package httpapi

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"ai-marketing-go/internal/store"
)

var batchCapabilities = []map[string]any{
	{"key": "image.dialog", "label": "对话生图", "mediaKind": "image", "schemaVersion": 1, "globalFields": batchImageGlobalFields(true), "rowFields": []any{batchField("prompt", "提示词", "string", true, false), batchField("referenceGroups.reference", "参考图", "asset-list", false, false)}},
	{"key": "image.outfit", "label": "换装", "mediaKind": "image", "schemaVersion": 1, "globalFields": batchImageGlobalFields(true), "rowFields": []any{batchField("referenceGroups.model", "模特", "asset-list", true, false), batchField("referenceGroups.clothes", "服装", "asset-list", true, false), batchField("prompt", "补充提示词", "string", false, false)}},
	{"key": "image.model_views", "label": "模特三视图", "mediaKind": "image", "schemaVersion": 1, "globalFields": batchImageGlobalFields(false), "rowFields": []any{batchField("referenceGroups.model", "模特", "asset-list", true, false), batchField("referenceGroups.front", "服装正面", "asset-list", false, false), batchField("referenceGroups.back", "服装背面", "asset-list", false, false), batchField("referenceGroups.background", "背景", "asset-list", false, false)}},
	{"key": "image.pose_reference", "label": "姿势参考", "mediaKind": "image", "schemaVersion": 1, "globalFields": batchImageGlobalFields(false), "rowFields": []any{batchField("referenceGroups.subject", "主体", "asset-list", true, false), batchField("referenceGroups.pose", "姿势", "asset-list", true, false), batchField("prompt", "补充提示词", "string", false, false)}},
	{"key": "image.upscale", "label": "高清放大", "mediaKind": "image", "schemaVersion": 1, "globalFields": batchImageGlobalFields(false), "rowFields": []any{batchField("referenceGroups.source", "原图", "asset-list", true, false)}},
	{"key": "image.cutout", "label": "图片抠图", "mediaKind": "image", "schemaVersion": 1, "globalFields": batchImageGlobalFields(false), "rowFields": []any{batchField("referenceGroups.source", "原图", "asset-list", true, false)}},
	{"key": "image.background", "label": "换背景", "mediaKind": "image", "schemaVersion": 1, "globalFields": batchImageGlobalFields(false), "rowFields": []any{batchField("referenceGroups.subject", "主体", "asset-list", true, false), batchField("referenceGroups.background", "背景", "asset-list", true, false), batchField("prompt", "补充提示词", "string", false, false)}},
	{"key": "image.scene_extract", "label": "场景提取", "mediaKind": "image", "schemaVersion": 1, "globalFields": batchImageGlobalFields(false), "rowFields": []any{batchField("referenceGroups.source", "原图", "asset-list", true, false)}},
	{"key": "image.model_face_swap", "label": "模特换脸", "mediaKind": "image", "schemaVersion": 1, "globalFields": batchImageGlobalFields(false), "rowFields": []any{batchField("referenceGroups.model", "模特", "asset-list", true, false), batchField("referenceGroups.face", "脸部", "asset-list", true, false)}},
	{"key": "image.head_swap", "label": "智能换头", "mediaKind": "image", "schemaVersion": 1, "globalFields": batchImageGlobalFields(false), "rowFields": []any{batchField("referenceGroups.model", "模特", "asset-list", true, false)}},
	{"key": "image.face_swap", "label": "智能换脸", "mediaKind": "image", "schemaVersion": 1, "globalFields": batchImageGlobalFields(false), "rowFields": []any{batchField("referenceGroups.model", "模特", "asset-list", true, false)}},
	{"key": "image.redraw", "label": "智能重绘", "mediaKind": "image", "schemaVersion": 1, "globalFields": batchImageGlobalFields(false), "rowFields": []any{batchField("referenceGroups.reference", "参考图", "asset-list", true, false), batchField("prompt", "补充提示词", "string", false, false)}},
	{"key": "image.print_extract", "label": "印花提取", "mediaKind": "image", "schemaVersion": 1, "globalFields": batchImageGlobalFields(false), "rowFields": []any{batchField("referenceGroups.clothes", "服装", "asset-list", true, false)}},
	{"key": "image.face_enhance", "label": "脸部增强", "mediaKind": "image", "schemaVersion": 1, "globalFields": batchImageGlobalFields(false), "rowFields": []any{batchField("referenceGroups.portrait", "人像", "asset-list", true, false)}},
	{"key": "video.generate", "label": "视频", "mediaKind": "video", "schemaVersion": 1, "globalFields": batchVideoGlobalFields(), "rowFields": batchVideoRowFields()},
	{"key": "video.upscale", "label": "视频高清放大", "mediaKind": "video", "schemaVersion": 1, "globalFields": []any{}, "rowFields": []any{batchField("referenceVideoIds", "视频素材", "asset-list", true, false)}},
	{"key": "video.dance_remake", "label": "跳舞复刻", "mediaKind": "video", "schemaVersion": 1, "globalFields": []any{batchField("danceRemakeMode", "生成模式", "string", false, true), batchField("videoModelId", "模型", "string", false, true), batchField("quality", "清晰度", "string", false, true), batchField("preserveAudio", "保留音乐", "boolean", false, true)}, "rowFields": []any{batchField("characterImageAssetId", "人物图", "asset", true, false), batchField("referenceVideoIds", "参考视频", "asset-list", true, false)}},
	{"key": "video.subject_replace", "label": "模特 / 商品替换", "mediaKind": "video", "schemaVersion": 1, "globalFields": []any{batchField("subjectReplaceType", "图片类型", "string", false, true), batchField("videoModelId", "模型", "string", false, true), batchField("quality", "清晰度", "string", false, true), batchField("preserveAudio", "保留音乐", "boolean", false, true)}, "rowFields": []any{batchField("subjectModelImageAssetId", "模特图", "asset", true, false), batchField("subjectClothingFrontAssetId", "服饰正面图", "asset", true, false), batchField("subjectClothingBackAssetId", "服饰反面图", "asset", false, false), batchField("subjectFaceImageAssetId", "人脸图", "asset", true, false), batchField("subjectBackgroundImageAssetId", "背景图", "asset", true, false), batchField("subjectProductImageAssetId", "商品图", "asset", true, false), batchField("referenceVideoIds", "参考视频", "asset-list", true, false)}},
}

