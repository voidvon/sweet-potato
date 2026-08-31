package httpapi

import (
	"errors"
	"net/http"
	"strings"

	"sweet-potato-go/internal/pluginruntime"
	"sweet-potato-go/internal/store"
)

func (s *Server) handleListPlugins(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireUser(w, r, permissionPlugins); !ok {
		return
	}
	plugins, err := s.store.ListPlugins()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "插件配置读取失败")
		return
	}
	payload := make([]map[string]any, 0, len(plugins))
	for _, plugin := range plugins {
		encoded := map[string]any{
			"key": plugin.Key, "name": plugin.Name, "category": plugin.Category,
			"version": plugin.Version, "requiredPermission": plugin.RequiredPermission,
			"workflowVersion": plugin.WorkflowVersion, "renderAdapter": plugin.RenderAdapter,
			"acceptedAttachments": plugin.AcceptedAttachments, "enabled": plugin.Enabled,
			"sortOrder": plugin.SortOrder, "timeoutSeconds": plugin.TimeoutSeconds,
			"maxConcurrency": plugin.MaxConcurrency, "templateVersion": plugin.TemplateVersion,
			"updatedAt": plugin.UpdatedAt, "runtime": s.plugins.Status(plugin.Key),
		}
		payload = append(payload, encoded)
	}
	writeJSON(w, http.StatusOK, map[string]any{"plugins": payload})
}

func (s *Server) handleUpdatePlugin(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireUser(w, r, permissionPlugins); !ok {
		return
	}
	var input struct {
		Enabled         bool   `json:"enabled"`
		SortOrder       int    `json:"sortOrder"`
		TimeoutSeconds  int    `json:"timeoutSeconds"`
		MaxConcurrency  int    `json:"maxConcurrency"`
		TemplateVersion string `json:"templateVersion"`
	}
	if !decodeJSONBody(w, r, &input) {
		return
	}
	if input.SortOrder < 0 || input.SortOrder > 10000 {
		writeError(w, http.StatusBadRequest, "显示顺序必须在 0 到 10000 之间")
		return
	}
	if input.TimeoutSeconds < 5 || input.TimeoutSeconds > 1800 {
		writeError(w, http.StatusBadRequest, "请求超时必须在 5 到 1800 秒之间")
		return
	}
	if input.MaxConcurrency < 1 || input.MaxConcurrency > 32 {
		writeError(w, http.StatusBadRequest, "最大并发必须在 1 到 32 之间")
		return
	}
	input.TemplateVersion = strings.TrimSpace(input.TemplateVersion)
	if input.TemplateVersion == "" || len(input.TemplateVersion) > 40 {
		writeError(w, http.StatusBadRequest, "请输入有效的模板版本")
		return
	}
	if input.Enabled && !s.plugins.Status(r.PathValue("key")).Installed {
		writeError(w, http.StatusConflict, pluginruntime.ErrNotInstalled.Error())
		return
	}
	previous, previousFound, err := s.store.FindPlugin(r.PathValue("key"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "插件配置读取失败")
		return
	}
	if !previousFound {
		writeError(w, http.StatusNotFound, "插件不存在")
		return
	}
	plugin, err := s.store.UpdatePluginSettings(r.PathValue("key"), store.PluginSettingsUpdate{
		Enabled:         input.Enabled,
		SortOrder:       input.SortOrder,
		TimeoutSeconds:  input.TimeoutSeconds,
		MaxConcurrency:  input.MaxConcurrency,
		TemplateVersion: input.TemplateVersion,
	})
	if errors.Is(err, store.ErrPluginNotFound) {
		writeError(w, http.StatusNotFound, "插件不存在")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "插件配置保存失败")
		return
	}
	if plugin.Enabled {
		if previous.Enabled && previous.MaxConcurrency != plugin.MaxConcurrency {
			if stopErr := s.plugins.Stop(plugin.Key); stopErr != nil {
				writeError(w, http.StatusInternalServerError, "插件进程重启失败："+stopErr.Error())
				return
			}
		}
		err = s.plugins.Start(plugin.Key, plugin.MaxConcurrency)
	} else {
		err = s.plugins.Stop(plugin.Key)
	}
	if err != nil {
		if errors.Is(err, pluginruntime.ErrNotInstalled) {
			writeError(w, http.StatusConflict, err.Error())
			return
		}
		writeError(w, http.StatusInternalServerError, "插件进程状态更新失败："+err.Error())
		return
	}
	writePluginPayload(w, http.StatusOK, plugin, s.plugins.Status(plugin.Key))
}

func (s *Server) handleTestPlugin(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireUser(w, r, permissionPlugins); !ok {
		return
	}
	latency, health, err := s.plugins.Health(r.Context(), r.PathValue("key"))
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":        true,
		"latencyMs": latency.Milliseconds(),
		"health":    health,
	})
}

func writePluginPayload(w http.ResponseWriter, status int, plugin store.Plugin, runtime pluginruntime.Status) {
	writeJSON(w, status, map[string]any{
		"key": plugin.Key, "name": plugin.Name, "category": plugin.Category,
		"version": plugin.Version, "requiredPermission": plugin.RequiredPermission,
		"workflowVersion": plugin.WorkflowVersion, "renderAdapter": plugin.RenderAdapter,
		"acceptedAttachments": plugin.AcceptedAttachments, "enabled": plugin.Enabled,
		"sortOrder": plugin.SortOrder, "timeoutSeconds": plugin.TimeoutSeconds,
		"maxConcurrency": plugin.MaxConcurrency, "templateVersion": plugin.TemplateVersion,
		"updatedAt": plugin.UpdatedAt, "runtime": runtime,
	})
}
