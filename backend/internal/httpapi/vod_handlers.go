package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"ai-marketing-go/internal/store"
	"ai-marketing-go/internal/vod"
)

const vodTaskReferenceType = "video_generation_task"

func (s *Server) createVODVideoTask(userID, resource string, input map[string]any) (store.VideoGenerationTask, error) {
	if s.vod == nil {
		return store.VideoGenerationTask{}, errors.New("VOD 服务未初始化")
	}
	if err := s.vod.Configured(); err != nil {
		return store.VideoGenerationTask{}, err
	}
	if err := validateVODPlaybackURL(s.config.VODPlaybackBaseURL); err != nil {
		return store.VideoGenerationTask{}, err
	}

	sourceID := strings.TrimSpace(stringValue(input, "sourceAssetId"))
	if sourceID == "" {
		return store.VideoGenerationTask{}, errors.New("请选择源视频素材")
	}
	source, found, err := s.store.FindContentAsset(sourceID)
	if err != nil {
		return store.VideoGenerationTask{}, err
	}
	if !found || source.UserID != userID {
		return store.VideoGenerationTask{}, errors.New("源视频素材不存在")
	}
	if err := validateVODSourceAsset(source, resource == "video-translations"); err != nil {
		return store.VideoGenerationTask{}, err
	}

	normalized, err := normalizeVODInput(resource, input)
	if err != nil {
		return store.VideoGenerationTask{}, err
	}
	name := vodSourceName(source)
	title, prompt, mode := vodTaskDetails(resource, normalized, name)
	ratio := videoSourceAspectRatio(source)
	task := buildVideoTask(userID, resource, normalized)
	task.SourceURL = source.FileURL
	task.Title = title
	task.Prompt = prompt
	task.AspectRatio = ratio
	task.ExpertContext = map[string]any{
		"mode":          mode,
		"sourceType":    resource,
		"sourceAssetId": source.ID,
		"ratio":         ratio,
		"request":       normalized,
		"vodStatus":     "pending",
		"createdAt":     time.Now().UTC().Format(time.RFC3339Nano),
	}
	created, err := s.store.SaveVideoTask(task, true)
	if err != nil {
		return store.VideoGenerationTask{}, err
	}
	if err := s.store.RetainContentAssetReference(source.ID, userID, vodTaskReferenceType, created.ID); err != nil {
		_ = s.store.DeleteVideoTask(created.ID, userID)
		return store.VideoGenerationTask{}, err
	}
	return created, nil
}