func batchField(key, label, valueType string, required, overridable bool) map[string]any {
	return map[string]any{"key": key, "label": label, "valueType": valueType, "required": required, "overridable": overridable}
}

func batchImageGlobalFields(outputCount bool) []any {
	fields := []any{batchField("modelConfigId", "模型", "string", false, true), batchField("resolution", "分辨率", "string", false, true), batchField("aspectRatio", "画面比例", "string", false, true)}
	if outputCount {
		fields = append(fields, batchField("outputCount", "出图张数", "number", false, true))
	}
	return fields
}

func batchVideoGlobalFields() []any {
	return []any{batchField("modelConfigId", "模型", "string", false, true), batchField("aspectRatio", "画面比例", "string", false, true), batchField("duration", "时长", "string", false, true), batchField("generateAudio", "生成配音", "boolean", false, true)}
}
func batchVideoRowFields() []any {
	return []any{batchField("prompt", "提示词", "string", false, false), batchField("referenceImageIds", "参考图", "asset-list", false, false), batchField("referenceVideoIds", "参考视频", "asset-list", false, false), batchField("referenceAudioIds", "参考音频", "asset-list", false, false)}
}

var batchRunMu sync.Mutex
var batchRunning = map[string]bool{}

func (s *Server) handleBatchGeneration(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requireUser(w, r, "web.module.content.batch_generation", "web.module.content.create_video")
	if !ok {
		return
	}
	parts := splitPath(strings.TrimPrefix(strings.TrimPrefix(r.URL.Path, "/api/batch-generation"), "/"))
	if len(parts) == 1 && parts[0] == "capabilities" && r.Method == http.MethodGet {
		writeJSON(w, http.StatusOK, batchCapabilities)
		return
	}
	if len(parts) == 1 && parts[0] == "model-options" && r.Method == http.MethodGet {
		s.handleBatchModelOptions(w)
		return
	}
	if len(parts) == 2 && parts[0] == "assets" && parts[1] == "upload" && r.Method == http.MethodPost {
		s.handleBatchAssetUpload(w, r, user)
		return
	}
	if len(parts) == 2 && parts[0] == "assets" && r.Method == http.MethodGet {
		s.handleBatchAsset(w, r, user, parts[1])
		return
	}
	if len(parts) == 3 && parts[0] == "assets" && parts[2] == "video-upscale-estimate" && r.Method == http.MethodGet {
		writeJSON(w, http.StatusOK, map[string]any{"estimatedCredits": 20})
		return
	}
	if len(parts) == 3 && parts[0] == "assets" && parts[2] == "video-source-estimate" && r.Method == http.MethodPost {
		writeJSON(w, http.StatusOK, map[string]any{"estimatedCredits": 20})
		return
	}
	if len(parts) == 1 && parts[0] == "sheets" {
		if r.Method == http.MethodGet {
			result, err := s.store.ListBatchSheets(user.ID)
			if err != nil {
				writeError(w, 500, "批量表格读取失败")
				return
			}
			writeJSON(w, 200, result)
			return
		}
		if r.Method == http.MethodPost {
			s.createBatchSheet(w, r, user)
			return
		}
	}
	if len(parts) >= 2 && parts[0] == "sheets" {
		s.handleBatchSheet(w, r, user, parts[1:])
		return
	}
	if len(parts) == 2 && parts[0] == "runs" {
		if r.Method == http.MethodGet {
			detail, found, err := s.store.BatchRunDetail(parts[1], user.ID)
			if err != nil {
				writeError(w, 500, "批量任务读取失败")
				return
			}
			if !found {
				writeError(w, 404, "批量任务不存在")
				return
			}
			writeJSON(w, 200, detail)
			return
		}
		if r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/retry") {
			s.retryBatchRun(w, user, parts[1])
			return
		}
	}
	if len(parts) == 3 && parts[0] == "runs" && parts[2] == "retry" && r.Method == http.MethodPost {
		s.retryBatchRun(w, user, parts[1])
		return
	}
	writeError(w, http.StatusNotFound, "批量生成接口不存在")
}

