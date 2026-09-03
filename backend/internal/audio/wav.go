package audio

import (
	"bytes"
	"encoding/binary"
	"errors"
	"math"
)

type WaveInfo struct {
	AudioFormat   uint16
	Channels      uint16
	SampleRate    uint32
	ByteRate      uint32
	BitsPerSample uint16
	DataBytes     int
}

func InspectWAV(input []byte) (WaveInfo, error) {
	if len(input) < 12 || string(input[:4]) != "RIFF" || string(input[8:12]) != "WAVE" {
		return WaveInfo{}, errors.New("语音模型返回的音频不是有效 WAV 文件")
	}
	var info WaveInfo
	var foundFormat, foundData bool
	for offset := 12; offset+8 <= len(input); {
		chunkID := string(input[offset : offset+4])
		chunkSize := int(binary.LittleEndian.Uint32(input[offset+4 : offset+8]))
		start := offset + 8
		end := start + chunkSize
		if chunkSize < 0 || end > len(input) {
			return WaveInfo{}, errors.New("语音模型返回了截断的 WAV 文件")
		}
		switch chunkID {
		case "fmt ":
			if chunkSize < 16 {
				return WaveInfo{}, errors.New("WAV 文件缺少有效的 fmt 区块")
			}
			info.AudioFormat = binary.LittleEndian.Uint16(input[start : start+2])
			info.Channels = binary.LittleEndian.Uint16(input[start+2 : start+4])
			info.SampleRate = binary.LittleEndian.Uint32(input[start+4 : start+8])
			info.ByteRate = binary.LittleEndian.Uint32(input[start+8 : start+12])
			info.BitsPerSample = binary.LittleEndian.Uint16(input[start+14 : start+16])
			foundFormat = true
		case "data":
			info.DataBytes += chunkSize
			foundData = true
		}
		offset = end
		if chunkSize%2 != 0 {
			offset++
		}
	}
	if !foundFormat || !foundData || info.AudioFormat != 1 || info.Channels == 0 || info.SampleRate == 0 || info.ByteRate == 0 || info.BitsPerSample == 0 || info.DataBytes == 0 {
		return WaveInfo{}, errors.New("WAV 文件缺少可用的 PCM 音频数据")
	}
	return info, nil
}

func DurationMs(input []byte) (int, error) {
	info, err := InspectWAV(input)
	if err != nil {
		return 0, err
	}
	duration := int((int64(info.DataBytes)*1000 + int64(info.ByteRate)/2) / int64(info.ByteRate))
	if duration < 1 {
		duration = 1
	}
	return duration, nil
}

// TrimBoundarySilence removes excess silence generated around an utterance
// while retaining a short natural pause at both edges.
func TrimBoundarySilence(input []byte, keepMs int) ([]byte, error) {
	info, dataOffset, dataSize, err := inspectWAVData(input)
	if err != nil {
		return nil, err
	}
	if info.AudioFormat != 1 || info.BitsPerSample != 16 {
		return input, nil
	}
	frameBytes := int(info.Channels) * 2
	frameCount := dataSize / frameBytes
	if frameCount == 0 {
		return input, nil
	}
	data := input[dataOffset : dataOffset+dataSize]
	windowFrames := maxWAVInt(1, int(info.SampleRate)/100)
	threshold := float64(math.MaxInt16) * 0.01
	firstActive, lastActive := -1, -1
	for start := 0; start < frameCount; start += windowFrames {
		end := minWAVInt(frameCount, start+windowFrames)
		var sumSquares float64
		for frame := start; frame < end; frame++ {
			for channel := 0; channel < int(info.Channels); channel++ {
				offset := frame*frameBytes + channel*2
				sample := float64(int16(binary.LittleEndian.Uint16(data[offset : offset+2])))
				sumSquares += sample * sample
			}
		}
		sampleCount := (end - start) * int(info.Channels)
		if math.Sqrt(sumSquares/float64(sampleCount)) >= threshold {
			if firstActive < 0 {
				firstActive = start
			}
			lastActive = end
		}
	}
	if firstActive < 0 {
		return input, nil
	}
	keepFrames := maxWAVInt(0, keepMs) * int(info.SampleRate) / 1000
	trimStart := maxWAVInt(0, firstActive-keepFrames)
	trimEnd := minWAVInt(frameCount, lastActive+keepFrames)
	if trimStart == 0 && trimEnd == frameCount {
		return input, nil
	}
	trimmedData := data[trimStart*frameBytes : trimEnd*frameBytes]
	dataHeaderOffset := dataOffset - 8
	originalChunkEnd := dataOffset + dataSize
	if dataSize%2 != 0 {
		originalChunkEnd++
	}
	var output bytes.Buffer
	output.Grow(len(input) - dataSize + len(trimmedData) + 1)
	output.Write(input[:dataHeaderOffset])
	output.WriteString("data")
	_ = binary.Write(&output, binary.LittleEndian, uint32(len(trimmedData)))
	output.Write(trimmedData)
	if len(trimmedData)%2 != 0 {
		output.WriteByte(0)
	}
	output.Write(input[originalChunkEnd:])
	result := output.Bytes()
	binary.LittleEndian.PutUint32(result[4:8], uint32(len(result)-8))
	return result, nil
}

func inspectWAVData(input []byte) (WaveInfo, int, int, error) {
	info, err := InspectWAV(input)
	if err != nil {
		return WaveInfo{}, 0, 0, err
	}
	for offset := 12; offset+8 <= len(input); {
		chunkSize := int(binary.LittleEndian.Uint32(input[offset+4 : offset+8]))
		start := offset + 8
		if string(input[offset:offset+4]) == "data" {
			return info, start, chunkSize, nil
		}
		offset = start + chunkSize
		if chunkSize%2 != 0 {
			offset++
		}
	}
	return WaveInfo{}, 0, 0, errors.New("WAV 文件缺少音频数据区块")
}

func minWAVInt(left, right int) int {
	if left < right {
		return left
	}
	return right
}

func maxWAVInt(left, right int) int {
	if left > right {
		return left
	}
	return right
}
