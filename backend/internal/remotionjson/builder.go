package remotionjson

import (
	"errors"
	"fmt"
	"math"
	"net/url"
	"strings"
	"time"

	"sweet-potato-go/internal/store"
)

const (
	SchemaVersion = "1.1"
	CompositionID = "JsonVideo"
	defaultFPS    = 30
)

type Preset struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	Description     string `json:"description"`
	SchemaVersion   string `json:"schemaVersion"`
	ImageAnimation  string `json:"imageAnimation"`
	TitleAnimation  string `json:"titleAnimation"`
	Transition      string `json:"transition"`
	BackgroundColor string `json:"backgroundColor"`
	AccentColor     string `json:"accentColor"`
}

type BuildOptions struct {
	PresetID   string
	ResolveURL func(string) (string, error)
}

type Result struct {
	Preset        Preset         `json:"preset"`
	Plan          map[string]any `json:"plan"`
	RenderRequest map[string]any `json:"renderRequest"`
	GeneratedAt   string         `json:"generatedAt"`
}

var presets = []Preset{
	{
		ID: "clean-marketing", Name: "简约营销", Description: "克制的淡入与溶解转场，适合产品介绍和品牌宣传。",
		SchemaVersion: SchemaVersion, ImageAnimation: "ken-burns", TitleAnimation: "fade-in", Transition: "dissolve",
		BackgroundColor: "#0F172A", AccentColor: "#FFFFFF",
	},
	{
		ID: "dynamic-promo", Name: "动感促销", Description: "弹性标题与滑动转场，适合活动、促销和快节奏内容。",
		SchemaVersion: SchemaVersion, ImageAnimation: "scale-in", TitleAnimation: "spring-in", Transition: "slide",
		BackgroundColor: "#111827", AccentColor: "#FBBF24",
	},
	{
		ID: "tech-focus", Name: "科技聚焦", Description: "揭示标题与擦除转场，适合软件、科技和专业服务。",
		SchemaVersion: SchemaVersion, ImageAnimation: "ken-burns", TitleAnimation: "reveal-in", Transition: "wipe",
		BackgroundColor: "#020617", AccentColor: "#67E8F9",
	},
}

func Presets() []Preset {
	result := make([]Preset, len(presets))
	copy(result, presets)
	return result
}

func FindPreset(id string) (Preset, bool) {
	if strings.TrimSpace(id) == "" {
		id = presets[0].ID
	}
	for _, preset := range presets {
		if preset.ID == id {
			return preset, true
		}
	}
	return Preset{}, false
}

