package imagegen

import (
	"bytes"
	"fmt"
	"image"
	"image/draw"
	_ "image/gif"
	_ "image/jpeg"
	"image/png"
)

const (
	opaqueAlpha        = 255
	strongGreenMinimum = 145
	softGreenMinimum   = 70
	strongGreenDelta   = 72
	softGreenDelta     = 18
)

// ApplyGreenChromaKey converts a generated green-screen image into a PNG with alpha.
func ApplyGreenChromaKey(data []byte) ([]byte, error) {
	source, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("decode chroma key image: %w", err)
	}
	bounds := source.Bounds()
	imageData := image.NewNRGBA(image.Rect(0, 0, bounds.Dx(), bounds.Dy()))
	draw.Draw(imageData, imageData.Bounds(), source, bounds.Min, draw.Src)
	applyGreenChromaKey(imageData)

	var output bytes.Buffer
	if err := png.Encode(&output, imageData); err != nil {
		return nil, fmt.Errorf("encode chroma key image: %w", err)
	}
	return output.Bytes(), nil
}

func applyGreenChromaKey(imageData *image.NRGBA) {
	width := imageData.Bounds().Dx()
	height := imageData.Bounds().Dy()
	marked := markConnectedGreen(imageData, width, height)
	for pixelIndex, connected := range marked {
		offset := pixelOffset(imageData, pixelIndex, width)
		if !connected && !isStrongGreen(imageData.Pix, offset) {
			continue
		}
		keyedAlpha := alphaForGreen(imageData.Pix, offset)
		originalAlpha := int(imageData.Pix[offset+3])
		alpha := (originalAlpha*keyedAlpha + opaqueAlpha/2) / opaqueAlpha
		removedRatio := 1 - float64(alpha)/float64(max(1, originalAlpha))
		neutralGreen := max(imageData.Pix[offset], imageData.Pix[offset+2])
		imageData.Pix[offset+1] = uint8(float64(imageData.Pix[offset+1])*(1-removedRatio) + float64(neutralGreen)*removedRatio + 0.5)
		imageData.Pix[offset+3] = uint8(alpha)
	}
}

func markConnectedGreen(imageData *image.NRGBA, width, height int) []bool {
	pixelCount := width * height
	marked := make([]bool, pixelCount)
	queue := make([]int, 0, pixelCount)
	enqueue := func(pixelIndex int) {
		if marked[pixelIndex] || !isSoftGreen(imageData.Pix, pixelOffset(imageData, pixelIndex, width)) {
			return
		}
		marked[pixelIndex] = true
		queue = append(queue, pixelIndex)
	}
	for pixelIndex := range pixelCount {
		if isStrongGreen(imageData.Pix, pixelOffset(imageData, pixelIndex, width)) {
			enqueue(pixelIndex)
		}
	}
	for queueStart := 0; queueStart < len(queue); queueStart++ {
		pixelIndex := queue[queueStart]
		x := pixelIndex % width
		if pixelIndex >= width {
			enqueue(pixelIndex - width)
		}
		if pixelIndex < pixelCount-width {
			enqueue(pixelIndex + width)
		}
		if x > 0 {
			enqueue(pixelIndex - 1)
		}
		if x < width-1 {
			enqueue(pixelIndex + 1)
		}
	}
	return marked
}

func pixelOffset(imageData *image.NRGBA, pixelIndex, width int) int {
	return (pixelIndex/width)*imageData.Stride + (pixelIndex%width)*4
}

func greenDominance(data []byte, offset int) int {
	return int(data[offset+1]) - int(max(data[offset], data[offset+2]))
}

func isStrongGreen(data []byte, offset int) bool {
	return data[offset+1] >= strongGreenMinimum && greenDominance(data, offset) >= strongGreenDelta
}

func isSoftGreen(data []byte, offset int) bool {
	return data[offset+1] >= softGreenMinimum && greenDominance(data, offset) >= softGreenDelta
}

func alphaForGreen(data []byte, offset int) int {
	dominance := greenDominance(data, offset)
	if dominance >= strongGreenDelta {
		return 0
	}
	normalized := float64(dominance-softGreenDelta) / float64(strongGreenDelta-softGreenDelta)
	normalized = max(0, min(1, normalized))
	return int(float64(opaqueAlpha)*(1-normalized) + 0.5)
}