func (s *Server) executeVODTask(task store.VideoGenerationTask) {
	if task.Status == "completed" || task.Status == "failed" {
		return
	}
	if s.vod == nil {
		s.failVODTask(task, errors.New("VOD 服务未初始化"))
		return
	}
	ctx, cancel := context.WithTimeout(s.taskContext(), s.config.VODTaskTimeout)
	defer cancel()

	task.Status = "generating"
	contextValue := objectValue(task.ExpertContext)
	contextValue["vodStatus"] = "uploading"
	if updated, err := s.saveVODTask(task, contextValue, nil); err != nil {
		s.failVODTask(task, err)
		return
	} else {
		task = updated
	}

	request := objectValue(contextValue["request"])
	sourceID := valueOr(stringValue(contextValue, "sourceAssetId"), stringValue(request, "sourceAssetId"))
	source, found, err := s.store.FindContentAsset(sourceID)
	if err != nil || !found || source.UserID != task.UserID {
		s.failVODTask(task, errors.New("源视频素材不存在"))
		return
	}
	if err := validateVODSourceAsset(source, stringValue(contextValue, "mode") == "video_translation"); err != nil {
		s.failVODTask(task, err)
		return
	}

	job, hasJob := vodJobFromTask(task)
	if !hasJob {
		fileName := valueOr(source.OriginalFileName, source.StoredFileName)
		upload, uploadErr := s.vod.Upload(ctx, source.FilePath, fileName)
		if uploadErr != nil {
			s.failVODTask(task, uploadErr)
			return
		}
		contextValue["sourceVid"] = upload.Vid
		contextValue["vodStoreUri"] = upload.StoreURI
		contextValue["vodFileName"] = upload.FileName
		contextValue["vodStatus"] = "uploaded"
		if updated, saveErr := s.saveVODTask(task, contextValue, nil); saveErr != nil {
			s.failVODTask(task, saveErr)
			return
		} else {
			task = updated
		}

		job, err = s.startVODJob(ctx, stringValue(contextValue, "mode"), upload.Vid, request)
		if err != nil {
			s.failVODTask(task, err)
			return
		}
		result := vodRunningResult(task, job)
		contextValue["vodStatus"] = "running"
		contextValue["vodJobId"] = vodJobID(job)
		if job.Kind == "video_translation" {
			contextValue["videoTranslationProjectId"] = job.ProjectID
		} else {
			contextValue["vodRunId"] = job.RunID
		}
		if updated, saveErr := s.saveVODTask(task, contextValue, result); saveErr != nil {
			s.failVODTask(task, saveErr)
			return
		} else {
			task = updated
		}
	}

	result, err := s.vod.Wait(ctx, job)
	if err != nil {
		s.failVODTask(task, err)
		return
	}
	remoteURL, err := s.vod.ResultURL(result)
	if err != nil {
		s.failVODTask(task, err)
		return
	}
	asset, err := s.persistVODOutput(ctx, task, source, remoteURL, result)
	if err != nil {
		s.failVODTask(task, err)
		return
	}

	completed := vodCompletedResult(task, asset, remoteURL, result, job)
	contextValue["vodStatus"] = "completed"
	contextValue["outputAssetId"] = asset.ID
	contextValue["remoteGeneratedVideoUrl"] = remoteURL
	if result.Vid != "" {
		contextValue["outputVid"] = result.Vid
	}
	if result.FileName != "" {
		contextValue["outputFileName"] = result.FileName
	}
	task.Status = "completed"
	task.FailureReason = nil
	task.GeneratedVideoURL = &asset.FileURL
	if _, err := s.saveVODTask(task, contextValue, completed); err != nil {
		s.failVODTask(task, err)
	}
}

func (s *Server) resumeVODTasks() {
	tasks, err := s.store.ListGeneratingVideoTasks()
	if err != nil {
		return
	}
	for _, task := range tasks {
		contextValue := objectValue(task.ExpertContext)
		mode := stringValue(contextValue, "mode")
		if mode != "video_upscale" && mode != "subtitle_removal" && mode != "video_translation" {
			continue
		}
		if _, ok := vodJobFromTask(task); !ok {
			s.failVODTask(task, errors.New("服务重启前 VOD 任务尚未成功提交，请重新发起任务"))
			continue
		}
		s.startBackgroundTask(func() { s.executeVODTask(task) })
	}
}

func (s *Server) saveVODTask(task store.VideoGenerationTask, contextValue, result map[string]any) (store.VideoGenerationTask, error) {
	if contextValue != nil {
		task.ExpertContext = contextValue
	}
	if result != nil {
		if task.EditableParseResult == nil {
			task.EditableParseResult = map[string]any{}
		}
		task.EditableParseResult["videoGenerationResult"] = result
	}
	return s.store.SaveVideoTask(task, false)
}

func (s *Server) failVODTask(task store.VideoGenerationTask, failure error) {
	message := "VOD 视频处理任务失败"
	if failure != nil && strings.TrimSpace(failure.Error()) != "" {
		message = failure.Error()
	}
	contextValue := objectValue(task.ExpertContext)
	contextValue["vodStatus"] = "failed"
	result := objectValue(task.EditableParseResult["videoGenerationResult"])
	if len(result) == 0 {
		result = map[string]any{"version": 1, "taskId": task.ID, "sourceType": stringValue(contextValue, "sourceType"), "ratio": task.AspectRatio, "provider": "volcengine-vod", "renderMode": "provider_generation", "generatedAt": time.Now().UTC().Format(time.RFC3339Nano)}
	}
	result["status"] = "failed"
	result["renderStatus"] = "failed"
	result["errorMessage"] = message
	result["videoUrl"] = nil
	task.Status = "failed"
	task.FailureReason = &message
	if _, err := s.saveVODTask(task, contextValue, result); err != nil {
		return
	}
}

