package assetextract

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

const (
	maxPPTXBytes             = 50 * 1024 * 1024
	maxPPTXEntries           = 2_000
	maxPPTXUncompressedBytes = 250 * 1024 * 1024
	maxPPTXXMLBytes          = 10 * 1024 * 1024
	maxPPTXImageBytes        = 50 * 1024 * 1024
	maxPPTXImages            = 100
)

var pptxSlidePattern = regexp.MustCompile(`^ppt/slides/slide([0-9]+)\.xml$`)

type PPTXParser struct{}

func NewPPTXParser() *PPTXParser { return &PPTXParser{} }

func (p *PPTXParser) Descriptor() Descriptor {
	return Descriptor{Name: "pptx-openxml", Version: "1", Kinds: []string{"presentation"}}
}

func (p *PPTXParser) Supports(input Input) bool {
	return normalizedMimeType(input.MimeType) == "application/vnd.openxmlformats-officedocument.presentationml.presentation" || strings.EqualFold(filepath.Ext(input.FileName), ".pptx")
}

type pptxXMLNode struct {
	Name     string
	Attrs    map[string]string
	Text     string
	Children []*pptxXMLNode
}

type pptxPlacement = ImagePlacement

type pptxImage struct {
	ID                    string
	FileName              string
	MimeType              string
	Hash                  string
	Data                  []byte
	SlideNumbers          []int
	Placements            []pptxPlacement
	HasTransparentChannel bool
	PreviewOmitted        bool
	Category              string
	Included              bool
	FilterConfidence      float64
	FilterReasons         []string
}

