package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

func (s *Store) ListUserModelConfigs(userID, modelType string) ([]ModelConfig, error) {
	query := `SELECT id, user_id, type, name, provider, model, api_key, base_url, temperature, settings, is_default, sort_order, created_at, updated_at FROM user_model_configs WHERE user_id = ?`
	args := []any{userID}
	if modelType != "" {
		query += ` AND type = ?`
		args = append(args, modelType)
	}
	query += ` ORDER BY type ASC, sort_order ASC, is_default DESC, updated_at DESC`
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("list user model configs: %w", err)
	}
	defer rows.Close()
	result := make([]ModelConfig, 0)
	for rows.Next() {
		model, err := scanUserModelConfig(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, model)
	}
	return result, rows.Err()
}

func (s *Store) FindUserModelConfig(userID, id string) (ModelConfig, bool, error) {
	row := s.db.QueryRow(`SELECT id, user_id, type, name, provider, model, api_key, base_url, temperature, settings, is_default, sort_order, created_at, updated_at FROM user_model_configs WHERE id = ? AND user_id = ?`, id, userID)
	model, err := scanUserModelConfig(row)
	if errors.Is(err, sql.ErrNoRows) {
		return ModelConfig{}, false, nil
	}
	return model, err == nil, err
}

type userModelScanner interface {
	Scan(dest ...any) error
}

func scanUserModelConfig(scanner userModelScanner) (ModelConfig, error) {
	var model ModelConfig
	var settings string
	var isDefault int
	err := scanner.Scan(&model.ID, &model.OwnerUserID, &model.Type, &model.Name, &model.Provider, &model.Model, &model.APIKey, &model.BaseURL, &model.Temperature, &settings, &isDefault, &model.SortOrder, &model.CreatedAt, &model.UpdatedAt)
	if err != nil {
		return ModelConfig{}, err
	}
	model.Settings = decodeObject(settings)
	model.IsDefault = isDefault != 0
	return model, nil
}

func (s *Store) SaveUserModelConfig(userID string, model ModelConfig, insert bool) (ModelConfig, error) {
	if strings.TrimSpace(userID) == "" {
		return ModelConfig{}, errors.New("用户不能为空")
	}
	model.Type = strings.TrimSpace(model.Type)
	if model.Type != "image" && model.Type != "llm" {
		return ModelConfig{}, errors.New("个人模型当前仅支持 LLM 和图片模型")
	}
	model.Name = strings.TrimSpace(model.Name)
	model.Provider = strings.TrimSpace(model.Provider)
	model.Model = strings.TrimSpace(model.Model)
	model.BaseURL = strings.TrimSpace(model.BaseURL)
	if model.Name == "" || model.Provider == "" || model.Model == "" || model.BaseURL == "" {
		return ModelConfig{}, errors.New("模型名称、供应商、模型和服务地址不能为空")
	}
	if model.ID == "" {
		model.ID = mustRandomID()
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if model.CreatedAt == "" {
		model.CreatedAt = now
	}
	model.UpdatedAt = now
	model.OwnerUserID = userID
	settings, _ := json.Marshal(model.SettingsOrEmpty())
	tx, err := s.db.Begin()
	if err != nil {
		return ModelConfig{}, err
	}
	defer tx.Rollback()
	if model.IsDefault {
		if _, err := tx.Exec(`UPDATE user_model_configs SET is_default = 0 WHERE user_id = ? AND type = ?`, userID, model.Type); err != nil {
			return ModelConfig{}, err
		}
	}
	if insert {
		_, err = tx.Exec(`INSERT INTO user_model_configs (id, user_id, type, name, provider, model, api_key, base_url, temperature, settings, is_default, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, model.ID, userID, model.Type, model.Name, model.Provider, model.Model, model.APIKey, model.BaseURL, model.Temperature, string(settings), boolInt(model.IsDefault), model.SortOrder, model.CreatedAt, model.UpdatedAt)
	} else {
		result, updateErr := tx.Exec(`UPDATE user_model_configs SET name = ?, provider = ?, model = ?, api_key = ?, base_url = ?, temperature = ?, settings = ?, is_default = ?, sort_order = ?, updated_at = ? WHERE id = ? AND user_id = ?`, model.Name, model.Provider, model.Model, model.APIKey, model.BaseURL, model.Temperature, string(settings), boolInt(model.IsDefault), model.SortOrder, model.UpdatedAt, model.ID, userID)
		err = updateErr
		if err == nil {
			if count, _ := result.RowsAffected(); count == 0 {
				return ModelConfig{}, errors.New("模型配置不存在")
			}
		}
	}
	if err != nil {
		return ModelConfig{}, fmt.Errorf("save user model config: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return ModelConfig{}, err
	}
	result, found, err := s.FindUserModelConfig(userID, model.ID)
	if err != nil {
		return ModelConfig{}, err
	}
	if !found {
		return ModelConfig{}, sql.ErrNoRows
	}
	return result, nil
}

func (s *Store) DeleteUserModelConfig(userID, id string) error {
	result, err := s.db.Exec(`DELETE FROM user_model_configs WHERE id = ? AND user_id = ?`, id, userID)
	if err != nil {
		return err
	}
	if count, _ := result.RowsAffected(); count == 0 {
		return errors.New("模型配置不存在")
	}
	return nil
}