func (s *Server) startVODJob(ctx context.Context, mode, vid string, input map[string]any) (vod.Job, error) {
	switch mode {
	case "video_upscale":
		resolution := valueOr(strings.ToLower(stringValue(input, "resolution")), "1080p")
		repairStyle := int(vodNumber(input["repairStyle"], 0))
		repairStrength := int(vodNumber(input["repairStrength"], 0))
		var fps *float64
		if value, ok := vodNumberOK(input["fps"]); ok {
			fps = &value
		}
		return s.vod.StartEnhancement(ctx, vod.EnhancementRequest{Vid: vid, Resolution: resolution, Config: valueOr(stringValue(input, "config"), "aigc"), RepairStyle: repairStyle, RepairStrength: repairStrength, FPS: fps})
	case "subtitle_removal":
		locations, err := vodLocations(input["locations"])
		if err != nil {
			return vod.Job{}, err
		}
		clips, clipMode, err := vodClips(input)
		if err != nil {
			return vod.Job{}, err
		}
		return s.vod.StartSubtitleRemoval(ctx, vod.SubtitleRemovalRequest{Vid: vid, Mode: valueOr(stringValue(input, "mode"), "auto"), ContentType: valueOr(stringValue(input, "contentType"), "subtitle"), Locations: locations, ClipMode: clipMode, Clips: clips})
	case "video_translation":
		config := objectValue(input["subtitleConfig"])
		return s.vod.StartTranslation(ctx, vod.TranslationRequest{
			Vid:              vid,
			SourceLanguage:   stringValue(input, "sourceLanguage"),
			TargetLanguage:   stringValue(input, "targetLanguage"),
			TranslationTypes: stringSlice(input["translationTypes"]),
			SubtitleSource:   valueOr(stringValue(input, "subtitleSource"), "ocr"),
			SubtitleConfig: vod.SubtitleConfig{
				IsHardSubtitle: boolValue(config["isHardSubtitle"]),
				IsEraseSource:  boolValue(config["isEraseSource"]),
				FontSize:       int(vodNumber(config["fontSize"], 0)),
				MarginL:        vodNumber(config["marginL"], 0),
				MarginR:        vodNumber(config["marginR"], 0),
				MarginV:        vodNumber(config["marginV"], 0),
				ShowLines:      int(vodNumber(config["showLines"], 0)),
			},
		})
	default:
		return vod.Job{}, fmt.Errorf("不支持的 VOD 任务类型: %s", mode)
	}
}

func (s *Server) persistVODOutput(ctx context.Context, task store.VideoGenerationTask, source store.ContentAsset, remoteURL string, result vod.Result) (store.ContentAsset, error) {
	contextValue := objectValue(task.ExpertContext)
	if assetID := stringValue(contextValue, "outputAssetId"); assetID != "" {
		if asset, found, err := s.store.FindContentAsset(assetID); err == nil && found && asset.UserID == task.UserID {
			return asset, nil
		}
	}
	groupID, err := s.ensureContentGroup(task.UserID, "finished_video")
	if err != nil {
		return store.ContentAsset{}, err
	}
	extension := strings.ToLower(filepath.Ext(result.FileName))
	if extension == "" || len(extension) > 8 || strings.ContainsAny(extension, `/\\`) {
		extension = ".mp4"
	}
	storedName := fmt.Sprintf("%d-vod-%s%s", time.Now().UnixNano(), sanitizeUploadName(task.ID), extension)
	path := filepath.Join(s.config.DataDir, "files", storedName)
	fileSize, err := s.vod.Download(ctx, remoteURL, path)
	if err != nil {
		_ = os.Remove(path)
		return store.ContentAsset{}, err
	}
	mode := stringValue(contextValue, "mode")
	metadata := map[string]any{
		"taskId":            task.ID,
		"provider":          "volcengine-vod",
		"generatedBy":       "go",
		"renderMode":        "provider_generation",
		"mode":              mode,
		"sourceAssetId":     source.ID,
		"remoteVideoUrl":    remoteURL,
		"vodStoreUri":       result.StoreURI,
		"vodOutputVid":      result.Vid,
		"vodOutputFileName": result.FileName,
	}
	if result.Duration > 0 {
		metadata["durationSeconds"] = result.Duration
	}
	remoteSource := remoteURL
	asset, err := s.store.CreateContentAsset(store.ContentAsset{
		UserID:           task.UserID,
		GroupID:          groupID,
		ResourceType:     "finished_video",
		Type:             "generated",
		Name:             task.Title,
		SourceURL:        &remoteSource,
		OriginalFileName: storedName,
		StoredFileName:   storedName,
		MimeType:         "video/mp4",
		FileSize:         fileSize,
		Size:             fileSize,
		FilePath:         path,
		FileURL:          "/files/" + storedName,
		AssetKind:        "video_task_output",
		LifecycleStatus:  "permanent",
		ParentAssetID:    sourceIDPointer(source.ID),
		Metadata:         metadata,
	})
	if err != nil {
		_ = os.Remove(path)
	}
	return asset, err
}

