package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

type ChatConversation struct {
	ID            string         `json:"id"`
	UserID        string         `json:"userId"`
	Title         string         `json:"title"`
	AgentID       string         `json:"agentId"`
	ModelConfigID *string        `json:"modelConfigId,omitempty"`
	Metadata      map[string]any `json:"metadata,omitempty"`
	CreatedAt     string         `json:"createdAt"`
	UpdatedAt     string         `json:"updatedAt"`
}

type ChatMessage struct {
	ID                           string         `json:"id"`
	ConversationID               string         `json:"conversationId"`
	Role                         string         `json:"role"`
	Content                      string         `json:"content"`
	CapabilityContext            map[string]any `json:"capabilityContext,omitempty"`
	ImageModelConfigID           *string        `json:"imageModelConfigId,omitempty"`
	GenerationJobID              *string        `json:"generationJobId,omitempty"`
	ImageGenerationExpectedCount *int           `json:"imageGenerationExpectedCount,omitempty"`
	ImageGenerationFailures      []any          `json:"imageGenerationFailures,omitempty"`
	ReasoningContent             *string        `json:"reasoningContent,omitempty"`
	Actions                      []any          `json:"actions,omitempty"`
	AgentID                      string         `json:"agentId"`
	ModelConfigID                *string        `json:"modelConfigId,omitempty"`
	Attachments                  []any          `json:"attachments,omitempty"`
	IsCompleted                  bool           `json:"isCompleted"`
	CreditCost                   *float64       `json:"creditCost,omitempty"`
	CreatedAt                    string         `json:"createdAt"`
}

type Agent struct {
	ID                string         `json:"id"`
	Name              string         `json:"name"`
	Description       string         `json:"description"`
	Icon              string         `json:"icon"`
	BuiltIn           bool           `json:"builtIn"`
	Capabilities      []any          `json:"capabilities"`
	RunMode           string         `json:"runMode"`
	ModelConfigID     *string        `json:"modelConfigId,omitempty"`
	SystemPrompt      string         `json:"systemPrompt"`
	Tools             []any          `json:"tools"`
	Skills            []any          `json:"skills"`
	RetrievalStrategy string         `json:"retrievalStrategy"`
	WebSearchEnabled  bool           `json:"webSearchEnabled"`
	Multimodal        map[string]any `json:"multimodal"`
	CreatedAt         string         `json:"createdAt"`
}

func decodeMapJSON(value string) map[string]any {
	var result map[string]any
	if err := json.Unmarshal([]byte(value), &result); err != nil || result == nil {
		return map[string]any{}
	}
	return result
}

func decodeListJSON(value string) []any {
	var result []any
	if err := json.Unmarshal([]byte(value), &result); err != nil || result == nil {
		return []any{}
	}
	return result
}

func encodeJSON(value any) string {
	encoded, err := json.Marshal(value)
	if err != nil {
		return "{}"
	}
	return string(encoded)
}

func (s *Store) ListAgents() ([]Agent, error) {
	rows, err := s.db.Query(`SELECT id, name, description, icon, built_in, capabilities, run_mode, model_config_id, system_prompt, tools, skills, retrieval_strategy, web_search_enabled, multimodal, created_at FROM agents ORDER BY built_in DESC, created_at ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]Agent, 0)
	for rows.Next() {
		item, err := scanAgent(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func (s *Store) FindAgent(id string) (Agent, bool, error) {
	item, err := scanAgent(s.db.QueryRow(`SELECT id, name, description, icon, built_in, capabilities, run_mode, model_config_id, system_prompt, tools, skills, retrieval_strategy, web_search_enabled, multimodal, created_at FROM agents WHERE id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return Agent{}, false, nil
	}
	return item, err == nil, err
}

func scanAgent(scanner rowScanner) (Agent, error) {
	var item Agent
	var builtIn, webSearch int
	var modelID sql.NullString
	var capabilities, tools, skills, multimodal string
	if err := scanner.Scan(&item.ID, &item.Name, &item.Description, &item.Icon, &builtIn, &capabilities, &item.RunMode, &modelID, &item.SystemPrompt, &tools, &skills, &item.RetrievalStrategy, &webSearch, &multimodal, &item.CreatedAt); err != nil {
		return Agent{}, err
	}
	item.BuiltIn = builtIn != 0
	item.WebSearchEnabled = webSearch != 0
	item.ModelConfigID = nullStringPointer(modelID)
	item.Capabilities = decodeListJSON(capabilities)
	item.Tools = decodeListJSON(tools)
	item.Skills = decodeListJSON(skills)
	item.Multimodal = decodeMapJSON(multimodal)
	return item, nil
}

func (s *Store) ListChatConversations(userID string) ([]ChatConversation, error) {
	rows, err := s.db.Query(`SELECT id, user_id, title, agent_id, model_config_id, metadata, created_at, updated_at FROM chat_conversations WHERE user_id = ? ORDER BY updated_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	// Keep empty conversation history responses as JSON arrays.
	result := make([]ChatConversation, 0)
	for rows.Next() {
		item, err := scanConversation(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func (s *Store) FindChatConversation(id string) (ChatConversation, bool, error) {
	item, err := scanConversation(s.db.QueryRow(`SELECT id, user_id, title, agent_id, model_config_id, metadata, created_at, updated_at FROM chat_conversations WHERE id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return ChatConversation{}, false, nil
	}
	return item, err == nil, err
}

