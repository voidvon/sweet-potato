package store

import (
	"database/sql"
	"errors"
	"strings"
	"time"
)

type ContentPlanningSession struct {
	ID             string         `json:"id"`
	UserID         string         `json:"userId"`
	SourceSurface  string         `json:"sourceSurface"`
	Status         string         `json:"status"`
	UIStep         string         `json:"uiStep"`
	JobStage       string         `json:"jobStage"`
	MaterialBundle map[string]any `json:"materialBundle"`
	Analysis       map[string]any `json:"analysis"`
	Settings       map[string]any `json:"settings"`
	Generation     map[string]any `json:"generation"`
	ApplySnapshot  map[string]any `json:"applySnapshot,omitempty"`
	ErrorMessage   string         `json:"errorMessage,omitempty"`
	CreatedAt      string         `json:"createdAt"`
	UpdatedAt      string         `json:"updatedAt"`
}

func defaultPlanningMaterialBundle() map[string]any {
	return map[string]any{"prompt": "", "productName": "", "imageMaterials": []any{}, "documentMaterials": []any{}, "referenceVideo": nil, "referenceAudio": nil}
}

func defaultPlanningAnalysis() map[string]any {
	return map[string]any{
		"referenceBreakdown": nil,
		"materialCaptions":   []any{},
		"campaignPlan":       nil,
		"campaignImageGeneration": map[string]any{
			"status": "idle", "images": []any{}, "errorMessage": "",
		},
		"productInsights": map[string]any{
			"productName": "", "productCategory": "", "productFeatures": []any{}, "coreSellingPoints": []any{}, "targetAudience": []any{}, "useScenarios": []any{},
		},
		"confirmed": false,
		"notes":     []any{},
	}
}

func defaultPlanningSettings() map[string]any {
	return map[string]any{
		"businessScene": "unrestricted", "contentType": "", "shootingMethod": "", "spokenLanguage": "zh", "displayOnly": false,
		"extraInstruction": "", "durationSeconds": 5, "styleKeywords": []any{"干净明亮"}, "deepThink": true, "webSearch": false, "candidateCount": 1,
		"referencePolicy": map[string]any{"useBreakdown": true, "lockedContentPreset": nil},
	}
}

func defaultPlanningGeneration() map[string]any {
	return map[string]any{"reasoningLogs": []any{}, "reasoningStream": nil, "stages": []any{}, "candidates": []any{}, "selectedCandidateId": "", "validatorSummary": "", "stageOutputs": map[string]any{}}
}

func normalizePlanningMap(value map[string]any, fallback map[string]any) map[string]any {
	if value == nil {
		return fallback
	}
	return value
}

func scanPlanningSession(scanner rowScanner) (ContentPlanningSession, error) {
	var item ContentPlanningSession
	var material, analysis, settings, generation, snapshot string
	if err := scanner.Scan(&item.ID, &item.UserID, &item.SourceSurface, &item.Status, &item.UIStep, &item.JobStage, &material, &analysis, &settings, &generation, &snapshot, &item.ErrorMessage, &item.CreatedAt, &item.UpdatedAt); err != nil {
		return ContentPlanningSession{}, err
	}
	item.MaterialBundle = normalizePlanningMap(decodeMapJSON(material), defaultPlanningMaterialBundle())
	item.Analysis = normalizePlanningMap(decodeMapJSON(analysis), defaultPlanningAnalysis())
	item.Settings = normalizePlanningMap(decodeMapJSON(settings), defaultPlanningSettings())
	item.Generation = normalizePlanningMap(decodeMapJSON(generation), defaultPlanningGeneration())
	if strings.TrimSpace(snapshot) != "" && strings.TrimSpace(snapshot) != "null" {
		item.ApplySnapshot = decodeMapJSON(snapshot)
	}
	return item, nil
}

const planningSelect = `SELECT id, user_id, source_surface, status, ui_step, job_stage, material_bundle, analysis, settings, generation, apply_snapshot, error_message, created_at, updated_at FROM content_planning_sessions`