func normalizeVODInput(resource string, input map[string]any) (map[string]any, error) {
	result := map[string]any{}
	for key, value := range input {
		result[key] = value
	}
	result["sourceAssetId"] = strings.TrimSpace(stringValue(input, "sourceAssetId"))
	switch resource {
	case "video-enhancements":
		resolution := strings.ToLower(strings.TrimSpace(stringValue(input, "resolution")))
		if resolution == "" {
			resolution = "1080p"
		}
		if !containsVOD([]string{"1080p", "2k", "4k"}, resolution) {
			return nil, fmt.Errorf("不支持的目标分辨率: %s", resolution)
		}
		result["resolution"] = resolution
	case "subtitle-removals":
		mode := strings.ToLower(strings.TrimSpace(stringValue(input, "mode")))
		if mode == "" {
			mode = "auto"
		}
		if !containsVOD([]string{"auto", "auto_region", "manual"}, mode) {
			return nil, fmt.Errorf("不支持的字幕擦除模式: %s", mode)
		}
		contentType := strings.ToLower(strings.TrimSpace(stringValue(input, "contentType")))
		if contentType == "" {
			contentType = "subtitle"
		}
		if !containsVOD([]string{"subtitle", "text"}, contentType) {
			return nil, fmt.Errorf("不支持的擦除内容类型: %s", contentType)
		}
		locations, err := vodLocations(input["locations"])
		if err != nil {
			return nil, err
		}
		if mode != "auto" && len(locations) == 0 {
			return nil, errors.New("区域擦除模式必须至少指定一个擦除区域")
		}
		result["mode"] = mode
		result["contentType"] = contentType
		result["locations"] = locationsToMaps(locations)
		clips, clipMode, err := vodClips(input)
		if err != nil {
			return nil, err
		}
		result["clipMode"] = clipMode
		result["clips"] = clipsToMaps(clips)
		result["clipFilter"] = map[string]any{"mode": clipMode, "clips": clipsToMaps(clips)}
	case "video-translations":
		sourceLanguage := strings.ToLower(strings.TrimSpace(stringValue(input, "sourceLanguage")))
		targetLanguage := strings.ToLower(strings.TrimSpace(stringValue(input, "targetLanguage")))
		if !containsVOD([]string{"zh", "en"}, sourceLanguage) {
			return nil, fmt.Errorf("不支持的源语言: %s", sourceLanguage)
		}
		if !containsVOD([]string{"zh", "en", "ja", "ko", "de", "fr", "ru", "es", "pt", "it", "id", "vi", "th", "ar", "tr"}, targetLanguage) {
			return nil, fmt.Errorf("不支持的目标语言: %s", targetLanguage)
		}
		if sourceLanguage == targetLanguage {
			return nil, errors.New("源语言和目标语言不能相同")
		}
		types := stringSlice(input["translationTypes"])
		if len(types) == 0 {
			types = []string{"subtitle"}
		}
		seen := map[string]bool{"subtitle": true}
		normalizedTypes := []string{"subtitle"}
		for _, item := range types {
			item = strings.ToLower(strings.TrimSpace(item))
			if (item == "voice" || item == "face") && !seen[item] {
				normalizedTypes = append(normalizedTypes, item)
				seen[item] = true
			}
		}
		if seen["face"] && !seen["voice"] {
			return nil, errors.New("面容翻译必须同时开启语音翻译")
		}
		subtitleSource := strings.ToLower(strings.TrimSpace(stringValue(input, "subtitleSource")))
		if subtitleSource == "" {
			subtitleSource = "ocr"
		}
		if !containsVOD([]string{"ocr", "asr"}, subtitleSource) {
			return nil, fmt.Errorf("不支持的字幕来源: %s", subtitleSource)
		}
		config := objectValue(input["subtitleConfig"])
		if err := validateVODSubtitleConfig(config); err != nil {
			return nil, err
		}
		result["sourceLanguage"] = sourceLanguage
		result["targetLanguage"] = targetLanguage
		result["translationTypes"] = normalizedTypes
		result["subtitleSource"] = subtitleSource
		result["subtitleConfig"] = config
	default:
		return nil, fmt.Errorf("不支持的 VOD 资源类型: %s", resource)
	}
	return result, nil
}

