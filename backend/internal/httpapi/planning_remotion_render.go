package httpapi

import (
	"context"
	"errors"
	"fmt"
	"math"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"sweet-potato-go/internal/pluginruntime"
	"sweet-potato-go/internal/store"
)

const remotionRenderAssetTokenTTL = 2 * time.Hour

func (s *Server) handleStartRemotionRender(w http.ResponseWriter, r *http.Request, session store.ContentPlanningSession) {
	generation := objectValue(session.Analysis["renderGeneration"])
	if status := stringValue(generation, "status"); status == "queued" || status == "rendering" {
		writeError(w, http.StatusConflict, "视频正在渲染")
		return
	}
	request, err := s.remotionRenderRequest(session)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	jobID, err := s.plugins.SubmitRender(r.Context(), pluginruntime.RemotionPluginKey, request)
	if err != nil {
		status := http.StatusBadGateway
		if errors.Is(err, pluginruntime.ErrNotRunning) {
			status = http.StatusConflict
		}
		writeError(w, status, err.Error())
		return
	}

	runID := randomIDForHTTP()
	now := time.Now().UTC().Format(time.RFC3339Nano)
	session.Analysis["renderGeneration"] = map[string]any{
		"runId": runID, "status": "queued", "progress": 0, "pluginJobId": jobID,
		"assetId": "", "fileUrl": "", "errorMessage": "", "startedAt": now, "updatedAt": now,
	}
	updated, err := s.store.UpdatePlanningSession(session)
	if err != nil {
		_ = s.plugins.CancelRender(context.Background(), pluginruntime.RemotionPluginKey, jobID)
		writeError(w, http.StatusInternalServerError, "视频渲染任务保存失败")
		return
	}
	s.publishPlanningSessionUpdated(updated, "render")
	s.startRemotionRenderMonitor(updated.ID, runID)
	writeJSON(w, http.StatusAccepted, updated)
}

func (s *Server) handleCancelRemotionRender(w http.ResponseWriter, r *http.Request, session store.ContentPlanningSession) {
	generation := objectValue(session.Analysis["renderGeneration"])
	status := stringValue(generation, "status")
	if status != "queued" && status != "rendering" {
		writeError(w, http.StatusConflict, "当前没有可取消的渲染任务")
		return
	}
	jobID := stringValue(generation, "pluginJobId")
	if jobID != "" {
		if err := s.plugins.CancelRender(r.Context(), pluginruntime.RemotionPluginKey, jobID); err != nil &&
			!errors.Is(err, pluginruntime.ErrRenderNotFound) && !errors.Is(err, pluginruntime.ErrNotRunning) {
			writeError(w, http.StatusBadGateway, err.Error())
			return
		}
	}
	s.remotionMu.Lock()
	defer s.remotionMu.Unlock()
	current, found, err := s.store.FindPlanningSession(session.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "取消状态读取失败")
		return
	}
	if !found {
		writeError(w, http.StatusNotFound, "视频策划会话不存在")
		return
	}
	generation = objectValue(current.Analysis["renderGeneration"])
	status = stringValue(generation, "status")
	if status != "queued" && status != "rendering" {
		writeError(w, http.StatusConflict, "当前没有可取消的渲染任务")
		return
	}
	generation["status"] = "cancelled"
	generation["progress"] = numberValue(generation["progress"], 0)
	generation["completedAt"] = time.Now().UTC().Format(time.RFC3339Nano)
	generation["updatedAt"] = generation["completedAt"]
	current.Analysis["renderGeneration"] = generation
	updated, err := s.store.UpdatePlanningSession(current)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "取消状态保存失败")
		return
	}
	s.publishPlanningSessionUpdated(updated, "render")
	writeJSON(w, http.StatusOK, updated)
}

func (s *Server) startRemotionRenderMonitor(sessionID, runID string) {
	s.remotionMu.Lock()
	if s.remotionRunning[sessionID] {
		s.remotionMu.Unlock()
		return
	}
	s.remotionRunning[sessionID] = true
	s.remotionMu.Unlock()
	s.startBackgroundTask(func() {
		defer func() {
			s.remotionMu.Lock()
			delete(s.remotionRunning, sessionID)
			s.remotionMu.Unlock()
		}()
		s.monitorRemotionRender(sessionID, runID)
	})
}

