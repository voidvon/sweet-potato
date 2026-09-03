package httpapi

import (
	"bytes"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	"image/png"
	"math"
	"regexp"
	"strconv"
	"strings"

	"github.com/gen2brain/webp"

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
	// For detail images, an explicit automatic selection must not inherit a
	// previous chapter's fixed ratio. The current request can still opt into a
	// fixed ratio by stating it in the message, handled above.
	if isPlannedCommerceImageMode(generation) {
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

// fitImageToAspectRatio preserves every source pixel and adds canvas space when
// the provider returns a different ratio than the explicitly requested one.
// Cropping is intentionally never used because generated product details may
// be located at any edge of the image.
func fitImageToAspectRatio(data []byte, mimeType, ratio string) ([]byte, error) {
	target, ok := numericAspectRatio(ratio)
	if !ok || len(data) == 0 {
		return data, nil
	}
	mediaType := strings.ToLower(strings.TrimSpace(strings.SplitN(mimeType, ";", 2)[0]))
	switch mediaType {
	case "", "image/png", "image/jpeg", "image/jpg", "image/webp":
	default:
		return data, nil
	}
	source, format, err := decodeAspectRatioImage(data, mediaType)
	if err != nil {
		return nil, err
	}
	bounds := source.Bounds()
	width, height := bounds.Dx(), bounds.Dy()
	if width <= 0 || height <= 0 || math.Abs(float64(width)/float64(height)-target)/target <= 0.000001 {
		return data, nil
	}
	numerator, denominator := aspectRatioFraction(ratio, target)
	canvasWidth, canvasHeight := width, height
	fitted := false
	if numerator > 0 && denominator > 0 {
		scale := math.Max(math.Ceil(float64(width)/float64(numerator)), math.Ceil(float64(height)/float64(denominator)))
		if scale > 0 && scale <= float64(math.MaxInt/2) {
			canvasWidth = max(width, int(numerator*int64(scale)))
			canvasHeight = max(height, int(denominator*int64(scale)))
			fitted = canvasWidth >= width && canvasHeight >= height
		}
	}
	if !fitted && float64(width)/float64(height) > target {
		canvasHeight = max(height, int(math.Ceil(float64(width)/target)))
	} else if !fitted {
		canvasWidth = max(width, int(math.Ceil(float64(height)*target)))
	}
	destination := image.NewRGBA(image.Rect(0, 0, canvasWidth, canvasHeight))
	hasTransparency := imageHasTransparency(source)
	if !hasTransparency || format == "jpeg" {
		draw.Draw(destination, destination.Bounds(), &image.Uniform{C: color.White}, image.Point{}, draw.Src)
	}
	left := (canvasWidth - width) / 2
	top := (canvasHeight - height) / 2
	draw.Draw(destination, image.Rect(left, top, left+width, top+height), source, bounds.Min, draw.Src)

	var output bytes.Buffer
	switch strings.ToLower(strings.TrimSpace(format)) {
	case "jpeg":
		err = jpeg.Encode(&output, destination, &jpeg.Options{Quality: 95})
	case "png":
		err = png.Encode(&output, destination)
	case "webp":
		err = webp.Encode(&output, destination, webp.Options{Quality: 95, Method: 6, Lossless: hasTransparency})
	default:
		return data, nil
	}
	if err != nil {
		return nil, fmt.Errorf("编码比例适配图片失败: %w", err)
	}
	return output.Bytes(), nil
}

// cropImageToAspectRatio is kept as a compatibility alias for legacy callers;
// it now fits the image without discarding any content.
func cropImageToAspectRatio(data []byte, mimeType, ratio string) ([]byte, error) {
	return fitImageToAspectRatio(data, mimeType, ratio)
}

func decodeAspectRatioImage(data []byte, mediaType string) (image.Image, string, error) {
	if mediaType == "image/webp" {
		source, err := webp.Decode(bytes.NewReader(data))
		return source, "webp", err
	}
	source, format, err := image.Decode(bytes.NewReader(data))
	if err == nil {
		return source, format, nil
	}
	// A gateway can omit the MIME type even when it returns WebP.
	if mediaType == "" {
		source, webpErr := webp.Decode(bytes.NewReader(data))
		if webpErr == nil {
			return source, "webp", nil
		}
	}
	return nil, "", err
}

// aspectRatioFraction returns a bounded integer representation so the fitted
// canvas can preserve a strict ratio even for small source images. User-facing
// ratios are normally simple integers (3:4, 16:9); unusual decimal ratios are
// rounded to three decimal places to avoid allocating an unexpectedly huge
// canvas.
func aspectRatioFraction(value string, target float64) (int64, int64) {
	parts := strings.FieldsFunc(strings.TrimSpace(value), func(character rune) bool { return character == ':' || character == '：' })
	if len(parts) != 2 {
		return 0, 0
	}
	left, leftDigits, leftOK := decimalFractionPart(parts[0])
	right, rightDigits, rightOK := decimalFractionPart(parts[1])
	if !leftOK || !rightOK || left <= 0 || right <= 0 {
		return 0, 0
	}
	scale := int64(1)
	for index := 0; index < max(leftDigits, rightDigits); index++ {
		scale *= 10
	}
	left *= scale / intPow10(leftDigits)
	right *= scale / intPow10(rightDigits)
	if max(left, right) > 10000 {
		scale = 1000
		left = max(int64(1), int64(math.Round(target*float64(scale))))
		right = scale
	}
	divisor := gcdInt64(left, right)
	return left / divisor, right / divisor
}

func decimalFractionPart(value string) (int64, int, bool) {
	value = strings.TrimSpace(value)
	parts := strings.SplitN(value, ".", 2)
	if len(parts) > 2 || parts[0] == "" {
		return 0, 0, false
	}
	whole, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil || whole < 0 {
		return 0, 0, false
	}
	fraction := ""
	if len(parts) == 2 {
		fraction = parts[1]
		if fraction == "" {
			return 0, 0, false
		}
		for _, character := range fraction {
			if character < '0' || character > '9' {
				return 0, 0, false
			}
		}
	}
	digits := min(len(fraction), 6)
	if len(fraction) > digits {
		fraction = fraction[:digits]
	}
	denominator := intPow10(digits)
	fractionValue := int64(0)
	if fraction != "" {
		fractionValue, err = strconv.ParseInt(fraction, 10, 64)
		if err != nil {
			return 0, 0, false
		}
	}
	if whole > (math.MaxInt64-fractionValue)/denominator {
		return 0, 0, false
	}
	return whole*denominator + fractionValue, digits, true
}

func intPow10(exponent int) int64 {
	result := int64(1)
	for index := 0; index < exponent; index++ {
		result *= 10
	}
	return result
}

func gcdInt64(left, right int64) int64 {
	for right != 0 {
		left, right = right, left%right
	}
	if left < 0 {
		return -left
	}
	return max(int64(1), left)
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
