package httpapi

import (
	"bytes"
	"image"
	"strings"

	"github.com/gen2brain/webp"

	"sweet-potato-go/internal/imagegen"
)

const generatedImageWebPQuality = 90

func optimizeGeneratedImageForStorage(output imagegen.Output) (imagegen.Output, map[string]any) {
	sourceMimeType := normalizedImageMimeType(output.MimeType)
	originalSize := len(output.Bytes)
	metadata := map[string]any{
		"sourceMimeType":  sourceMimeType,
		"originalSize":    originalSize,
		"encodedSize":     originalSize,
		"encoding":        imageExtension(sourceMimeType),
		"encodingApplied": false,
	}
	if originalSize == 0 || sourceMimeType == "image/webp" {
		return output, metadata
	}
	switch sourceMimeType {
	case "image/png", "image/jpeg", "image/jpg":
	default:
		return output, metadata
	}

	source, _, err := image.Decode(bytes.NewReader(output.Bytes))
	if err != nil {
		return output, metadata
	}
	lossless := imageHasTransparency(source)
	var encoded bytes.Buffer
	if err := webp.Encode(&encoded, source, webp.Options{
		Quality:  generatedImageWebPQuality,
		Method:   6,
		Lossless: lossless,
	}); err != nil || encoded.Len() >= originalSize {
		return output, metadata
	}

	output.Bytes = encoded.Bytes()
	output.MimeType = "image/webp"
	metadata["encodedSize"] = encoded.Len()
	metadata["encoding"] = "webp"
	metadata["encodingApplied"] = true
	metadata["encodingLossless"] = lossless
	metadata["savedBytes"] = originalSize - encoded.Len()
	if !lossless {
		metadata["encodingQuality"] = generatedImageWebPQuality
	}
	return output, metadata
}

func normalizedImageMimeType(value string) string {
	value = strings.ToLower(strings.TrimSpace(strings.SplitN(value, ";", 2)[0]))
	if value == "" {
		return "image/png"
	}
	return value
}

func imageHasTransparency(source image.Image) bool {
	if opaque, ok := source.(interface{ Opaque() bool }); ok {
		return !opaque.Opaque()
	}
	bounds := source.Bounds()
	for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
		for x := bounds.Min.X; x < bounds.Max.X; x++ {
			_, _, _, alpha := source.At(x, y).RGBA()
			if alpha != 0xffff {
				return true
			}
		}
	}
	return false
}
