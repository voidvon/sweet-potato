package imagegen

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"testing"
)

func TestApplyGreenChromaKeyRemovesStrongGreen(t *testing.T) {
	green := color.NRGBA{G: 255, A: 255}
	red := color.NRGBA{R: 220, G: 20, B: 20, A: 255}
	pixels := make([]color.NRGBA, 25)
	for index := range pixels {
		pixels[index] = green
	}
	for _, index := range []int{6, 7, 8, 11, 13, 16, 17, 18} {
		pixels[index] = red
	}
	result := decodeChromaKeyResult(t, encodeChromaKeyInput(t, 5, 5, pixels))
	if got := result.NRGBAAt(2, 2).A; got != 0 {
		t.Fatalf("center alpha = %d, want 0", got)
	}
	if got := result.NRGBAAt(1, 1).A; got != 255 {
		t.Fatalf("foreground alpha = %d, want 255", got)
	}
}

func TestApplyGreenChromaKeyPreservesIsolatedForegroundGreen(t *testing.T) {
	green := color.NRGBA{G: 255, A: 255}
	red := color.NRGBA{R: 220, G: 20, B: 20, A: 255}
	pixels := make([]color.NRGBA, 25)
	for index := range pixels {
		pixels[index] = green
	}
	for _, index := range []int{6, 7, 8, 11, 13, 16, 17, 18} {
		pixels[index] = red
	}
	pixels[12] = color.NRGBA{R: 30, G: 120, B: 35, A: 255}
	result := decodeChromaKeyResult(t, encodeChromaKeyInput(t, 5, 5, pixels))
	if got := result.NRGBAAt(2, 2).A; got != 255 {
		t.Fatalf("isolated green alpha = %d, want 255", got)
	}
}

func TestApplyGreenChromaKeyCreatesSoftConnectedEdge(t *testing.T) {
	result := decodeChromaKeyResult(t, encodeChromaKeyInput(t, 3, 1, []color.NRGBA{
		{G: 255, A: 255},
		{R: 60, G: 120, B: 55, A: 255},
		{R: 220, G: 20, B: 20, A: 255},
	}))
	edgeAlpha := result.NRGBAAt(1, 0).A
	if edgeAlpha == 0 || edgeAlpha == 255 {
		t.Fatalf("edge alpha = %d, want soft alpha", edgeAlpha)
	}
	if got := result.NRGBAAt(2, 0).A; got != 255 {
		t.Fatalf("foreground alpha = %d, want 255", got)
	}
}

func encodeChromaKeyInput(t *testing.T, width, height int, pixels []color.NRGBA) []byte {
	t.Helper()
	input := image.NewNRGBA(image.Rect(0, 0, width, height))
	for index, pixel := range pixels {
		input.SetNRGBA(index%width, index/width, pixel)
	}
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, input); err != nil {
		t.Fatalf("encode input: %v", err)
	}
	return encoded.Bytes()
}

func decodeChromaKeyResult(t *testing.T, input []byte) *image.NRGBA {
	t.Helper()
	result, err := ApplyGreenChromaKey(input)
	if err != nil {
		t.Fatalf("apply chroma key: %v", err)
	}
	decoded, err := png.Decode(bytes.NewReader(result))
	if err != nil {
		t.Fatalf("decode result: %v", err)
	}
	rgba, ok := decoded.(*image.NRGBA)
	if !ok {
		t.Fatalf("result type = %T, want *image.NRGBA", decoded)
	}
	return rgba
}
