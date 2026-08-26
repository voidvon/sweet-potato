package httpapi

import (
	"context"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
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
	result, err := s.createChatResponseContext(r.Context(), user, input)
	if err != nil {
		status := http.StatusBadRequest
		if errors.Is(err, errChatAgentNotFound) {
			status = http.StatusNotFound
		} else if errors.Is(err, store.ErrChatResponseInProgress) {
			status = http.StatusConflict
		} else if errors.Is(err, store.ErrInsufficientCredits) {
			status = http.StatusPaymentRequired
		}
		writeError(w, status, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

var errChatAgentNotFound = errors.New("智能体不存在")

func (s *Server) createChatResponse(user store.User, input chatRequest) (response map[string]any, responseErr error) {
	return s.createChatResponseContext(context.Background(), user, input)
}

func (s *Server) createChatResponseContext(ctx context.Context, user store.User, input chatRequest) (response map[string]any, responseErr error) {
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
	if strings.TrimSpace(input.EditMessageID) != "" && !found {
		return nil, store.ErrChatEditMessageNotFound
	}
	createdConversation := !found
	if !found {
		title := makeChatTitle(content)
		conversation, err = s.store.SaveChatConversation(store.ChatConversation{UserID: user.ID, Title: title, AgentID: agentID, ModelConfigID: llmModelID}, true)
		if err != nil {
			return nil, err
		}
	}
	userMessageInput := store.ChatMessage{ConversationID: conversation.ID, Role: "user", Content: content, AgentID: agentID, ModelConfigID: llmModelID, Attachments: input.Attachments, CapabilityContext: input.CapabilityContext, IsCompleted: true}
	assistantMessageInput := store.ChatMessage{ConversationID: conversation.ID, Role: "assistant", Content: "", AgentID: agentID, ModelConfigID: llmModelID, IsCompleted: false}
	var userMessage, assistantMessage store.ChatMessage
	if editMessageID := strings.TrimSpace(input.EditMessageID); editMessageID != "" {
		userMessage, assistantMessage, err = s.store.BeginEditedChatResponse(user.ID, editMessageID, userMessageInput, assistantMessageInput)
	} else {
		userMessage, assistantMessage, err = s.store.BeginChatResponse(user.ID, createdConversation, userMessageInput, assistantMessageInput)
	}
	if err != nil {
		if createdConversation && errors.Is(err, store.ErrChatResponseInProgress) {
			_ = s.store.DeleteChatConversation(conversation.ID, user.ID)
		}
		return nil, err
	}
	responseFinalized := false
	defer func() {
		if responseFinalized {
			return
		}
		assistantMessage.IsCompleted = true
		if responseErr != nil {
			if errors.Is(responseErr, context.Canceled) {
				assistantMessage.Content = "已停止生成"
			} else {
				assistantMessage.Content = responseErr.Error()
			}
		} else if strings.TrimSpace(assistantMessage.Content) == "" {
			assistantMessage.Content = "回复已中断，请重新发送。"
		}
		_, _ = s.store.UpdateChatMessage(assistantMessage)
	}()
	history, err := s.store.ListChatMessages(conversation.ID)
	if err != nil {
		return nil, err
	}
	history = chatHistoryWithoutMessage(history, assistantMessage.ID)
	if imageRequest || input.AutoImageGeneration {
		input.CapabilityContext = resolveImageGenerationAspectRatio(content, input.CapabilityContext, history, userMessage.ID)
		userMessage.CapabilityContext = input.CapabilityContext
		userMessage, err = s.store.UpdateChatMessage(userMessage)
		if err != nil {
			return nil, err
		}
	}
	var answer, reasoning string
	var assistantAttachments []any
	var imageModelID *string
	var imageExpectedCount *int
	var assistantCapabilityContext map[string]any
	var contextUsage map[string]any
	if input.AutoImageGeneration {
		imageDecision, err = s.decideImageGeneration(ctx, user.ID, assistantMessage.ID, model, agent, history, input.CapabilityContext)
		if err != nil {
			return nil, err
		}
		if isDialogImageContext(input.CapabilityContext) {
			contextUsage = s.imageDialogContextUsage(model, imageDecision.Usage)
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
		var references []store.ContentAsset
		if input.AutoImageGeneration && imageDecision.HasReferenceSelection {
			references = imageDecision.ReferenceAssets
		} else {
			var referenceErr error
			references, referenceErr = s.imageReferences(user.ID, input.Attachments, input.CapabilityContext, nil)
			if referenceErr != nil {
				return nil, referenceErr
			}
		}
		mode := valueOr(stringValue(generation, "modeKey"), "image_generation")
		title := valueOr(stringValue(generation, "modeTitle"), "生成图片")
		assistantCapabilityContext = imageGenerationResultContext(generation, content, prompt, references)
		assistantMessage.CapabilityContext = assistantCapabilityContext
		assets, generateErr := s.generateImageAssetsContext(ctx, user.ID, imageModel, prompt, count, references, s.imageGenerationOptions(input.CapabilityContext, nil), mode, title, nil)
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
		answer, reasoning, err = s.completeChat(ctx, user.ID, assistantMessage.ID, model, agent, history)
		if err != nil {
			return nil, err
		}
	}
	assistantMessage.Content = answer
	assistantMessage.CapabilityContext = assistantCapabilityContext
	assistantMessage.ReasoningContent = stringPointerOrNil(reasoning)
	assistantMessage.ImageModelConfigID = imageModelID
	assistantMessage.ImageGenerationExpectedCount = imageExpectedCount
	assistantMessage.Attachments = assistantAttachments
	assistantMessage.IsCompleted = true
	assistantMessage, err = s.store.UpdateChatMessage(assistantMessage)
	if err != nil {
		return nil, err
	}
	responseFinalized = true
	metadata := conversation.Metadata
	if metadata == nil {
		metadata = map[string]any{}
	}
	metadata["previewText"] = makeConversationPreview(answer)
	if contextUsage != nil {
		metadata["contextUsage"] = contextUsage
	}
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
	creditBalance := user.CreditBalance
	if updatedUser, found, findErr := s.store.FindUserByID(user.ID); findErr == nil && found {
		creditBalance = updatedUser.CreditBalance
	}
	_ = userMessage
	_ = assistantMessage
	return map[string]any{"conversation": conversation, "messages": messages, "creditBalance": creditBalance}, nil
}

func chatHistoryWithoutMessage(messages []store.ChatMessage, messageID string) []store.ChatMessage {
	result := make([]store.ChatMessage, 0, len(messages))
	for _, message := range messages {
		if message.ID != messageID {
			result = append(result, message)
		}
	}
	return result
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
	Generate              bool
	Arguments             map[string]any
	Answer                string
	HasReferenceSelection bool
	ReferenceAssets       []store.ContentAsset
	NeedsReferenceVision  bool
	Usage                 responsesUsage
}

// decideImageGeneration lets the configured chat model choose whether the
// image tool is needed. The server still validates and executes the tool.
func (s *Server) decideImageGeneration(ctx context.Context, userID, sourceID string, model store.ModelConfig, agent store.Agent, history []store.ChatMessage, contextValue map[string]any) (imageGenerationDecision, error) {
	messages, err := s.chatResponsesInput(userID, history)
	if err != nil {
		return imageGenerationDecision{}, err
	}
	candidates, err := s.imageReferenceCandidates(userID, history, 8)
	if err != nil {
		return imageGenerationDecision{}, err
	}
	decision, err := s.callImageGenerationDecision(ctx, userID, sourceID, model, agent, messages, candidates, contextValue, false)
	if err != nil {
		return imageGenerationDecision{}, err
	}
	if decision.HasReferenceSelection && len(decision.ReferenceAssets) > 0 {
		selectedCandidates := imageReferenceCandidatesForAssets(candidates, decision.ReferenceAssets)
		selectedCandidates = imageReferenceCandidatesWithThumbnails(selectedCandidates)
		finalized, finalizeErr := s.callImageGenerationDecision(ctx, userID, sourceID, model, agent, messages, selectedCandidates, contextValue, true)
		if finalizeErr != nil {
			return imageGenerationDecision{}, finalizeErr
		}
		if !finalized.Generate {
			decision.Usage = finalized.Usage
			return decision, nil
		}
		finalized.HasReferenceSelection = true
		finalized.ReferenceAssets = decision.ReferenceAssets
		return finalized, nil
	}
	if !decision.NeedsReferenceVision || len(candidates) == 0 {
		return decision, nil
	}
	candidates = imageReferenceCandidatesWithThumbnails(candidates)
	return s.callImageGenerationDecision(ctx, userID, sourceID, model, agent, messages, candidates, contextValue, true)
}

func (s *Server) callImageGenerationDecision(ctx context.Context, userID, sourceID string, model store.ModelConfig, agent store.Agent, messages []map[string]any, candidates []imageReferenceCandidate, contextValue map[string]any, includePreviews bool) (imageGenerationDecision, error) {
	messages = appendImageReferenceCandidates(messages, candidates, includePreviews)
	systemPrompt := strings.TrimSpace(agent.SystemPrompt)
	if systemPrompt == "" {
		systemPrompt = "你是一个高效、准确的 AI 助手。"
	}
	contextJSON, _ := json.Marshal(contextValue)
	systemPrompt += "\n在图片工作台中，只有当用户明确要求生成、修改、编辑、放大或处理图片时才调用 image_generation；普通咨询、询问和闲聊不要调用。工具参数必须来自用户需求和工作台上下文，不要编造素材。后续翻译、改文案、再生成或风格调整必须保留工作台中已确定的画面比例，除非用户本轮明确要求更改。当用户指代当前或历史图片时，自主选择 reference_asset_ids；只能使用候选列表中的 asset_id，不得编造 ID。如果根据所属消息、附件位置和文件名已能确定引用，inspect_reference_images 必须为 false；只有必须观察图片视觉内容才能决定时才为 true。如果任务不需要参考图，返回空数组。"
	if includePreviews {
		systemPrompt += "候选图片的低清预览已提供，请直接完成选择，inspect_reference_images 返回 false。最终 prompt 必须与 reference_asset_ids 严格一致：不得沿用历史对话中的附件编号。只选一张时，统一称为“提供的参考图片”，不使用图1、图2或第几张。选中多张时，可按 selected_reference_position 使用“参考图1”至“参考图N”，该位置就是实际发送顺序。对未选图片的排除要求，必须改写为具体可见的构图、造型、色彩或元素特征，不得引用其历史编号。"
	}
	systemPrompt += "当前工作台上下文：" + string(contextJSON)
	messages = append([]map[string]any{{"role": "system", "content": systemPrompt}}, messages...)
	result, err := s.callBillableResponses(ctx, userID, "chat_image_decision", modelSourceID(sourceID), model, messages, agentResponsesTools(agent, imageGenerationTool(candidateAssetIDs(candidates)...)))
	if err != nil {
		return imageGenerationDecision{}, fmt.Errorf("调用图片决策模型失败: %w", err)
	}
	decision := imageGenerationDecision{Answer: responseOutputText(result), Usage: result.Usage}
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
		if rawIDs, ok := arguments["reference_asset_ids"]; ok {
			decision.HasReferenceSelection = true
			decision.ReferenceAssets = selectedImageReferenceAssets(candidates, stringSlice(rawIDs))
		}
		decision.NeedsReferenceVision = boolValue(arguments["inspect_reference_images"]) && !includePreviews
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
	for source, target := range map[string]string{"prompt": "promptText", "count": "outputCount", "size": "outputSize", "resolution": "resolution", "background": "outputBackground"} {
		if value, ok := arguments[source]; ok {
			copyGeneration[target] = value
		}
	}
	if currentRatio := stringValue(copyGeneration, "aspectRatio"); currentRatio == "" || strings.EqualFold(currentRatio, "auto") {
		if value, ok := arguments["aspect_ratio"]; ok {
			copyGeneration["aspectRatio"] = value
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
	Usage      responsesUsage        `json:"usage"`
}

type responsesUsage struct {
	InputTokens       int64 `json:"input_tokens"`
	CachedInputTokens int64 `json:"-"`
	OutputTokens      int64 `json:"output_tokens"`
	ReasoningTokens   int64 `json:"-"`
	TotalTokens       int64 `json:"total_tokens"`
	Estimated         bool  `json:"-"`
	InputTokenDetails struct {
		CachedTokens int64 `json:"cached_tokens"`
	} `json:"input_tokens_details"`
	OutputTokenDetails struct {
		ReasoningTokens int64 `json:"reasoning_tokens"`
	} `json:"output_tokens_details"`
}

func (usage *responsesUsage) normalize() {
	usage.CachedInputTokens = usage.InputTokenDetails.CachedTokens
	usage.ReasoningTokens = usage.OutputTokenDetails.ReasoningTokens
	if usage.TotalTokens <= 0 {
		usage.TotalTokens = usage.InputTokens + usage.OutputTokens
	}
}

func callResponses(model store.ModelConfig, input []map[string]any, tools []map[string]any) (responsesResult, error) {
	return callResponsesContext(context.Background(), model, input, tools)
}

func callResponsesContext(ctx context.Context, model store.ModelConfig, input []map[string]any, tools []map[string]any) (responsesResult, error) {
	if strings.TrimSpace(model.APIKey) == "" {
		return responsesResult{}, errors.New("LLM 模型未配置 API Key")
	}
	baseURL := strings.TrimRight(strings.TrimSpace(model.BaseURL), "/")
	if baseURL == "" {
		baseURL = "https://api.openai.com/v1"
	}
	// Responses calls follow the Codex/OpenAI streaming protocol. We consume
	// the stream internally and expose a completed result to the rest of the
	// server, so callers do not need to know about SSE framing.
	payload := map[string]any{"model": model.Model, "input": input, "stream": true}
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
	request.Header.Set("Accept", "text/event-stream")
	request.Header.Set("Authorization", "Bearer "+model.APIKey)
	request = request.WithContext(ctx)
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
		slog.Error("Responses API returned non-success status", "provider", model.Provider, "model", model.Model, "base_url", baseURL, "status", response.StatusCode, "content_type", response.Header.Get("Content-Type"), "body", truncateResponsesDiagnostic(string(raw)))
		return responsesResult{}, fmt.Errorf("Responses API 返回 %d: %s", response.StatusCode, strings.TrimSpace(string(raw)))
	}
	contentType := strings.ToLower(strings.TrimSpace(strings.Split(response.Header.Get("Content-Type"), ";")[0]))
	if contentType != "text/event-stream" {
		slog.Error("Responses API returned unexpected content type", "provider", model.Provider, "model", model.Model, "base_url", baseURL, "status", response.StatusCode, "content_type", response.Header.Get("Content-Type"), "body", truncateResponsesDiagnostic(string(raw)))
		return responsesResult{}, fmt.Errorf("Responses API 必须返回 text/event-stream，实际返回 %q", response.Header.Get("Content-Type"))
	}
	result, err := parseResponsesSSE(raw)
	if err != nil {
		diagnostics := responsesSSEDiagnostics(raw)
		slog.Error("failed to parse Responses SSE", "provider", model.Provider, "model", model.Model, "base_url", baseURL, "status", response.StatusCode, "content_type", response.Header.Get("Content-Type"), "body_bytes", len(raw), "tools", responseToolNames(tools), "diagnostics", diagnostics, "error", err)
		return responsesResult{}, fmt.Errorf("解析 Responses SSE 响应失败: %w（SSE诊断: %s）", err, formatResponsesDiagnostics(diagnostics))
	}
	if len(result.Output) == 0 {
		return responsesResult{}, errors.New("Responses API 没有返回有效 output")
	}
	if result.Usage.TotalTokens <= 0 {
		result.Usage = estimateResponsesUsage(input, tools, result)
	}
	return result, nil
}

func estimateResponsesUsage(input []map[string]any, tools []map[string]any, result responsesResult) responsesUsage {
	inputValue := map[string]any{"input": input, "tools": tools}
	outputValue := map[string]any{"output": result.Output, "output_text": result.OutputText}
	inputBytes, _ := json.Marshal(normalizeTokenEstimateValue(inputValue))
	outputBytes, _ := json.Marshal(outputValue)
	inputTokens := int64((len(inputBytes) + 3) / 4)
	outputTokens := int64((len(outputBytes) + 3) / 4)
	return responsesUsage{
		InputTokens:  inputTokens,
		OutputTokens: outputTokens,
		TotalTokens:  inputTokens + outputTokens,
		Estimated:    true,
	}
}

func normalizeTokenEstimateValue(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		result := make(map[string]any, len(typed))
		for key, item := range typed {
			result[key] = normalizeTokenEstimateValue(item)
		}
		return result
	case []map[string]any:
		result := make([]any, len(typed))
		for index, item := range typed {
			result[index] = normalizeTokenEstimateValue(item)
		}
		return result
	case []any:
		result := make([]any, len(typed))
		for index, item := range typed {
			result[index] = normalizeTokenEstimateValue(item)
		}
		return result
	case string:
		lower := strings.ToLower(typed)
		if strings.HasPrefix(lower, "data:image/") {
			if marker := strings.Index(lower, ";base64,"); marker >= 0 {
				const resizedImageBytesEstimate = 7373
				return typed[:marker+len(";base64,")] + strings.Repeat("x", resizedImageBytesEstimate)
			}
		}
	}
	return value
}

func responseToolNames(tools []map[string]any) []string {
	result := make([]string, 0, len(tools))
	for _, tool := range tools {
		name := stringValue(tool, "name")
		if name == "" {
			name = stringValue(tool, "type")
		}
		if name != "" {
			result = append(result, name)
		}
	}
	return result
}

func truncateResponsesDiagnostic(value string) string {
	value = strings.TrimSpace(value)
	const limit = 1200
	if len(value) <= limit {
		return value
	}
	return value[:limit] + "…"
}

func responsesSSEDiagnostics(raw []byte) map[string]any {
	events := []string{}
	dataTypes := []string{}
	lastData := ""
	for _, line := range strings.Split(strings.ReplaceAll(string(raw), "\r\n", "\n"), "\n") {
		if strings.HasPrefix(line, "event:") {
			event := strings.TrimSpace(strings.TrimPrefix(line, "event:"))
			if event != "" && (len(events) == 0 || events[len(events)-1] != event) {
				events = append(events, event)
			}
		}
		if strings.HasPrefix(line, "data:") {
			lastData = strings.TrimSpace(strings.TrimPrefix(line, "data:"))
			var envelope struct {
				Type string `json:"type"`
			}
			if json.Unmarshal([]byte(lastData), &envelope) == nil && envelope.Type != "" {
				dataTypes = append(dataTypes, envelope.Type)
			}
		}
	}
	return map[string]any{"events": events, "dataTypes": dataTypes, "lastData": truncateResponsesDiagnostic(lastData), "hasDone": strings.Contains(string(raw), "[DONE]"), "hasCompleted": strings.Contains(string(raw), "response.completed")}
}

func formatResponsesDiagnostics(diagnostics map[string]any) string {
	encoded, err := json.Marshal(diagnostics)
	if err != nil {
		return fmt.Sprintf("%v", diagnostics)
	}
	return string(encoded)
}

type responsesSSEEvent struct {
	Name string
	Data map[string]any
}

type responsesTurnState struct {
	completed bool
	failed    error
	result    responsesResult
	items     map[string]*responsesOutputItem
	itemOrder []string
}

func newResponsesTurnState() *responsesTurnState {
	return &responsesTurnState{items: map[string]*responsesOutputItem{}}
}

func (state *responsesTurnState) apply(event responsesSSEEvent) error {
	typ := stringValue(event.Data, "type")
	if typ == "" {
		typ = event.Name
	}
	if typ == "response.failed" {
		if errValue := objectValue(event.Data["error"]); len(errValue) > 0 {
			state.failed = fmt.Errorf("Responses API 生成失败: %s", formatResponsesDiagnostics(errValue))
		} else {
			state.failed = errors.New("Responses API 生成失败")
		}
		return state.failed
	}
	if typ == "response.output_item.added" || typ == "response.output_item.done" {
		item := objectValue(event.Data["item"])
		if stringValue(item, "type") == "function_call" {
			state.ensureFunction(stringValue(item, "id"), stringValue(item, "name"), stringValue(item, "arguments"))
		}
	}
	if typ == "response.function_call_arguments.delta" || typ == "response.function_call_arguments.done" {
		item := state.ensureFunction(stringValue(event.Data, "item_id"), "", "")
		if delta := stringValue(event.Data, "delta"); delta != "" {
			item.Arguments += delta
		}
		if arguments := stringValue(event.Data, "arguments"); arguments != "" {
			item.Arguments = arguments
		}
	}
	if typ == "response.output_text.delta" {
		state.result.OutputText += stringValue(event.Data, "delta")
	}
	if typ == "response.reasoning_summary_text.delta" || typ == "response.reasoning_text.delta" {
		state.result.Output = append(state.result.Output, responsesOutputItem{Type: "reasoning", Summary: []responsesOutputSummary{{Text: stringValue(event.Data, "delta")}}})
	}
	if typ != "response.completed" {
		return nil
	}
	state.completed = true
	response := objectValue(event.Data["response"])
	if len(response) > 0 {
		encoded, _ := json.Marshal(response)
		var result responsesResult
		if err := json.Unmarshal(encoded, &result); err != nil {
			return fmt.Errorf("response.completed 数据无效: %w", err)
		}
		if result.OutputText != "" {
			state.result.OutputText = result.OutputText
		}
		if len(result.Output) > 0 {
			state.result.Output = result.Output
		}
		result.Usage.normalize()
		state.result.Usage = result.Usage
	}
	if len(state.result.Output) == 0 && len(state.itemOrder) > 0 {
		for _, id := range state.itemOrder {
			state.result.Output = append(state.result.Output, *state.items[id])
		}
	}
	return nil
}

func (state *responsesTurnState) ensureFunction(id, name, arguments string) *responsesOutputItem {
	if id == "" {
		id = fmt.Sprintf("function_%d", len(state.itemOrder))
	}
	item := state.items[id]
	if item == nil {
		item = &responsesOutputItem{Type: "function_call"}
		state.items[id] = item
		state.itemOrder = append(state.itemOrder, id)
	}
	if name != "" {
		item.Name = name
	}
	if arguments != "" {
		item.Arguments = arguments
	}
	return item
}

func decodeResponsesSSE(raw []byte) ([]responsesSSEEvent, error) {
	var eventName string
	var dataLines []string
	events := []responsesSSEEvent{}
	flush := func() error {
		if eventName == "" && len(dataLines) == 0 {
			return nil
		}
		name := strings.TrimSpace(eventName)
		data := strings.TrimSpace(strings.Join(dataLines, "\n"))
		eventName, dataLines = "", nil
		if data == "" || data == "[DONE]" {
			return nil
		}
		var object map[string]any
		if err := json.Unmarshal([]byte(data), &object); err != nil {
			return fmt.Errorf("事件 %s 数据无效: %w", name, err)
		}
		events = append(events, responsesSSEEvent{Name: name, Data: object})
		return nil
	}
	for _, line := range strings.Split(strings.ReplaceAll(string(raw), "\r\n", "\n"), "\n") {
		if line == "" {
			if err := flush(); err != nil {
				return nil, err
			}
			continue
		}
		switch {
		case strings.HasPrefix(line, "event:"):
			eventName = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
		case strings.HasPrefix(line, "data:"):
			dataLines = append(dataLines, strings.TrimSpace(strings.TrimPrefix(line, "data:")))
		}
	}
	if err := flush(); err != nil {
		return nil, err
	}
	return events, nil
}

// parseResponsesSSE reduces the provider event stream into one completed turn.
func parseResponsesSSE(raw []byte) (responsesResult, error) {
	events, err := decodeResponsesSSE(raw)
	if err != nil {
		return responsesResult{}, err
	}
	state := newResponsesTurnState()
	for _, event := range events {
		if err := state.apply(event); err != nil {
			return responsesResult{}, err
		}
	}
	if state.failed != nil {
		return responsesResult{}, state.failed
	}
	if !state.completed {
		return responsesResult{}, errors.New("SSE 响应未包含 response.completed")
	}
	if len(state.result.Output) == 0 && strings.TrimSpace(state.result.OutputText) == "" {
		return responsesResult{}, errors.New("response.completed 未包含可用 output")
	}
	return state.result, nil
}

func imageGenerationTool(referenceAssetIDs ...string) map[string]any {
	referenceItems := map[string]any{"type": "string"}
	if len(referenceAssetIDs) > 0 {
		referenceItems["enum"] = referenceAssetIDs
	}
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
				"aspect_ratio": map[string]any{"type": "string", "description": "画面宽高比。必须保留当前工作台已确定的比例，除非用户本轮明确要求更改"},
				"resolution":   map[string]any{"type": "string"},
				"background":   map[string]any{"type": "string", "enum": []string{"transparent", "opaque", "auto"}},
				"reference_asset_ids": map[string]any{
					"type":        "array",
					"description": "从系统提供的当前对话候选图片中选择生图所需的参考图 asset_id；不需要参考图时返回空数组",
					"items":       referenceItems,
					"maxItems":    8,
				},
				"inspect_reference_images": map[string]any{
					"type":        "boolean",
					"description": "仅当必须查看候选图片的视觉内容才能决定参考图时返回 true；可根据结构化位置或文件名决定时返回 false",
				},
			},
			"required": []string{"prompt", "reference_asset_ids", "inspect_reference_images"},
		},
	}
}

func webSearchTool() map[string]any {
	return map[string]any{"type": "web_search"}
}

func agentResponsesTools(agent store.Agent, additional ...map[string]any) []map[string]any {
	tools := append([]map[string]any(nil), additional...)
	if agent.WebSearchEnabled {
		tools = append(tools, webSearchTool())
	}
	return tools
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

func (s *Server) completeChat(ctx context.Context, userID, sourceID string, model store.ModelConfig, agent store.Agent, history []store.ChatMessage) (string, string, error) {
	messages := make([]map[string]any, 0, len(history)+1)
	if strings.TrimSpace(agent.SystemPrompt) != "" {
		messages = append(messages, map[string]any{"role": "system", "content": agent.SystemPrompt})
	}
	for _, item := range history {
		messages = append(messages, map[string]any{"role": item.Role, "content": item.Content})
	}
	result, err := s.callBillableResponses(ctx, userID, "chat_response", modelSourceID(sourceID), model, messages, agentResponsesTools(agent))
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
	session := &chatWebSocketSession{server: s, connection: connection, user: user}
	defer session.cancelActive()
	for {
		payload, opcode, err := readWebSocketFrame(buffered)
		if err != nil || opcode == 8 {
			return
		}
		if opcode == 9 {
			_ = session.writeFrame(10, payload)
			continue
		}
		if opcode != 1 {
			continue
		}
		var command chatTurnCommand
		if err := json.Unmarshal(payload, &command); err != nil {
			_ = session.writeJSON(chatTurnError(nil, http.StatusBadRequest, "聊天请求格式错误"))
			continue
		}
		if command.Method == "" {
			command.Method = "turn/start"
			command.ID = randomIDForHTTP()
			command.Params = json.RawMessage(payload)
		}
		switch command.Method {
		case "turn/start":
			if err := session.startTurn(command); err != nil {
				status := http.StatusBadRequest
				if errors.Is(err, store.ErrChatResponseInProgress) {
					status = http.StatusConflict
				}
				_ = session.writeJSON(chatTurnError(command.ID, status, err.Error()))
			}
		case "turn/interrupt":
			if err := session.interruptTurn(command); err != nil {
				_ = session.writeJSON(chatTurnError(command.ID, http.StatusBadRequest, err.Error()))
			}
		default:
			_ = session.writeJSON(chatTurnError(command.ID, http.StatusNotFound, "不支持的聊天命令"))
		}
	}
}

type chatTurnCommand struct {
	Method string          `json:"method"`
	ID     any             `json:"id"`
	Params json.RawMessage `json:"params"`
}

type chatTurnInterruptParams struct {
	TurnID string `json:"turnId"`
}

type activeChatTurn struct {
	id     string
	cancel context.CancelFunc
}

type chatWebSocketSession struct {
	server     *Server
	connection net.Conn
	user       store.User
	writeMu    sync.Mutex
	turnMu     sync.Mutex
	active     *activeChatTurn
}

func (session *chatWebSocketSession) writeFrame(opcode byte, payload []byte) error {
	session.writeMu.Lock()
	defer session.writeMu.Unlock()
	return writeWebSocketFrame(session.connection, opcode, payload)
}

func (session *chatWebSocketSession) writeJSON(value any) error {
	payload, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return session.writeFrame(1, payload)
}

func (session *chatWebSocketSession) startTurn(command chatTurnCommand) error {
	var input chatRequest
	if len(command.Params) == 0 || json.Unmarshal(command.Params, &input) != nil {
		return errors.New("聊天请求格式错误")
	}
	turnID := strings.TrimSpace(fmt.Sprint(command.ID))
	if turnID == "" || turnID == "<nil>" {
		turnID = randomIDForHTTP()
	}
	session.turnMu.Lock()
	if session.active != nil {
		session.turnMu.Unlock()
		return store.ErrChatResponseInProgress
	}
	ctx, cancel := context.WithCancel(session.server.taskContext())
	session.active = &activeChatTurn{id: turnID, cancel: cancel}
	session.turnMu.Unlock()
	if err := session.writeJSON(map[string]any{"id": command.ID, "result": map[string]any{"turn": map[string]any{"id": turnID, "status": "inProgress"}}}); err != nil {
		cancel()
		session.clearTurn(turnID)
		return err
	}
	if err := session.writeJSON(map[string]any{"method": "turn/started", "params": map[string]any{"turn": map[string]any{"id": turnID, "status": "inProgress"}}}); err != nil {
		cancel()
		session.clearTurn(turnID)
		return err
	}
	go session.runTurn(ctx, turnID, input)
	return nil
}

func (session *chatWebSocketSession) interruptTurn(command chatTurnCommand) error {
	var params chatTurnInterruptParams
	if len(command.Params) > 0 && json.Unmarshal(command.Params, &params) != nil {
		return errors.New("中止请求格式错误")
	}
	session.turnMu.Lock()
	active := session.active
	if active == nil || (params.TurnID != "" && params.TurnID != active.id) {
		session.turnMu.Unlock()
		return errors.New("当前没有可中止的任务")
	}
	active.cancel()
	session.turnMu.Unlock()
	return session.writeJSON(map[string]any{"id": command.ID, "result": map[string]any{}})
}

func (session *chatWebSocketSession) runTurn(ctx context.Context, turnID string, input chatRequest) {
	result, err := session.server.createChatResponseContext(ctx, session.user, input)
	if err != nil {
		status := "failed"
		message := err.Error()
		if errors.Is(err, context.Canceled) || errors.Is(ctx.Err(), context.Canceled) {
			status = "interrupted"
			message = "已停止生成"
		}
		_ = session.writeJSON(map[string]any{"method": "turn/completed", "params": map[string]any{"turn": map[string]any{"id": turnID, "status": status, "error": message}}})
		session.clearTurn(turnID)
		return
	}
	conversation, _ := result["conversation"].(store.ChatConversation)
	messages, _ := result["messages"].([]store.ChatMessage)
	creditBalance, _ := result["creditBalance"].(float64)
	_ = session.writeJSON(map[string]any{"method": "thread/updated", "params": map[string]any{"conversation": conversation}})
	if len(messages) >= 2 {
		_ = session.writeJSON(map[string]any{"method": "item/completed", "params": map[string]any{"kind": "user_message", "message": messages[len(messages)-2]}})
		assistant := messages[len(messages)-1]
		for _, chunk := range splitTextChunks(assistant.Content, 80) {
			_ = session.writeJSON(map[string]any{"method": "item/agentMessage/delta", "params": map[string]any{"delta": chunk}})
		}
		_ = session.writeJSON(map[string]any{"method": "item/completed", "params": map[string]any{"kind": "assistant_message", "message": assistant}})
	}
	_ = session.writeJSON(map[string]any{"method": "turn/completed", "params": map[string]any{"turn": map[string]any{"id": turnID, "status": "completed"}, "conversation": conversation, "messages": messages, "creditBalance": creditBalance}})
	session.clearTurn(turnID)
}

func (session *chatWebSocketSession) clearTurn(turnID string) {
	session.turnMu.Lock()
	defer session.turnMu.Unlock()
	if session.active != nil && session.active.id == turnID {
		session.active.cancel()
		session.active = nil
	}
}

func (session *chatWebSocketSession) cancelActive() {
	session.turnMu.Lock()
	defer session.turnMu.Unlock()
	if session.active != nil {
		session.active.cancel()
		session.active = nil
	}
}

func chatTurnError(id any, status int, message string) map[string]any {
	return map[string]any{"id": id, "error": map[string]any{"code": status, "message": message}}
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
