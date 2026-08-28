package httpapi

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"sweet-potato-go/internal/store"
)

const maxContentWorkflowStateBytes = 1024 * 1024

var contentWorkflowModules = map[string]bool{
	"talking-video":               true,
	"marketing-video":             true,
	"lightweight-marketing-video": true,
}

var contentWorkflowStatuses = map[string]bool{
	"draft": true, "uploading": true, "processing": true, "paused": true,
	"completed": true, "failed": true, "cancelled": true,
}

func (s *Server) handleContentWorkflows(w http.ResponseWriter, r *http.Request, parts []string) {
	user, ok := s.requireUser(w, r, "web.module.content.create_video")
	if !ok {
		return
	}
	if len(parts) == 0 {
		switch r.Method {
		case http.MethodGet:
			limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
			items, err := s.store.ListContentWorkflows(user.ID, strings.TrimSpace(r.URL.Query().Get("moduleKey")), limit)
			if err != nil {
				writeError(w, http.StatusInternalServerError, "工作流记录读取失败")
				return
			}
			writeJSON(w, http.StatusOK, items)
		case http.MethodPost:
			input, decoded := decodeMap(w, r)
			if !decoded {
				return
			}
			item, err := contentWorkflowFromInput(user.ID, input)
			if err != nil {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
			saved, err := s.store.UpsertContentWorkflow(item)
			if err != nil {
				writeError(w, http.StatusBadRequest, "工作流记录保存失败")
				return
			}
			writeJSON(w, http.StatusOK, saved)
		default:
			writeError(w, http.StatusMethodNotAllowed, "请求方法不支持")
		}
		return
	}
	if len(parts) != 1 {
		writeError(w, http.StatusNotFound, "工作流接口不存在")
		return
	}
	switch r.Method {
	case http.MethodGet:
		item, found, err := s.store.FindContentWorkflow(parts[0], user.ID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "工作流记录读取失败")
			return
		}
		if !found {
			writeError(w, http.StatusNotFound, "工作流记录不存在")
			return
		}
		writeJSON(w, http.StatusOK, item)
	case http.MethodDelete:
		deleted, err := s.store.DeleteContentWorkflow(parts[0], user.ID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "工作流记录删除失败")
			return
		}
		if !deleted {
			writeError(w, http.StatusNotFound, "工作流记录不存在")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		writeError(w, http.StatusMethodNotAllowed, "请求方法不支持")
	}
}

func contentWorkflowFromInput(userID string, input map[string]any) (store.ContentWorkflow, error) {
	moduleKey := strings.TrimSpace(stringValue(input, "moduleKey"))
	if !contentWorkflowModules[moduleKey] {
		return store.ContentWorkflow{}, errInvalidContentWorkflow("功能模块无效")
	}
	status := valueOr(strings.TrimSpace(stringValue(input, "status")), "draft")
	if !contentWorkflowStatuses[status] {
		return store.ContentWorkflow{}, errInvalidContentWorkflow("工作流状态无效")
	}
	state := objectValue(input["state"])
	encoded, err := json.Marshal(state)
	if err != nil || len(encoded) > maxContentWorkflowStateBytes {
		return store.ContentWorkflow{}, errInvalidContentWorkflow("工作流状态不能超过 1 MB")
	}
	schemaVersion := int(numberValue(input["schemaVersion"], 1))
	if schemaVersion < 1 {
		return store.ContentWorkflow{}, errInvalidContentWorkflow("工作流结构版本无效")
	}
	return store.ContentWorkflow{
		ID: strings.TrimSpace(stringValue(input, "id")), UserID: userID, ModuleKey: moduleKey,
		RecordKey: valueOr(strings.TrimSpace(stringValue(input, "recordKey")), "default"),
		Title:     strings.TrimSpace(stringValue(input, "title")), Status: status,
		CurrentStep: strings.TrimSpace(stringValue(input, "currentStep")), State: state,
		SchemaVersion: schemaVersion,
	}, nil
}

type invalidContentWorkflowError string

func (err invalidContentWorkflowError) Error() string { return string(err) }

func errInvalidContentWorkflow(message string) error { return invalidContentWorkflowError(message) }
