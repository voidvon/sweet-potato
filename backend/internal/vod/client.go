package vod

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/volcengine/volcengine-go-sdk/service/vod20250101"
	"github.com/volcengine/volcengine-go-sdk/volcengine"
	"github.com/volcengine/volcengine-go-sdk/volcengine/credentials"
	"github.com/volcengine/volcengine-go-sdk/volcengine/session"

	"ai-marketing-go/internal/transfer"
)

const (
	defaultRegion       = "cn-north-1"
	defaultPollInterval = 10 * time.Second
	defaultPollAttempts = 90
	defaultTaskTimeout  = 15 * time.Minute
)

type Config struct {
	AccessKey        string
	SecretKey        string
	SpaceName        string
	Region           string
	APIHost          string
	UploadHostPrefer string
	PlaybackBaseURL  string
	PollInterval     time.Duration
	PollMaxAttempts  int
	TaskTimeout      time.Duration
	HTTPClient       *http.Client
}

type Client struct {
	config Config
	http   *http.Client
	v2     *vod20250101.VOD20250101
}

type UploadResult struct {
	Vid        string
	PosterURI  string
	StoreURI   string
	FileName   string
	RequestID  string
	SourceInfo map[string]any
	Reused     bool
}

type Job struct {
	Kind           string
	RunID          string
	ProjectID      string
	ProjectVersion string
}

type Result struct {
	Status       string
	URL          string
	FileName     string
	Vid          string
	StoreURI     string
	ErrorMessage string
	Duration     float64
}

type EnhancementRequest struct {
	Vid            string
	Resolution     string
	Config         string
	RepairStyle    int
	RepairStrength int
	FPS            *float64
}

type Location struct {
	TopLeftX     float64
	TopLeftY     float64
	BottomRightX float64
	BottomRightY float64
}

type Clip struct {
	Start float64
	End   float64
}

type SubtitleRemovalRequest struct {
	Vid         string
	Mode        string
	ContentType string
	Locations   []Location
	ClipMode    string
	Clips       []Clip
}

type TranslationRequest struct {
	Vid              string
	SourceLanguage   string
	TargetLanguage   string
	TranslationTypes []string
	SubtitleSource   string
	SubtitleConfig   SubtitleConfig
}

type SubtitleConfig struct {
	IsHardSubtitle bool
	IsEraseSource  bool
	FontSize       int
	MarginL        float64
	MarginR        float64
	MarginV        float64
	ShowLines      int
}

func New(config Config) *Client {
	if config.Region == "" {
		config.Region = defaultRegion
	}
	if config.PollInterval <= 0 {
		config.PollInterval = defaultPollInterval
	}
	if config.PollMaxAttempts <= 0 {
		config.PollMaxAttempts = defaultPollAttempts
	}
	if config.TaskTimeout <= 0 {
		config.TaskTimeout = defaultTaskTimeout
	}
	if config.HTTPClient == nil {
		config.HTTPClient = &http.Client{Timeout: 10 * time.Minute}
	}
	return &Client{config: config, http: config.HTTPClient}
}

func (c *Client) Enabled() bool {
	return strings.TrimSpace(c.config.AccessKey) != "" &&
		strings.TrimSpace(c.config.SecretKey) != "" &&
		strings.TrimSpace(c.config.SpaceName) != ""
}

func (c *Client) Configured() error {
	if strings.TrimSpace(c.config.AccessKey) == "" || strings.TrimSpace(c.config.SecretKey) == "" {
		return errors.New("缺少火山引擎 VOD AK/SK，请配置访问控制密钥")
	}
	if strings.TrimSpace(c.config.SpaceName) == "" {
		return errors.New("缺少 VOD 空间配置，请设置 VOLCENGINE_VOD_SPACE_NAME")
	}
	return nil
}

func (c *Client) v2Client() (*vod20250101.VOD20250101, error) {
	if err := c.Configured(); err != nil {
		return nil, err
	}
	if c.v2 != nil {
		return c.v2, nil
	}
	config := volcengine.NewConfig().
		WithCredentials(credentials.NewStaticCredentials(c.config.AccessKey, c.config.SecretKey, "")).
		WithRegion(c.config.Region).
		WithHTTPClient(c.http)
	if strings.TrimSpace(c.config.APIHost) != "" {
		config.WithEndpoint(c.config.APIHost)
	}
	sess, err := session.NewSession(config)
	if err != nil {
		return nil, fmt.Errorf("初始化 VOD SDK 失败: %w", err)
	}
	c.v2 = vod20250101.New(sess)
	return c.v2, nil
}

