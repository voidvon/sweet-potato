package audio

import (
	"encoding/binary"
	"errors"
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