func (s *Server) monitorRemotionRender(sessionID, runID string) {
	ticker := time.NewTicker(750 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-s.taskContext().Done():
			return
		case <-ticker.C:
		}
		session, found, err := s.store.FindPlanningSession(sessionID)
		if err != nil || !found {
			return
		}
		generation := objectValue(session.Analysis["renderGeneration"])
		if stringValue(generation, "runId") != runID {
			return
		}
		status := stringValue(generation, "status")
		if status != "queued" && status != "rendering" {
			return
		}
		jobID := stringValue(generation, "pluginJobId")
		if jobID == "" {
			if _, err := s.resubmitRemotionRender(session, generation); err != nil {
				if errors.Is(err, pluginruntime.ErrNotRunning) {
					continue
				}
				s.failRemotionRender(session, runID, err)
				return
			}
			continue
		}

		ctx, cancel := context.WithTimeout(s.taskContext(), 10*time.Second)
		job, err := s.plugins.RenderStatus(ctx, pluginruntime.RemotionPluginKey, jobID)
		cancel()
		if errors.Is(err, pluginruntime.ErrNotRunning) {
			continue
		}
		if errors.Is(err, pluginruntime.ErrRenderNotFound) {
			generation["pluginJobId"] = ""
			session.Analysis["renderGeneration"] = generation
			if updated, updateErr := s.store.UpdatePlanningSession(session); updateErr == nil {
				s.publishPlanningSessionUpdated(updated, "render")
			}
			continue
		}
		if err != nil {
			s.failRemotionRender(session, runID, err)
			return
		}
		switch job.Status {
		case "queued", "in-progress":
			nextStatus := "queued"
			if job.Status == "in-progress" {
				nextStatus = "rendering"
			}
			previousProgress := numberValue(generation["progress"], 0)
			if nextStatus != status || math.Abs(previousProgress-job.Progress) >= 0.01 {
				generation["status"] = nextStatus
				generation["progress"] = math.Max(0, math.Min(1, job.Progress))
				generation["updatedAt"] = time.Now().UTC().Format(time.RFC3339Nano)
				session.Analysis["renderGeneration"] = generation
				if updated, updateErr := s.store.UpdatePlanningSession(session); updateErr == nil {
					s.publishPlanningSessionUpdated(updated, "render")
				}
			}
		case "completed":
			if err := s.finalizeRemotionRender(session, runID, jobID); err != nil {
				s.failRemotionRender(session, runID, err)
			}
			return
		case "failed":
			s.failRemotionRender(session, runID, errors.New(valueOr(strings.TrimSpace(job.Error), "Remotion 视频渲染失败")))
			_ = s.plugins.CancelRender(context.Background(), pluginruntime.RemotionPluginKey, jobID)
			return
		case "cancelled":
			generation["status"] = "cancelled"
			generation["completedAt"] = time.Now().UTC().Format(time.RFC3339Nano)
			session.Analysis["renderGeneration"] = generation
			if updated, updateErr := s.store.UpdatePlanningSession(session); updateErr == nil {
				s.publishPlanningSessionUpdated(updated, "render")
			}
			return
		default:
			s.failRemotionRender(session, runID, fmt.Errorf("未知的 Remotion 渲染状态：%s", job.Status))
			return
		}
	}
}

func (s *Server) resubmitRemotionRender(session store.ContentPlanningSession, generation map[string]any) (store.ContentPlanningSession, error) {
	request, err := s.remotionRenderRequest(session)
	if err != nil {
		return session, err
	}
	ctx, cancel := context.WithTimeout(s.taskContext(), 30*time.Second)
	defer cancel()
	jobID, err := s.plugins.SubmitRender(ctx, pluginruntime.RemotionPluginKey, request)
	if err != nil {
		return session, err
	}
	generation["pluginJobId"] = jobID
	generation["status"] = "queued"
	generation["updatedAt"] = time.Now().UTC().Format(time.RFC3339Nano)
	session.Analysis["renderGeneration"] = generation
	updated, err := s.store.UpdatePlanningSession(session)
	if err == nil {
		s.publishPlanningSessionUpdated(updated, "render")
	}
	return updated, err
}