func (s *Server) handleBatchModelOptions(w http.ResponseWriter) {
	models := []map[string]any{}
	for _, kind := range []string{"image", "video"} {
		items, err := s.store.ListModelConfigs(kind)
		if err != nil {
			writeError(w, 500, "模型读取失败")
			return
		}
		for _, item := range items {
			models = append(models, map[string]any{"id": item.ID, "type": kind, "name": item.Name, "provider": item.Provider, "model": item.Model, "creditsPerRequest": 1, "supportsCustomResolution": true, "isDefault": item.IsDefault})
		}
	}
	if len(models) == 0 {
		models = append(models, map[string]any{"id": "local", "type": "image", "name": "Go 本地生成器", "provider": "local", "model": "local", "creditsPerRequest": 0, "supportsCustomResolution": true, "isDefault": true})
	}
	writeJSON(w, 200, models)
}

func (s *Server) createBatchSheet(w http.ResponseWriter, r *http.Request, user store.User) {
	input, ok := decodeMap(w, r)
	if !ok {
		return
	}
	name := strings.TrimSpace(stringValue(input, "name"))
	capability := strings.TrimSpace(stringValue(input, "capabilityKey"))
	definition := findBatchCapability(capability)
	if name == "" || definition == nil {
		writeError(w, 400, "表格名称或创作功能无效")
		return
	}
	mediaKind := stringValue(definition, "mediaKind")
	item, err := s.store.CreateBatchSheet(store.BatchSheet{UserID: user.ID, Name: name, CapabilityKey: capability, MediaKind: mediaKind, GlobalParams: objectValue(input["globalParams"]), SchemaVersion: 1, SortOrder: 0, Revision: 1})
	if err != nil {
		writeError(w, 400, err.Error())
		return
	}
	writeJSON(w, 201, item)
}

