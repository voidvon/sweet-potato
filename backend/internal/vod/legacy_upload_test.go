package vod

import "testing"

func TestParseUploadResult(t *testing.T) {
	result := parseUploadResult(map[string]any{
		"Result": map[string]any{
			"Data": map[string]any{
				"Vid":      "v-123",
				"StoreUri": "tos-vod/video.mp4",
				"SourceInfo": map[string]any{
					"FileName": "video.mp4",
					"Format":   "mp4",
				},
			},
		},
		"ResponseMetadata": map[string]any{"RequestId": "request-1"},
	}, "fallback.mp4")
	if result.Vid != "v-123" || result.StoreURI != "tos-vod/video.mp4" || result.FileName != "video.mp4" || result.RequestID != "request-1" {
		t.Fatalf("unexpected upload result: %+v", result)
	}
}

func TestTOSResponseSucceeded(t *testing.T) {
	if !tosResponseSucceeded(map[string]any{}) || !tosResponseSucceeded(map[string]any{"success": true}) || !tosResponseSucceeded(map[string]any{"success": 1.0}) {
		t.Fatal("expected successful TOS responses")
	}
	if tosResponseSucceeded(map[string]any{"success": false}) || tosResponseSucceeded(map[string]any{"success": "0"}) {
		t.Fatal("expected failed TOS responses")
	}
}

func TestSafeVODFileName(t *testing.T) {
	if got := safeVODFileName("../source file.MP4", ".mp4", "input.mp4"); got != "video-uploads/source-file-input.mp4" {
		t.Fatalf("safe VOD file name = %s", got)
	}
}
