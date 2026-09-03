package audio

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
)

// ApplyTempo changes the duration of a complete WAV while preserving pitch.
func ApplyTempo(ctx context.Context, input []byte, speed float64) ([]byte, error) {
	if speed <= 0 {
		return nil, fmt.Errorf("音频倍速必须大于 0")
	}
	if speed == 1 {
		return input, nil
	}
	ffmpegPath := strings.TrimSpace(os.Getenv("FFMPEG_PATH"))
	if ffmpegPath == "" {
		var err error
		ffmpegPath, err = exec.LookPath("ffmpeg")
		if err != nil {
			return nil, fmt.Errorf("音频模型不支持原生倍速，且未找到 FFmpeg：%w", err)
		}
	}
	inputFile, err := os.CreateTemp("", "sweet-potato-narration-input-*.wav")
	if err != nil {
		return nil, fmt.Errorf("创建 FFmpeg 输入文件失败: %w", err)
	}
	inputPath := inputFile.Name()
	defer os.Remove(inputPath)
	if _, err = inputFile.Write(input); err != nil {
		_ = inputFile.Close()
		return nil, fmt.Errorf("写入 FFmpeg 输入文件失败: %w", err)
	}
	if err = inputFile.Close(); err != nil {
		return nil, fmt.Errorf("关闭 FFmpeg 输入文件失败: %w", err)
	}
	outputFile, err := os.CreateTemp("", "sweet-potato-narration-output-*.wav")
	if err != nil {
		return nil, fmt.Errorf("创建 FFmpeg 输出文件失败: %w", err)
	}
	outputPath := outputFile.Name()
	_ = outputFile.Close()
	_ = os.Remove(outputPath)
	defer os.Remove(outputPath)

	filter := "atempo=" + strconv.FormatFloat(speed, 'f', 3, 64)
	command := exec.CommandContext(ctx, ffmpegPath,
		"-hide_banner", "-loglevel", "error", "-nostdin", "-y",
		"-i", inputPath, "-filter:a", filter, "-c:a", "pcm_s16le", outputPath,
	)
	if commandOutput, commandErr := command.CombinedOutput(); commandErr != nil {
		detail := strings.TrimSpace(string(commandOutput))
		if len(detail) > 500 {
			detail = detail[len(detail)-500:]
		}
		if detail != "" {
			return nil, fmt.Errorf("FFmpeg 保音调变速失败: %w: %s", commandErr, detail)
		}
		return nil, fmt.Errorf("FFmpeg 保音调变速失败: %w", commandErr)
	}
	result, err := os.ReadFile(outputPath)
	if err != nil {
		return nil, fmt.Errorf("读取 FFmpeg 输出失败: %w", err)
	}
	if _, err := InspectWAV(result); err != nil {
		return nil, fmt.Errorf("FFmpeg 输出音频无效: %w", err)
	}
	return result, nil
}
