package httpapi

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"testing"

	"sweet-potato-go/internal/imagegen"
)

func TestOptimizeGeneratedImageForStorageUsesLossyWebPForOpaquePNG(t *testing.T) {
	source := image.NewNRGBA(image.Rect(0, 0, 512, 512))
	for y := 0; y < 512; y++ {
		for x := 0; x < 512; x++ {
			source.SetNRGBA(x, y, color.NRGBA{
				R: uint8((x*17 + y*31) ^ (x * y)),
				G: uint8((x*43 + y*13) ^ (x + y*7)),
				B: uint8((x*29 + y*47) ^ (x*11 + y)),
				A: 255,
			})
		}
	}
	input := encodeStorageTestPNG(t, source)

	output, metadata := optimizeGeneratedImageForStorage(imagegen.Output{Bytes: input, MimeType: "image/png"})
	if output.MimeType != "image/webp" {
		t.Fatalf("mime type = %q, want image/webp", output.MimeType)
	}
	if len(output.Bytes) >= len(input) {
		t.Fatalf("encoded size = %d, want smaller than %d", len(output.Bytes), len(input))
	}
	if metadata["encodingApplied"] != true || metadata["encodingQuality"] != generatedImageWebPQuality {
		t.Fatalf("metadata = %#v", metadata)
	}
}

func TestOptimizeGeneratedImageForStorageUsesLosslessWebPForTransparency(t *testing.T) {
	source := image.NewNRGBA(image.Rect(0, 0, 512, 512))
	for y := 0; y < 512; y++ {
		for x := 0; x < 512; x++ {
			alpha := uint8(255)
			if x < 256 {
				alpha = 0
			}
			source.SetNRGBA(x, y, color.NRGBA{R: 220, G: 40, B: 80, A: alpha})
		}
	}
	input := encodeStorageTestPNG(t, source)

	output, metadata := optimizeGeneratedImageForStorage(imagegen.Output{Bytes: input, MimeType: "image/png"})
	if output.MimeType != "image/webp" || metadata["encodingLossless"] != true {
		t.Fatalf("output mime = %q, metadata = %#v", output.MimeType, metadata)
	}
	decoded, _, err := image.Decode(bytes.NewReader(output.Bytes))
	if err != nil {
		t.Fatalf("decode WebP: %v", err)
	}
	_, _, _, alpha := decoded.At(0, 0).RGBA()
	if alpha != 0 {
		t.Fatalf("transparent pixel alpha = %d, want 0", alpha)
	}
}

func encodeStorageTestPNG(t *testing.T, source image.Image) []byte {
	t.Helper()
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, source); err != nil {
		t.Fatalf("encode PNG: %v", err)
	}
	return encoded.Bytes()
}