func (s *Server) remotionRenderRequest(session store.ContentPlanningSession) (map[string]any, error) {
	remotion := objectValue(session.Analysis["remotionGeneration"])
	if stringValue(remotion, "status") != "completed" {
		return nil, errors.New("请先生成并校验 Remotion JSON")
	}
	renderRequest := objectValue(remotion["renderRequest"])
	if len(renderRequest) == 0 {
		return nil, errors.New("当前会话没有可用的 Remotion JSON")
	}
	cloned := cloneObject(renderRequest)
	if err := s.rewriteRemotionMediaURLs(session.UserID, cloned); err != nil {
		return nil, err
	}
	return cloned, nil
}

func (s *Server) rewriteRemotionMediaURLs(userID string, value any) error {
	switch item := value.(type) {
	case map[string]any:
		for key, child := range item {
			if key == "src" {
				raw, _ := child.(string)
				rewritten, changed, err := s.signedRemotionMediaURL(userID, raw)
				if err != nil {
					return err
				}
				if changed {
					item[key] = rewritten
				}
				continue
			}
			if err := s.rewriteRemotionMediaURLs(userID, child); err != nil {
				return err
			}
		}
	case []any:
		for _, child := range item {
			if err := s.rewriteRemotionMediaURLs(userID, child); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *Server) signedRemotionMediaURL(userID, raw string) (string, bool, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return "", false, err
	}
	if !strings.HasPrefix(parsed.Path, "/files/") {
		return raw, false, nil
	}
	name := filepath.Base(parsed.Path)
	if name == "." || name == "" {
		return "", false, errors.New("Remotion 素材地址无效")
	}
	asset, found, err := s.store.FindContentAssetByStoredFileName(name)
	if err != nil {
		return "", false, err
	}
	if !found || asset.UserID != userID {
		return "", false, errors.New("Remotion 素材不存在或无权访问")
	}
	token := s.renderFileToken(name, time.Now().Add(remotionRenderAssetTokenTTL))
	return s.remotionInternalBaseURL() + "/files/" + url.PathEscape(name) + "?render_token=" + url.QueryEscape(token), true, nil
}

func (s *Server) remotionInternalBaseURL() string {
	address := strings.TrimSpace(s.config.Addr)
	if address == "" {
		address = "127.0.0.1:7072"
	}
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return "http://" + strings.TrimRight(address, "/")
	}
	if host == "" || host == "0.0.0.0" || host == "::" || host == "[::]" {
		host = "127.0.0.1"
	}
	return "http://" + net.JoinHostPort(host, port)
}

