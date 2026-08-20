package httpapi

import (
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"sweet-potato-go/internal/store"
	"sweet-potato-go/internal/transfer"
)

type chatRequest struct {
	ConversationID        string         `json:"conversationId"`
	EditMessageID         string         `json:"editMessageId"`
	AgentID               string         `json:"agentId"`
	ModelConfigID         *string        `json:"modelConfigId"`
	ImageModelConfigID    *string        `json:"imageModelConfigId"`
	Attachments           []any          `json:"attachments"`
	Content               string         `json:"content"`
	CapabilityContext     map[string]any `json:"capabilityContext"`
	RequestedCapabilities []string       `json:"requestedCapabilities"`
	AutoImageGeneration   bool           `json:"autoImageGeneration"`
}

func (s *Server) handleChat(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireUser(w, r, "web.module.chat"); !ok {
		return
	}
	parts := splitPath(strings.TrimPrefix(strings.TrimPrefix(r.URL.Path, "/api/chat"), "/"))
	if len(parts) == 0 {
		writeError(w, http.StatusNotFound, "接口不存在")
		return
	}
	if parts[0] == "messages" && len(parts) == 2 && parts[1] == "ws" {
		s.handleChatWebSocket(w, r)
		return
	}
	if parts[0] == "attachments" {
		s.handleChatAttachments(w, r, parts[1:])
		return
	}
	if parts[0] == "conversations" {
		s.handleChatConversations(w, r, parts[1:])
		return
	}
	if parts[0] == "messages" && len(parts) == 1 && r.Method == http.MethodPost {
		s.handleCreateChatMessage(w, r)
		return
	}
	writeError(w, http.StatusNotFound, "接口不存在")
}

func (s *Server) handleChatAttachments(w http.ResponseWriter, r *http.Request, parts []string) {
	user, ok := s.requireUser(w, r, "web.module.chat")
	if !ok {
		return
	}
	if len(parts) == 2 && parts[0] == "direct-upload" && parts[1] == "prepare" && r.Method == http.MethodPost {
		s.prepareLocalDirectUpload(w, r)
		return
	}
	if len(parts) == 2 && parts[0] == "direct-upload" && parts[1] == "complete" && r.Method == http.MethodPost {
		input, ok := decodeMap(w, r)
		if !ok {
			return
		}
		asset, _, err := s.completeLocalDirectUploadAsset(user.ID, input)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusCreated, chatAttachmentPayload(asset))
		return
	}
	if len(parts) == 1 && parts[0] == "upload" && r.Method == http.MethodPost {
		asset, err := s.uploadContentAsset(r, uploadOptions{UserID: user.ID, ResourceType: "other", AssetKind: "file_input", Metadata: map[string]any{"kind": "chat_reference_upload", "source": "local_upload", "temporary": true}})
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusCreated, chatAttachmentPayload(asset))
		return
	}
	if len(parts) == 2 && r.Method == http.MethodDelete {
		asset, found, err := s.store.FindContentAsset(parts[1])
		if err != nil || !found || asset.UserID != user.ID || stringValue(asset.Metadata, "kind") != "chat_reference_upload" {
			writeError(w, http.StatusBadRequest, "附件素材不存在")
			return
		}
		if asset.FilePath != "" {
			_ = os.Remove(asset.FilePath)
		}
		_, _ = s.store.DeleteContentAsset(asset.ID, user.ID)
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "deleted": true})
		return
	}
	writeError(w, http.StatusNotFound, "附件接口不存在")
}

func chatAttachmentPayload(asset store.ContentAsset) map[string]any {
	kind := "file"
	if strings.HasPrefix(asset.MimeType, "image/") {
		kind = "image"
	}
	return map[string]any{"id": "chat-attachment-" + asset.ID, "assetId": asset.ID, "name": asset.OriginalFileName, "type": asset.MimeType, "size": asset.FileSize, "kind": kind, "url": asset.FileURL}
}