func findBatchCapability(key string) map[string]any {
	for _, item := range batchCapabilities {
		if item["key"] == key {
			return item
		}
	}
	return nil
}

func (s *Server) handleBatchSheet(w http.ResponseWriter, r *http.Request, user store.User, parts []string) {
	sheetID := parts[0]
	sheet, found, err := s.store.FindBatchSheet(sheetID, user.ID)
	if err != nil {
		writeError(w, 500, "批量表格读取失败")
		return
	}
	if !found {
		writeError(w, 404, "表格不存在")
		return
	}
	if len(parts) == 1 {
		switch r.Method {
		case http.MethodGet:
			detail, err := s.store.BatchSheetDetail(sheet)
			if err != nil {
				writeError(w, 500, "表格详情读取失败")
				return
			}
			writeJSON(w, 200, detail)
		case http.MethodPatch:
			input, ok := decodeMap(w, r)
			if !ok {
				return
			}
			expected := int(numberValue(input["revision"], float64(sheet.Revision)))
			updated, ok, err := s.store.UpdateBatchSheet(store.BatchSheet{ID: sheet.ID, UserID: user.ID, Name: valueOr(stringValue(input, "name"), sheet.Name), GlobalParams: objectOr(input["globalParams"], sheet.GlobalParams), SortOrder: int(numberValue(input["sortOrder"], float64(sheet.SortOrder)))}, expected)
			if err != nil {
				writeError(w, 400, err.Error())
				return
			}
			if !ok {
				writeError(w, 409, "表格已被其他操作更新，请刷新后重试")
				return
			}
			writeJSON(w, 200, updated)
		case http.MethodDelete:
			if err := s.store.DeleteBatchSheet(sheet.ID, user.ID); err != nil {
				writeError(w, 400, err.Error())
				return
			}
			writeJSON(w, 200, map[string]bool{"ok": true})
		default:
			writeError(w, 405, "请求方法不支持")
		}
		return
	}
	if len(parts) == 2 && parts[1] == "rows" {
		if r.Method == http.MethodPost {
			s.addBatchRows(w, r, sheet)
			return
		}
	}
	if len(parts) == 3 && parts[1] == "rows" {
		row, found, err := s.store.FindBatchRow(parts[2], sheet.ID)
		if err != nil || !found {
			writeError(w, 404, "表格行不存在")
			return
		}
		switch r.Method {
		case http.MethodPatch:
			input, ok := decodeMap(w, r)
			if !ok {
				return
			}
			params := objectOr(input["params"], row.Params)
			expected := int(numberValue(input["revision"], float64(row.Revision)))
			updated, ok, err := s.store.UpdateBatchRow(store.BatchRow{ID: row.ID, SheetID: sheet.ID, Params: params, ValidationStatus: "draft", ValidationErrors: []string{}}, expected)
			if err != nil {
				writeError(w, 400, err.Error())
				return
			}
			if !ok {
				writeError(w, 409, "表格行已被其他操作更新，请刷新后重试")
				return
			}
			writeJSON(w, 200, updated)
		case http.MethodDelete:
			if err := s.store.DeleteBatchRow(row.ID, sheet.ID); err != nil {
				writeError(w, 400, err.Error())
				return
			}
			writeJSON(w, 200, map[string]bool{"ok": true})
		default:
			writeError(w, 405, "请求方法不支持")
		}
		return
	}
	if len(parts) == 2 && parts[1] == "runs" {
		if r.Method == http.MethodGet {
			result, err := s.store.ListBatchRuns(sheet.ID, user.ID)
			if err != nil {
				writeError(w, 500, "批量任务读取失败")
				return
			}
			writeJSON(w, 200, result)
			return
		}
		if r.Method == http.MethodPost {
			s.startBatchRun(w, r, user, sheet)
			return
		}
	}
	writeError(w, 404, "批量表格接口不存在")
}