func validateVODSourceAsset(asset store.ContentAsset, requireMP4 bool) error {
	if !strings.HasPrefix(strings.ToLower(strings.TrimSpace(asset.MimeType)), "video/") {
		return errors.New("请选择视频素材进行 VOD 处理")
	}
	if requireMP4 {
		name := valueOr(asset.OriginalFileName, valueOr(asset.StoredFileName, asset.FilePath))
		if strings.ToLower(filepath.Ext(name)) != ".mp4" && strings.ToLower(asset.MimeType) != "video/mp4" {
			return errors.New("视频翻译仅支持 MP4 格式")
		}
	}
	if strings.TrimSpace(asset.FilePath) == "" {
		return errors.New("源视频没有本地文件，请先下载或重新上传")
	}
	info, err := os.Stat(asset.FilePath)
	if err != nil || !info.Mode().IsRegular() {
		return errors.New("源视频本地文件不存在，请重新上传")
	}
	return nil
}

func validateVODPlaybackURL(value string) error {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return errors.New("VOD 未配置有效的播放地址，请设置 VOLCENGINE_VOD_PLAYBACK_BASE_URL")
	}
	return nil
}

func validateVODSubtitleConfig(config map[string]any) error {
	if !boolValue(config["isHardSubtitle"]) {
		return nil
	}
	fontSize, ok := vodNumberOK(config["fontSize"])
	if !ok || fontSize < 1 || fontSize > 80 || math.Trunc(fontSize) != fontSize {
		return errors.New("硬字幕字号必须在 1 到 80 之间")
	}
	marginL := vodNumber(config["marginL"], math.NaN())
	marginR := vodNumber(config["marginR"], math.NaN())
	marginV := vodNumber(config["marginV"], math.NaN())
	if math.IsNaN(marginL) || math.IsNaN(marginR) || math.IsNaN(marginV) || marginL < 0 || marginL >= 1 || marginR < 0 || marginR >= 1 || marginV < 0 || marginV >= 1 || marginL+marginR >= 1 {
		return errors.New("硬字幕边距配置无效")
	}
	showLines, ok := vodNumberOK(config["showLines"])
	if !ok || showLines < 0 || math.Trunc(showLines) != showLines {
		return errors.New("硬字幕最大行数不能小于 0")
	}
	return nil
}

func vodLocations(value any) ([]vod.Location, error) {
	items := arrayValue(value)
	result := make([]vod.Location, 0, len(items))
	for _, item := range items {
		object, ok := item.(map[string]any)
		if !ok {
			return nil, errors.New("擦除区域格式无效")
		}
		location := vod.Location{TopLeftX: vodNumber(object["topLeftX"], math.NaN()), TopLeftY: vodNumber(object["topLeftY"], math.NaN()), BottomRightX: vodNumber(object["bottomRightX"], math.NaN()), BottomRightY: vodNumber(object["bottomRightY"], math.NaN())}
		if math.IsNaN(location.TopLeftX) || math.IsNaN(location.TopLeftY) || math.IsNaN(location.BottomRightX) || math.IsNaN(location.BottomRightY) {
			return nil, errors.New("擦除区域坐标必须完整填写")
		}
		if location.TopLeftX < 0 || location.TopLeftX > 1 || location.TopLeftY < 0 || location.TopLeftY > 1 || location.BottomRightX < 0 || location.BottomRightX > 1 || location.BottomRightY < 0 || location.BottomRightY > 1 || location.TopLeftX >= location.BottomRightX || location.TopLeftY >= location.BottomRightY {
			return nil, errors.New("擦除区域坐标必须是 0 到 1 之间的有效矩形")
		}
		result = append(result, location)
	}
	return result, nil
}

