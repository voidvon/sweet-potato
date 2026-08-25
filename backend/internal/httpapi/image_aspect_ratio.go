package httpapi

import (
	"bytes"
	"fmt"
	"image"
	"image/draw"
	"image/jpeg"
	"image/png"
	"math"
	"regexp"
	"strconv"
	"strings"

	"sweet-potato-go/internal/store"
)

var explicitImageAspectRatioPattern = regexp.MustCompile(`(?i)(?:图片|画面|画布|宽高|纵横)?\s*(?:比例|aspect\s*ratio)\s*(?:为|是|of|[:：=])?\s*(\d+(?:\.\d+)?)\s*[:：]\s*(\d+(?:\.\d+)?)`)

func resolveImageGenerationAspectRatio(content string, contextValue map[string]any, history []store.ChatMessage, currentMessageID string) map[string]any {
	result := cloneStringAnyMap(contextValue)
	generation := cloneStringAnyMap(objectValue(result["imageGeneration"]))
	currentRatio := stringValue(generation, "aspectRatio")
	if currentRatio != "" && !strings.EqualFold(currentRatio, "auto") {
		result["imageGeneration"] = generation
		return result
	}
	if ratio := explicitImageAspectRatio(strings.Join([]string{content, stringValue(generation, "promptText")}, "\n")); ratio != "" {
		generation["aspectRatio"] = ratio
		result["imageGeneration"] = generation
		return result
	}
	for index := len(history) - 1; index >= 0; index-- {
		message := history[index]
		if message.ID == currentMessageID || message.Role != "user" {
			continue
		}
		previousGeneration := objectValue(message.CapabilityContext["imageGeneration"])
		ratio := stringValue(previousGeneration, "aspectRatio")
		if ratio == "" || strings.EqualFold(ratio, "auto") {
			ratio = explicitImageAspectRatio(strings.Join([]string{message.Content, stringValue(previousGeneration, "promptText")}, "\n"))
		}
		if ratio != "" && !strings.EqualFold(ratio, "auto") {
			generation["aspectRatio"] = ratio
			break
		}
	}
	result["imageGeneration"] = generation
	return result
}

func cloneStringAnyMap(source map[string]any) map[string]any {
	result := make(map[string]any, len(source))
	for key, value := range source {
		result[key] = value
	}
	return result
}

func explicitImageAspectRatio(value string) string {
	match := explicitImageAspectRatioPattern.FindStringSubmatch(value)
	if len(match) != 3 {
		return ""
	}
	left, leftErr := strconv.ParseFloat(match[1], 64)
	right, rightErr := strconv.ParseFloat(match[2], 64)
	if leftErr != nil || rightErr != nil || left <= 0 || right <= 0 || left/right < 0.1 || left/right > 10 {
		return ""
	}
	return match[1] + ":" + match[2]
}

func cropImageToAspectRatio(data []byte, mimeType, ratio string) ([]byte, error) {
	target, ok := numericAspectRatio(ratio)
	if !ok || len(data) == 0 {
		return data, nil
	}
	switch strings.ToLower(strings.TrimSpace(mimeType)) {
	case "", "image/png", "image/jpeg", "image/jpg":
	default:
		return data, nil
	}
	source, format, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	bounds := source.Bounds()
	width, height := bounds.Dx(), bounds.Dy()
	if width <= 0 || height <= 0 || math.Abs(float64(width)/float64(height)-target)/target <= 0.005 {
		return data, nil
	}
	cropWidth, cropHeight := width, height
	if float64(width)/float64(height) > target {
		cropWidth = int(math.Round(float64(height) * target))
	} else {
		cropHeight = int(math.Round(float64(width) / target))
	}
	cropWidth = min(cropWidth, width)
	cropHeight = min(cropHeight, height)
	left := bounds.Min.X + (width-cropWidth)/2
	top := bounds.Min.Y + (height-cropHeight)/2
	destination := image.NewRGBA(image.Rect(0, 0, cropWidth, cropHeight))
	draw.Draw(destination, destination.Bounds(), source, image.Point{X: left, Y: top}, draw.Src)

	var output bytes.Buffer
	switch strings.ToLower(strings.TrimSpace(format)) {
	case "jpeg":
		err = jpeg.Encode(&output, destination, &jpeg.Options{Quality: 95})
	case "png":
		err = png.Encode(&output, destination)
	default:
		return data, nil
	}
	if err != nil {
		return nil, fmt.Errorf("编码比例校正图片失败: %w", err)
	}
	return output.Bytes(), nil
}

func numericAspectRatio(value string) (float64, bool) {
	parts := strings.FieldsFunc(strings.TrimSpace(value), func(character rune) bool { return character == ':' || character == '：' })
	if len(parts) != 2 {
		return 0, false
	}
	left, leftErr := strconv.ParseFloat(strings.TrimSpace(parts[0]), 64)
	right, rightErr := strconv.ParseFloat(strings.TrimSpace(parts[1]), 64)
	if leftErr != nil || rightErr != nil || left <= 0 || right <= 0 {
		return 0, false
	}
	ratio := left / right
	return ratio, ratio >= 0.1 && ratio <= 10
}