func (p *PPTXParser) Parse(ctx context.Context, input Input) (Result, error) {
	if !strings.EqualFold(filepath.Ext(input.FileName), ".pptx") {
		return Result{}, errors.New("仅支持 .pptx 演示文稿")
	}
	data, err := readPPTXInput(input)
	if err != nil {
		return Result{}, err
	}
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return Result{}, errors.New("文件不是有效的 PPTX 演示文稿")
	}
	if len(reader.File) > maxPPTXEntries {
		return Result{}, fmt.Errorf("PPTX 内部文件数量超过 %d", maxPPTXEntries)
	}
	files := make(map[string]*zip.File, len(reader.File))
	var totalUncompressed uint64
	for _, file := range reader.File {
		cleanName := path.Clean(strings.TrimPrefix(file.Name, "/"))
		if cleanName == "." || cleanName == ".." || strings.HasPrefix(cleanName, "../") {
			return Result{}, errors.New("PPTX 包含不安全的内部路径")
		}
		totalUncompressed += file.UncompressedSize64
		if totalUncompressed > maxPPTXUncompressedBytes {
			return Result{}, errors.New("PPTX 解压后内容过大")
		}
		files[cleanName] = file
	}
	presentationFile := files["ppt/presentation.xml"]
	if files["[Content_Types].xml"] == nil || presentationFile == nil {
		return Result{}, errors.New("文件不是有效的 PPTX 演示文稿")
	}
	presentationData, err := readZipEntry(presentationFile, maxPPTXXMLBytes)
	if err != nil {
		return Result{}, fmt.Errorf("读取 PPTX 清单失败: %w", err)
	}
	presentation, err := parsePPTXXML(presentationData)
	if err != nil {
		return Result{}, fmt.Errorf("解析 PPTX 清单失败: %w", err)
	}
	slideWidth, slideHeight := 12_192_000.0, 6_858_000.0
	if size := findPPTXNode(presentation, "sldSz"); size != nil {
		slideWidth = pptxFloatAttr(size, "cx", slideWidth)
		slideHeight = pptxFloatAttr(size, "cy", slideHeight)
	}

	type slideFile struct {
		name   string
		number int
	}
	slides := make([]slideFile, 0)
	for name := range files {
		match := pptxSlidePattern.FindStringSubmatch(name)
		if len(match) != 2 {
			continue
		}
		number, _ := strconv.Atoi(match[1])
		slides = append(slides, slideFile{name: name, number: number})
	}
	sort.Slice(slides, func(i, j int) bool { return slides[i].number < slides[j].number })

	imagesByPath := map[string]*pptxImage{}
	units := make([]ContentUnit, 0, len(slides))
	allText := make([]string, 0, len(slides))
	warnings := []string{}
	for slideIndex, slideEntry := range slides {
		if err := ctx.Err(); err != nil {
			return Result{}, err
		}
		slideData, readErr := readZipEntry(files[slideEntry.name], maxPPTXXMLBytes)
		if readErr != nil {
			return Result{}, fmt.Errorf("读取第 %d 页幻灯片失败: %w", slideIndex+1, readErr)
		}
		slide, parseErr := parsePPTXXML(slideData)
		if parseErr != nil {
			return Result{}, fmt.Errorf("解析第 %d 页幻灯片失败: %w", slideIndex+1, parseErr)
		}
		texts := collectPPTXTexts(slide)
		text := strings.Join(texts, " ")
		if text != "" {
			allText = append(allText, text)
		}
		embeddedIDs := stringSet(collectPPTXAttrs(slide, "embed"))
		placements := collectPPTXPlacements(slide, slideIndex+1, slideWidth, slideHeight)
		relName := path.Join(path.Dir(slideEntry.name), "_rels", path.Base(slideEntry.name)+".rels")
		artifactIDs := []string{}
		if relationshipsFile := files[relName]; relationshipsFile != nil && len(embeddedIDs) > 0 {
			relData, relReadErr := readZipEntry(relationshipsFile, maxPPTXXMLBytes)
			if relReadErr != nil {
				return Result{}, fmt.Errorf("读取第 %d 页关联关系失败: %w", slideIndex+1, relReadErr)
			}
			relRoot, relParseErr := parsePPTXXML(relData)
			if relParseErr != nil {
				return Result{}, fmt.Errorf("解析第 %d 页关联关系失败: %w", slideIndex+1, relParseErr)
			}
			for _, relationship := range findAllPPTXNodes(relRoot, "Relationship") {
				id := relationship.Attrs["Id"]
				target := relationship.Attrs["Target"]
				typeName := relationship.Attrs["Type"]
				if id == "" || target == "" || !embeddedIDs[id] || !strings.HasSuffix(typeName, "/image") || strings.EqualFold(relationship.Attrs["TargetMode"], "External") {
					continue
				}
				imagePath := path.Clean(path.Join(path.Dir(slideEntry.name), target))
				if strings.HasPrefix(imagePath, "../") || !strings.HasPrefix(imagePath, "ppt/") {
					continue
				}
				imageFile := files[imagePath]
				if imageFile == nil {
					continue
				}
				imageID := sanitizeArtifactID(imagePath)
				if existing := imagesByPath[imagePath]; existing != nil {
					artifactIDs = appendUniqueString(artifactIDs, imageID)
					existing.SlideNumbers = appendUniqueInt(existing.SlideNumbers, slideIndex+1)
					existing.Placements = append(existing.Placements, placements[id]...)
					continue
				}
				if len(imagesByPath) >= maxPPTXImages {
					continue
				}
				imageData, imageErr := readZipEntry(imageFile, maxPPTXImageBytes)
				if imageErr != nil {
					return Result{}, fmt.Errorf("读取 PPTX 内嵌图片失败: %w", imageErr)
				}
				artifactIDs = appendUniqueString(artifactIDs, imageID)
				hash := sha256.Sum256(imageData)
				mimeType := imageMimeType(imagePath)
				imagesByPath[imagePath] = &pptxImage{
					ID: imageID, FileName: path.Base(imagePath), MimeType: mimeType, Hash: hex.EncodeToString(hash[:]), Data: imageData,
					SlideNumbers: []int{slideIndex + 1}, Placements: placements[id], HasTransparentChannel: ImageHasTransparentChannel(mimeType, imageData),
					PreviewOmitted: mimeType == "image/emf" || mimeType == "image/wmf", Category: "content", Included: true, FilterConfidence: 0.5,
				}
			}
		}
		units = append(units, ContentUnit{Locator: Locator{Kind: "slide", Index: slideIndex + 1}, Text: text, ArtifactIDs: artifactIDs, Metadata: map[string]any{"texts": texts}})
	}
	if len(imagesByPath) >= maxPPTXImages {
		warnings = append(warnings, "仅提取前 100 个内嵌图片")
	}

	imagesByHash := map[string][]*pptxImage{}
	for _, image := range imagesByPath {
		imagesByHash[image.Hash] = append(imagesByHash[image.Hash], image)
		if image.PreviewOmitted {
			warnings = appendUniqueString(warnings, "EMF 或 WMF 图片无法直接在浏览器中预览")
		}
	}
	artifacts := make([]Artifact, 0, len(imagesByPath))
	for _, image := range imagesByPath {
		classifyPPTXImage(image, imagesByHash[image.Hash], len(slides))
		artifacts = append(artifacts, Artifact{
			ID: image.ID, Kind: "embedded-image", FileName: image.FileName, MimeType: image.MimeType, Data: image.Data,
			Metadata: map[string]any{
				"contentHash": image.Hash, "size": len(image.Data), "slideNumbers": image.SlideNumbers, "placements": placementMetadata(image.Placements),
				"hasTransparentChannel": image.HasTransparentChannel, "previewOmitted": image.PreviewOmitted, "imageFilterVersion": ImageFilterVersion, "category": image.Category,
				"included": image.Included, "filterConfidence": image.FilterConfidence, "filterReasons": image.FilterReasons,
			},
		})
	}
	sort.Slice(artifacts, func(i, j int) bool { return artifacts[i].ID < artifacts[j].ID })
	return Result{
		FileName: input.FileName, Kind: "presentation", Parser: p.Descriptor().Name, Version: p.Descriptor().Version,
		Text: strings.Join(allText, "\n"), Units: units, Artifacts: artifacts, Metadata: map[string]any{"slideCount": len(slides)}, Warnings: warnings,
	}, nil
}

