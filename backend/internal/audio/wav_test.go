package audio

import (
	"context"
	"encoding/binary"
	"os/exec"
	"testing"
)

func TestTrimBoundarySilenceKeepsShortPause(t *testing.T) {
	const sampleRate = 1000
	samples := make([]int16, 1000)
	for index := 300; index < 700; index++ {
		samples[index] = 2000
	}
	wav := testPCM16WAV(samples, sampleRate)
	trimmed, err := TrimBoundarySilence(wav, 80)
	if err != nil {
		t.Fatalf("trim silence: %v", err)
	}
	duration, err := DurationMs(trimmed)
	if err != nil {
		t.Fatalf("inspect trimmed WAV: %v", err)
	}
	if duration != 560 {
		t.Fatalf("trimmed duration = %dms, want 560ms", duration)
	}
}

func TestApplyTempoChangesWholeWAVDurationWithoutPlaybackMetadata(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg is not installed")
	}
	samples := make([]int16, 24000*2)
	for index := range samples {
		samples[index] = 2000
	}
	result, err := ApplyTempo(context.Background(), testPCM16WAV(samples, 24000), 1.5)
	if err != nil {
		t.Fatalf("apply tempo: %v", err)
	}
	duration, err := DurationMs(result)
	if err != nil {
		t.Fatalf("inspect tempo output: %v", err)
	}
	if duration < 1300 || duration > 1370 {
		t.Fatalf("tempo duration = %dms, want about 1333ms", duration)
	}
}

func testPCM16WAV(samples []int16, sampleRate uint32) []byte {
	dataSize := len(samples) * 2
	result := make([]byte, 44+dataSize)
	copy(result[0:4], "RIFF")
	binary.LittleEndian.PutUint32(result[4:8], uint32(len(result)-8))
	copy(result[8:12], "WAVE")
	copy(result[12:16], "fmt ")
	binary.LittleEndian.PutUint32(result[16:20], 16)
	binary.LittleEndian.PutUint16(result[20:22], 1)
	binary.LittleEndian.PutUint16(result[22:24], 1)
	binary.LittleEndian.PutUint32(result[24:28], sampleRate)
	binary.LittleEndian.PutUint32(result[28:32], sampleRate*2)
	binary.LittleEndian.PutUint16(result[32:34], 2)
	binary.LittleEndian.PutUint16(result[34:36], 16)
	copy(result[36:40], "data")
	binary.LittleEndian.PutUint32(result[40:44], uint32(dataSize))
	for index, sample := range samples {
		binary.LittleEndian.PutUint16(result[44+index*2:], uint16(sample))
	}
	return result
}
