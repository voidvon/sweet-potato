package httpapi

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"sweet-potato-go/internal/imagegen"
	"sweet-potato-go/internal/store"
)

func (s *Server) queuePlanningCampaignImages(session store.ContentPlanningSession) (store.ContentPlanningSession, string, error) {
	plan := objectValue(session.Analysis["campaignPlan"])
	if len(anySlice(plan["scenes"])) == 0 {
		return session, "", errors.New("当前分析结果没有宣传图片规划，请先重新进行 AI 内容分析")
	}
	generation := objectValue(session.Analysis["campaignImageGeneration"])
	if stringValue(generation, "status") == "generating" {
		return session, "", errors.New("宣传图片正在生成")
	}
	runID := randomIDForHTTP()
	session.Analysis["campaignImageGeneration"] = map[string]any{
		"runId": runID, "status": "generating", "images": anySlice(generation["images"]), "errorMessage": "",
		"startedAt": time.Now().UTC().Format(time.RFC3339Nano),
	}
	updated, err := s.store.UpdatePlanningSession(session)
	return updated, runID, err
}

func (s *Server) executePlanningCampaignImages(sessionID, runID, requestedModelID string) {
	session, found, err := s.store.FindPlanningSession(sessionID)
	if err != nil || !found || !planningCampaignImageRunActive(session, runID) {
		return
	}
	model, err := s.resolveImageModelConfig(session.UserID, requestedModelID)
	if err != nil {
		s.failPlanningCampaignImages(session, runID, err, nil)
		return
	}
	prompts, references, scenes, err := s.planningCampaignImageInputs(session)
	if err != nil {
		s.failPlanningCampaignImages(session, runID, err, nil)
		return
	}
	ctx, cancel := context.WithTimeout(s.taskContext(), 15*time.Minute)
	defer cancel()
	generatedSlots := map[string]int{}
	assets, generateErr := s.generateImageAssetsForPromptPlansContextWithProgress(
		ctx,
		session.UserID,
		model,
		prompts,
		references,
		len(prompts),
		imagegen.GenerateInput{AspectRatio: "16:9", Resolution: "2K", Background: "opaque", OutputFormat: "png"},
		"lightweight_campaign_image",
		"营销视频宣传图",
		nil,
		func(asset store.ContentAsset, slotIndex int) { generatedSlots[asset.ID] = slotIndex },
	)
	images := planningCampaignImageResults(assets, references, scenes, generatedSlots)
	if generateErr != nil {
		s.failPlanningCampaignImages(session, runID, generateErr, images)
		return
	}
	current, found, err := s.store.FindPlanningSession(sessionID)
	if err != nil || !found || !planningCampaignImageRunActive(current, runID) {
		return
	}
	current.Analysis["campaignImageGeneration"] = map[string]any{
		"runId": runID, "status": "completed", "images": images, "errorMessage": "",
		"completedAt": time.Now().UTC().Format(time.RFC3339Nano),
	}
	_, _ = s.store.UpdatePlanningSession(current)
}

func (s *Server) planningCampaignImageInputs(session store.ContentPlanningSession) ([]string, [][]store.ContentAsset, []map[string]any, error) {
	plan := objectValue(session.Analysis["campaignPlan"])
	visualStyle := strings.TrimSpace(stringValue(plan, "visualStyle"))
	prompts := []string{}
	referenceSets := [][]store.ContentAsset{}
	scenes := []map[string]any{}
	for _, value := range anySlice(plan["scenes"]) {
		scene := objectValue(value)
		imagePrompt := strings.TrimSpace(stringValue(scene, "imagePrompt"))
		if imagePrompt == "" {
			continue
		}
		references := []store.ContentAsset{}
		for _, assetID := range stringSlice(scene["assetIds"]) {
			asset, found, err := s.store.FindContentAsset(assetID)
			if err != nil {
				return nil, nil, nil, err
			}
			if !found || asset.UserID != session.UserID || !strings.HasPrefix(strings.ToLower(asset.MimeType), "image/") {
				continue
			}
			references = append(references, asset)
			if len(references) >= planningCampaignMaxReferences {
				break
			}
		}
		prompt := strings.TrimSpace(fmt.Sprintf(`全片统一视觉方向：%s

%s

请生成一张精致、专业的 16:9 营销视频画面。严格依据上述场景描述和参考图片确定画面，不要自行套用办公室、会议室或团队协作等通用场景。图片中不要生成文字、字幕、Logo、水印、UI 标签或边框。请为后续叠加主标题、副标题和行动文案预留视觉简洁、对比清晰的区域。`, visualStyle, imagePrompt))
		prompts = append(prompts, prompt)
		referenceSets = append(referenceSets, references)
		scenes = append(scenes, scene)
	}
	if len(prompts) == 0 {
		return nil, nil, nil, errors.New("宣传图片规划中没有可用的图片提示词")
	}
	return prompts, referenceSets, scenes, nil
}

func planningCampaignImageResults(assets []store.ContentAsset, references [][]store.ContentAsset, scenes []map[string]any, generatedSlots map[string]int) []any {
	result := make([]any, 0, len(assets))
	for index, asset := range assets {
		slotIndex, ok := generatedSlots[asset.ID]
		if !ok {
			slotIndex = index
		}
		if slotIndex >= len(scenes) {
			break
		}
		result = append(result, map[string]any{
			"sceneId": stringValue(scenes[slotIndex], "id"), "title": stringValue(scenes[slotIndex], "title"),
			"assetId": asset.ID, "fileUrl": asset.FileURL, "prompt": stringValue(scenes[slotIndex], "imagePrompt"),
			"referenceAssetIds": contentAssetIDs(imageReferencesForSlot(references, slotIndex)),
		})
	}
	return result
}

func planningCampaignImageRunActive(session store.ContentPlanningSession, runID string) bool {
	generation := objectValue(session.Analysis["campaignImageGeneration"])
	return stringValue(generation, "status") == "generating" && stringValue(generation, "runId") == runID
}

func (s *Server) failPlanningCampaignImages(session store.ContentPlanningSession, runID string, cause error, images []any) {
	current, found, err := s.store.FindPlanningSession(session.ID)
	if err != nil || !found || !planningCampaignImageRunActive(current, runID) {
		return
	}
	if len(images) == 0 {
		images = anySlice(objectValue(current.Analysis["campaignImageGeneration"])["images"])
	}
	current.Analysis["campaignImageGeneration"] = map[string]any{
		"runId": runID, "status": "failed", "images": images, "errorMessage": cause.Error(),
		"completedAt": time.Now().UTC().Format(time.RFC3339Nano),
	}
	_, _ = s.store.UpdatePlanningSession(current)
}
