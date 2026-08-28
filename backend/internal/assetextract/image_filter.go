package assetextract

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"math"
)

const ImageFilterVersion = "1"

const minContentImageBytes = 50 * 1024

type ImageRole string

const (
	ImageRoleEmbedded     ImageRole = "embedded"
	ImageRoleDocumentPage ImageRole = "document-page"
)

type ImagePlacement struct {
	UnitIndex            int
	XRatio               *float64
	YRatio               *float64
	WidthRatio           *float64
	HeightRatio          *float64
	AreaRatio            *float64
	IsDocumentBackground bool
}

type ImageFilterInput struct {
	Role                  ImageRole
	Size                  int
	HasTransparentChannel bool
	Placements            []ImagePlacement
	UnitIndexes           []int
	UnitCount             int
}

type ImageFilterResult struct {
	Version    string
	Category   string
	Included   bool
	Confidence float64
	Reasons    []string
}

func FilterImage(input ImageFilterInput) ImageFilterResult {
	if input.Role == ImageRoleDocumentPage {
		return ImageFilterResult{
			Version: ImageFilterVersion, Category: "document-page", Included: true, Confidence: 1,
			Reasons: []string{"文档整页参考图需保留，不参与模板背景和装饰元素过滤"},
		}
	}

	known := make([]ImagePlacement, 0, len(input.Placements))
	maxArea := 0.0
	for _, placement := range input.Placements {
		if placement.AreaRatio != nil && placement.WidthRatio != nil && placement.HeightRatio != nil {
			known = append(known, placement)
			maxArea = math.Max(maxArea, *placement.AreaRatio)
		}
	}
	uniqueUnits := make(map[int]bool, len(input.UnitIndexes))
	for _, index := range input.UnitIndexes {
		uniqueUnits[index] = true
	}
	occurrenceRatio := 0.0
	if input.UnitCount > 0 {
		occurrenceRatio = float64(len(uniqueUnits)) / float64(input.UnitCount)
	}
	signatures := map[string]int{}
	for _, placement := range known {
		signature := fmt.Sprintf("%.0f:%.0f:%.0f:%.0f", filterRoundedRatio(placement.XRatio), filterRoundedRatio(placement.YRatio), filterRoundedRatio(placement.WidthRatio), filterRoundedRatio(placement.HeightRatio))
		signatures[signature]++
	}
	maxSignature := 0
	for _, count := range signatures {
		if count > maxSignature {
			maxSignature = count
		}
	}
	samePosition := len(known) > 1 && float64(maxSignature)/float64(len(known)) >= 0.8
	inCorner := len(known) > 0
	isThinLine := len(known) > 0
	for _, placement := range known {
		centerX := filterPointerValue(placement.XRatio) + filterPointerValue(placement.WidthRatio)/2
		centerY := filterPointerValue(placement.YRatio) + filterPointerValue(placement.HeightRatio)/2
		if !((centerX <= 0.22 || centerX >= 0.78) && (centerY <= 0.22 || centerY >= 0.78)) {
			inCorner = false
		}
		width, height := filterPointerValue(placement.WidthRatio), filterPointerValue(placement.HeightRatio)
		if width <= 0 || height <= 0 || math.Max(width/height, height/width) < 10 || math.Min(width, height) > 0.04 {
			isThinLine = false
		}
	}

	result := ImageFilterResult{Version: ImageFilterVersion, Category: "content", Included: true, Confidence: 0.5}
	hardReasons := []string{}
	if input.Size < minContentImageBytes {
		hardReasons = append(hardReasons, fmt.Sprintf("文件大小为 %.1f KB，小于 50 KB", float64(input.Size)/1024))
	}
	if input.HasTransparentChannel {
		hardReasons = append(hardReasons, "图片包含透明通道")
	}
	if len(hardReasons) > 0 {
		result.Category, result.Included, result.Confidence, result.Reasons = "small-file", false, 1, hardReasons
		if input.HasTransparentChannel {
			result.Category = "transparent"
		}
	} else if hasDocumentBackgroundPlacement(input.Placements) || maxArea >= 0.72 {
		result.Category, result.Included, result.Confidence, result.Reasons = "background", false, 0.96, []string{"图片覆盖至少 72% 的页面，判定为背景图"}
	} else if isThinLine {
		result.Category, result.Included, result.Confidence, result.Reasons = "decorative-line", false, 0.97, []string{"图片宽高比极端且短边很窄，判定为装饰线"}
	} else if len(uniqueUnits) >= 2 && occurrenceRatio >= 0.35 && samePosition && inCorner && maxArea <= 0.08 {
		result.Category, result.Included, result.Confidence, result.Reasons = "logo", false, 0.93, []string{fmt.Sprintf("图片在 %d 页的相同角落重复出现，且面积不超过页面的 8%%", len(uniqueUnits))}
	} else if len(known) > 0 && maxArea <= 0.025 {
		result.Category, result.Included, result.Confidence, result.Reasons = "icon", false, 0.86, []string{"图片最大面积不超过页面的 2.5%，判定为图标或小装饰"}
	} else if len(known) > 0 && inCorner && maxArea <= 0.08 {
		result.Category, result.Included, result.Confidence, result.Reasons = "decoration", false, 0.74, []string{"图片位于页面角落且面积不超过 8%，判定为角标或装饰"}
	} else if len(uniqueUnits) >= 2 && occurrenceRatio >= 0.5 && samePosition && maxArea <= 0.18 {
		result.Category, result.Included, result.Confidence, result.Reasons = "decoration", false, 0.88, []string{fmt.Sprintf("图片在 %d 页的相同位置重复出现，判定为模板装饰", len(uniqueUnits))}
	}
	return result
}