func Build(session store.ContentPlanningSession, options BuildOptions) (Result, error) {
	preset, found := FindPreset(options.PresetID)
	if !found {
		return Result{}, errors.New("视频风格预设不存在")
	}
	if options.ResolveURL == nil {
		return Result{}, errors.New("缺少素材地址解析器")
	}

	plan := object(session.Analysis["campaignPlan"])
	planScenes := slice(plan["scenes"])
	if len(planScenes) == 0 {
		return Result{}, errors.New("当前分析结果没有视频场景规划，请先完成 AI 内容分析")
	}
	imageGeneration := object(session.Analysis["campaignImageGeneration"])
	if stringValue(imageGeneration["status"]) != "completed" {
		return Result{}, errors.New("请先完成宣传图片生成")
	}
	narrationGeneration := object(session.Analysis["narrationGeneration"])
	if stringValue(narrationGeneration["status"]) != "completed" {
		return Result{}, errors.New("请先完成旁白与字幕生成")
	}

	imagesByScene := indexByScene(slice(imageGeneration["images"]))
	narrationsByScene := indexByScene(slice(narrationGeneration["scenes"]))
	jsonScenes := make([]any, 0, len(planScenes))
	semanticScenes := make([]any, 0, len(planScenes))
	totalFrames := 0
	totalTransitionFrames := 0

	for index, raw := range planScenes {
		scene := object(raw)
		sceneID := valueOr(stringValue(scene["id"]), fmt.Sprintf("scene-%d", index+1))
		image, imageFound := imagesByScene[sceneID]
		if !imageFound || strings.TrimSpace(stringValue(image["fileUrl"])) == "" {
			return Result{}, fmt.Errorf("场景 %s 缺少已生成的宣传图片", sceneID)
		}
		narration, narrationFound := narrationsByScene[sceneID]
		if !narrationFound || strings.TrimSpace(stringValue(narration["fileUrl"])) == "" {
			return Result{}, fmt.Errorf("场景 %s 缺少已生成的旁白", sceneID)
		}
		imageURL, err := resolveHTTPURL(options.ResolveURL, stringValue(image["fileUrl"]))
		if err != nil {
			return Result{}, fmt.Errorf("场景 %s 宣传图片地址无效：%w", sceneID, err)
		}
		audioURL, err := resolveHTTPURL(options.ResolveURL, stringValue(narration["fileUrl"]))
		if err != nil {
			return Result{}, fmt.Errorf("场景 %s 旁白地址无效：%w", sceneID, err)
		}

		durationMs := int(math.Round(number(narration["durationMs"], number(scene["durationInSeconds"], 4)*1000)))
		if durationMs < 1000 {
			durationMs = 1000
		}
		durationFrames := int(math.Ceil(float64(durationMs) * defaultFPS / 1000))
		transitionFrames := 0
		if index < len(planScenes)-1 {
			transitionFrames = min(12, max(1, durationFrames/5))
			totalTransitionFrames += transitionFrames
		}
		totalFrames += durationFrames

		title := valueOr(stringValue(scene["title"]), fmt.Sprintf("场景 %d", index+1))
		subtitle := valueOr(stringValue(scene["subtitle"]), stringValue(scene["cta"]))
		elements := []any{
			imageElement(sceneID, imageURL, durationFrames, preset, index),
			overlayElement(sceneID, durationFrames),
			textElement(sceneID+"-title", title, 210, 84, durationFrames, preset.TitleAnimation, preset.AccentColor),
			audioElement(sceneID, audioURL, durationFrames),
		}
		if subtitle != "" {
			elements = append(elements, textElement(sceneID+"-subtitle", subtitle, 810, 46, durationFrames, "fade-in", "#FFFFFF"))
		}
		captions := localCaptions(slice(narration["captions"]), int(math.Round(number(narration["startMs"], 0))), durationMs)
		if len(captions) > 0 {
			elements = append(elements, captionsElement(sceneID, captions, durationFrames, preset.AccentColor))
		}

		jsonScene := map[string]any{
			"id": sceneID, "durationInFrames": durationFrames, "backgroundColor": preset.BackgroundColor, "elements": elements,
		}
		if transitionFrames > 0 {
			jsonScene["transitionAfter"] = transition(preset.Transition, transitionFrames)
		}
		jsonScenes = append(jsonScenes, jsonScene)
		semanticScenes = append(semanticScenes, map[string]any{
			"sceneId": sceneID, "layout": "marketing-hero", "imageAssetId": stringValue(image["assetId"]),
			"narrationAssetId": stringValue(narration["assetId"]), "headline": title, "subtitle": subtitle,
			"motionIntent": preset.ID, "transitionIntent": preset.Transition, "durationMs": durationMs,
		})
	}

	renderRequest := map[string]any{
		"compositionId": CompositionID,
		"inputProps": map[string]any{
			"version": SchemaVersion,
			"video": map[string]any{
				"width": 1920, "height": 1080, "fps": defaultFPS,
				"durationInFrames": totalFrames - totalTransitionFrames,
				"backgroundColor":  preset.BackgroundColor,
			},
			"elements": []any{},
			"scenes":   jsonScenes,
		},
	}
	return Result{
		Preset:        preset,
		Plan:          map[string]any{"stylePreset": preset.ID, "visualStyle": stringValue(plan["visualStyle"]), "scenes": semanticScenes},
		RenderRequest: renderRequest,
		GeneratedAt:   time.Now().UTC().Format(time.RFC3339Nano),
	}, nil
}

func imageElement(sceneID, source string, duration int, preset Preset, index int) map[string]any {
	animation := map[string]any{"type": preset.ImageAnimation, "from": 0, "durationInFrames": duration, "easing": "ease-in-out"}
	if preset.ImageAnimation == "ken-burns" {
		animation["fromScale"], animation["toScale"] = 1, 1.12
		if index%2 == 0 {
			animation["fromX"], animation["toX"] = -20, 20
		} else {
			animation["fromX"], animation["toX"] = 20, -20
		}
		animation["fromY"], animation["toY"] = 0, 0
	}
	if preset.ImageAnimation == "scale-in" {
		animation["durationInFrames"] = min(24, duration)
		animation["fromScale"] = .92
	}
	return map[string]any{
		"id": sceneID + "-image", "type": "image", "src": source, "from": 0, "durationInFrames": duration,
		"position": map[string]any{"x": 960, "y": 540, "anchor": "center"}, "size": map[string]any{"width": 1920, "height": 1080},
		"zIndex": 0, "opacity": 1, "animations": []any{animation}, "style": map[string]any{"objectFit": "cover", "borderRadius": 0},
	}
}

func overlayElement(sceneID string, duration int) map[string]any {
	return map[string]any{
		"id": sceneID + "-overlay", "type": "shape", "shape": "rectangle", "from": 0, "durationInFrames": duration,
		"position": map[string]any{"x": 960, "y": 540, "anchor": "center"}, "size": map[string]any{"width": 1920, "height": 1080},
		"zIndex": 1, "opacity": .32, "animations": []any{},
		"style": map[string]any{"backgroundColor": "#000000", "borderWidth": 0, "borderRadius": 0},
	}
}