func (s *Server) addBatchRows(w http.ResponseWriter, r *http.Request, sheet store.BatchSheet) {
	input, ok := decodeMap(w, r)
	if !ok {
		return
	}
	raw, _ := input["rows"].([]any)
	if len(raw) == 0 {
		writeError(w, 400, "至少需要新增一行")
		return
	}
	existing, err := s.store.ListBatchRows(sheet.ID)
	if err != nil {
		writeError(w, 500, "表格行读取失败")
		return
	}
	if len(existing)+len(raw) > 200 {
		writeError(w, 400, "每个表格最多允许 200 行")
		return
	}
	at := int(numberValue(input["insertAt"], float64(len(existing))))
	if at < 0 || at > len(existing) {
		writeError(w, 400, "插入位置无效")
		return
	}
	items := make([]store.BatchRow, 0, len(raw))
	for _, value := range raw {
		items = append(items, store.BatchRow{SheetID: sheet.ID, Params: objectValue(value)})
	}
	if err := s.store.AddBatchRows(sheet.ID, items, at); err != nil {
		writeError(w, 400, err.Error())
		return
	}
	all, err := s.store.ListBatchRows(sheet.ID)
	if err != nil {
		writeError(w, 500, "表格行读取失败")
		return
	}
	result := all[at : at+len(items)]
	writeJSON(w, 201, result)
}

func (s *Server) startBatchRun(w http.ResponseWriter, r *http.Request, user store.User, sheet store.BatchSheet) {
	input, ok := decodeMap(w, r)
	if !ok {
		return
	}
	rows, err := s.store.ListBatchRows(sheet.ID)
	if err != nil {
		writeError(w, 500, "表格行读取失败")
		return
	}
	selected := rows
	if ids, exists := input["rowIds"].([]any); exists && len(ids) > 0 {
		set := map[string]bool{}
		for _, id := range ids {
			set[fmt.Sprint(id)] = true
		}
		selected = nil
		for _, row := range rows {
			if set[row.ID] {
				selected = append(selected, row)
			}
		}
	}
	if len(selected) == 0 {
		writeError(w, 400, "至少需要选择一行")
		return
	}
	attempts := []store.BatchAttempt{}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	estimated := 0.0
	for _, row := range selected {
		params := mergeBatchParams(sheet.GlobalParams, row.Params)
		if message := validateBatchParams(sheet.CapabilityKey, params); message != "" {
			writeError(w, 400, fmt.Sprintf("第 %d 行：%s", row.Position+1, message))
			return
		}
		attemptNo, _ := s.store.NextBatchAttemptNo(row.ID)
		cost := batchEstimatedCredits(sheet.MediaKind, params)
		estimated += cost
		attempts = append(attempts, store.BatchAttempt{ID: randomIDForHTTP(), RowID: row.ID, AttemptNo: attemptNo, Status: "queued", EffectiveParams: params, ModelConfigSnapshot: map[string]any{"capabilityKey": sheet.CapabilityKey, "mediaKind": sheet.MediaKind}, EstimatedCredits: cost, QueuedAt: now, UpdatedAt: now})
	}
	run := store.BatchRun{ID: randomIDForHTTP(), SheetID: sheet.ID, UserID: user.ID, Status: "queued", TotalCount: len(attempts), EstimatedCredits: estimated, CreatedAt: now, UpdatedAt: now}
	for index := range attempts {
		attempts[index].RunID = run.ID
	}
	if err := s.store.CreateBatchRun(run, attempts); err != nil {
		writeError(w, 400, err.Error())
		return
	}
	s.startBackgroundTask(func() { s.executeBatchRun(run.ID, user.ID, sheet) })
	detail, _, _ := s.store.BatchRunDetail(run.ID, user.ID)
	writeJSON(w, 202, detail)
}

