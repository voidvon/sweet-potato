package httpapi

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"strings"

	"github.com/disintegration/imaging"
	"github.com/gen2brain/webp"

	"sweet-potato-go/internal/store"
)

type imageReferenceCandidate struct {
	Asset              store.ContentAsset
	MessageID          string
	MessageRole        string
	MessagePosition    int
	AttachmentPosition int
	SelectedPosition   int
	ThumbnailDataURL   string
}

func (s *Server) imageReferenceCandidates(userID string, history []store.ChatMessage, limit int) ([]imageReferenceCandidate, error) {
	if limit < 1 {
		return nil, nil
	}
	candidates := make([]imageReferenceCandidate, 0, limit)
	seen := map[string]bool{}
	for messageIndex := len(history) - 1; messageIndex >= 0 && len(candidates) < limit; messageIndex-- {
		message := history[messageIndex]
		for attachmentIndex := len(message.Attachments) - 1; attachmentIndex >= 0 && len(candidates) < limit; attachmentIndex-- {
			attachment := objectValue(message.Attachments[attachmentIndex])
			if !strings.HasPrefix(strings.ToLower(strings.TrimSpace(stringValue(attachment, "type"))), "image/") {
				continue
			}
			assetID := strings.TrimPrefix(valueOr(stringValue(attachment, "assetId"), stringValue(attachment, "id")), "chat-attachment-")
			if assetID == "" || seen[assetID] {
				continue
			}
			asset, found, err := s.store.FindContentAsset(assetID)
			if err != nil {
				return nil, err
			}
			if !found || asset.UserID != userID || !strings.HasPrefix(strings.ToLower(asset.MimeType), "image/") {
				continue
			}
			seen[assetID] = true
			candidate := imageReferenceCandidate{
				Asset:              asset,
				MessageID:          message.ID,
				MessageRole:        message.Role,
				MessagePosition:    messageIndex + 1,
				AttachmentPosition: attachmentIndex + 1,
			}
			candidates = append(candidates, candidate)
		}
	}
	for left, right := 0, len(candidates)-1; left < right; left, right = left+1, right-1 {
		candidates[left], candidates[right] = candidates[right], candidates[left]
	}
	return candidates, nil
}

func imageReferenceCandidatesWithThumbnails(candidates []imageReferenceCandidate) []imageReferenceCandidate {
	result := append([]imageReferenceCandidate(nil), candidates...)
	for index := range result {
		if thumbnail, err := imageDecisionThumbnailDataURL(result[index].Asset.FilePath, 512); err == nil {
			result[index].ThumbnailDataURL = thumbnail
		}
	}
	return result
}

func imageReferenceCandidatesForAssets(candidates []imageReferenceCandidate, assets []store.ContentAsset) []imageReferenceCandidate {
	byAssetID := make(map[string]imageReferenceCandidate, len(candidates))
	for _, candidate := range candidates {
		byAssetID[candidate.Asset.ID] = candidate
	}
	result := make([]imageReferenceCandidate, 0, len(assets))
	for index, asset := range assets {
		if candidate, ok := byAssetID[asset.ID]; ok {
			candidate.SelectedPosition = index + 1
			result = append(result, candidate)
		}
	}
	return result
}

func candidateAssetIDs(candidates []imageReferenceCandidate) []string {
	result := make([]string, 0, len(candidates))
	for _, candidate := range candidates {
		result = append(result, candidate.Asset.ID)
	}
	return result
}

func selectedImageReferenceAssets(candidates []imageReferenceCandidate, requestedIDs []string) []store.ContentAsset {
	allowed := make(map[string]store.ContentAsset, len(candidates))
	for _, candidate := range candidates {
		allowed[candidate.Asset.ID] = candidate.Asset
	}
	selected := make([]store.ContentAsset, 0, len(requestedIDs))
	seen := map[string]bool{}
	for _, requestedID := range requestedIDs {
		id := strings.TrimPrefix(strings.TrimSpace(requestedID), "chat-attachment-")
		asset, ok := allowed[id]
		if !ok || seen[id] {
			continue
		}
		seen[id] = true
		selected = append(selected, asset)
	}
	return selected
}

func appendImageReferenceCandidates(messages []map[string]any, candidates []imageReferenceCandidate, includePreviews bool) []map[string]any {
	if len(candidates) == 0 {
		return messages
	}
	result := make([]map[string]any, len(messages))
	for index, message := range messages {
		result[index] = make(map[string]any, len(message))
		for key, value := range message {
			result[index][key] = value
		}
	}
	parts := []map[string]any{{
		"type": "input_text",
		"text": "以下是当前对话可选的历史图片。请结合用户的任意语言表达、图片所属消息和附件位置，为 image_generation 选择必要的 reference_asset_ids。",
	}}
	for _, candidate := range candidates {
		label := fmt.Sprintf("asset_id=%s; message_id=%s; message_role=%s; message_position=%d; attachment_position=%d; original_file_name=%s",
			candidate.Asset.ID,
			candidate.MessageID,
			candidate.MessageRole,
			candidate.MessagePosition,
			candidate.AttachmentPosition,
			candidate.Asset.OriginalFileName,
		)
		if candidate.SelectedPosition > 0 {
			label += fmt.Sprintf("; selected_reference_position=%d", candidate.SelectedPosition)
		}
		parts = append(parts, map[string]any{"type": "input_text", "text": label})
		if includePreviews && candidate.ThumbnailDataURL != "" {
			parts = append(parts, map[string]any{
				"type":      "input_image",
				"image_url": candidate.ThumbnailDataURL,
				"detail":    "low",
			})
		}
	}
	for index := len(result) - 1; index >= 0; index-- {
		if stringValue(result[index], "role") != "user" {
			continue
		}
		switch content := result[index]["content"].(type) {
		case string:
			result[index]["content"] = append([]map[string]any{{"type": "input_text", "text": content}}, parts...)
		case []map[string]any:
			copiedContent := append([]map[string]any(nil), content...)
			result[index]["content"] = append(copiedContent, parts...)
		case []any:
			content = append([]any(nil), content...)
			for _, part := range parts {
				content = append(content, part)
			}
			result[index]["content"] = content
		default:
			result[index]["content"] = parts
		}
		return result
	}
	return append(result, map[string]any{"role": "user", "content": parts})
}

func imageDecisionThumbnailDataURL(path string, maxDimension int) (string, error) {
	if strings.TrimSpace(path) == "" || maxDimension < 1 {
		return "", fmt.Errorf("图片路径或缩略图尺寸无效")
	}
	source, err := imaging.Open(path, imaging.AutoOrientation(true))
	if err != nil {
		return "", err
	}
	bounds := source.Bounds()
	width, height := bounds.Dx(), bounds.Dy()
	if width < 1 || height < 1 {
		return "", fmt.Errorf("图片尺寸无效")
	}
	scale := 1.0
	if width > maxDimension || height > maxDimension {
		if width >= height {
			scale = float64(maxDimension) / float64(width)
		} else {
			scale = float64(maxDimension) / float64(height)
		}
	}
	targetWidth := max(1, int(float64(width)*scale))
	targetHeight := max(1, int(float64(height)*scale))
	target := imaging.Resize(source, targetWidth, targetHeight, imaging.Lanczos)
	var encoded bytes.Buffer
	if err := webp.Encode(&encoded, target, webp.Options{Quality: 80, Method: 6}); err != nil {
		return "", err
	}
	return "data:image/webp;base64," + base64.StdEncoding.EncodeToString(encoded.Bytes()), nil
}