func (c *Client) StartEnhancement(ctx context.Context, request EnhancementRequest) (Job, error) {
	if err := c.Configured(); err != nil {
		return Job{}, err
	}
	request.Vid = strings.TrimSpace(request.Vid)
	request.Resolution = strings.ToLower(strings.TrimSpace(request.Resolution))
	request.Config = strings.ToLower(strings.TrimSpace(request.Config))
	if request.Vid == "" {
		return Job{}, errors.New("缺少 VOD Vid")
	}
	if request.Resolution == "" {
		request.Resolution = "1080p"
	}
	if !contains([]string{"1080p", "2k", "4k"}, request.Resolution) {
		return Job{}, fmt.Errorf("不支持的目标分辨率: %s", request.Resolution)
	}
	if request.Config == "" {
		request.Config = "aigc"
	}
	if !contains([]string{"aigc", "short_series", "ugc", "old_film", "common"}, request.Config) {
		return Job{}, fmt.Errorf("不支持的画质增强场景: %s", request.Config)
	}
	if request.RepairStyle == 0 {
		request.RepairStyle = 1
	}
	if request.RepairStrength < 0 {
		return Job{}, errors.New("画质修复强度不能小于 0")
	}
	if request.FPS != nil && (*request.FPS <= 0 || *request.FPS > 240) {
		return Job{}, errors.New("目标帧率必须在 0 到 240 之间")
	}

	client, err := c.v2Client()
	if err != nil {
		return Job{}, err
	}
	target := &vod20250101.TargetForStartExecutionInput{Res: volcengine.String(request.Resolution)}
	if request.FPS != nil {
		target.Fps = request.FPS
	}
	input := &vod20250101.StartExecutionInput{
		SpaceName: volcengine.String(c.config.SpaceName),
		Input: &vod20250101.InputForStartExecutionInput{
			Type: volcengine.String("Vid"),
			Vid:  volcengine.String(request.Vid),
		},
		Operation: &vod20250101.ConvertOperationForStartExecutionInput{
			Type: volcengine.String("Task"),
			Task: &vod20250101.TaskForStartExecutionInput{
				Type: volcengine.String("Enhance"),
				Enhance: &vod20250101.EnhanceForStartExecutionInput{
					Type: volcengine.String("Moe"),
					MoeEnhance: &vod20250101.MoeEnhanceForStartExecutionInput{
						Config: volcengine.String(request.Config),
						Target: target,
						VideoStrategy: &vod20250101.VideoStrategyForStartExecutionInput{
							RepairStyle:    volcengine.Int32(int32(request.RepairStyle)),
							RepairStrength: volcengine.Int32(int32(request.RepairStrength)),
						},
					},
				},
			},
		},
	}
	output, err := client.StartExecutionWithContext(ctx, input)
	if err != nil {
		return Job{}, fmt.Errorf("提交视频画质增强任务失败: %w", err)
	}
	if output == nil || output.RunId == nil || strings.TrimSpace(*output.RunId) == "" {
		return Job{}, errors.New("提交视频画质增强任务成功但未返回 RunId")
	}
	return Job{Kind: "enhancement", RunID: *output.RunId}, nil
}