func (s *Server) retryBatchRun(w http.ResponseWriter, user store.User, runID string) {
	old, found, err := s.store.FindBatchRun(runID, user.ID)
	if err != nil || !found {
		writeError(w, 404, "批量任务不存在")
		return
	}
	attempts, err := s.store.ListBatchAttempts(old.ID)
	if err != nil {
		writeError(w, 500, "批量任务读取失败")
		return
	}
	sheet, found, err := s.store.FindBatchSheet(old.SheetID, user.ID)
	if err != nil || !found {
		writeError(w, 404, "表格不存在")
		return
	}
	inputRows := map[string]bool{}
	for _, attempt := range attempts {
		if attempt.Status == "failed" || attempt.Status == "partial_failed" {
			inputRows[attempt.RowID] = true
		}
	}
	rows, _ := s.store.ListBatchRows(sheet.ID)
	selected := []store.BatchRow{}
	for _, row := range rows {
		if inputRows[row.ID] {
			selected = append(selected, row)
		}
	}
	if len(selected) == 0 {
		writeError(w, 400, "当前任务没有可重试的失败行")
		return
	}
	createBatchRunForRows(w, s, user, sheet, selected)
}

func createBatchRunForRows(w http.ResponseWriter, s *Server, user store.User, sheet store.BatchSheet, selected []store.BatchRow) {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	attempts := []store.BatchAttempt{}
	estimated := 0.0
	for _, row := range selected {
		params := mergeBatchParams(sheet.GlobalParams, row.Params)
		attemptNo, _ := s.store.NextBatchAttemptNo(row.ID)
		cost := batchEstimatedCredits(sheet.MediaKind, params)
		estimated += cost
		attempts = append(attempts, store.BatchAttempt{ID: randomIDForHTTP(), RowID: row.ID, AttemptNo: attemptNo, Status: "queued", EffectiveParams: params, ModelConfigSnapshot: map[string]any{"capabilityKey": sheet.CapabilityKey, "mediaKind": sheet.MediaKind}, EstimatedCredits: cost, QueuedAt: now, UpdatedAt: now})
	}
	run := store.BatchRun{ID: randomIDForHTTP(), SheetID: sheet.ID, UserID: user.ID, Status: "queued", TotalCount: len(attempts), EstimatedCredits: estimated, CreatedAt: now, UpdatedAt: now}
	for index := range attempts {
		attempts[index].RunID = run.ID
	}
	if err := s.store.CreateBatchRun(run, attempts); err != nil {
		writeError(w, 400, err.Error())
		return
	}
	s.startBackgroundTask(func() { s.executeBatchRun(run.ID, user.ID, sheet) })
	detail, _, _ := s.store.BatchRunDetail(run.ID, user.ID)
	writeJSON(w, 202, detail)
}

func (s *Server) executeBatchRun(runID, userID string, sheet store.BatchSheet) {
	batchRunMu.Lock()
	if batchRunning[runID] {
		batchRunMu.Unlock()
		return
	}
	batchRunning[runID] = true
	batchRunMu.Unlock()
	defer func() { batchRunMu.Lock(); delete(batchRunning, runID); batchRunMu.Unlock() }()
	_ = s.store.MarkBatchRunRunning(runID, userID)
	attempts, err := s.store.ListBatchAttempts(runID)
	if err != nil {
		return
	}
	for _, attempt := range attempts {
		if attempt.Status != "queued" {
			continue
		}
		if err := s.store.MarkBatchAttemptRunning(attempt.ID); err != nil {
			continue
		}
		outputs, execErr := s.executeBatchAttempt(userID, sheet, attempt)
		if execErr != nil {
			_ = s.store.FailBatchAttempt(attempt.ID, attempt.RowID, runID, "execution_failed", execErr.Error())
			continue
		}
		status := "completed"
		_ = s.store.CompleteBatchAttempt(attempt.ID, attempt.RowID, runID, status, attempt.EstimatedCredits, outputs)
	}
}