func (s *Server) handleChatConversations(w http.ResponseWriter, r *http.Request, parts []string) {
	user, ok := s.requireUser(w, r, "web.module.chat")
	if !ok {
		return
	}
	if len(parts) == 0 && r.Method == http.MethodGet {
		items, err := s.store.ListChatConversations(user.ID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "对话列表读取失败")
			return
		}
		if items == nil {
			items = []store.ChatConversation{}
		}
		writeJSON(w, http.StatusOK, items)
		return
	}
	if len(parts) == 1 {
		conversation, found, err := s.store.FindChatConversation(parts[0])
		if err != nil || !found {
			writeError(w, http.StatusNotFound, "对话不存在")
			return
		}
		if conversation.UserID != user.ID {
			writeError(w, http.StatusForbidden, "无权访问该对话")
			return
		}
		switch r.Method {
		case http.MethodGet:
			messages, err := s.store.ListChatMessages(conversation.ID)
			if err != nil {
				writeError(w, http.StatusInternalServerError, "消息列表读取失败")
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"conversation": conversation, "messages": messages})
		case http.MethodPut:
			input, ok := decodeMap(w, r)
			if !ok {
				return
			}
			title := strings.TrimSpace(stringValue(input, "title"))
			if title == "" {
				writeError(w, http.StatusBadRequest, "会话名称不能为空")
				return
			}
			conversation.Title = truncateRunes(title, 80)
			updated, err := s.store.SaveChatConversation(conversation, false)
			if err != nil {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
			writeJSON(w, http.StatusOK, updated)
		case http.MethodDelete:
			if err := s.store.DeleteChatConversation(conversation.ID, user.ID); err != nil {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
			w.WriteHeader(http.StatusNoContent)
		default:
			writeError(w, http.StatusMethodNotAllowed, "请求方法不支持")
		}
		return
	}
	if len(parts) == 2 && parts[1] == "messages" {
		conversation, found, err := s.store.FindChatConversation(parts[0])
		if err != nil || !found || conversation.UserID != user.ID {
			writeError(w, http.StatusNotFound, "对话不存在")
			return
		}
		if r.Method == http.MethodGet {
			messages, err := s.store.ListChatMessages(conversation.ID)
			if err != nil {
				writeError(w, http.StatusInternalServerError, "消息列表读取失败")
				return
			}
			writeJSON(w, http.StatusOK, messages)
			return
		}
		if r.Method == http.MethodDelete {
			updated, err := s.store.ClearChatMessages(conversation.ID, user.ID)
			if err != nil {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"conversation": updated, "messages": []any{}})
			return
		}
	}
	if len(parts) == 3 && parts[1] == "messages" && r.Method == http.MethodDelete {
		conversation, messages, err := s.store.DeleteChatMessage(parts[0], parts[2], user.ID)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"conversation": conversation, "messages": messages})
		return
	}
	writeError(w, http.StatusNotFound, "对话接口不存在")
}