func (c *Client) StartSubtitleRemoval(ctx context.Context, request SubtitleRemovalRequest) (Job, error) {
	if err := c.Configured(); err != nil {
		return Job{}, err
	}
	request.Vid = strings.TrimSpace(request.Vid)
	request.Mode = strings.ToLower(strings.TrimSpace(request.Mode))
	request.ContentType = strings.ToLower(strings.TrimSpace(request.ContentType))
	request.ClipMode = strings.ToLower(strings.TrimSpace(request.ClipMode))
	if request.Vid == "" {
		return Job{}, errors.New("缺少 VOD Vid")
	}
	if request.Mode == "" {
		request.Mode = "auto"
	}
	if !contains([]string{"auto", "auto_region", "manual"}, request.Mode) {
		return Job{}, fmt.Errorf("不支持的字幕擦除模式: %s", request.Mode)
	}
	if request.ContentType == "" {
		request.ContentType = "subtitle"
	}
	if !contains([]string{"subtitle", "text"}, request.ContentType) {
		return Job{}, fmt.Errorf("不支持的擦除内容类型: %s", request.ContentType)
	}
	locations, err := normalizeLocations(request.Locations)
	if err != nil {
		return Job{}, err
	}
	if request.Mode != "auto" && len(locations) == 0 {
		return Job{}, errors.New("区域擦除模式必须至少指定一个擦除区域")
	}
	if request.ClipMode == "" {
		request.ClipMode = "all"
	}
	if !contains([]string{"all", "selected", "skip"}, request.ClipMode) {
		return Job{}, fmt.Errorf("不支持的时间范围模式: %s", request.ClipMode)
	}
	clips, err := normalizeClips(request.Clips, request.ClipMode)
	if err != nil {
		return Job{}, err
	}

	client, err := c.v2Client()
	if err != nil {
		return Job{}, err
	}
	locationModels := make([]*vod20250101.LocationForStartExecutionInput, 0, len(locations))
	for _, location := range locations {
		locationModels = append(locationModels, &vod20250101.LocationForStartExecutionInput{
			RatioLocation: &vod20250101.RatioLocationForStartExecutionInput{
				TopLeftX:     volcengine.Float64(location.TopLeftX),
				TopLeftY:     volcengine.Float64(location.TopLeftY),
				BottomRightX: volcengine.Float64(location.BottomRightX),
				BottomRightY: volcengine.Float64(location.BottomRightY),
			},
		})
	}
	erase := &vod20250101.EraseForStartExecutionInput{
		Mode:          volcengine.String("Auto"),
		NewVid:        volcengine.Bool(true),
		WithEraseInfo: volcengine.Bool(true),
	}
	if request.Mode == "manual" {
		erase.Mode = volcengine.String("Manual")
		erase.Manual = &vod20250101.ManualForStartExecutionInput{Locations: locationModels}
	} else {
		erase.Auto = &vod20250101.AutoForStartExecutionInput{Type: volcengine.String(titleCase(request.ContentType))}
		if request.ContentType == "subtitle" {
			erase.Auto.SubtitleFilter = &vod20250101.SubtitleFilterForStartExecutionInput{}
		}
		if request.Mode == "auto_region" {
			erase.Auto.Locations = locationModels
		}
	}
	if request.ClipMode != "all" {
		clipModels := make([]*vod20250101.ClipForStartExecutionInput, 0, len(clips))
		for _, clip := range clips {
			clipModels = append(clipModels, &vod20250101.ClipForStartExecutionInput{Start: volcengine.Float64(clip.Start), End: volcengine.Float64(clip.End)})
		}
		mode := titleCase(request.ClipMode)
		erase.EraseOption = &vod20250101.EraseOptionForStartExecutionInput{ClipFilter: &vod20250101.ClipFilterForStartExecutionInput{Mode: volcengine.String(mode), Clips: clipModels}}
	}
	output, err := client.StartExecutionWithContext(ctx, &vod20250101.StartExecutionInput{
		SpaceName: volcengine.String(c.config.SpaceName),
		Input:     &vod20250101.InputForStartExecutionInput{Type: volcengine.String("Vid"), Vid: volcengine.String(request.Vid)},
		Operation: &vod20250101.ConvertOperationForStartExecutionInput{
			Type: volcengine.String("Task"),
			Task: &vod20250101.TaskForStartExecutionInput{Type: volcengine.String("Erase"), Erase: erase},
		},
	})
	if err != nil {
		return Job{}, fmt.Errorf("提交字幕擦除任务失败: %w", err)
	}
	if output == nil || output.RunId == nil || strings.TrimSpace(*output.RunId) == "" {
		return Job{}, errors.New("提交字幕擦除任务成功但未返回 RunId")
	}
	return Job{Kind: "subtitle_removal", RunID: *output.RunId}, nil
}

