package vod

import (
	"errors"
	"fmt"
)

func normalizeLocations(values []Location) ([]Location, error) {
	result := make([]Location, 0, len(values))
	for _, value := range values {
		if value.TopLeftX < 0 || value.TopLeftX > 1 || value.TopLeftY < 0 || value.TopLeftY > 1 ||
			value.BottomRightX < 0 || value.BottomRightX > 1 || value.BottomRightY < 0 || value.BottomRightY > 1 ||
			value.TopLeftX >= value.BottomRightX || value.TopLeftY >= value.BottomRightY {
			return nil, errors.New("擦除区域坐标必须是 0 到 1 之间的有效矩形")
		}
		result = append(result, value)
	}
	return result, nil
}

func normalizeClips(values []Clip, mode string) ([]Clip, error) {
	if mode == "all" {
		return nil, nil
	}
	if len(values) == 0 {
		return nil, errors.New("选择时间范围时必须至少指定一个片段")
	}
	result := make([]Clip, 0, len(values))
	for _, value := range values {
		if value.Start < 0 || value.End <= value.Start {
			return nil, fmt.Errorf("时间片段无效: %.3f - %.3f", value.Start, value.End)
		}
		result = append(result, value)
	}
	return result, nil
}

func normalizeTranslationTypes(values []string) ([]string, error) {
	result := []string{"subtitle"}
	seen := map[string]bool{"subtitle": true}
	for _, value := range values {
		if value == "voice" && !seen[value] {
			result = append(result, value)
			seen[value] = true
		}
		if value == "face" && !seen[value] {
			result = append(result, value)
			seen[value] = true
		}
	}
	if seen["face"] && !seen["voice"] {
		return nil, errors.New("面容翻译必须同时开启语音翻译")
	}
	return result, nil
}

func normalizeSubtitleConfig(value SubtitleConfig) (SubtitleConfig, error) {
	if !value.IsHardSubtitle {
		return value, nil
	}
	if value.FontSize < 1 || value.FontSize > 80 {
		return SubtitleConfig{}, errors.New("硬字幕字号必须在 1 到 80 之间")
	}
	if value.MarginL < 0 || value.MarginL >= 1 || value.MarginR < 0 || value.MarginR >= 1 || value.MarginV < 0 || value.MarginV >= 1 || value.MarginL+value.MarginR >= 1 {
		return SubtitleConfig{}, errors.New("硬字幕边距配置无效")
	}
	if value.ShowLines < 0 {
		return SubtitleConfig{}, errors.New("硬字幕最大行数不能小于 0")
	}
	return value, nil
}

func isSuccess(status string) bool {
	switch normalizeStatus(status) {
	case "success", "succeeded", "completed", "complete", "done":
		return true
	default:
		return false
	}
}

func isFailure(status string) bool {
	switch normalizeStatus(status) {
	case "failed", "failure", "error", "canceled", "cancelled", "terminated":
		return true
	default:
		return false
	}
}

func normalizeStatus(value string) string {
	return lowerASCII(value)
}

func lowerASCII(value string) string {
	result := []byte(value)
	for index, char := range result {
		if char >= 'A' && char <= 'Z' {
			result[index] += 'a' - 'A'
		}
	}
	return string(result)
}