func readPPTXInput(input Input) ([]byte, error) {
	if len(input.Bytes) > 0 {
		if len(input.Bytes) > maxPPTXBytes {
			return nil, errors.New("PPTX 文件不能超过 50 MB")
		}
		return input.Bytes, nil
	}
	if input.FilePath == "" {
		return nil, errors.New("PPTX 文件内容为空")
	}
	info, err := os.Stat(input.FilePath)
	if err != nil {
		return nil, fmt.Errorf("读取 PPTX 文件失败: %w", err)
	}
	if info.Size() > maxPPTXBytes {
		return nil, errors.New("PPTX 文件不能超过 50 MB")
	}
	return os.ReadFile(input.FilePath)
}

func readZipEntry(file *zip.File, limit uint64) ([]byte, error) {
	if file == nil {
		return nil, errors.New("内部文件不存在")
	}
	if file.UncompressedSize64 > limit {
		return nil, errors.New("内部文件解压后过大")
	}
	reader, err := file.Open()
	if err != nil {
		return nil, err
	}
	defer reader.Close()
	data, err := io.ReadAll(io.LimitReader(reader, int64(limit)+1))
	if err != nil {
		return nil, err
	}
	if uint64(len(data)) > limit {
		return nil, errors.New("内部文件解压后过大")
	}
	return data, nil
}

func parsePPTXXML(data []byte) (*pptxXMLNode, error) {
	decoder := xml.NewDecoder(bytes.NewReader(data))
	var root *pptxXMLNode
	stack := []*pptxXMLNode{}
	for {
		token, err := decoder.Token()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, err
		}
		switch value := token.(type) {
		case xml.StartElement:
			node := &pptxXMLNode{Name: value.Name.Local, Attrs: map[string]string{}}
			for _, attr := range value.Attr {
				node.Attrs[attr.Name.Local] = attr.Value
			}
			if len(stack) > 0 {
				stack[len(stack)-1].Children = append(stack[len(stack)-1].Children, node)
			} else {
				root = node
			}
			stack = append(stack, node)
		case xml.CharData:
			if len(stack) > 0 {
				stack[len(stack)-1].Text += string(value)
			}
		case xml.EndElement:
			if len(stack) > 0 {
				stack = stack[:len(stack)-1]
			}
		}
	}
	if root == nil {
		return nil, errors.New("XML 内容为空")
	}
	return root, nil
}

func findPPTXNode(node *pptxXMLNode, name string) *pptxXMLNode {
	if node == nil {
		return nil
	}
	if node.Name == name {
		return node
	}
	for _, child := range node.Children {
		if found := findPPTXNode(child, name); found != nil {
			return found
		}
	}
	return nil
}

func findAllPPTXNodes(node *pptxXMLNode, name string) []*pptxXMLNode {
	result := []*pptxXMLNode{}
	var walk func(*pptxXMLNode)
	walk = func(current *pptxXMLNode) {
		if current == nil {
			return
		}
		if current.Name == name {
			result = append(result, current)
		}
		for _, child := range current.Children {
			walk(child)
		}
	}
	walk(node)
	return result
}

func collectPPTXTexts(node *pptxXMLNode) []string {
	result := []string{}
	for _, item := range findAllPPTXNodes(node, "t") {
		if text := strings.TrimSpace(item.Text); text != "" {
			result = append(result, text)
		}
	}
	return result
}

func collectPPTXAttrs(node *pptxXMLNode, name string) []string {
	result := []string{}
	var walk func(*pptxXMLNode)
	walk = func(current *pptxXMLNode) {
		if current == nil {
			return
		}
		if value := strings.TrimSpace(current.Attrs[name]); value != "" {
			result = append(result, value)
		}
		for _, child := range current.Children {
			walk(child)
		}
	}
	walk(node)
	return result
}