func (s *Server) finalizeRemotionRender(session store.ContentPlanningSession, runID, jobID string) error {
	filesDir := filepath.Join(s.config.DataDir, "files")
	temporary, err := os.CreateTemp(filesDir, ".remotion-render-*.mp4")
	if err != nil {
		return fmt.Errorf("创建视频临时文件失败：%w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	ctx, cancel := context.WithTimeout(s.taskContext(), 2*time.Hour)
	written, downloadErr := s.plugins.DownloadRender(ctx, pluginruntime.RemotionPluginKey, jobID, temporary)
	cancel()
	closeErr := temporary.Close()
	if downloadErr != nil {
		return downloadErr
	}
	if closeErr != nil {
		return closeErr
	}
	if written <= 0 {
		return errors.New("Remotion 返回了空视频文件")
	}

	// Cancelling and committing a completed asset must be serialized. The
	// download itself intentionally stays outside the lock because it may take
	// a long time and does not mutate persistent state.
	s.remotionMu.Lock()
	defer s.remotionMu.Unlock()
	current, found, err := s.store.FindPlanningSession(session.ID)
	if err != nil || !found {
		return valueOrError(err, "视频策划会话不存在")
	}
	generation := objectValue(current.Analysis["renderGeneration"])
	if stringValue(generation, "runId") != runID || !isActiveRemotionRender(generation) {
		return errors.New("渲染任务已取消或被新的任务替代")
	}

	storedName := fmt.Sprintf("%d-remotion-%s.mp4", time.Now().UnixNano(), sanitizeUploadName(session.ID))
	finalPath := filepath.Join(filesDir, storedName)
	if err := os.Rename(temporaryPath, finalPath); err != nil {
		return fmt.Errorf("保存 Remotion 视频失败：%w", err)
	}
	groupID, err := s.ensureContentGroup(session.UserID, "finished_video")
	if err != nil {
		_ = os.Remove(finalPath)
		return err
	}
	insights := objectValue(session.Analysis["productInsights"])
	name := valueOr(strings.TrimSpace(stringValue(insights, "productName")), "轻量营销视频")
	videoTaskID := "remotion-" + runID
	asset, err := s.store.CreateContentAsset(store.ContentAsset{
		UserID: session.UserID, GroupID: groupID, ResourceType: "finished_video", Type: "generated",
		Name: name, OriginalFileName: storedName, StoredFileName: storedName, MimeType: "video/mp4",
		FileSize: written, Size: written, FilePath: finalPath, FileURL: "/files/" + storedName,
		AssetKind: "lightweight_marketing_video", LifecycleStatus: "permanent",
		Metadata: map[string]any{"taskId": videoTaskID, "planningSessionId": session.ID, "pluginJobId": jobID, "provider": "remotion", "renderMode": "remotion-json", "schemaVersion": "1.1"},
	})
	if err != nil {
		_ = os.Remove(finalPath)
		return err
	}
	videoURL := asset.FileURL
	videoResult := map[string]any{
		"status": "completed", "renderStatus": "completed", "videoUrl": asset.FileURL,
		"assetId": asset.ID, "provider": "remotion", "renderMode": "remotion-json",
		"ratio": remotionRenderAspectRatio(session), "duration": remotionRenderDuration(session),
	}
	videoTask := store.VideoGenerationTask{
		ID: videoTaskID, UserID: session.UserID, Prompt: stringValue(session.MaterialBundle, "prompt"),
		Title: name, Status: "completed", GeneratedVideoURL: &videoURL, AspectRatio: remotionRenderAspectRatio(session),
		RawParseResult: map[string]any{
			"sourceType": "video-productions", "spokenContent": stringValue(session.MaterialBundle, "prompt"),
		},
		EditableParseResult: map[string]any{"videoGenerationResult": videoResult},
		ExpertContext: map[string]any{
			"mode": "lightweight_marketing_video", "sourceType": "video-productions",
			"planningSessionId": session.ID, "renderRunId": runID, "videoGenerationResult": videoResult,
		},
	}
	createdVideoTask := true
	if _, err := s.store.SaveVideoTask(videoTask, true); err != nil {
		existing, found, findErr := s.store.FindVideoTask(videoTaskID, session.UserID)
		existingResult := objectValue(existing.EditableParseResult["videoGenerationResult"])
		existingAssetID := stringValue(existingResult, "assetId")
		existingAsset, assetFound, assetErr := s.store.FindContentAsset(existingAssetID)
		if findErr != nil || assetErr != nil || !found || !assetFound || existingAsset.UserID != session.UserID || existing.GeneratedVideoURL == nil {
			_, _ = s.store.DeleteContentAsset(asset.ID, session.UserID)
			_ = os.Remove(finalPath)
			return fmt.Errorf("保存视频结果记录失败：%w", err)
		}
		// A process may stop after the standard result row was committed but
		// before the planning session was updated. Reuse that deterministic task
		// and its asset instead of inserting a duplicate result after recovery.
		_, _ = s.store.DeleteContentAsset(asset.ID, session.UserID)
		_ = os.Remove(finalPath)
		asset = existingAsset
		createdVideoTask = false
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	generation["status"] = "completed"
	generation["progress"] = 1
	generation["assetId"] = asset.ID
	generation["videoTaskId"] = videoTaskID
	generation["fileUrl"] = asset.FileURL
	generation["errorMessage"] = ""
	generation["completedAt"] = now
	generation["updatedAt"] = now
	current.Analysis["renderGeneration"] = generation
	updated, err := s.store.UpdatePlanningSession(current)
	if err != nil {
		if createdVideoTask {
			_ = s.store.DeleteVideoTask(videoTaskID, session.UserID)
			_, _ = s.store.DeleteContentAsset(asset.ID, session.UserID)
			_ = os.Remove(finalPath)
		}
		return err
	}
	s.publishPlanningSessionUpdated(updated, "render")
	_ = s.plugins.CancelRender(context.Background(), pluginruntime.RemotionPluginKey, jobID)
	return nil
}

func remotionRenderAspectRatio(session store.ContentPlanningSession) string {
	request := objectValue(objectValue(session.Analysis["remotionGeneration"])["renderRequest"])
	video := objectValue(objectValue(request["inputProps"])["video"])
	width := int(numberValue(video["width"], 0))
	height := int(numberValue(video["height"], 0))
	if width <= 0 || height <= 0 {
		return "9:16"
	}
	divisor := greatestCommonDivisor(width, height)
	return fmt.Sprintf("%d:%d", width/divisor, height/divisor)
}

func remotionRenderDuration(session store.ContentPlanningSession) string {
	request := objectValue(objectValue(session.Analysis["remotionGeneration"])["renderRequest"])
	input := objectValue(request["inputProps"])
	video := objectValue(input["video"])
	fps := numberValue(video["fps"], 30)
	frames := numberValue(video["durationInFrames"], 0)
	if fps <= 0 || frames <= 0 {
		return ""
	}
	return fmt.Sprintf("%.1f秒", frames/fps)
}

func greatestCommonDivisor(left, right int) int {
	for right != 0 {
		left, right = right, left%right
	}
	if left <= 0 {
		return 1
	}
	return left
}

func (s *Server) failRemotionRender(session store.ContentPlanningSession, runID string, cause error) {
	s.remotionMu.Lock()
	defer s.remotionMu.Unlock()
	current, found, err := s.store.FindPlanningSession(session.ID)
	if err != nil || !found {
		return
	}
	generation := objectValue(current.Analysis["renderGeneration"])
	if stringValue(generation, "runId") != runID || !isActiveRemotionRender(generation) {
		return
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	generation["status"] = "failed"
	generation["errorMessage"] = cause.Error()
	generation["completedAt"] = now
	generation["updatedAt"] = now
	current.Analysis["renderGeneration"] = generation
	if updated, updateErr := s.store.UpdatePlanningSession(current); updateErr == nil {
		s.publishPlanningSessionUpdated(updated, "render")
	}
}

func isActiveRemotionRender(generation map[string]any) bool {
	status := stringValue(generation, "status")
	return status == "queued" || status == "rendering"
}

func (s *Server) resumeRemotionRenderTasks() {
	sessions, err := s.store.ListActiveRemotionRenderSessions()
	if err != nil {
		return
	}
	for _, session := range sessions {
		generation := objectValue(session.Analysis["renderGeneration"])
		runID := stringValue(generation, "runId")
		if runID != "" {
			s.startRemotionRenderMonitor(session.ID, runID)
		}
	}
}

func cloneObject(value map[string]any) map[string]any {
	result := make(map[string]any, len(value))
	for key, child := range value {
		switch item := child.(type) {
		case map[string]any:
			result[key] = cloneObject(item)
		case []any:
			result[key] = cloneSlice(item)
		default:
			result[key] = child
		}
	}
	return result
}

func cloneSlice(value []any) []any {
	result := make([]any, len(value))
	for index, child := range value {
		switch item := child.(type) {
		case map[string]any:
			result[index] = cloneObject(item)
		case []any:
			result[index] = cloneSlice(item)
		default:
			result[index] = child
		}
	}
	return result
}

func valueOrError(err error, message string) error {
	if err != nil {
		return err
	}
	return errors.New(message)
}