func (c *Client) StartTranslation(ctx context.Context, request TranslationRequest) (Job, error) {
	if err := c.Configured(); err != nil {
		return Job{}, err
	}
	request.Vid = strings.TrimSpace(request.Vid)
	request.SourceLanguage = strings.ToLower(strings.TrimSpace(request.SourceLanguage))
	request.TargetLanguage = strings.ToLower(strings.TrimSpace(request.TargetLanguage))
	request.SubtitleSource = strings.ToLower(strings.TrimSpace(request.SubtitleSource))
	if request.Vid == "" {
		return Job{}, errors.New("缺少 VOD Vid")
	}
	if !contains([]string{"zh", "en"}, request.SourceLanguage) {
		return Job{}, fmt.Errorf("不支持的源语言: %s", request.SourceLanguage)
	}
	if !contains([]string{"zh", "en", "ja", "ko", "de", "fr", "ru", "es", "pt", "it", "id", "vi", "th", "ar", "tr"}, request.TargetLanguage) {
		return Job{}, fmt.Errorf("不支持的目标语言: %s", request.TargetLanguage)
	}
	if request.SourceLanguage == request.TargetLanguage {
		return Job{}, errors.New("源语言和目标语言不能相同")
	}
	if request.SubtitleSource == "" {
		request.SubtitleSource = "ocr"
	}
	if !contains([]string{"ocr", "asr"}, request.SubtitleSource) {
		return Job{}, fmt.Errorf("不支持的字幕来源: %s", request.SubtitleSource)
	}
	types, err := normalizeTranslationTypes(request.TranslationTypes)
	if err != nil {
		return Job{}, err
	}
	subtitleConfig, err := normalizeSubtitleConfig(request.SubtitleConfig)
	if err != nil {
		return Job{}, err
	}

	client, err := c.v2Client()
	if err != nil {
		return Job{}, err
	}
	typeValues := make([]*string, 0, len(types))
	for _, item := range types {
		value := map[string]string{"subtitle": "SubtitleTranslation", "voice": "VoiceTranslation", "face": "FacialTranslation"}[item]
		typeValues = append(typeValues, volcengine.String(value))
	}
	subtitle := &vod20250101.SubtitleConfigForSubmitAITranslationWorkflowInput{
		IsHardSubtitle: volcengine.Bool(subtitleConfig.IsHardSubtitle),
		IsEraseSource:  volcengine.Bool(subtitleConfig.IsEraseSource),
	}
	if subtitleConfig.IsHardSubtitle {
		subtitle.FontSize = volcengine.Int32(int32(subtitleConfig.FontSize))
		subtitle.MarginL = volcengine.Float64(subtitleConfig.MarginL)
		subtitle.MarginR = volcengine.Float64(subtitleConfig.MarginR)
		subtitle.MarginV = volcengine.Float64(subtitleConfig.MarginV)
		subtitle.ShowLines = volcengine.Int32(int32(subtitleConfig.ShowLines))
	}
	output, err := client.SubmitAITranslationWorkflowWithContext(ctx, &vod20250101.SubmitAITranslationWorkflowInput{
		SpaceName: volcengine.String(c.config.SpaceName),
		Vid:       volcengine.String(request.Vid),
		TranslationConfig: &vod20250101.TranslationConfigForSubmitAITranslationWorkflowInput{
			SourceLanguage:      volcengine.String(request.SourceLanguage),
			TargetLanguage:      volcengine.String(request.TargetLanguage),
			TranslationTypeList: typeValues,
		},
		OperatorConfig: &vod20250101.OperatorConfigForSubmitAITranslationWorkflowInput{
			SubtitleRecognitionConfig: &vod20250101.SubtitleRecognitionConfigForSubmitAITranslationWorkflowInput{
				RecognitionType: volcengine.String(strings.ToUpper(request.SubtitleSource)),
				IsVision:        volcengine.Bool(false),
			},
		},
		SubtitleConfig: subtitle,
	})
	if err != nil {
		return Job{}, fmt.Errorf("提交视频翻译任务失败: %w", err)
	}
	if output == nil || output.ProjectBaseInfo == nil || output.ProjectBaseInfo.ProjectId == nil || strings.TrimSpace(*output.ProjectBaseInfo.ProjectId) == "" {
		return Job{}, errors.New("提交视频翻译任务成功但未返回 ProjectId")
	}
	version := ""
	if output.ProjectBaseInfo.ProjectVersion != nil {
		version = *output.ProjectBaseInfo.ProjectVersion
	}
	return Job{Kind: "video_translation", ProjectID: *output.ProjectBaseInfo.ProjectId, ProjectVersion: version}, nil
}

func (c *Client) Wait(ctx context.Context, job Job) (Result, error) {
	if err := c.Configured(); err != nil {
		return Result{}, err
	}
	waitContext, cancel := context.WithTimeout(ctx, c.config.TaskTimeout)
	defer cancel()
	for attempt := 0; attempt < c.config.PollMaxAttempts; attempt++ {
		result, err := c.pollOnce(waitContext, job)
		if err != nil {
			return Result{}, err
		}
		if isFailure(result.Status) {
			message := result.ErrorMessage
			if message == "" {
				message = "VOD 视频处理任务失败"
			}
			return Result{}, errors.New(message)
		}
		if isSuccess(result.Status) {
			return result, nil
		}
		timer := time.NewTimer(c.config.PollInterval)
		select {
		case <-waitContext.Done():
			timer.Stop()
			return Result{}, fmt.Errorf("VOD 视频处理任务超时: %w", waitContext.Err())
		case <-timer.C:
		}
	}
	return Result{}, errors.New("VOD 视频处理任务超过最大轮询次数")
}