func (s *Server) executeBatchAttempt(userID string, sheet store.BatchSheet, attempt store.BatchAttempt) ([]store.BatchOutput, error) {
	if sheet.MediaKind == "image" {
		return s.executeBatchImageAttempt(userID, sheet, attempt)
	}
	count := 1
	result := []store.BatchOutput{}
	for index := 0; index < count; index++ {
		asset, err := s.createBatchOutputAsset(userID, sheet, attempt.EffectiveParams, index)
		if err != nil {
			return nil, err
		}
		result = append(result, store.BatchOutput{ID: randomIDForHTTP(), AttemptID: attempt.ID, SlotIndex: index, AssetID: asset.ID, MediaKind: sheet.MediaKind, Metadata: map[string]any{"capabilityKey": sheet.CapabilityKey, "local": true, "prompt": stringValue(attempt.EffectiveParams, "prompt")}})
	}
	return result, nil
}

func (s *Server) executeBatchImageAttempt(userID string, sheet store.BatchSheet, attempt store.BatchAttempt) ([]store.BatchOutput, error) {
	params := attempt.EffectiveParams
	model := s.resolveImageModelConfig(stringValue(params, "modelConfigId"))
	ids := batchImageReferenceIDs(params)
	references, err := s.imageReferences(userID, nil, nil, ids)
	if err != nil {
		return nil, err
	}
	prompt := s.imageGenerationPrompt("", nil, params)
	count := imageGenerationCount(nil, params)
	assets, err := s.generateImageAssets(userID, model, prompt, count, references, s.imageGenerationOptions(nil, params), sheet.CapabilityKey, sheet.Name, firstAssetIDPointer(references))
	if err != nil {
		return nil, err
	}
	result := make([]store.BatchOutput, 0, len(assets))
	for index, asset := range assets {
		result = append(result, store.BatchOutput{ID: randomIDForHTTP(), AttemptID: attempt.ID, SlotIndex: index, AssetID: asset.ID, MediaKind: "image", Metadata: map[string]any{"capabilityKey": sheet.CapabilityKey, "provider": model.Provider, "model": model.Model, "prompt": prompt}})
	}
	return result, nil
}

func batchImageReferenceIDs(params map[string]any) []string {
	result := []string{}
	for key, value := range params {
		lower := strings.ToLower(key)
		if strings.Contains(lower, "asset") || strings.Contains(lower, "reference") || strings.Contains(lower, "attachment") {
			collectBatchAssetIDs(value, &result)
		}
	}
	return uniqueBatchStrings(result)
}

func uniqueBatchStrings(values []string) []string {
	seen := map[string]bool{}
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		result = append(result, value)
	}
	return result
}

func firstAssetIDPointer(assets []store.ContentAsset) *string {
	if len(assets) == 0 {
		return nil
	}
	return &assets[0].ID
}