func scanConversation(scanner rowScanner) (ChatConversation, error) {
	var item ChatConversation
	var modelID, metadata sql.NullString
	if err := scanner.Scan(&item.ID, &item.UserID, &item.Title, &item.AgentID, &modelID, &metadata, &item.CreatedAt, &item.UpdatedAt); err != nil {
		return ChatConversation{}, err
	}
	item.ModelConfigID = nullStringPointer(modelID)
	item.Metadata = decodeMapJSON(metadata.String)
	return item, nil
}

func (s *Store) SaveChatConversation(item ChatConversation, insert bool) (ChatConversation, error) {
	if item.ID == "" {
		item.ID = mustRandomID()
	}
	if item.Title == "" {
		item.Title = "新对话"
	}
	if item.AgentID == "" {
		item.AgentID = "quick-answer"
	}
	if item.Metadata == nil {
		item.Metadata = map[string]any{}
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if item.CreatedAt == "" {
		item.CreatedAt = now
	}
	item.UpdatedAt = now
	var err error
	if insert {
		_, err = s.db.Exec(`INSERT INTO chat_conversations (id, user_id, title, agent_id, model_config_id, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, item.ID, item.UserID, strings.TrimSpace(item.Title), item.AgentID, nullableStringValue(item.ModelConfigID), encodeJSON(item.Metadata), item.CreatedAt, item.UpdatedAt)
	} else {
		_, err = s.db.Exec(`UPDATE chat_conversations SET title = ?, agent_id = ?, model_config_id = ?, metadata = ?, updated_at = ? WHERE id = ? AND user_id = ?`, strings.TrimSpace(item.Title), item.AgentID, nullableStringValue(item.ModelConfigID), encodeJSON(item.Metadata), item.UpdatedAt, item.ID, item.UserID)
	}
	if err != nil {
		return ChatConversation{}, err
	}
	result, found, err := s.FindChatConversation(item.ID)
	if err != nil {
		return ChatConversation{}, err
	}
	if !found {
		return ChatConversation{}, sql.ErrNoRows
	}
	return result, nil
}

func (s *Store) ListChatMessages(conversationID string) ([]ChatMessage, error) {
	rows, err := s.db.Query(`SELECT id, conversation_id, role, content, capability_context, image_model_config_id, generation_job_id, image_generation_expected_count, image_generation_failures, reasoning_content, actions, agent_id, model_config_id, attachments, is_completed, credit_cost, created_at FROM chat_messages WHERE conversation_id = ? ORDER BY created_at ASC`, conversationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	// Keep empty message history responses as JSON arrays.
	result := make([]ChatMessage, 0)
	for rows.Next() {
		item, err := scanMessage(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func (s *Store) FindChatMessage(id string) (ChatMessage, bool, error) {
	item, err := scanMessage(s.db.QueryRow(`SELECT id, conversation_id, role, content, capability_context, image_model_config_id, generation_job_id, image_generation_expected_count, image_generation_failures, reasoning_content, actions, agent_id, model_config_id, attachments, is_completed, credit_cost, created_at FROM chat_messages WHERE id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return ChatMessage{}, false, nil
	}
	return item, err == nil, err
}

func scanMessage(scanner rowScanner) (ChatMessage, error) {
	var item ChatMessage
	var capability, imageID, jobID, failures, reasoning, actions, modelID, attachments sql.NullString
	var expected sql.NullInt64
	var completed int
	var credit sql.NullFloat64
	if err := scanner.Scan(&item.ID, &item.ConversationID, &item.Role, &item.Content, &capability, &imageID, &jobID, &expected, &failures, &reasoning, &actions, &item.AgentID, &modelID, &attachments, &completed, &credit, &item.CreatedAt); err != nil {
		return ChatMessage{}, err
	}
	item.CapabilityContext = nil
	if capability.Valid && strings.TrimSpace(capability.String) != "" {
		item.CapabilityContext = decodeMapJSON(capability.String)
	}
	item.ImageModelConfigID = nullStringPointer(imageID)
	item.GenerationJobID = nullStringPointer(jobID)
	if expected.Valid {
		value := int(expected.Int64)
		item.ImageGenerationExpectedCount = &value
	}
	item.ImageGenerationFailures = decodeListJSON(failures.String)
	if reasoning.Valid && reasoning.String != "" {
		item.ReasoningContent = &reasoning.String
	}
	item.Actions = decodeListJSON(actions.String)
	item.ModelConfigID = nullStringPointer(modelID)
	item.Attachments = decodeListJSON(attachments.String)
	item.IsCompleted = completed != 0
	if credit.Valid {
		value := credit.Float64
		item.CreditCost = &value
	}
	return item, nil
}

func (s *Store) SaveChatMessage(item ChatMessage) (ChatMessage, error) {
	if item.ID == "" {
		item.ID = mustRandomID()
	}
	if item.CreatedAt == "" {
		item.CreatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	}
	if item.ImageGenerationFailures == nil {
		item.ImageGenerationFailures = []any{}
	}
	if item.Actions == nil {
		item.Actions = []any{}
	}
	if item.Attachments == nil {
		item.Attachments = []any{}
	}
	_, err := s.db.Exec(`INSERT INTO chat_messages (id, conversation_id, role, content, capability_context, image_model_config_id, generation_job_id, image_generation_expected_count, image_generation_failures, reasoning_content, actions, agent_id, model_config_id, attachments, is_completed, credit_cost, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, item.ID, item.ConversationID, item.Role, item.Content, encodeNullableObject(item.CapabilityContext), nullableStringValue(item.ImageModelConfigID), nullableStringValue(item.GenerationJobID), nullableIntPointer(item.ImageGenerationExpectedCount), encodeJSON(item.ImageGenerationFailures), nullableStringValue(item.ReasoningContent), encodeJSON(item.Actions), item.AgentID, nullableStringValue(item.ModelConfigID), encodeJSON(item.Attachments), boolInt(item.IsCompleted), nullableFloatPointer(item.CreditCost), item.CreatedAt)
	if err != nil {
		return ChatMessage{}, err
	}
	result, _, err := s.FindChatMessage(item.ID)
	return result, err
}

func (s *Store) UpdateChatMessage(item ChatMessage) (ChatMessage, error) {
	if item.ImageGenerationFailures == nil {
		item.ImageGenerationFailures = []any{}
	}
	if item.Actions == nil {
		item.Actions = []any{}
	}
	if item.Attachments == nil {
		item.Attachments = []any{}
	}
	_, err := s.db.Exec(`UPDATE chat_messages SET content = ?, capability_context = ?, image_model_config_id = ?, generation_job_id = ?, image_generation_expected_count = ?, image_generation_failures = ?, reasoning_content = ?, actions = ?, model_config_id = ?, attachments = ?, is_completed = ?, credit_cost = ? WHERE id = ?`, item.Content, encodeNullableObject(item.CapabilityContext), nullableStringValue(item.ImageModelConfigID), nullableStringValue(item.GenerationJobID), nullableIntPointer(item.ImageGenerationExpectedCount), encodeJSON(item.ImageGenerationFailures), nullableStringValue(item.ReasoningContent), encodeJSON(item.Actions), nullableStringValue(item.ModelConfigID), encodeJSON(item.Attachments), boolInt(item.IsCompleted), nullableFloatPointer(item.CreditCost), item.ID)
	if err != nil {
		return ChatMessage{}, err
	}
	result, _, err := s.FindChatMessage(item.ID)
	return result, err
}

func (s *Store) DeleteChatConversation(id, userID string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.Exec(`DELETE FROM chat_conversations WHERE id = ? AND user_id = ?`, id, userID)
	if err != nil {
		return err
	}
	count, _ := result.RowsAffected()
	if count == 0 {
		return errors.New("对话不存在")
	}
	if _, err := tx.Exec(`DELETE FROM chat_messages WHERE conversation_id = ?`, id); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) ClearChatMessages(id, userID string) (ChatConversation, error) {
	conversation, found, err := s.FindChatConversation(id)
	if err != nil || !found || conversation.UserID != userID {
		return ChatConversation{}, errors.New("对话不存在")
	}
	tx, err := s.db.Begin()
	if err != nil {
		return ChatConversation{}, err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`DELETE FROM chat_messages WHERE conversation_id = ?`, id); err != nil {
		return ChatConversation{}, err
	}
	metadata := conversation.Metadata
	if metadata == nil {
		metadata = map[string]any{}
	}
	metadata["previewText"] = ""
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := tx.Exec(`UPDATE chat_conversations SET metadata = ?, updated_at = ? WHERE id = ?`, encodeJSON(metadata), now, id); err != nil {
		return ChatConversation{}, err
	}
	if err := tx.Commit(); err != nil {
		return ChatConversation{}, err
	}
	conversation, _, err = s.FindChatConversation(id)
	return conversation, err
}

func (s *Store) DeleteChatMessage(conversationID, messageID, userID string) (ChatConversation, []ChatMessage, error) {
	conversation, found, err := s.FindChatConversation(conversationID)
	if err != nil || !found || conversation.UserID != userID {
		return ChatConversation{}, nil, errors.New("对话不存在")
	}
	result, err := s.db.Exec(`DELETE FROM chat_messages WHERE id = ? AND conversation_id = ?`, messageID, conversationID)
	if err != nil {
		return ChatConversation{}, nil, err
	}
	count, _ := result.RowsAffected()
	if count == 0 {
		return ChatConversation{}, nil, errors.New("消息不存在")
	}
	messages, err := s.ListChatMessages(conversationID)
	return conversation, messages, err
}

func encodeNullableObject(value map[string]any) any {
	if value == nil {
		return nil
	}
	return encodeJSON(value)
}

func nullableIntPointer(value *int) any {
	if value == nil {
		return nil
	}
	return *value
}

func nullableFloatPointer(value *float64) any {
	if value == nil {
		return nil
	}
	return *value
}