func (c *Client) pollOnce(ctx context.Context, job Job) (Result, error) {
	client, err := c.v2Client()
	if err != nil {
		return Result{}, err
	}
	if job.Kind == "video_translation" {
		pageSize := "10"
		output, err := client.ListAITranslationProjectWithContext(ctx, &vod20250101.ListAITranslationProjectInput{
			SpaceName:              volcengine.String(c.config.SpaceName),
			ProjectIdOrTitleFilter: volcengine.String(job.ProjectID),
			PageNumber:             volcengine.Int32(1),
			PageSize:               volcengine.String(pageSize),
		})
		if err != nil {
			return Result{}, fmt.Errorf("查询视频翻译任务失败: %w", err)
		}
		if output == nil {
			return Result{}, errors.New("查询视频翻译任务返回为空")
		}
		for _, project := range output.Projects {
			if project == nil || project.ProjectId == nil || *project.ProjectId != job.ProjectID {
				continue
			}
			result := Result{Status: stringPointer(project.Status), ErrorMessage: stringPointer(project.ErrorMsg)}
			if project.OutputVideo != nil {
				result.URL = stringPointer(project.OutputVideo.Url)
				result.FileName = stringPointer(project.OutputVideo.FileName)
				result.Vid = stringPointer(project.OutputVideo.Vid)
				result.Duration = floatPointer(project.OutputVideo.DurationSecond)
			}
			return result, nil
		}
		return Result{Status: "running"}, nil
	}

	output, err := client.GetExecutionWithContext(ctx, &vod20250101.GetExecutionInput{RunId: volcengine.String(job.RunID)})
	if err != nil {
		return Result{}, fmt.Errorf("查询 VOD 视频处理任务失败: %w", err)
	}
	if output == nil {
		return Result{}, errors.New("查询 VOD 视频处理任务返回为空")
	}
	result := Result{Status: stringPointer(output.Status), ErrorMessage: stringPointer(output.Code)}
	if output.Output != nil && output.Output.Task != nil {
		if output.Output.Task.Enhance != nil {
			result.StoreURI = stringPointer(output.Output.Task.Enhance.StoreUri)
			result.Duration = floatPointer(output.Output.Task.Enhance.Duration)
		}
		if output.Output.Task.Erase != nil && output.Output.Task.Erase.File != nil {
			result.FileName = stringPointer(output.Output.Task.Erase.File.FileName)
			result.Vid = stringPointer(output.Output.Task.Erase.File.Vid)
		}
		if output.Output.Task.Erase != nil && output.Output.Task.Erase.Duration != nil {
			result.Duration = *output.Output.Task.Erase.Duration
		}
	}
	if result.ErrorMessage == "" && output.Meta != nil {
		result.ErrorMessage = "VOD 返回任务失败"
	}
	return result, nil
}

func (c *Client) ResultURL(result Result) (string, error) {
	if value := strings.TrimSpace(result.URL); value != "" {
		parsed, err := url.Parse(value)
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
			return "", errors.New("VOD 返回的视频地址无效")
		}
		return value, nil
	}
	fileName := strings.TrimSpace(result.FileName)
	if fileName == "" && strings.TrimSpace(result.StoreURI) != "" {
		fileName = strings.TrimPrefix(strings.TrimSpace(result.StoreURI), "tos-vod/")
		if index := strings.IndexByte(fileName, '/'); index >= 0 {
			fileName = fileName[index+1:]
		}
	}
	base := strings.TrimRight(strings.TrimSpace(c.config.PlaybackBaseURL), "/")
	if base == "" {
		return "", errors.New("VOD 未返回可下载地址，请配置 VOLCENGINE_VOD_PLAYBACK_BASE_URL")
	}
	if fileName == "" {
		return "", errors.New("VOD 任务完成但未返回产物文件名")
	}
	parts := strings.Split(strings.TrimLeft(fileName, "/"), "/")
	for index, part := range parts {
		parts[index] = url.PathEscape(part)
	}
	return base + "/" + strings.Join(parts, "/"), nil
}

func (c *Client) Download(ctx context.Context, sourceURL, destination string) (int64, error) {
	return transfer.Download(ctx, c.http, sourceURL, destination, transfer.MaxMediaBytes)
}

func contains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func titleCase(value string) string {
	if value == "" {
		return value
	}
	return strings.ToUpper(value[:1]) + value[1:]
}

func stringPointer(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}

func floatPointer(value *float64) float64 {
	if value == nil {
		return 0
	}
	return *value
}
