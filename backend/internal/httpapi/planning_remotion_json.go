package httpapi

import (
	"errors"
	"net/http"
	"net/url"
	"os"
	"strings"

	"sweet-potato-go/internal/pluginruntime"
	"sweet-potato-go/internal/remotionjson"
	"sweet-potato-go/internal/store"
)

func (s *Server) handleGenerateRemotionJSON(w http.ResponseWriter, r *http.Request, session store.ContentPlanningSession) {
	if isActiveRemotionRender(objectValue(session.Analysis["renderGeneration"])) {
		writeError(w, http.StatusConflict, "视频正在渲染，请先取消渲染任务")
		return
	}
	input, ok := decodeMap(w, r)
	if !ok {
		return
	}
	result, err := remotionjson.Build(session, remotionjson.BuildOptions{
		PresetID:   stringValue(input, "presetId"),
		ResolveURL: remotionAssetURLResolver(r),
	})
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	validation, err := s.plugins.Validate(r.Context(), pluginruntime.RemotionPluginKey, result.RenderRequest)
	if err != nil {
		session.Analysis["remotionGeneration"] = map[string]any{
			"status": "failed", "presetId": result.Preset.ID, "errorMessage": err.Error(), "generatedAt": result.GeneratedAt,
		}
		if updated, updateErr := s.store.UpdatePlanningSession(session); updateErr == nil {
			s.publishPlanningSessionUpdated(updated, "remotion-json")
		}
		status := http.StatusBadGateway
		if errors.Is(err, pluginruntime.ErrNotRunning) {
			status = http.StatusConflict
		}
		writeError(w, status, err.Error())
		return
	}

	session.Analysis["remotionGeneration"] = map[string]any{
		"status": "completed", "presetId": result.Preset.ID, "preset": result.Preset,
		"plan": result.Plan, "renderRequest": result.RenderRequest, "validation": validation,
		"generatedAt": result.GeneratedAt, "errorMessage": "",
	}
	session.Analysis["renderGeneration"] = map[string]any{
		"status": "idle", "progress": 0, "pluginJobId": "", "assetId": "", "fileUrl": "", "errorMessage": "",
	}
	updated, err := s.store.UpdatePlanningSession(session)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Remotion JSON 保存失败")
		return
	}
	s.publishPlanningSessionUpdated(updated, "remotion-json")
	writeJSON(w, http.StatusOK, updated)
}

func remotionAssetURLResolver(r *http.Request) func(string) (string, error) {
	base := strings.TrimRight(strings.TrimSpace(os.Getenv("PUBLIC_BASE_URL")), "/")
	if base == "" {
		scheme := "http"
		if r.TLS != nil {
			scheme = "https"
		}
		forwarded := strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-Proto"), ",")[0])
		if forwarded == "http" || forwarded == "https" {
			scheme = forwarded
		}
		base = scheme + "://" + r.Host
	}
	return func(raw string) (string, error) {
		value := strings.TrimSpace(raw)
		parsed, err := url.Parse(value)
		if err != nil {
			return "", err
		}
		if parsed.IsAbs() {
			return value, nil
		}
		if !strings.HasPrefix(value, "/") {
			value = "/" + value
		}
		return base + value, nil
	}
}