func (s *Server) handleCreateChatMessage(w http.ResponseWriter, r *http.Request) {
	var input chatRequest
	if !decodeJSONBody(w, r, &input) {
		return
	}
	user, ok := s.requireUser(w, r, "web.module.chat")
	if !ok {
		return
	}
	result, err := s.createChatResponse(user, input)
	if err != nil {
		status := http.StatusBadRequest
		if errors.Is(err, errChatAgentNotFound) {
			status = http.StatusNotFound
		}
		writeError(w, status, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

var errChatAgentNotFound = errors.New("智能体不存在")

func (s *Server) createChatResponse(user store.User, input chatRequest) (map[string]any, error) {
	content := strings.TrimSpace(input.Content)
	imageRequest := isImageGenerationRequest(input)
	directImageRequest := imageRequest && !input.AutoImageGeneration
	imageDecision := imageGenerationDecision{}
	if content == "" && len(input.Attachments) == 0 && !imageRequest {
		return nil, errors.New("消息内容不能为空")
	}
	agentID := strings.TrimSpace(input.AgentID)
	if agentID == "" {
		agentID = "quick-answer"
	}
	var agent store.Agent
	var model store.ModelConfig
	var llmModelID *string
	if !directImageRequest {
		var found bool
		var err error
		agent, found, err = s.store.FindAgent(agentID)
		if err != nil {
			return nil, err
		}
		if !found {
			return nil, errChatAgentNotFound
		}
		model, err = s.resolveLLMModelConfig(user.ID, pointerValue(input.ModelConfigID), pointerValue(agent.ModelConfigID))
		if err != nil {
			return nil, err
		}
		llmModelID = stringPointer(model.ID)
	}
	conversation, found, err := s.resolveChatConversation(user.ID, input, agentID, llmModelID)
	if err != nil {
		return nil, err
	}
	if !found {
		title := makeChatTitle(content)
		conversation, err = s.store.SaveChatConversation(store.ChatConversation{UserID: user.ID, Title: title, AgentID: agentID, ModelConfigID: llmModelID}, true)
		if err != nil {
			return nil, err
		}
	}
	userMessage, err := s.store.SaveChatMessage(store.ChatMessage{ConversationID: conversation.ID, Role: "user", Content: content, AgentID: agentID, ModelConfigID: llmModelID, Attachments: input.Attachments, CapabilityContext: input.CapabilityContext, IsCompleted: true})
	if err != nil {
		return nil, err
	}
	var history []store.ChatMessage
	if !directImageRequest {
		history, err = s.store.ListChatMessages(conversation.ID)
		if err != nil {
			return nil, err
		}
	}
	var answer, reasoning string
	var assistantAttachments []any
	var imageModelID *string
	var imageExpectedCount *int
	if input.AutoImageGeneration {
		imageDecision, err = s.decideImageGeneration(user.ID, model, agent, history, input.CapabilityContext)
		if err != nil {
			return nil, err
		}
		imageRequest = imageDecision.Generate
		if !imageRequest && explicitImageIntent(content) && imageDecisionNeedsFallback(imageDecision.Answer) {
			imageRequest = true
			imageDecision.Generate = true
			imageDecision.Arguments = map[string]any{"prompt": content}
			imageDecision.Answer = ""
		}
		if imageRequest {
			input.CapabilityContext = applyImageToolArguments(input.CapabilityContext, imageDecision.Arguments)
		}
	}
	if imageRequest {
		imageModel, resolveErr := s.resolveImageModelConfig(user.ID, pointerValue(input.ImageModelConfigID))
		if resolveErr != nil {
			return nil, resolveErr
		}
		generation := objectValue(input.CapabilityContext["imageGeneration"])
		prompt := strings.TrimSpace(s.imageGenerationPrompt(content, input.CapabilityContext, nil))
		prompt = strings.TrimSpace(strings.ReplaceAll(strings.ReplaceAll(prompt, "@生图", ""), "＠生图", ""))
		count := imageGenerationCount(input.CapabilityContext, nil)
		references, referenceErr := s.imageReferences(user.ID, input.Attachments, input.CapabilityContext, nil)
		if referenceErr != nil {
			return nil, referenceErr
		}
		mode := valueOr(stringValue(generation, "modeKey"), "image_generation")
		title := valueOr(stringValue(generation, "modeTitle"), "生成图片")
		assets, generateErr := s.generateImageAssets(user.ID, imageModel, prompt, count, references, s.imageGenerationOptions(input.CapabilityContext, nil), mode, title, nil)
		if generateErr != nil {
			return nil, generateErr
		}
		for _, asset := range assets {
			assistantAttachments = append(assistantAttachments, chatAttachmentPayload(asset))
		}
		answer = valueOr(imageDecision.Answer, fmt.Sprintf("已生成 %d 张图片。", len(assets)))
		imageModelID = stringPointer(imageModel.ID)
		value := count
		imageExpectedCount = &value
	} else if input.AutoImageGeneration {
		answer = imageDecision.Answer
		if strings.TrimSpace(answer) == "" {
			answer = "我可以帮你生成图片，请描述想要的画面。"
		}
	} else {
		answer, reasoning, err = s.completeChat(model, agent, history)
		if err != nil {
			return nil, err
		}
	}
	assistantMessage, err := s.store.SaveChatMessage(store.ChatMessage{ConversationID: conversation.ID, Role: "assistant", Content: answer, ReasoningContent: stringPointerOrNil(reasoning), ImageModelConfigID: imageModelID, ImageGenerationExpectedCount: imageExpectedCount, AgentID: agentID, ModelConfigID: llmModelID, Attachments: assistantAttachments, IsCompleted: true})
	if err != nil {
		return nil, err
	}
	metadata := conversation.Metadata
	if metadata == nil {
		metadata = map[string]any{}
	}
	metadata["previewText"] = makeConversationPreview(answer)
	conversation.Metadata = metadata
	conversation.AgentID = agentID
	if llmModelID != nil {
		conversation.ModelConfigID = llmModelID
	}
	conversation, err = s.store.SaveChatConversation(conversation, false)
	if err != nil {
		return nil, err
	}
	messages, err := s.store.ListChatMessages(conversation.ID)
	if err != nil {
		return nil, err
	}
	_ = userMessage
	_ = assistantMessage
	return map[string]any{"conversation": conversation, "messages": messages}, nil
}

func (s *Server) resolveLLMModelConfig(userID, requestedID, agentModelID string) (store.ModelConfig, error) {
	requestedID = strings.TrimSpace(requestedID)
	if requestedID != "" {
		if model, found, err := s.store.FindUserModelConfig(userID, requestedID); err != nil {
			return store.ModelConfig{}, err
		} else if found && model.Type == "llm" {
			return model, nil
		}
		if model, found, err := s.store.FindModelConfig(requestedID); err != nil {
			return store.ModelConfig{}, err
		} else if found && model.Type == "llm" {
			return model, nil
		}
		return store.ModelConfig{}, errors.New("LLM 模型不存在或无权使用")
	}
	personalModels, err := s.store.ListUserModelConfigs(userID, "llm")
	if err != nil {
		return store.ModelConfig{}, err
	}
	for _, model := range personalModels {
		if model.IsDefault {
			return model, nil
		}
	}
	agentModelID = strings.TrimSpace(agentModelID)
	if agentModelID != "" {
		if model, found, err := s.store.FindModelConfig(agentModelID); err != nil {
			return store.ModelConfig{}, err
		} else if found && model.Type == "llm" {
			return model, nil
		}
		return store.ModelConfig{}, errors.New("模型配置不存在")
	}
	models, err := s.store.ListModelConfigs("llm")
	if err != nil {
		return store.ModelConfig{}, err
	}
	for _, model := range models {
		if model.IsDefault {
			return model, nil
		}
	}
	if len(models) > 0 {
		return models[0], nil
	}
	return store.ModelConfig{}, errors.New("未找到可用的默认 LLM 模型配置")
}

type imageGenerationDecision struct {
	Generate  bool
	Arguments map[string]any
	Answer    string
}

// decideImageGeneration lets the configured chat model choose whether the
// image tool is needed. The server still validates and executes the tool.
func (s *Server) decideImageGeneration(userID string, model store.ModelConfig, agent store.Agent, history []store.ChatMessage, contextValue map[string]any) (imageGenerationDecision, error) {
	messages, err := s.chatResponsesInput(userID, history)
	if err != nil {
		return imageGenerationDecision{}, err
	}
	systemPrompt := strings.TrimSpace(agent.SystemPrompt)
	if systemPrompt == "" {
		systemPrompt = "你是一个高效、准确的 AI 助手。"
	}
	contextJSON, _ := json.Marshal(contextValue)
	systemPrompt += "\n在图片工作台中，只有当用户明确要求生成、修改、编辑、放大或处理图片时才调用 image_generation；普通咨询、询问和闲聊不要调用。工具参数必须来自用户需求和工作台上下文，不要编造素材。当前工作台上下文：" + string(contextJSON)
	messages = append([]map[string]any{{"role": "system", "content": systemPrompt}}, messages...)
	result, err := callResponses(model, messages, []map[string]any{imageGenerationTool()})
	if err != nil {
		return imageGenerationDecision{}, fmt.Errorf("调用图片决策模型失败: %w", err)
	}
	decision := imageGenerationDecision{Answer: responseOutputText(result)}
	for _, item := range result.Output {
		if item.Type != "function_call" || item.Name != "image_generation" {
			continue
		}
		var arguments map[string]any
		if err := json.Unmarshal([]byte(item.Arguments), &arguments); err != nil {
			return imageGenerationDecision{}, fmt.Errorf("图片工具参数格式无效: %w", err)
		}
		decision.Generate = true
		decision.Arguments = arguments
		break
	}
	return decision, nil
}

func (s *Server) chatResponsesInput(userID string, history []store.ChatMessage) ([]map[string]any, error) {
	result := make([]map[string]any, 0, len(history))
	totalPDFBytes := 0
	for _, item := range history {
		parts := []map[string]any{{"type": "input_text", "text": item.Content}}
		for _, rawAttachment := range item.Attachments {
			attachment, ok := rawAttachment.(map[string]any)
			if !ok || !strings.EqualFold(strings.TrimSpace(stringValue(attachment, "type")), "application/pdf") {
				continue
			}
			assetID := strings.TrimPrefix(valueOr(stringValue(attachment, "assetId"), stringValue(attachment, "id")), "chat-attachment-")
			asset, found, err := s.store.FindContentAsset(assetID)
			if err != nil {
				return nil, err
			}
			if !found || asset.UserID != userID || !strings.EqualFold(strings.TrimSpace(asset.MimeType), "application/pdf") || asset.FilePath == "" {
				continue
			}
			data, err := os.ReadFile(asset.FilePath)
			if err != nil {
				return nil, fmt.Errorf("读取 PDF 附件失败: %w", err)
			}
			if len(data) > 20<<20 {
				return nil, errors.New("PDF 附件超过 20MB，无法发送给模型")
			}
			totalPDFBytes += len(data)
			if totalPDFBytes > 20<<20 {
				return nil, errors.New("PDF 附件总大小超过 20MB，无法发送给模型")
			}
			parts = append(parts, map[string]any{
				"type":      "input_file",
				"filename":  filepath.Base(valueOr(stringValue(attachment, "name"), asset.OriginalFileName)),
				"file_data": "data:application/pdf;base64," + base64.StdEncoding.EncodeToString(data),
			})
		}
		if len(parts) == 1 {
			result = append(result, map[string]any{"role": item.Role, "content": item.Content})
		} else {
			result = append(result, map[string]any{"role": item.Role, "content": parts})
		}
	}
	return result, nil
}

func applyImageToolArguments(contextValue map[string]any, arguments map[string]any) map[string]any {
	result := map[string]any{}
	for key, value := range contextValue {
		result[key] = value
	}
	generation := objectValue(result["imageGeneration"])
	copyGeneration := map[string]any{}
	for key, value := range generation {
		copyGeneration[key] = value
	}
	for source, target := range map[string]string{"prompt": "promptText", "count": "outputCount", "size": "outputSize", "aspect_ratio": "aspectRatio", "resolution": "resolution", "background": "outputBackground"} {
		if value, ok := arguments[source]; ok {
			copyGeneration[target] = value
		}
	}
	result["imageGeneration"] = copyGeneration
	return result
}

func isImageGenerationRequest(input chatRequest) bool {
	for _, capability := range input.RequestedCapabilities {
		if capability == "image_generation" {
			return true
		}
	}
	return strings.Contains(input.Content, "@生图") || strings.Contains(input.Content, "＠生图")
}

func explicitImageIntent(content string) bool {
	content = strings.ToLower(strings.TrimSpace(content))
	for _, phrase := range []string{"生成图片", "生成一张图", "画一张", "画个", "帮我画", "制作图片", "创建图片", "生图", "出图", "生成图像", "生成照片", "生成海报", "generate an image", "create an image", "make an image"} {
		if strings.Contains(content, phrase) {
			return true
		}
	}
	return strings.Contains(content, "生成") && (strings.Contains(content, "图片") || strings.Contains(content, "图像") || strings.Contains(content, "照片") || strings.Contains(content, "海报"))
}

func imageDecisionNeedsFallback(answer string) bool {
	answer = strings.ToLower(strings.TrimSpace(answer))
	if answer == "" {
		return true
	}
	for _, phrase := range []string{"无法直接", "无法生成", "不能直接", "不能生成", "当前对话无法", "提示词用于", "图像生成工具", "cannot generate", "can't generate", "use an image generator"} {
		if strings.Contains(answer, phrase) {
			return true
		}
	}
	return false
}

func pointerValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func (s *Server) resolveChatConversation(userID string, input chatRequest, agentID string, modelID *string) (store.ChatConversation, bool, error) {
	if strings.TrimSpace(input.ConversationID) == "" {
		return store.ChatConversation{}, false, nil
	}
	conversation, found, err := s.store.FindChatConversation(strings.TrimSpace(input.ConversationID))
	if err != nil {
		return store.ChatConversation{}, false, err
	}
	if !found {
		return store.ChatConversation{}, false, nil
	}
	if conversation.UserID != userID {
		return store.ChatConversation{}, false, errors.New("无权访问该对话")
	}
	conversation.AgentID = agentID
	if modelID != nil {
		conversation.ModelConfigID = modelID
	}
	return conversation, true, nil
}

type responsesOutputContent struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

type responsesOutputSummary struct {
	Text string `json:"text"`
}

type responsesOutputItem struct {
	Type      string                   `json:"type"`
	Name      string                   `json:"name"`
	Arguments string                   `json:"arguments"`
	Content   []responsesOutputContent `json:"content"`
	Summary   []responsesOutputSummary `json:"summary"`
}

type responsesResult struct {
	Output     []responsesOutputItem `json:"output"`
	OutputText string                `json:"output_text"`
}

func callResponses(model store.ModelConfig, input []map[string]any, tools []map[string]any) (responsesResult, error) {
	if strings.TrimSpace(model.APIKey) == "" {
		return responsesResult{}, errors.New("LLM 模型未配置 API Key")
	}
	baseURL := strings.TrimRight(strings.TrimSpace(model.BaseURL), "/")
	if baseURL == "" {
		baseURL = "https://api.openai.com/v1"
	}
	payload := map[string]any{"model": model.Model, "input": input}
	if model.Temperature > 0 {
		payload["temperature"] = model.Temperature
	}
	if len(tools) > 0 {
		payload["tools"] = tools
		payload["tool_choice"] = "auto"
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return responsesResult{}, fmt.Errorf("编码 Responses 请求失败: %w", err)
	}
	request, err := http.NewRequest(http.MethodPost, baseURL+"/responses", strings.NewReader(string(body)))
	if err != nil {
		return responsesResult{}, err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer "+model.APIKey)
	response, err := (&http.Client{Timeout: 2 * time.Minute}).Do(request)
	if err != nil {
		return responsesResult{}, err
	}
	defer response.Body.Close()
	raw, err := transfer.ReadAll(response.Body, 20<<20)
	if err != nil {
		return responsesResult{}, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return responsesResult{}, fmt.Errorf("Responses API 返回 %d: %s", response.StatusCode, strings.TrimSpace(string(raw)))
	}
	var result responsesResult
	if err := json.Unmarshal(raw, &result); err != nil {
		return responsesResult{}, fmt.Errorf("解析 Responses 响应失败: %w", err)
	}
	if len(result.Output) == 0 {
		return responsesResult{}, errors.New("Responses API 没有返回有效 output")
	}
	return result, nil
}

func imageGenerationTool() map[string]any {
	return map[string]any{
		"type":        "function",
		"name":        "image_generation",
		"description": "根据用户明确的图片创作或编辑意图生成图片。普通聊天不要调用。",
		"parameters": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"prompt":       map[string]any{"type": "string", "description": "最终图片生成提示词"},
				"count":        map[string]any{"type": "integer", "minimum": 1, "maximum": 4},
				"size":         map[string]any{"type": "string"},
				"aspect_ratio": map[string]any{"type": "string"},
				"resolution":   map[string]any{"type": "string"},
				"background":   map[string]any{"type": "string", "enum": []string{"transparent", "opaque", "auto"}},
			},
			"required": []string{"prompt"},
		},
	}
}

func responseOutputText(result responsesResult) string {
	if strings.TrimSpace(result.OutputText) != "" {
		return strings.TrimSpace(result.OutputText)
	}
	var parts []string
	for _, item := range result.Output {
		if item.Type != "message" {
			continue
		}
		for _, content := range item.Content {
			if content.Type == "output_text" && strings.TrimSpace(content.Text) != "" {
				parts = append(parts, content.Text)
			}
		}
	}
	return strings.TrimSpace(strings.Join(parts, ""))
}

func responseReasoningText(result responsesResult) string {
	var parts []string
	for _, item := range result.Output {
		if item.Type != "reasoning" {
			continue
		}
		for _, summary := range item.Summary {
			if strings.TrimSpace(summary.Text) != "" {
				parts = append(parts, summary.Text)
			}
		}
	}
	return strings.TrimSpace(strings.Join(parts, ""))
}

func (s *Server) completeChat(model store.ModelConfig, agent store.Agent, history []store.ChatMessage) (string, string, error) {
	messages := make([]map[string]any, 0, len(history)+1)
	if strings.TrimSpace(agent.SystemPrompt) != "" {
		messages = append(messages, map[string]any{"role": "system", "content": agent.SystemPrompt})
	}
	for _, item := range history {
		messages = append(messages, map[string]any{"role": item.Role, "content": item.Content})
	}
	result, err := callResponses(model, messages, nil)
	if err != nil {
		return "", "", fmt.Errorf("调用模型失败: %w", err)
	}
	answer := responseOutputText(result)
	if strings.TrimSpace(answer) == "" {
		return "", "", errors.New("模型没有返回有效内容")
	}
	return answer, responseReasoningText(result), nil
}

func makeChatTitle(content string) string {
	content = strings.TrimSpace(strings.Join(strings.Fields(content), " "))
	if content == "" {
		return "新对话"
	}
	return truncateRunes(content, 40)
}

func makeConversationPreview(content string) string {
	return truncateRunes(strings.Join(strings.Fields(content), " "), 48)
}

func truncateRunes(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit]) + "..."
}