func vodClips(input map[string]any) ([]vod.Clip, string, error) {
	filter := objectValue(input["clipFilter"])
	mode := strings.ToLower(strings.TrimSpace(stringValue(filter, "mode")))
	if mode == "" {
		mode = strings.ToLower(strings.TrimSpace(stringValue(input, "clipMode")))
	}
	if mode == "" {
		mode = "all"
	}
	if !containsVOD([]string{"all", "selected", "skip"}, mode) {
		return nil, "", fmt.Errorf("不支持的时间范围模式: %s", mode)
	}
	if mode == "all" {
		return nil, mode, nil
	}
	values := arrayValue(filter["clips"])
	if len(values) == 0 {
		values = arrayValue(input["clips"])
	}
	if len(values) == 0 && filter["start"] != nil {
		values = []any{map[string]any{"start": filter["start"], "end": filter["end"]}}
	}
	if len(values) == 0 && input["start"] != nil {
		values = []any{map[string]any{"start": input["start"], "end": input["end"]}}
	}
	if len(values) == 0 {
		return nil, "", errors.New("选择时间范围时必须至少指定一个片段")
	}
	result := make([]vod.Clip, 0, len(values))
	for _, value := range values {
		object, ok := value.(map[string]any)
		if !ok {
			return nil, "", errors.New("时间片段格式无效")
		}
		clip := vod.Clip{Start: vodNumber(object["start"], math.NaN()), End: vodNumber(object["end"], math.NaN())}
		if math.IsNaN(clip.Start) || math.IsNaN(clip.End) || clip.Start < 0 || clip.End <= clip.Start {
			return nil, "", errors.New("字幕擦除时间范围无效")
		}
		result = append(result, clip)
	}
	return result, mode, nil
}

func locationsToMaps(values []vod.Location) []map[string]any {
	result := make([]map[string]any, 0, len(values))
	for _, value := range values {
		result = append(result, map[string]any{"topLeftX": value.TopLeftX, "topLeftY": value.TopLeftY, "bottomRightX": value.BottomRightX, "bottomRightY": value.BottomRightY})
	}
	return result
}

func clipsToMaps(values []vod.Clip) []map[string]any {
	result := make([]map[string]any, 0, len(values))
	for _, value := range values {
		result = append(result, map[string]any{"start": value.Start, "end": value.End})
	}
	return result
}

func vodTaskDetails(resource string, input map[string]any, sourceName string) (string, string, string) {
	switch resource {
	case "video-enhancements":
		resolution := valueOr(stringValue(input, "resolution"), "1080p")
		return fmt.Sprintf("%s-高清%s", sourceName, strings.ToUpper(resolution)), fmt.Sprintf("使用火山引擎 VOD AIGC 画质增强至 %s", resolution), "video_upscale"
	case "subtitle-removals":
		return sourceName + "-字幕擦除", "使用火山引擎 VOD 擦除视频字幕", "subtitle_removal"
	case "video-translations":
		target := stringValue(input, "targetLanguage")
		return fmt.Sprintf("%s-%s翻译", sourceName, target), fmt.Sprintf("使用火山引擎 VOD 将视频翻译为 %s", target), "video_translation"
	default:
		return valueOr(stringValue(input, "title"), "视频制作任务"), stringValue(input, "prompt"), ""
	}
}

func vodSourceName(asset store.ContentAsset) string {
	name := strings.TrimSpace(asset.Name)
	if name == "" {
		name = strings.TrimSuffix(strings.TrimSpace(asset.OriginalFileName), filepath.Ext(asset.OriginalFileName))
	}
	if name == "" {
		name = "视频"
	}
	return name
}