func collectPPTXPlacements(root *pptxXMLNode, slideNumber int, slideWidth, slideHeight float64) map[string][]pptxPlacement {
	result := map[string][]pptxPlacement{}
	var walk func(*pptxXMLNode)
	walk = func(node *pptxXMLNode) {
		if node == nil {
			return
		}
		if node.Name == "pic" || node.Name == "sp" || node.Name == "bg" {
			ids := collectPPTXAttrs(node, "embed")
			if len(ids) > 0 {
				placement := pptxPlacement{UnitIndex: slideNumber, IsDocumentBackground: node.Name == "bg"}
				transform := findPPTXNode(node, "xfrm")
				offset, extent := findPPTXNode(transform, "off"), findPPTXNode(transform, "ext")
				x, xOK := pptxOptionalFloatAttr(offset, "x")
				y, yOK := pptxOptionalFloatAttr(offset, "y")
				width, widthOK := pptxOptionalFloatAttr(extent, "cx")
				height, heightOK := pptxOptionalFloatAttr(extent, "cy")
				if xOK && yOK && widthOK && heightOK && slideWidth > 0 && slideHeight > 0 {
					placement.XRatio = floatPointer(x / slideWidth)
					placement.YRatio = floatPointer(y / slideHeight)
					placement.WidthRatio = floatPointer(width / slideWidth)
					placement.HeightRatio = floatPointer(height / slideHeight)
					placement.AreaRatio = floatPointer((width * height) / (slideWidth * slideHeight))
				} else if placement.IsDocumentBackground {
					placement.AreaRatio = floatPointer(1)
				}
				for _, id := range ids {
					result[id] = append(result[id], placement)
				}
			}
		}
		for _, child := range node.Children {
			walk(child)
		}
	}
	walk(root)
	return result
}

func pptxOptionalFloatAttr(node *pptxXMLNode, name string) (float64, bool) {
	if node == nil {
		return 0, false
	}
	value, err := strconv.ParseFloat(node.Attrs[name], 64)
	return value, err == nil
}

func pptxFloatAttr(node *pptxXMLNode, name string, fallback float64) float64 {
	if value, ok := pptxOptionalFloatAttr(node, name); ok {
		return value
	}
	return fallback
}

func classifyPPTXImage(image *pptxImage, equivalent []*pptxImage, slideCount int) {
	placements := []pptxPlacement{}
	unitIndexes := []int{}
	for _, candidate := range equivalent {
		placements = append(placements, candidate.Placements...)
		for _, slide := range candidate.SlideNumbers {
			unitIndexes = appendUniqueInt(unitIndexes, slide)
		}
	}
	filter := FilterImage(ImageFilterInput{
		Role:                  ImageRoleEmbedded,
		Size:                  len(image.Data),
		HasTransparentChannel: image.HasTransparentChannel,
		Placements:            placements,
		UnitIndexes:           unitIndexes,
		UnitCount:             slideCount,
	})
	image.Category = filter.Category
	image.Included = filter.Included
	image.FilterConfidence = filter.Confidence
	image.FilterReasons = filter.Reasons
}

func imageMimeType(fileName string) string {
	switch strings.ToLower(filepath.Ext(fileName)) {
	case ".avif":
		return "image/avif"
	case ".bmp":
		return "image/bmp"
	case ".emf":
		return "image/emf"
	case ".gif":
		return "image/gif"
	case ".jpeg", ".jpg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".svg":
		return "image/svg+xml"
	case ".tif", ".tiff":
		return "image/tiff"
	case ".webp":
		return "image/webp"
	case ".wmf":
		return "image/wmf"
	default:
		return "application/octet-stream"
	}
}

func placementMetadata(placements []pptxPlacement) []map[string]any {
	result := make([]map[string]any, 0, len(placements))
	for _, placement := range placements {
		item := map[string]any{"slideNumber": placement.UnitIndex, "isSlideBackground": placement.IsDocumentBackground}
		putFloat := func(key string, value *float64) {
			if value != nil {
				item[key] = *value
			}
		}
		putFloat("xRatio", placement.XRatio)
		putFloat("yRatio", placement.YRatio)
		putFloat("widthRatio", placement.WidthRatio)
		putFloat("heightRatio", placement.HeightRatio)
		putFloat("areaRatio", placement.AreaRatio)
		result = append(result, item)
	}
	return result
}

func sanitizeArtifactID(value string) string {
	var builder strings.Builder
	for _, char := range value {
		if char >= 'a' && char <= 'z' || char >= 'A' && char <= 'Z' || char >= '0' && char <= '9' || char == '_' || char == '-' {
			builder.WriteRune(char)
		} else {
			builder.WriteByte('-')
		}
	}
	return builder.String()
}

func stringSet(values []string) map[string]bool {
	result := map[string]bool{}
	for _, value := range values {
		result[value] = true
	}
	return result
}
func appendUniqueString(values []string, value string) []string {
	for _, current := range values {
		if current == value {
			return values
		}
	}
	return append(values, value)
}
func appendUniqueInt(values []int, value int) []int {
	for _, current := range values {
		if current == value {
			return values
		}
	}
	return append(values, value)
}