func (s *Server) createBatchOutputAsset(userID string, sheet store.BatchSheet, params map[string]any, index int) (store.ContentAsset, error) {
	source := s.findBatchSourceAsset(userID, params)
	if source.ID == "" {
		return store.ContentAsset{}, fmt.Errorf("批量视频第 %d 行缺少可用源视频，且未配置视频模型", index+1)
	}
	if !strings.HasPrefix(source.MimeType, "video/") {
		return store.ContentAsset{}, errors.New("批量视频源素材必须是视频")
	}
	groupID, err := s.ensureContentGroup(userID, "other")
	if err != nil {
		return store.ContentAsset{}, err
	}
	name := fmt.Sprintf("%s-%d", sheet.Name, index+1)
	extension := filepath.Ext(source.StoredFileName)
	if extension == "" {
		extension = filepath.Ext(source.OriginalFileName)
	}
	if extension == "" {
		extension = ".mp4"
	}
	stored := fmt.Sprintf("%d-batch-%s%s", time.Now().UnixNano()+int64(index), sanitizeUploadName(name), extension)
	path := filepath.Join(s.config.DataDir, "files", stored)
	mimeType := source.MimeType
	fileSize := int64(0)
	if source.FilePath != "" {
		input, openErr := os.Open(source.FilePath)
		if openErr == nil {
			output, createErr := os.Create(path)
			if createErr == nil {
				_, copyErr := io.Copy(output, input)
				_ = output.Close()
				_ = input.Close()
				if copyErr == nil {
					fileSize = statFileSize(path)
					stored = filepath.Base(path)
					mimeType = source.MimeType
				} else {
					_ = os.Remove(path)
				}
			} else {
				_ = input.Close()
			}
		}
	}
	if fileSize == 0 {
		return store.ContentAsset{}, errors.New("批量视频源素材无法读取")
	}
	asset := store.ContentAsset{UserID: userID, GroupID: groupID, ResourceType: "other", Type: "generated", Name: name, OriginalFileName: name + filepath.Ext(stored), StoredFileName: stored, MimeType: mimeType, FileSize: fileSize, Size: fileSize, FilePath: path, FileURL: "/files/" + stored, AssetKind: "batch_output", LifecycleStatus: "permanent", Metadata: map[string]any{"capabilityKey": sheet.CapabilityKey, "generated": true, "renderMode": "source_passthrough"}}
	if source.ID != "" {
		asset.ParentAssetID = &source.ID
	}
	return s.store.CreateContentAsset(asset)
}

func statFileSize(path string) int64 {
	info, err := os.Stat(path)
	if err != nil {
		return 0
	}
	return info.Size()
}

func (s *Server) findBatchSourceAsset(userID string, value any) store.ContentAsset {
	var ids []string
	collectBatchAssetIDs(value, &ids)
	for _, id := range ids {
		asset, found, _ := s.store.FindContentAsset(id)
		if found && asset.UserID == userID {
			return asset
		}
	}
	return store.ContentAsset{}
}
func collectBatchAssetIDs(value any, result *[]string) {
	switch item := value.(type) {
	case string:
		if len(item) > 8 {
			*result = append(*result, item)
		}
	case []any:
		for _, child := range item {
			collectBatchAssetIDs(child, result)
		}
	case map[string]any:
		for _, child := range item {
			collectBatchAssetIDs(child, result)
		}
	}
}
func mergeBatchParams(global, row map[string]any) map[string]any {
	result := map[string]any{}
	for key, value := range global {
		result[key] = value
	}
	for key, value := range row {
		result[key] = value
	}
	return result
}
func validateBatchParams(key string, params map[string]any) string {
	if strings.HasPrefix(key, "image.") && stringValue(params, "prompt") == "" && key == "image.dialog" {
		return "提示词不能为空"
	}
	if strings.HasPrefix(key, "video.") && key == "video.generate" && stringValue(params, "prompt") == "" {
		return "提示词不能为空"
	}
	return ""
}
func batchEstimatedCredits(mediaKind string, params map[string]any) float64 {
	if mediaKind == "video" {
		return 15
	}
	count := int(numberValue(params["outputCount"], 1))
	if count < 1 {
		count = 1
	}
	return float64(count)
}
func valueOr(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}
func objectOr(value any, fallback map[string]any) map[string]any {
	if result, ok := value.(map[string]any); ok {
		return result
	}
	return fallback
}

func (s *Server) handleBatchAssetUpload(w http.ResponseWriter, r *http.Request, user store.User) {
	asset, err := s.uploadContentAsset(r, uploadOptions{UserID: user.ID, ResourceType: "other", AssetKind: "batch_input", Metadata: map[string]any{"source": "batch_generation"}})
	if err != nil {
		writeError(w, 400, err.Error())
		return
	}
	writeJSON(w, 201, asset)
}
func (s *Server) handleBatchAsset(w http.ResponseWriter, r *http.Request, user store.User, id string) {
	asset, found, err := s.store.FindContentAsset(id)
	if err != nil || !found || asset.UserID != user.ID {
		writeError(w, 404, "素材不存在")
		return
	}
	writeJSON(w, 200, asset)
}