func (s *Store) FindPlanningSession(id string) (ContentPlanningSession, bool, error) {
	item, err := scanPlanningSession(s.db.QueryRow(planningSelect+` WHERE id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return ContentPlanningSession{}, false, nil
	}
	return item, err == nil, err
}

func (s *Store) FindLatestPlanningSession(userID, sourceSurface string) (ContentPlanningSession, bool, error) {
	item, err := scanPlanningSession(s.db.QueryRow(planningSelect+` WHERE user_id = ? AND source_surface = ? AND status IN ('draft', 'analyzing', 'confirming', 'configuring', 'generating', 'ready_to_apply', 'failed') ORDER BY updated_at DESC LIMIT 1`, userID, sourceSurface))
	if errors.Is(err, sql.ErrNoRows) {
		return ContentPlanningSession{}, false, nil
	}
	return item, err == nil, err
}

func (s *Store) CreatePlanningSession(userID, sourceSurface, prompt, productName string) (ContentPlanningSession, error) {
	if sourceSurface == "" {
		sourceSurface = "create_video"
	}
	id := mustRandomID()
	now := time.Now().UTC().Format(time.RFC3339Nano)
	material := defaultPlanningMaterialBundle()
	material["prompt"] = strings.TrimSpace(prompt)
	material["productName"] = strings.TrimSpace(productName)
	item := ContentPlanningSession{ID: id, UserID: userID, SourceSurface: sourceSurface, Status: "draft", UIStep: "step1", JobStage: "idle", MaterialBundle: material, Analysis: defaultPlanningAnalysis(), Settings: defaultPlanningSettings(), Generation: defaultPlanningGeneration(), CreatedAt: now, UpdatedAt: now}
	_, err := s.db.Exec(`INSERT INTO content_planning_sessions (id, user_id, source_surface, status, ui_step, job_stage, material_bundle, analysis, settings, generation, apply_snapshot, error_message, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'null', '', ?, ?)`, item.ID, item.UserID, item.SourceSurface, item.Status, item.UIStep, item.JobStage, encodeJSON(item.MaterialBundle), encodeJSON(item.Analysis), encodeJSON(item.Settings), encodeJSON(item.Generation), item.CreatedAt, item.UpdatedAt)
	if err != nil {
		return ContentPlanningSession{}, err
	}
	return item, nil
}

func (s *Store) UpdatePlanningSession(item ContentPlanningSession) (ContentPlanningSession, error) {
	item.MaterialBundle = normalizePlanningMap(item.MaterialBundle, defaultPlanningMaterialBundle())
	item.Analysis = normalizePlanningMap(item.Analysis, defaultPlanningAnalysis())
	item.Settings = normalizePlanningMap(item.Settings, defaultPlanningSettings())
	item.Generation = normalizePlanningMap(item.Generation, defaultPlanningGeneration())
	item.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	var snapshot any = "null"
	if item.ApplySnapshot != nil {
		snapshot = encodeJSON(item.ApplySnapshot)
	}
	_, err := s.db.Exec(`UPDATE content_planning_sessions SET status = ?, ui_step = ?, job_stage = ?, material_bundle = ?, analysis = ?, settings = ?, generation = ?, apply_snapshot = ?, error_message = ?, updated_at = ? WHERE id = ? AND user_id = ?`, item.Status, item.UIStep, item.JobStage, encodeJSON(item.MaterialBundle), encodeJSON(item.Analysis), encodeJSON(item.Settings), encodeJSON(item.Generation), snapshot, item.ErrorMessage, item.UpdatedAt, item.ID, item.UserID)
	if err != nil {
		return ContentPlanningSession{}, err
	}
	result, found, err := s.FindPlanningSession(item.ID)
	if err != nil {
		return ContentPlanningSession{}, err
	}
	if !found {
		return ContentPlanningSession{}, sql.ErrNoRows
	}
	return result, nil
}