func videoSourceAspectRatio(asset store.ContentAsset) string {
	width := vodNumber(asset.Metadata["width"], 0)
	height := vodNumber(asset.Metadata["height"], 0)
	if width <= 0 || height <= 0 {
		return "16:9"
	}
	ratio := width / height
	candidates := []struct {
		name  string
		ratio float64
	}{
		{"9:16", 9.0 / 16},
		{"1:1", 1},
		{"4:3", 4.0 / 3},
		{"3:4", 3.0 / 4},
		{"16:9", 16.0 / 9},
		{"21:9", 21.0 / 9},
	}
	best := candidates[0]
	bestDistance := math.Abs(ratio - best.ratio)
	for _, candidate := range candidates[1:] {
		if distance := math.Abs(ratio - candidate.ratio); distance < bestDistance {
			best = candidate
			bestDistance = distance
		}
	}
	return best.name
}

func vodJobFromTask(task store.VideoGenerationTask) (vod.Job, bool) {
	contextValue := objectValue(task.ExpertContext)
	mode := stringValue(contextValue, "mode")
	result := objectValue(task.EditableParseResult["videoGenerationResult"])
	jobID := stringValue(result, "jobId")
	if jobID == "" {
		jobID = stringValue(contextValue, "vodJobId")
	}
	if jobID == "" {
		return vod.Job{}, false
	}
	if mode == "video_translation" {
		return vod.Job{Kind: mode, ProjectID: jobID, ProjectVersion: stringValue(contextValue, "videoTranslationProjectVersion")}, true
	}
	return vod.Job{Kind: mode, RunID: jobID}, true
}

func vodJobID(job vod.Job) string {
	if job.Kind == "video_translation" {
		return job.ProjectID
	}
	return job.RunID
}

func vodRunningResult(task store.VideoGenerationTask, job vod.Job) map[string]any {
	contextValue := objectValue(task.ExpertContext)
	result := objectValue(task.EditableParseResult["videoGenerationResult"])
	if len(result) == 0 {
		result = map[string]any{"version": 1, "taskId": task.ID, "sourceType": stringValue(contextValue, "sourceType"), "provider": "volcengine-vod", "model": vodModel(stringValue(contextValue, "mode")), "videoUrl": nil, "duration": "", "ratio": task.AspectRatio, "renderMode": "provider_generation", "generatedAt": time.Now().UTC().Format(time.RFC3339Nano)}
	}
	result["status"] = "running"
	result["jobId"] = vodJobID(job)
	result["renderStatus"] = "rendering"
	return result
}

func vodCompletedResult(task store.VideoGenerationTask, asset store.ContentAsset, remoteURL string, result vod.Result, job vod.Job) map[string]any {
	contextValue := objectValue(task.ExpertContext)
	completed := vodRunningResult(task, job)
	completed["status"] = "completed"
	completed["renderStatus"] = "rendered"
	completed["videoUrl"] = asset.FileURL
	completed["remoteVideoUrl"] = remoteURL
	completed["assetId"] = asset.ID
	completed["provider"] = "volcengine-vod"
	completed["model"] = vodModel(stringValue(contextValue, "mode"))
	completed["generatedAt"] = time.Now().UTC().Format(time.RFC3339Nano)
	if result.Duration > 0 {
		completed["duration"] = strconv.FormatFloat(result.Duration, 'f', 3, 64)
	}
	return completed
}

func vodModel(mode string) string {
	switch mode {
	case "video_upscale":
		return "moe-aigc-enhance"
	case "subtitle_removal":
		return "subtitle-erase"
	case "video_translation":
		return "ai-video-translation"
	default:
		return "vod"
	}
}

func vodNumber(value any, fallback float64) float64 {
	if parsed, ok := vodNumberOK(value); ok {
		return parsed
	}
	return fallback
}

func vodNumberOK(value any) (float64, bool) {
	switch item := value.(type) {
	case json.Number:
		parsed, err := item.Float64()
		return parsed, err == nil
	case float64:
		return item, true
	case float32:
		return float64(item), true
	case int:
		return float64(item), true
	case int64:
		return float64(item), true
	case string:
		parsed, err := strconv.ParseFloat(strings.TrimSpace(item), 64)
		return parsed, err == nil
	default:
		return 0, false
	}
}

func containsVOD(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