func textElement(id, content string, y, fontSize, duration int, animationType, color string) map[string]any {
	animationDuration := min(24, duration)
	animation := map[string]any{"type": animationType, "from": 0, "durationInFrames": animationDuration}
	if animationType == "fade-in" {
		animation["easing"] = "ease-out"
	}
	if animationType == "spring-in" {
		animation["fromScale"], animation["damping"], animation["mass"], animation["stiffness"] = .75, 120, 1, 140
	}
	if animationType == "reveal-in" {
		animation["direction"], animation["easing"] = "up", "ease-out"
	}
	return map[string]any{
		"id": id, "type": "text", "content": content, "from": 0, "durationInFrames": duration,
		"position": map[string]any{"x": 960, "y": y, "anchor": "center"}, "zIndex": 3, "opacity": 1, "animations": []any{animation},
		"style": map[string]any{"width": 1560, "fontSize": fontSize, "fontFamily": "Arial, sans-serif", "fontWeight": 700, "lineHeight": 1.2, "color": color, "textAlign": "center", "padding": 0, "borderRadius": 0},
	}
}

func audioElement(sceneID, source string, duration int) map[string]any {
	return map[string]any{
		"id": sceneID + "-audio", "type": "audio", "src": source, "from": 0, "durationInFrames": duration,
		"volume": 1, "playbackRate": 1, "trimBefore": 0, "loop": false, "toneFrequency": 1, "animations": []any{},
	}
}

func captionsElement(sceneID string, captions []any, duration int, highlightColor string) map[string]any {
	return map[string]any{
		"id": sceneID + "-captions", "type": "captions", "captions": captions, "from": 0, "durationInFrames": duration,
		"position": map[string]any{"x": 960, "y": 940, "anchor": "center"}, "zIndex": 4, "opacity": 1, "animations": []any{},
		"displayMode": "sentence", "combineTokensWithinMilliseconds": 1200,
		"style": map[string]any{"width": 1600, "fontSize": 54, "fontFamily": "Arial, sans-serif", "fontWeight": 700, "lineHeight": 1.2, "color": "#FFFFFF", "highlightColor": highlightColor, "shadowColor": "#000000E6", "shadowBlur": 12, "textAlign": "center", "padding": 20},
	}
}

func localCaptions(items []any, sceneStartMs, durationMs int) []any {
	result := make([]any, 0, len(items))
	for _, raw := range items {
		item := object(raw)
		start := int(math.Round(number(item["startMs"], 0))) - sceneStartMs
		end := int(math.Round(number(item["endMs"], 0))) - sceneStartMs
		start = max(0, start)
		end = min(durationMs, end)
		if end <= start || strings.TrimSpace(stringValue(item["text"])) == "" {
			continue
		}
		result = append(result, map[string]any{
			"text": stringValue(item["text"]), "startMs": start, "endMs": end,
			"timestampMs": nil, "confidence": nil,
		})
	}
	return result
}

func transition(kind string, duration int) map[string]any {
	result := map[string]any{"type": kind, "durationInFrames": duration}
	if kind == "slide" {
		result["direction"] = "from-right"
	}
	if kind == "wipe" {
		result["direction"] = "from-left"
	}
	return result
}

func resolveHTTPURL(resolve func(string) (string, error), raw string) (string, error) {
	value, err := resolve(raw)
	if err != nil {
		return "", err
	}
	parsed, err := url.Parse(value)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return "", errors.New("素材地址必须是 HTTP 或 HTTPS 绝对地址")
	}
	return value, nil
}

func indexByScene(items []any) map[string]map[string]any {
	result := make(map[string]map[string]any, len(items))
	for _, raw := range items {
		item := object(raw)
		if id := stringValue(item["sceneId"]); id != "" {
			result[id] = item
		}
	}
	return result
}

func object(value any) map[string]any {
	if result, ok := value.(map[string]any); ok {
		return result
	}
	return map[string]any{}
}

func slice(value any) []any {
	if result, ok := value.([]any); ok {
		return result
	}
	return []any{}
}

func stringValue(value any) string {
	if result, ok := value.(string); ok {
		return strings.TrimSpace(result)
	}
	return ""
}

func number(value any, fallback float64) float64 {
	switch result := value.(type) {
	case float64:
		return result
	case int:
		return float64(result)
	case int64:
		return float64(result)
	default:
		return fallback
	}
}

func valueOr(value, fallback string) string {
	if strings.TrimSpace(value) != "" {
		return value
	}
	return fallback
}