func stringPointer(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

func stringPointerOrNil(value string) *string {
	return stringPointer(value)
}

func (s *Server) handleChatWebSocket(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requireUser(w, r, "web.module.chat")
	if !ok {
		return
	}
	hijacker, ok := w.(http.Hijacker)
	if !ok {
		writeError(w, http.StatusInternalServerError, "当前服务器不支持 WebSocket")
		return
	}
	connection, buffered, err := hijacker.Hijack()
	if err != nil {
		return
	}
	defer connection.Close()
	key := r.Header.Get("Sec-WebSocket-Key")
	if key == "" {
		return
	}
	acceptHash := sha1.Sum([]byte(strings.TrimSpace(key) + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))
	response := "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + base64.StdEncoding.EncodeToString(acceptHash[:]) + "\r\n\r\n"
	if _, err := connection.Write([]byte(response)); err != nil {
		return
	}
	for {
		payload, opcode, err := readWebSocketFrame(buffered)
		if err != nil || opcode == 8 {
			return
		}
		if opcode == 9 {
			_ = writeWebSocketFrame(connection, 10, payload)
			continue
		}
		if opcode != 1 {
			continue
		}
		var input chatRequest
		if err := json.Unmarshal(payload, &input); err != nil {
			_ = writeWebSocketJSON(connection, websocketError(r, http.StatusBadRequest, "聊天请求格式错误"))
			continue
		}
		result, err := s.createChatResponse(user, input)
		if err != nil {
			_ = writeWebSocketJSON(connection, websocketError(r, http.StatusBadRequest, err.Error()))
			continue
		}
		conversation, _ := result["conversation"].(store.ChatConversation)
		messages, _ := result["messages"].([]store.ChatMessage)
		if err := writeWebSocketJSON(connection, map[string]any{"type": "conversation", "conversation": conversation}); err != nil {
			return
		}
		if len(messages) >= 2 {
			if err := writeWebSocketJSON(connection, map[string]any{"type": "user_message", "message": messages[len(messages)-2]}); err != nil {
				return
			}
			assistant := messages[len(messages)-1]
			for _, chunk := range splitTextChunks(assistant.Content, 80) {
				if err := writeWebSocketJSON(connection, map[string]any{"type": "answer_delta", "delta": chunk}); err != nil {
					return
				}
			}
			if err := writeWebSocketJSON(connection, map[string]any{"type": "assistant_message", "message": assistant}); err != nil {
				return
			}
		}
		if err := writeWebSocketJSON(connection, map[string]any{"type": "done", "conversation": conversation, "messages": messages}); err != nil {
			return
		}
	}
}

func websocketError(r *http.Request, status int, message string) map[string]any {
	return map[string]any{
		"type":    "error",
		"code":    errorCodeForStatus(status),
		"message": localizedErrorMessage(resolveRequestLanguage(r.Header.Get("Accept-Language")), status, message),
	}
}

func splitTextChunks(value string, max int) []string {
	runes := []rune(value)
	if len(runes) == 0 {
		return []string{""}
	}
	var result []string
	for len(runes) > 0 {
		count := max
		if len(runes) < count {
			count = len(runes)
		}
		result = append(result, string(runes[:count]))
		runes = runes[count:]
	}
	return result
}

func readWebSocketFrame(reader io.Reader) ([]byte, byte, error) {
	header := make([]byte, 2)
	if _, err := io.ReadFull(reader, header); err != nil {
		return nil, 0, err
	}
	opcode := header[0] & 0x0f
	masked := header[1]&0x80 != 0
	length := int64(header[1] & 0x7f)
	if length == 126 {
		var value uint16
		if err := binary.Read(reader, binary.BigEndian, &value); err != nil {
			return nil, 0, err
		}
		length = int64(value)
	} else if length == 127 {
		if err := binary.Read(reader, binary.BigEndian, &length); err != nil {
			return nil, 0, err
		}
	}
	if length < 0 || length > 20<<20 {
		return nil, 0, errors.New("WebSocket 消息过大")
	}
	var maskKey [4]byte
	if masked {
		if _, err := io.ReadFull(reader, maskKey[:]); err != nil {
			return nil, 0, err
		}
	}
	payload := make([]byte, length)
	if _, err := io.ReadFull(reader, payload); err != nil {
		return nil, 0, err
	}
	if masked {
		for index := range payload {
			payload[index] ^= maskKey[index%4]
		}
	}
	return payload, opcode, nil
}

func writeWebSocketJSON(connection net.Conn, value any) error {
	payload, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return writeWebSocketFrame(connection, 1, payload)
}

func writeWebSocketFrame(connection net.Conn, opcode byte, payload []byte) error {
	var header []byte
	first := byte(0x80) | opcode
	if len(payload) < 126 {
		header = []byte{first, byte(len(payload))}
	} else if len(payload) <= 65535 {
		header = make([]byte, 4)
		header[0], header[1] = first, 126
		binary.BigEndian.PutUint16(header[2:], uint16(len(payload)))
	} else {
		header = make([]byte, 10)
		header[0], header[1] = first, 127
		binary.BigEndian.PutUint64(header[2:], uint64(len(payload)))
	}
	if _, err := connection.Write(header); err != nil {
		return err
	}
	_, err := connection.Write(payload)
	return err
}