func (result ImageFilterResult) Metadata() map[string]any {
	return map[string]any{
		"imageFilterVersion": result.Version,
		"category":           result.Category,
		"included":           result.Included,
		"filterConfidence":   result.Confidence,
		"filterReasons":      result.Reasons,
	}
}

func ImageHasTransparentChannel(mimeType string, data []byte) bool {
	switch mimeType {
	case "image/png":
		if len(data) < 8 || !bytes.Equal(data[:8], []byte{137, 80, 78, 71, 13, 10, 26, 10}) {
			return false
		}
		for offset := 8; offset+12 <= len(data); {
			length := int(binary.BigEndian.Uint32(data[offset : offset+4]))
			if length < 0 || offset+12+length > len(data) {
				break
			}
			typeName := string(data[offset+4 : offset+8])
			if typeName == "IHDR" && length >= 10 && (data[offset+17] == 4 || data[offset+17] == 6) {
				return true
			}
			if typeName == "tRNS" {
				return true
			}
			offset += length + 12
		}
	case "image/webp":
		if len(data) < 16 || string(data[:4]) != "RIFF" || string(data[8:12]) != "WEBP" {
			return false
		}
		for offset := 12; offset+8 <= len(data); {
			length := int(binary.LittleEndian.Uint32(data[offset+4 : offset+8]))
			dataOffset := offset + 8
			if length < 0 || dataOffset+length > len(data) {
				break
			}
			typeName := string(data[offset : offset+4])
			if typeName == "ALPH" || (typeName == "VP8X" && length > 0 && data[dataOffset]&0x10 != 0) || (typeName == "VP8L" && length > 4 && data[dataOffset] == 0x2f && data[dataOffset+4]&0x10 != 0) {
				return true
			}
			offset = dataOffset + length + length%2
		}
	case "image/gif":
		if len(data) < 6 || (string(data[:6]) != "GIF87a" && string(data[:6]) != "GIF89a") {
			return false
		}
		for index := 0; index+7 < len(data); index++ {
			if data[index] == 0x21 && data[index+1] == 0xf9 && data[index+2] == 0x04 && data[index+3]&0x01 != 0 {
				return true
			}
		}
	case "image/bmp":
		return len(data) >= 30 && int(data[28])+int(data[29])*256 == 32
	}
	return false
}

func hasDocumentBackgroundPlacement(placements []ImagePlacement) bool {
	for _, placement := range placements {
		if placement.IsDocumentBackground {
			return true
		}
	}
	return false
}

func filterPointerValue(value *float64) float64 {
	if value == nil {
		return 0
	}
	return *value
}

func filterRoundedRatio(value *float64) float64 {
	return math.Round(filterPointerValue(value) * 20)
}

func floatPointer(value float64) *float64 { return &value }
