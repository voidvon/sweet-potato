package httpapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"sweet-potato-go/internal/store"
	"sweet-potato-go/internal/video"
)

var contentModules = []map[string]any{
	{"code": "digital_human", "name": "数字人", "kind": "asset_library", "description": "管理数字人素材。"},
	{"code": "virtual_portrait_assets", "name": "人物素材", "kind": "asset_library", "description": "管理人物参考素材。"},
	{"code": "ai_voice", "name": "人声素材", "kind": "asset_library", "description": "管理声音素材。"},
	{"code": "scene_library", "name": "场景素材", "kind": "asset_library", "description": "管理场景素材。"},
	{"code": "product_assets", "name": "产品素材", "kind": "asset_library", "description": "管理产品素材。"},
	{"code": "finished_assets", "name": "作品", "kind": "asset_library", "description": "查看已生成作品。"},
	{"code": "create_video", "name": "视频创作", "kind": "video_generation", "description": "创建和管理视频生成任务。"},
}

func (s *Server) handleContent(w http.ResponseWriter, r *http.Request) {
	relative := strings.TrimPrefix(strings.TrimPrefix(r.URL.Path, "/api/content"), "/")
	parts := splitPath(relative)
	if len(parts) == 0 {
		writeError(w, http.StatusNotFound, "接口不存在")
		return
	}
	if parts[0] == "modules" {
		if _, ok := s.requireUser(w, r); !ok {
			return
		}
		writeJSON(w, http.StatusOK, contentModules)
		return
	}
	if parts[0] == "real-person" {
		s.handleRealPerson(w, r, parts[1:])
		return
	}
	if len(parts) == 2 && parts[0] == "virtual-portrait" && parts[1] == "remote-library" {
		writeError(w, http.StatusNotFound, "接口不存在")
		return
	}
	if len(parts) == 3 && parts[0] == "virtual-portrait" && parts[1] == "remote-library" && parts[2] == "sync" {
		s.handleVirtualPortraitRemoteSync(w, r)
		return
	}
	if parts[0] == "asset-groups" {
		s.handleContentGroups(w, r, parts[1:])
		return
	}
	if parts[0] == "assets" {
		s.handleContentAssets(w, r, parts[1:])
		return
	}
	if parts[0] == "video-tasks" || parts[0] == "video-productions" || parts[0] == "video-enhancements" || parts[0] == "subtitle-removals" || parts[0] == "video-translations" {
		s.handleVideoContent(w, r, parts)
		return
	}
	if parts[0] == "reference-video" {
		s.handleReferenceVideo(w, r, parts[1:])
		return
	}
	if parts[0] == "marketing-video-storyboards" {
		s.handleStoryboard(w, r, parts[1:])
		return
	}
	if parts[0] == "temporary-assets" {
		s.handleTemporaryAssets(w, r, parts[1:])
		return
	}
	writeError(w, http.StatusNotFound, "接口不存在")
}

func splitPath(value string) []string {
	items := strings.Split(strings.Trim(value, "/"), "/")
	if len(items) == 1 && items[0] == "" {
		return nil
	}
	result := make([]string, 0, len(items))
	for _, item := range items {
		if item != "" {
			result = append(result, item)
		}
	}
	return result
}

func (s *Server) handleRealPerson(w http.ResponseWriter, r *http.Request, parts []string) {
	if len(parts) == 1 && parts[0] == "callback" && r.Method == http.MethodGet {
		groupID := strings.TrimSpace(r.URL.Query().Get("groupId"))
		userID := strings.TrimSpace(r.URL.Query().Get("userId"))
		status := valueOr(strings.TrimSpace(r.URL.Query().Get("status")), "verified")
		if status != "pending" && status != "verified" && status != "failed" {
			writeError(w, http.StatusBadRequest, "认证状态无效")
			return
		}
		group, found, err := s.store.FindContentGroup(groupID)
		if err != nil || !found || userID == "" || group.UserID != userID {
			writeError(w, http.StatusNotFound, "认证分组不存在")
			return
		}
		metadata := objectValue(group.Metadata)
		metadata["validationStatus"] = status
		metadata["validationCallbackAt"] = time.Now().UTC().Format(time.RFC3339Nano)
		updated, err := s.store.UpdateContentGroup(group.ID, group.UserID, group.Name, group.Description, metadata)
		if err != nil {
			writeError(w, http.StatusBadRequest, "认证回调处理失败")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "group": updated})
		return
	}
	if _, ok := s.requireUser(w, r); !ok {
		return
	}
	if len(parts) == 1 && parts[0] == "validation-session" && r.Method == http.MethodPost {
		user, _ := s.authenticatedUser(r)
		input, ok := decodeMap(w, r)
		if !ok {
			return
		}
		name := valueOr(strings.TrimSpace(stringValue(input, "name")), "真人认证素材")
		group, err := s.store.CreateContentGroup(user.ID, "real_person", name, stringValue(input, "description"), map[string]any{"validationStatus": "pending"})
		if err != nil {
			writeError(w, http.StatusBadRequest, "真人认证会话创建失败")
			return
		}
		callbackURL := "/api/content/real-person/callback?userId=" + url.QueryEscape(user.ID) + "&groupId=" + url.QueryEscape(group.ID)
		writeJSON(w, http.StatusCreated, map[string]any{"group": group, "validationUrl": callbackURL, "h5Link": callbackURL, "expiresInSeconds": 900})
		return
	}
	if len(parts) == 1 && parts[0] == "validation-result" && r.Method == http.MethodPost {
		user, _ := s.authenticatedUser(r)
		input, ok := decodeMap(w, r)
		if !ok {
			return
		}
		groupID := strings.TrimSpace(stringValue(input, "groupId"))
		group, found, err := s.store.FindContentGroup(groupID)
		if err != nil || !found || group.UserID != user.ID {
			writeError(w, http.StatusNotFound, "认证分组不存在")
			return
		}
		metadata := objectValue(group.Metadata)
		metadata["validationStatus"] = valueOr(stringValue(input, "status"), "verified")
		metadata["validationResultAt"] = time.Now().UTC().Format(time.RFC3339Nano)
		updated, err := s.store.UpdateContentGroup(group.ID, group.UserID, group.Name, group.Description, metadata)
		if err != nil {
			writeError(w, http.StatusBadRequest, "真人认证结果保存失败")
			return
		}
		writeJSON(w, http.StatusOK, updated)
		return
	}
	writeError(w, http.StatusNotFound, "真人认证接口不存在")
}

func (s *Server) handleVirtualPortraitRemoteSync(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireUser(w, r, "web.module.content.virtual_portrait_assets"); !ok {
		return
	}
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "请求方法不支持")
		return
	}
	input, ok := decodeMap(w, r)
	if !ok {
		return
	}
	projectName := valueOr(strings.TrimSpace(stringValue(input, "projectName")), "local")
	writeJSON(w, http.StatusOK, map[string]any{
		"projectName": projectName, "totalRemoteGroups": 0, "createdGroups": 0,
		"updatedGroups": 0, "syncedAssetGroups": 0, "failedGroups": 0,
		"groups": []any{}, "provider": "go-local",
	})
}

func contentPermission(resourceType string) string {
	switch resourceType {
	case "digital_human":
		return "web.module.content.virtual_portrait_assets"
	case "virtual_portrait":
		return "web.module.content.virtual_portrait_assets"
	case "voice":
		return "web.module.content.ai_voice"
	case "scene":
		return "web.module.content.scene_library"
	case "product":
		return "web.module.content.product_assets"
	case "finished_video":
		return "web.module.content.finished_assets"
	case "other":
		return "web.module.content.create_video"
	default:
		return ""
	}
}

func (s *Server) requireContentUser(w http.ResponseWriter, r *http.Request, resourceType string) (store.User, bool) {
	user, ok := s.requireUser(w, r)
	if !ok {
		return store.User{}, false
	}
	if !canAccessContentResource(user, resourceType) {
		writeError(w, http.StatusForbidden, "当前账号无权访问该素材类型")
		return store.User{}, false
	}
	return user, true
}

func canAccessContentResource(user store.User, resourceType string) bool {
	permission := contentPermission(resourceType)
	if permission == "" || user.Role == "admin" {
		return true
	}
	for _, granted := range user.Permissions {
		if granted == permission {
			return true
		}
	}
	return false
}

func (s *Server) handleContentGroups(w http.ResponseWriter, r *http.Request, parts []string) {
	if len(parts) == 0 {
		if r.Method == http.MethodGet {
			user, ok := s.requireUser(w, r)
			if !ok {
				return
			}
			userID := user.ID
			if user.Role == "admin" && r.URL.Query().Get("all") == "true" {
				userID = ""
			}
			page, pageSize := queryPage(r, 0, 0)
			groups, pageResult, err := s.store.ListContentGroups(userID, r.URL.Query().Get("resourceType"), page, pageSize)
			if err != nil {
				writeError(w, http.StatusInternalServerError, "素材分组获取失败")
				return
			}
			if pageResult != nil {
				if pageResult["items"] == nil {
					pageResult["items"] = []store.ContentAssetGroup{}
				}
				writeJSON(w, http.StatusOK, pageResult)
			} else {
				if groups == nil {
					groups = []store.ContentAssetGroup{}
				}
				writeJSON(w, http.StatusOK, groups)
			}
			return
		}
		if r.Method == http.MethodPost {
			input, ok := decodeMap(w, r)
			if !ok {
				return
			}
			resourceType := stringValue(input, "resourceType")
			user, ok := s.requireContentUser(w, r, resourceType)
			if !ok {
				return
			}
			name := strings.TrimSpace(stringValue(input, "name"))
			if name == "" || resourceType == "" {
				writeError(w, http.StatusBadRequest, "素材分组参数不完整")
				return
			}
			group, err := s.store.CreateContentGroup(user.ID, resourceType, name, stringValue(input, "description"), objectValue(input["metadata"]))
			if err != nil {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
			writeJSON(w, http.StatusCreated, group)
			return
		}
		writeError(w, http.StatusMethodNotAllowed, "请求方法不支持")
		return
	}

	id := parts[0]
	if len(parts) >= 2 && parts[1] == "assets" {
		resourceType := ""
		if len(parts) >= 3 {
			if parts[2] == "virtual-portrait" {
				resourceType = "virtual_portrait"
			} else if parts[2] == "real-person" {
				resourceType = "real_person"
			}
		}
		s.handleGroupAssetUpload(w, r, id, resourceType)
		return
	}
	if len(parts) >= 2 && (parts[1] == "digital-human" || parts[1] == "virtual-portrait" || parts[1] == "voice") {
		s.handleDerivedGroupAction(w, r, id, parts[1])
		return
	}
	user, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	group, found, err := s.store.FindContentGroup(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "素材分组读取失败")
		return
	}
	if !found {
		writeError(w, http.StatusNotFound, "素材分组不存在")
		return
	}
	if user.Role != "admin" && group.UserID != user.ID {
		writeError(w, http.StatusForbidden, "无权访问该素材分组")
		return
	}
	switch r.Method {
	case http.MethodPatch, http.MethodPut:
		input, ok := decodeMap(w, r)
		if !ok {
			return
		}
		metadata := group.Metadata
		if value, exists := input["metadata"]; exists {
			metadata = objectValue(value)
		}
		updated, err := s.store.UpdateContentGroup(id, group.UserID, stringValue(input, "name"), stringValue(input, "description"), metadata)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, updated)
	case http.MethodDelete:
		if err := s.store.DeleteContentGroup(id, group.UserID); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	default:
		writeError(w, http.StatusMethodNotAllowed, "请求方法不支持")
	}
}

func objectValue(value any) map[string]any {
	if result, ok := value.(map[string]any); ok && result != nil {
		return result
	}
	return map[string]any{}
}

func (s *Server) handleDerivedGroupAction(w http.ResponseWriter, r *http.Request, groupID, action string) {
	resourceType := "digital_human"
	if action == "virtual-portrait" {
		resourceType = "virtual_portrait"
	} else if action == "voice" {
		resourceType = "voice"
	}
	user, ok := s.requireContentUser(w, r, resourceType)
	if !ok {
		return
	}
	group, found, err := s.store.FindContentGroup(groupID)
	if err != nil || !found || (user.Role != "admin" && group.UserID != user.ID) {
		writeError(w, http.StatusNotFound, "素材分组不存在")
		return
	}
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "请求方法不支持")
		return
	}
	if action == "voice" {
		writeJSON(w, http.StatusOK, group)
		return
	}
	input, ok := decodeMap(w, r)
	if !ok {
		return
	}
	metadata := objectValue(input["metadata"])
	metadata["kind"] = "three_view_result"
	asset := store.ContentAsset{UserID: group.UserID, GroupID: group.ID, ResourceType: resourceType, Type: "generated", Name: stringValue(input, "name"), Description: stringValue(input, "description"), OriginalFileName: "generated.json", StoredFileName: "", MimeType: "application/json", FileSize: 0, Size: 0, FilePath: "", FileURL: "", AssetKind: "generated", LifecycleStatus: "permanent", Metadata: metadata}
	if asset.Name == "" {
		asset.Name = "三视图"
	}
	created, err := s.store.CreateContentAsset(asset)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, created)
}

func (s *Server) handleGroupAssetUpload(w http.ResponseWriter, r *http.Request, groupID, routeResourceType string) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "请求方法不支持")
		return
	}
	group, found, err := s.store.FindContentGroup(groupID)
	if err != nil || !found {
		writeError(w, http.StatusNotFound, "素材分组不存在")
		return
	}
	if _, ok := s.requireContentUser(w, r, group.ResourceType); !ok {
		return
	}
	resourceType := group.ResourceType
	if routeResourceType != "" && routeResourceType != "real_person" {
		resourceType = routeResourceType
	}
	asset, err := s.uploadContentAsset(r, uploadOptions{
		UserID:       mustAuthenticatedUserID(s, r),
		GroupID:      groupID,
		ResourceType: resourceType,
		AssetKind:    "upload",
	})
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, asset)
}

type uploadOptions struct {
	UserID       string
	GroupID      string
	ResourceType string
	AssetKind    string
	Metadata     map[string]any
}

type uploadedContentFile struct {
	Header       *multipart.FileHeader
	OriginalName string
	StoredName   string
	Path         string
	URL          string
	MimeType     string
	Size         int64
}

func (s *Server) uploadContentAsset(r *http.Request, options uploadOptions) (store.ContentAsset, error) {
	if options.UserID == "" {
		return store.ContentAsset{}, errors.New("请先登录")
	}
	file, err := s.saveMultipartFile(r, "file")
	if err != nil {
		return store.ContentAsset{}, err
	}
	if options.ResourceType == "" {
		options.ResourceType = strings.TrimSpace(r.FormValue("resourceType"))
	}
	if options.ResourceType == "" {
		options.ResourceType = "other"
	}
	if options.ResourceType == "finished_video" {
		_ = os.Remove(file.Path)
		return store.ContentAsset{}, errors.New("成片素材只能由视频生成任务写入")
	}
	if options.AssetKind != "file_input" && options.AssetKind != "batch_input" {
		user, found, findErr := s.store.FindUserByID(options.UserID)
		if findErr != nil || !found || !canAccessContentResource(user, options.ResourceType) {
			_ = os.Remove(file.Path)
			return store.ContentAsset{}, errors.New("当前账号无权访问该素材类型")
		}
	}
	metadata := options.Metadata
	if metadata == nil {
		metadata = parseFormMetadata(r.FormValue("metadata"))
	}
	if value := strings.TrimSpace(r.FormValue("assetKind")); value != "" {
		options.AssetKind = value
	}
	if options.AssetKind == "" {
		options.AssetKind = "upload"
	}
	groupID := options.GroupID
	if groupID == "" {
		groupID, err = s.ensureContentGroup(options.UserID, options.ResourceType)
		if err != nil {
			_ = os.Remove(file.Path)
			return store.ContentAsset{}, err
		}
	}
	name := strings.TrimSpace(r.FormValue("name"))
	if name == "" {
		name = file.OriginalName
	}
	lifecycle := "permanent"
	var expiresAt *string
	if boolValue(metadata["temporary"]) {
		lifecycle = "temporary"
		expires := time.Now().UTC().Add(24 * time.Hour).Format(time.RFC3339Nano)
		expiresAt = &expires
	}
	asset, err := s.store.CreateContentAsset(store.ContentAsset{
		UserID:           options.UserID,
		GroupID:          groupID,
		ResourceType:     options.ResourceType,
		Type:             "file",
		Name:             name,
		Description:      strings.TrimSpace(r.FormValue("description")),
		OriginalFileName: file.OriginalName,
		StoredFileName:   file.StoredName,
		MimeType:         file.MimeType,
		FileSize:         file.Size,
		Size:             file.Size,
		FilePath:         file.Path,
		FileURL:          file.URL,
		AssetKind:        options.AssetKind,
		LifecycleStatus:  lifecycle,
		ExpiresAt:        expiresAt,
		Metadata:         metadata,
	})
	if err != nil {
		_ = os.Remove(file.Path)
		return store.ContentAsset{}, err
	}
	return asset, nil
}

func (s *Server) saveMultipartFile(r *http.Request, field string) (uploadedContentFile, error) {
	settings, err := s.store.GetBatchRequestSettings()
	if err != nil {
		return uploadedContentFile{}, fmt.Errorf("读取上传限制失败: %w", err)
	}
	maxBytes := int64(settings.MaxFileSizeMB) * 1024 * 1024
	if maxBytes < 1 {
		maxBytes = 100 * 1024 * 1024
	}
	file, header, err := r.FormFile(field)
	if err != nil {
		return uploadedContentFile{}, errors.New("请选择要上传的素材文件")
	}
	defer file.Close()
	originalName := sanitizeUploadName(header.Filename)
	if originalName == "" {
		originalName = "asset"
	}
	storedName := fmt.Sprintf("%d-%s", time.Now().UnixNano(), originalName)
	path := filepath.Join(s.config.DataDir, "files", storedName)
	output, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return uploadedContentFile{}, fmt.Errorf("创建上传文件失败: %w", err)
	}
	removeOnError := true
	defer func() {
		if removeOnError {
			_ = os.Remove(path)
		}
	}()
	written, copyErr := io.Copy(output, io.LimitReader(file, maxBytes+1))
	closeErr := output.Close()
	if copyErr != nil {
		return uploadedContentFile{}, fmt.Errorf("保存上传文件失败: %w", copyErr)
	}
	if closeErr != nil {
		return uploadedContentFile{}, fmt.Errorf("关闭上传文件失败: %w", closeErr)
	}
	if written > maxBytes {
		return uploadedContentFile{}, fmt.Errorf("上传文件不能超过 %d MB", settings.MaxFileSizeMB)
	}
	removeOnError = false
	mimeType := header.Header.Get("Content-Type")
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}
	return uploadedContentFile{Header: header, OriginalName: header.Filename, StoredName: storedName, Path: path, URL: "/files/" + storedName, MimeType: mimeType, Size: written}, nil
}

func sanitizeUploadName(value string) string {
	base := filepath.Base(strings.TrimSpace(value))
	if base == "." || base == string(filepath.Separator) {
		return ""
	}
	var builder strings.Builder
	for _, r := range base {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '.' || r == '-' || r == '_' {
			builder.WriteRune(r)
		} else {
			builder.WriteByte('-')
		}
	}
	return strings.Trim(builder.String(), ".-")
}

func parseFormMetadata(value string) map[string]any {
	if strings.TrimSpace(value) == "" {
		return map[string]any{}
	}
	var result map[string]any
	if err := json.Unmarshal([]byte(value), &result); err != nil || result == nil {
		return map[string]any{}
	}
	return result
}

func (s *Server) ensureContentGroup(userID, resourceType string) (string, error) {
	groups, _, err := s.store.ListContentGroups(userID, resourceType, 0, 0)
	if err != nil {
		return "", err
	}
	for _, group := range groups {
		if boolValue(group.Metadata["systemDefault"]) {
			return group.ID, nil
		}
	}
	name := map[string]string{"digital_human": "默认数字人", "virtual_portrait": "默认人物素材", "voice": "默认人声", "scene": "默认场景", "product": "默认产品素材", "finished_video": "默认作品", "other": "默认素材"}[resourceType]
	if name == "" {
		name = "默认素材"
	}
	returnGroup, err := s.store.CreateContentGroup(userID, resourceType, name, "", map[string]any{"systemDefault": true, "hiddenFromGroupUi": true, "source": "local_upload"})
	if err != nil {
		return "", err
	}
	return returnGroup.ID, nil
}

func mustAuthenticatedUserID(s *Server, r *http.Request) string {
	user, _ := s.authenticatedUser(r)
	return user.ID
}

func queryPage(r *http.Request, defaultPage, defaultSize int) (int, int) {
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	pageSize, _ := strconv.Atoi(r.URL.Query().Get("pageSize"))
	if page == 0 {
		page = defaultPage
	}
	if pageSize == 0 {
		pageSize = defaultSize
	}
	return page, pageSize
}

func (s *Server) handleContentAssets(w http.ResponseWriter, r *http.Request, parts []string) {
	if len(parts) == 1 && parts[0] == "upload" && r.Method == http.MethodPost {
		user, ok := s.requireUser(w, r)
		if !ok {
			return
		}
		asset, err := s.uploadContentAsset(r, uploadOptions{UserID: user.ID})
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusCreated, asset)
		return
	}
	if len(parts) == 0 {
		if r.Method == http.MethodPost {
			user, ok := s.requireUser(w, r)
			if !ok {
				return
			}
			if r.URL.Path != "/api/content/assets/upload" {
				writeJSON(w, http.StatusOK, map[string]any{"directUpload": false})
				return
			}
			asset, err := s.uploadContentAsset(r, uploadOptions{UserID: user.ID})
			if err != nil {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
			writeJSON(w, http.StatusCreated, asset)
			return
		}
		if r.Method == http.MethodGet {
			user, ok := s.requireUser(w, r)
			if !ok {
				return
			}
			userID := user.ID
			if user.Role == "admin" && r.URL.Query().Get("all") == "true" {
				userID = ""
			}
			page, pageSize := queryPage(r, 0, 0)
			assets, pageResult, err := s.store.ListContentAssets(userID, r.URL.Query().Get("groupId"), r.URL.Query().Get("resourceType"), page, pageSize)
			if err != nil {
				writeError(w, http.StatusInternalServerError, "素材列表获取失败")
				return
			}
			if pageResult != nil {
				writeJSON(w, http.StatusOK, pageResult)
			} else {
				if assets == nil {
					assets = []store.ContentAsset{}
				}
				writeJSON(w, http.StatusOK, assets)
			}
			return
		}
		writeError(w, http.StatusMethodNotAllowed, "请求方法不支持")
		return
	}

	if len(parts) == 2 && parts[0] == "direct-upload" && parts[1] == "prepare" && r.Method == http.MethodPost {
		s.prepareLocalDirectUpload(w, r)
		return
	}
	if len(parts) == 3 && parts[0] == "direct-upload" && parts[1] == "upload" && r.Method == http.MethodPut {
		s.receiveLocalDirectUpload(w, r, parts[2])
		return
	}
	if len(parts) == 2 && parts[0] == "direct-upload" && parts[1] == "complete" && r.Method == http.MethodPost {
		s.completeLocalDirectUpload(w, r)
		return
	}

	id := parts[0]
	if len(parts) == 1 {
		user, ok := s.requireUser(w, r)
		if !ok {
			return
		}
		asset, found, err := s.store.FindContentAsset(id)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "素材读取失败")
			return
		}
		if !found || (user.Role != "admin" && asset.UserID != user.ID) {
			writeError(w, http.StatusNotFound, "素材不存在")
			return
		}
		switch r.Method {
		case http.MethodGet:
			writeJSON(w, http.StatusOK, asset)
		case http.MethodPatch, http.MethodPut:
			input, ok := decodeMap(w, r)
			if !ok {
				return
			}
			updated, err := s.store.UpdateContentAsset(id, asset.UserID, input)
			if err != nil {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
			writeJSON(w, http.StatusOK, updated)
		case http.MethodDelete:
			removed, err := s.store.DeleteContentAsset(id, asset.UserID)
			if err != nil {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
			if removed.FilePath != "" {
				_ = os.Remove(removed.FilePath)
			}
			writeJSON(w, http.StatusOK, map[string]any{"ok": true, "deleted": true})
		default:
			writeError(w, http.StatusMethodNotAllowed, "请求方法不支持")
		}
		return
	}
	if len(parts) == 2 && parts[1] == "thumbnail" {
		user, ok := s.requireUser(w, r)
		if !ok {
			return
		}
		asset, found, err := s.store.FindContentAsset(id)
		if err != nil || !found || (user.Role != "admin" && asset.UserID != user.ID) {
			writeError(w, http.StatusNotFound, "素材不存在")
			return
		}
		if asset.FilePath == "" {
			writeError(w, http.StatusNotFound, "素材没有本地预览")
			return
		}
		w.Header().Set("Cache-Control", "private, no-store")
		http.ServeFile(w, r, asset.FilePath)
		return
	}
	if len(parts) == 2 && (parts[1] == "real-person" || parts[1] == "virtual-portrait") && r.Method == http.MethodPost {
		user, ok := s.requireUser(w, r)
		if !ok {
			return
		}
		asset, found, err := s.store.FindContentAsset(id)
		if err != nil || !found || (user.Role != "admin" && asset.UserID != user.ID) {
			writeError(w, http.StatusNotFound, "素材不存在")
			return
		}
		writeJSON(w, http.StatusOK, asset)
		return
	}
	writeError(w, http.StatusNotFound, "接口不存在")
}

func (s *Server) handleVideoContent(w http.ResponseWriter, r *http.Request, parts []string) {
	user, ok := s.requireUser(w, r, "web.module.content.create_video")
	if !ok {
		return
	}
	resource := parts[0]
	if resource == "video-tasks" {
		if len(parts) == 1 && r.Method == http.MethodGet {
			tasks, err := s.store.ListVideoTasks(user.ID)
			if err != nil {
				writeError(w, http.StatusInternalServerError, "视频任务列表获取失败")
				return
			}
			writeJSON(w, http.StatusOK, tasks)
			return
		}
		if len(parts) >= 2 {
			id := parts[1]
			task, found, err := s.store.FindVideoTask(id, user.ID)
			if err != nil || !found {
				writeError(w, http.StatusNotFound, "视频任务不存在")
				return
			}
			if len(parts) == 3 && parts[2] == "title" && (r.Method == http.MethodPatch || r.Method == http.MethodPut) {
				input, ok := decodeMap(w, r)
				if !ok {
					return
				}
				task.Title = strings.TrimSpace(stringValue(input, "title"))
				if task.Title == "" {
					writeError(w, http.StatusBadRequest, "任务名称不能为空")
					return
				}
				updated, err := s.store.SaveVideoTask(task, false)
				if err != nil {
					writeError(w, http.StatusBadRequest, err.Error())
					return
				}
				writeJSON(w, http.StatusOK, updated)
				return
			}
			if len(parts) == 2 && r.Method == http.MethodGet {
				writeJSON(w, http.StatusOK, task)
				return
			}
			if len(parts) == 2 && r.Method == http.MethodDelete {
				if err := s.store.DeleteVideoTask(id, user.ID); err != nil {
					writeError(w, http.StatusBadRequest, err.Error())
					return
				}
				writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
				return
			}
		}
		writeError(w, http.StatusNotFound, "视频任务接口不存在")
		return
	}
	if resource == "video-productions" && r.Method == http.MethodGet {
		filters := map[string]string{"search": r.URL.Query().Get("search"), "status": r.URL.Query().Get("status"), "ratio": r.URL.Query().Get("ratio")}
		page, pageSize := queryPage(r, 0, 0)
		tasks, pageResult, err := s.store.ListVideoProductions(user.ID, filters, page, pageSize)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "视频制作记录获取失败")
			return
		}
		if pageResult != nil {
			if pageResult["items"] == nil {
				pageResult["items"] = []store.VideoGenerationTask{}
			}
			writeJSON(w, http.StatusOK, pageResult)
		} else {
			writeJSON(w, http.StatusOK, tasks)
		}
		return
	}
	if resource == "video-productions" || resource == "video-enhancements" || resource == "subtitle-removals" || resource == "video-translations" {
		if r.Method != http.MethodPost || len(parts) != 1 {
			writeError(w, http.StatusMethodNotAllowed, "请求方法不支持")
			return
		}
		input, ok := decodeMap(w, r)
		if !ok {
			return
		}
		if resource != "video-productions" {
			task, err := s.createVODVideoTask(user.ID, resource, input)
			if err != nil {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
			s.startBackgroundTask(func() { s.executeVODTask(task) })
			writeJSON(w, http.StatusCreated, task)
			return
		}
		task := buildVideoTask(user.ID, resource, input)
		created, err := s.store.SaveVideoTask(task, true)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		s.startBackgroundTask(func() { s.executeVideoTask(created) })
		writeJSON(w, http.StatusCreated, created)
		return
	}
	writeError(w, http.StatusNotFound, "视频接口不存在")
}

func buildVideoTask(userID, resource string, input map[string]any) store.VideoGenerationTask {
	prompt := strings.TrimSpace(stringValue(input, "prompt"))
	ratio := strings.TrimSpace(stringValue(input, "ratio"))
	if ratio == "" {
		ratio = strings.TrimSpace(stringValue(input, "aspectRatio"))
	}
	if ratio == "" {
		ratio = "16:9"
	}
	title := strings.TrimSpace(stringValue(input, "title"))
	if title == "" {
		title = "视频制作任务"
	}
	status := "pending"
	if resource == "video-enhancements" || resource == "subtitle-removals" || resource == "video-translations" {
		status = "pending"
	}
	selectedSkills := stringSlice(input["selectedSkillIds"])
	return store.VideoGenerationTask{
		UserID: userID, SourceURL: stringValue(input, "sourceUrl"), Prompt: prompt, Title: title, Status: status,
		RawParseResult:      map[string]any{"person": "", "scene": "", "voice": "", "shotLanguage": "", "product": "", "pip": "", "spokenContent": prompt, "extraDetails": "", "sourceType": resource},
		EditableParseResult: map[string]any{"person": "", "scene": "", "voice": "", "shotLanguage": "", "product": "", "pip": "", "spokenContent": prompt, "extraDetails": ""},
		SelectedSkillIDs:    selectedSkills, ExpertContext: map[string]any{"request": input, "sourceType": resource}, AspectRatio: ratio,
	}
}

func (s *Server) executeVideoTask(task store.VideoGenerationTask) {
	userID := task.UserID
	taskContext := task.ExpertContext
	request, _ := taskContext["request"].(map[string]any)
	if request == nil {
		request = map[string]any{}
	}
	task.Status = "generating"
	if updated, err := s.store.SaveVideoTask(task, false); err == nil {
		task = updated
	}
	sourceID := stringValue(request, "sourceAssetId")
	if sourceID == "" {
		for _, key := range []string{"referenceVideoAssetId", "sourceVideoAssetId"} {
			if sourceID = stringValue(request, key); sourceID != "" {
				break
			}
		}
	}
	source, found, _ := s.store.FindContentAsset(sourceID)
	if sourceID != "" && (!found || source.UserID != userID) {
		s.failVideoTask(task, "源视频素材不存在")
		return
	}
	groupID, err := s.ensureContentGroup(userID, "finished_video")
	if err != nil {
		s.failVideoTask(task, err.Error())
		return
	}
	modelConfig := s.resolveVideoModelConfig(request)
	var asset store.ContentAsset
	if modelConfig.APIKey != "" {
		asset, err = s.executeConfiguredVideoTask(task, request, source, groupID, modelConfig)
	} else {
		if stringValue(task.ExpertContext, "sourceType") != "video-productions" {
			err = errors.New("该视频处理能力需要配置视频 provider")
		} else {
			asset, err = s.executeLocalVideoTask(task, request, source, groupID)
		}
	}
	if err != nil {
		s.failVideoTask(task, fmt.Sprintf("生成视频产物失败: %v", err))
		return
	}
	task.Status = "completed"
	task.GeneratedVideoURL = &asset.FileURL
	result := task.EditableParseResult
	if result == nil {
		result = map[string]any{}
	}
	provider := stringValue(asset.Metadata, "provider")
	if provider == "" {
		provider = "go-local"
	}
	result["videoGenerationResult"] = map[string]any{"status": "completed", "videoUrl": asset.FileURL, "assetId": asset.ID, "provider": provider, "renderMode": stringValue(asset.Metadata, "renderMode")}
	task.EditableParseResult = result
	if _, err := s.store.SaveVideoTask(task, false); err != nil {
		s.failVideoTask(task, err.Error())
	}
}

func (s *Server) resolveVideoModelConfig(input map[string]any) store.ModelConfig {
	requestedID := valueOr(stringValue(input, "videoModelConfigId"), stringValue(input, "modelConfigId"))
	providerID := stringValue(input, "videoModelProviderId")
	models, _ := s.store.ListModelConfigs("video")
	for _, model := range models {
		if requestedID != "" && model.ID == requestedID {
			return model
		}
	}
	if providerID != "" {
		for _, model := range models {
			if model.Provider == providerID {
				return model
			}
		}
	}
	for _, model := range models {
		if model.IsDefault {
			return model
		}
	}
	if len(models) > 0 {
		return models[0]
	}
	apiKey := strings.TrimSpace(os.Getenv("VIDEO_MODEL_API_KEY"))
	if apiKey == "" {
		apiKey = strings.TrimSpace(os.Getenv("ARK_API_KEY"))
	}
	return store.ModelConfig{ID: "env-video", Type: "video", Provider: valueOr(strings.TrimSpace(os.Getenv("VIDEO_MODEL_PROVIDER")), "volcengine-seedance"), Model: valueOr(strings.TrimSpace(os.Getenv("VIDEO_MODEL_ID")), "doubao-seedance-2-0-260128"), APIKey: apiKey, BaseURL: valueOr(strings.TrimSpace(os.Getenv("VIDEO_MODEL_BASE_URL")), "https://ark.cn-beijing.volces.com/api/v3")}
}

func (s *Server) executeConfiguredVideoTask(task store.VideoGenerationTask, input map[string]any, source store.ContentAsset, groupID string, model store.ModelConfig) (store.ContentAsset, error) {
	images, err := s.ownedVideoAssets(task.UserID, stringSlice(input["referenceImageIds"]), "image/")
	if err != nil {
		return store.ContentAsset{}, err
	}
	videos, err := s.ownedVideoAssets(task.UserID, stringSlice(input["referenceVideoIds"]), "video/")
	if err != nil {
		return store.ContentAsset{}, err
	}
	audios, err := s.ownedVideoAssets(task.UserID, stringSlice(input["referenceAudioIds"]), "audio/")
	if err != nil {
		return store.ContentAsset{}, err
	}
	remoteVideo, _ := input["remoteVideo"].(map[string]any)
	client := video.Client{BaseURL: model.BaseURL, APIKey: model.APIKey, Provider: model.Provider, Model: valueOr(stringValue(input, "videoModelId"), model.Model), PublicBase: strings.TrimRight(os.Getenv("PUBLIC_BASE_URL"), "/")}
	ctx, cancel := context.WithTimeout(s.taskContext(), 30*time.Minute)
	defer cancel()
	result, err := client.Generate(ctx, video.GenerateInput{TaskID: task.ID, Prompt: task.Prompt, Ratio: task.AspectRatio, Quality: stringValue(input, "quality"), Duration: stringValue(input, "duration"), GenerateAudio: input["generateAudio"] != false, Images: images, Videos: videos, Audios: audios, RemoteVideo: stringValue(remoteVideo, "input")})
	if err != nil {
		return store.ContentAsset{}, err
	}
	if result.VideoURL == "" {
		return store.ContentAsset{}, errors.New("视频模型没有返回视频地址")
	}
	ext := filepath.Ext(result.VideoURL)
	if len(ext) > 5 || ext == "" {
		ext = ".mp4"
	}
	storedName := fmt.Sprintf("%d-video-task-%s%s", time.Now().UnixNano(), sanitizeUploadName(task.ID), ext)
	path := filepath.Join(s.config.DataDir, "files", storedName)
	fileSize, err := client.Download(ctx, result.VideoURL, path)
	if err != nil {
		return store.ContentAsset{}, err
	}
	metadata := map[string]any{"taskId": task.ID, "provider": result.Provider, "model": result.Model, "jobId": result.JobID, "generatedBy": "go", "renderMode": "provider"}
	if result.CoverURL != "" {
		metadata["coverUrl"] = result.CoverURL
	}
	asset, err := s.store.CreateContentAsset(store.ContentAsset{UserID: task.UserID, GroupID: groupID, ResourceType: "finished_video", Type: "generated", Name: task.Title, OriginalFileName: storedName, StoredFileName: storedName, MimeType: "video/mp4", FileSize: fileSize, Size: fileSize, FilePath: path, FileURL: "/files/" + storedName, AssetKind: "video_task_output", LifecycleStatus: "permanent", ParentAssetID: sourceIDPointer(source.ID), Metadata: metadata})
	if err != nil {
		_ = os.Remove(path)
	}
	return asset, err
}

func (s *Server) executeLocalVideoTask(task store.VideoGenerationTask, input map[string]any, source store.ContentAsset, groupID string) (store.ContentAsset, error) {
	storedName := fmt.Sprintf("%d-video-task-%s.json", time.Now().UnixNano(), sanitizeUploadName(task.ID))
	path := filepath.Join(s.config.DataDir, "files", storedName)
	mimeType := "application/json"
	fileSize := int64(0)
	if source.FilePath != "" {
		ext := filepath.Ext(source.StoredFileName)
		if ext == "" {
			ext = filepath.Ext(source.OriginalFileName)
		}
		if ext == "" {
			ext = ".mp4"
		}
		storedName = fmt.Sprintf("%d-video-task-%s%s", time.Now().UnixNano(), sanitizeUploadName(task.ID), ext)
		path = filepath.Join(s.config.DataDir, "files", storedName)
		inputFile, openErr := os.Open(source.FilePath)
		if openErr == nil {
			output, createErr := os.Create(path)
			if createErr == nil {
				fileSize, createErr = io.Copy(output, inputFile)
				_ = output.Close()
				err := inputFile.Close()
				if createErr != nil {
					openErr = createErr
				} else if err != nil {
					openErr = err
				}
			} else {
				_ = inputFile.Close()
				openErr = createErr
			}
		}
		if openErr != nil {
			return store.ContentAsset{}, openErr
		}
		mimeType = valueOr(source.MimeType, "video/mp4")
	} else {
		return store.ContentAsset{}, errors.New("未提供源视频，无法在未配置 provider 时生成视频")
	}
	return s.store.CreateContentAsset(store.ContentAsset{UserID: task.UserID, GroupID: groupID, ResourceType: "finished_video", Type: "generated", Name: task.Title, OriginalFileName: storedName, StoredFileName: storedName, MimeType: mimeType, FileSize: fileSize, Size: fileSize, FilePath: path, FileURL: "/files/" + storedName, AssetKind: "video_task_output", LifecycleStatus: "permanent", ParentAssetID: sourceIDPointer(source.ID), Metadata: map[string]any{"taskId": task.ID, "provider": "go-local", "generatedBy": "go", "renderMode": "source_passthrough"}})
}

func (s *Server) ownedVideoAssets(userID string, ids []string, mimePrefix string) ([]store.ContentAsset, error) {
	result := []store.ContentAsset{}
	for _, id := range ids {
		asset, found, err := s.store.FindContentAsset(id)
		if err != nil || !found || asset.UserID != userID || !strings.HasPrefix(asset.MimeType, mimePrefix) {
			return nil, errors.New("参考素材不存在或类型不匹配")
		}
		result = append(result, asset)
	}
	return result, nil
}

func sourceIDPointer(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

func (s *Server) failVideoTask(task store.VideoGenerationTask, message string) {
	task.Status = "failed"
	task.FailureReason = &message
	_, _ = s.store.SaveVideoTask(task, false)
}

func (s *Server) handleReferenceVideo(w http.ResponseWriter, r *http.Request, parts []string) {
	if _, ok := s.requireUser(w, r); !ok {
		return
	}
	if len(parts) == 1 && parts[0] == "trim" && r.Method == http.MethodPost {
		user, _ := s.authenticatedUser(r)
		file, err := s.saveMultipartFile(r, "file")
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		metadata := parseFormMetadata(r.FormValue("metadata"))
		metadata["trimStart"] = r.FormValue("start")
		metadata["trimEnd"] = r.FormValue("end")
		groupID, err := s.ensureContentGroup(user.ID, "other")
		if err != nil {
			_ = os.Remove(file.Path)
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		asset, err := s.store.CreateContentAsset(store.ContentAsset{UserID: user.ID, GroupID: groupID, ResourceType: "other", Name: strings.TrimSuffix(file.OriginalName, filepath.Ext(file.OriginalName)) + "-trimmed", OriginalFileName: file.OriginalName, StoredFileName: file.StoredName, MimeType: file.MimeType, FileSize: file.Size, Size: file.Size, FilePath: file.Path, FileURL: file.URL, AssetKind: "reference_video_trimmed", LifecycleStatus: "temporary", ExpiresAt: func() *string { value := time.Now().UTC().Add(24 * time.Hour).Format(time.RFC3339Nano); return &value }(), Metadata: metadata})
		if err != nil {
			_ = os.Remove(file.Path)
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusCreated, asset)
		return
	}
	if len(parts) == 0 && r.Method == http.MethodDelete {
		user, _ := s.authenticatedUser(r)
		var input map[string]any
		if !decodeJSONBody(w, r, &input) {
			return
		}
		assetID := strings.TrimSpace(stringValue(input, "assetId"))
		var asset store.ContentAsset
		var found bool
		var err error
		if assetID != "" {
			asset, found, err = s.store.FindContentAsset(assetID)
		} else {
			stored := filepath.Base(strings.TrimSpace(stringValue(input, "storedFileName")))
			if stored != "." && stored != "" && !strings.Contains(stored, "..") {
				asset, found, err = s.store.FindContentAssetByStoredFileName(stored)
			}
		}
		if err != nil || !found || asset.UserID != user.ID {
			writeError(w, http.StatusNotFound, "参考视频素材不存在")
			return
		}
		if _, err := s.store.DeleteContentAsset(asset.ID, user.ID); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		if asset.FilePath != "" {
			_ = os.Remove(asset.FilePath)
		}
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
		return
	}
	writeError(w, http.StatusNotFound, "参考视频接口不存在")
}

func (s *Server) handleStoryboard(w http.ResponseWriter, r *http.Request, parts []string) {
	user, ok := s.requireUser(w, r, "web.module.content.create_video")
	if !ok {
		return
	}
	if len(parts) == 0 && r.Method == http.MethodGet {
		items, err := s.listStoryboards(user.ID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "营销视频分镜历史获取失败")
			return
		}
		if items == nil {
			items = []map[string]any{}
		}
		writeJSON(w, http.StatusOK, items)
		return
	}
	if len(parts) == 0 && r.Method == http.MethodPost {
		input, ok := decodeMap(w, r)
		if !ok {
			return
		}
		storyboard, err := s.createStoryboard(user.ID, input)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusCreated, storyboard)
		return
	}
	if len(parts) >= 1 {
		id := parts[0]
		if len(parts) == 2 && parts[1] == "generate-video" && r.Method == http.MethodPost {
			input, ok := decodeMap(w, r)
			if !ok {
				return
			}
			task := buildVideoTask(user.ID, "video-productions", input)
			task.Prompt = "营销视频分镜 " + id
			created, err := s.store.SaveVideoTask(task, true)
			if err != nil {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
			s.startBackgroundTask(func() { s.executeVideoTask(created) })
			writeJSON(w, http.StatusCreated, created)
			return
		}
		if (len(parts) == 2 && parts[1] == "retry") && r.Method == http.MethodPost {
			input, ok := decodeMap(w, r)
			if !ok {
				return
			}
			storyboard, err := s.updateStoryboardRetry(user.ID, id, input)
			if err != nil {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
			writeJSON(w, http.StatusOK, storyboard)
			return
		}
		if len(parts) == 1 && r.Method == http.MethodDelete {
			if err := s.deleteStoryboard(user.ID, id); err != nil {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
	}
	writeError(w, http.StatusNotFound, "营销视频分镜接口不存在")
}

func (s *Server) prepareLocalDirectUpload(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	input, ok := decodeMap(w, r)
	if !ok {
		return
	}
	resourceType := strings.TrimSpace(stringValue(input, "resourceType"))
	if resourceType == "" {
		resourceType = "other"
	}
	if resourceType == "finished_video" {
		writeError(w, http.StatusBadRequest, "成片素材只能由视频生成任务写入")
		return
	}
	if !strings.HasPrefix(r.URL.Path, "/api/chat/attachments/") {
		if user, found, findErr := s.store.FindUserByID(user.ID); findErr != nil || !found || !canAccessContentResource(user, resourceType) {
			writeError(w, http.StatusForbidden, "当前账号无权访问该素材类型")
			return
		}
	}
	groupID := strings.TrimSpace(stringValue(input, "groupId"))
	if groupID != "" {
		group, found, err := s.store.FindContentGroup(groupID)
		if err != nil || !found || (user.Role != "admin" && group.UserID != user.ID) {
			writeError(w, http.StatusBadRequest, "素材分组不存在或无权访问")
			return
		}
	} else {
		var err error
		groupID, err = s.ensureContentGroup(user.ID, resourceType)
		if err != nil {
			writeError(w, http.StatusBadRequest, "素材分组创建失败")
			return
		}
	}
	originalName := sanitizeUploadName(stringValue(input, "originalFileName"))
	if originalName == "" {
		originalName = "asset"
	}
	storedName := fmt.Sprintf("%d-direct-%s", time.Now().UnixNano(), originalName)
	mimeType := strings.TrimSpace(stringValue(input, "mimeType"))
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}
	fileSize := int64(numberValue(input["fileSize"], 0))
	if fileSize < 0 {
		writeError(w, http.StatusBadRequest, "文件大小无效")
		return
	}
	metadata := objectValue(input["metadata"])
	if strings.HasPrefix(r.URL.Path, "/api/chat/attachments/") {
		metadata["kind"] = "chat_reference_upload"
		metadata["source"] = "local_upload"
		metadata["temporary"] = true
	}
	lifecycle := "permanent"
	if boolValue(metadata["temporary"]) {
		lifecycle = "temporary"
	}
	expiresAt := time.Now().UTC().Add(15 * time.Minute).Format(time.RFC3339Nano)
	intent, err := s.store.CreateFileUploadIntent(store.FileUploadIntent{
		UserID: user.ID, GroupID: groupID, ResourceType: resourceType,
		OriginalFileName: originalName, StoredFileName: storedName, MimeType: mimeType,
		FileSize: fileSize, Name: valueOr(stringValue(input, "name"), originalName),
		Description: stringValue(input, "description"), AssetKind: valueOr(stringValue(metadata, "assetKind"), "upload"),
		LifecycleStatus: lifecycle, Metadata: metadata, ExpiresAt: expiresAt,
	})
	if err != nil {
		writeError(w, http.StatusBadRequest, "直传任务创建失败")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"directUpload": true,
		"intentId":     intent.ID,
		"uploadUrl":    "/api/content/assets/direct-upload/upload/" + intent.ID,
		"headers":      map[string]string{"Content-Type": mimeType},
		"expiresAt":    intent.ExpiresAt,
	})
}

func (s *Server) receiveLocalDirectUpload(w http.ResponseWriter, r *http.Request, intentID string) {
	user, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	intent, found, err := s.store.FindFileUploadIntent(intentID, user.ID)
	if err != nil || !found {
		writeError(w, http.StatusNotFound, "上传任务不存在")
		return
	}
	if intent.Status != "pending" {
		writeError(w, http.StatusConflict, "上传任务已完成")
		return
	}
	if expires, parseErr := time.Parse(time.RFC3339Nano, intent.ExpiresAt); parseErr != nil || !time.Now().UTC().Before(expires) {
		writeError(w, http.StatusGone, "上传任务已过期，请重新上传")
		return
	}
	settings, err := s.store.GetBatchRequestSettings()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "读取上传限制失败")
		return
	}
	maxBytes := int64(settings.MaxFileSizeMB) * 1024 * 1024
	if maxBytes < 1 {
		maxBytes = 100 * 1024 * 1024
	}
	if intent.FileSize > 0 && intent.FileSize > maxBytes {
		writeError(w, http.StatusRequestEntityTooLarge, "上传文件超过系统限制")
		return
	}
	path := filepath.Join(s.config.DataDir, "files", filepath.Base(intent.StoredFileName))
	output, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o644)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "创建上传文件失败")
		return
	}
	written, copyErr := io.Copy(output, io.LimitReader(r.Body, maxBytes+1))
	closeErr := output.Close()
	if copyErr != nil || closeErr != nil || written > maxBytes {
		_ = os.Remove(path)
		writeError(w, http.StatusBadRequest, "保存上传文件失败")
		return
	}
	if intent.FileSize > 0 && written != intent.FileSize {
		_ = os.Remove(path)
		writeError(w, http.StatusBadRequest, "上传文件大小校验失败")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "size": written})
}

func (s *Server) completeLocalDirectUpload(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	input, ok := decodeMap(w, r)
	if !ok {
		return
	}
	asset, created, err := s.completeLocalDirectUploadAsset(user.ID, input)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	status := http.StatusCreated
	if !created {
		status = http.StatusOK
	}
	writeJSON(w, status, asset)
}

func (s *Server) completeLocalDirectUploadAsset(userID string, input map[string]any) (store.ContentAsset, bool, error) {
	intentID := strings.TrimSpace(stringValue(input, "intentId"))
	intent, found, err := s.store.FindFileUploadIntent(intentID, userID)
	if err != nil || !found {
		return store.ContentAsset{}, false, errors.New("上传任务不存在")
	}
	if intent.Status == "completed" && intent.AssetID != "" {
		asset, assetFound, findErr := s.store.FindContentAsset(intent.AssetID)
		if findErr == nil && assetFound {
			return asset, false, nil
		}
	}
	if expires, parseErr := time.Parse(time.RFC3339Nano, intent.ExpiresAt); parseErr != nil || !time.Now().UTC().Before(expires) {
		return store.ContentAsset{}, false, errors.New("上传任务已过期，请重新上传")
	}
	path := filepath.Join(s.config.DataDir, "files", filepath.Base(intent.StoredFileName))
	fileInfo, err := os.Stat(path)
	if err != nil {
		return store.ContentAsset{}, false, errors.New("请先完成文件上传")
	}
	if intent.FileSize > 0 && fileInfo.Size() != intent.FileSize {
		return store.ContentAsset{}, false, errors.New("上传文件大小校验失败")
	}
	metadata := objectValue(intent.Metadata)
	metadata["storageProvider"] = "local"
	metadata["directUpload"] = true
	var assetExpiresAt *string
	if intent.LifecycleStatus == "temporary" {
		expires := time.Now().UTC().Add(24 * time.Hour).Format(time.RFC3339Nano)
		assetExpiresAt = &expires
	}
	asset, err := s.store.CreateContentAsset(store.ContentAsset{
		UserID: userID, GroupID: intent.GroupID, ResourceType: intent.ResourceType,
		Type: "file", Name: intent.Name, Description: intent.Description,
		OriginalFileName: intent.OriginalFileName, StoredFileName: intent.StoredFileName,
		MimeType: intent.MimeType, FileSize: fileInfo.Size(), Size: fileInfo.Size(),
		FilePath: path, FileURL: "/files/" + filepath.Base(intent.StoredFileName),
		AssetKind: intent.AssetKind, LifecycleStatus: intent.LifecycleStatus,
		ExpiresAt: assetExpiresAt, Metadata: metadata,
	})
	if err != nil {
		return store.ContentAsset{}, false, errors.New("素材记录创建失败")
	}
	if err := s.store.CompleteFileUploadIntent(intent.ID, userID, asset.ID); err != nil {
		return store.ContentAsset{}, false, err
	}
	return asset, true, nil
}

func (s *Server) listStoryboards(userID string) ([]map[string]any, error) {
	rows, err := s.store.QueryRows(`SELECT id, title, product_name, product_category, selling_points, additional_prompt, prompt, reference_image_ids, model_config_id, model_name, status, image_asset_id, image_url, video_task_id, reservation_id, credit_cost, error_message, created_at, updated_at FROM marketing_video_storyboards WHERE user_id = ? ORDER BY updated_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	// Keep empty history responses as JSON arrays for clients that iterate them.
	result := make([]map[string]any, 0)
	for rows.Next() {
		var id, title, productName, category, points, additional, prompt, refs, modelConfigID, modelName, status string
		var imageAssetID, imageURL, videoTaskID, reservationID, errorMessage sql.NullString
		var credit float64
		var created, updated string
		if err := rows.Scan(&id, &title, &productName, &category, &points, &additional, &prompt, &refs, &modelConfigID, &modelName, &status, &imageAssetID, &imageURL, &videoTaskID, &reservationID, &credit, &errorMessage, &created, &updated); err != nil {
			return nil, err
		}
		result = append(result, map[string]any{"id": id, "title": title, "productName": productName, "productCategory": category, "sellingPoints": points, "additionalPrompt": additional, "prompt": prompt, "referenceImageIds": decodeJSONList(refs), "modelConfigId": modelConfigID, "modelName": modelName, "status": status, "imageAssetId": nullStringPointerValue(imageAssetID), "imageUrl": nullStringPointerValue(imageURL), "videoTaskId": nullStringPointerValue(videoTaskID), "reservationId": nullStringPointerValue(reservationID), "creditCost": credit, "errorMessage": nullStringPointerValue(errorMessage), "createdAt": created, "updatedAt": updated})
	}
	return result, rows.Err()
}

func (s *Server) createStoryboard(userID string, input map[string]any) (map[string]any, error) {
	productName := strings.TrimSpace(stringValue(input, "productName"))
	if productName == "" {
		return nil, errors.New("产品名称不能为空")
	}
	id := randomIDForHTTP()
	now := time.Now().UTC().Format(time.RFC3339Nano)
	prompt := strings.TrimSpace(fmt.Sprintf("为%s设计营销视频分镜。卖点：%s。%s", productName, stringValue(input, "sellingPoints"), stringValue(input, "additionalPrompt")))
	refs, _ := json.Marshal(input["referenceImageIds"])
	_, err := s.store.Exec(`INSERT INTO marketing_video_storyboards (id, user_id, title, product_name, product_category, selling_points, additional_prompt, prompt, reference_image_ids, model_config_id, model_name, status, credit_cost, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', 0, ?, ?)`, id, userID, productName+"营销分镜", productName, stringValue(input, "productCategory"), stringValue(input, "sellingPoints"), stringValue(input, "additionalPrompt"), prompt, string(refs), "default-llm", "默认 LLM 模型", now, now)
	if err != nil {
		return nil, err
	}
	items, err := s.listStoryboards(userID)
	if err != nil || len(items) == 0 {
		return nil, err
	}
	return items[0], nil
}

func (s *Server) updateStoryboardRetry(userID, id string, input map[string]any) (map[string]any, error) {
	result, err := s.store.Exec(`UPDATE marketing_video_storyboards SET additional_prompt = ?, status = 'completed', updated_at = ? WHERE id = ? AND user_id = ?`, stringValue(input, "optimizationInstruction"), time.Now().UTC().Format(time.RFC3339Nano), id, userID)
	if err != nil {
		return nil, err
	}
	count, _ := result.RowsAffected()
	if count == 0 {
		return nil, errors.New("营销视频分镜不存在")
	}
	items, err := s.listStoryboards(userID)
	if err != nil {
		return nil, err
	}
	for _, item := range items {
		if item["id"] == id {
			return item, nil
		}
	}
	return nil, errors.New("营销视频分镜不存在")
}

func (s *Server) deleteStoryboard(userID, id string) error {
	result, err := s.store.Exec(`DELETE FROM marketing_video_storyboards WHERE id = ? AND user_id = ?`, id, userID)
	if err != nil {
		return err
	}
	count, _ := result.RowsAffected()
	if count == 0 {
		return errors.New("营销视频分镜不存在")
	}
	return nil
}

func (s *Server) handleTemporaryAssets(w http.ResponseWriter, r *http.Request, parts []string) {
	if _, ok := s.requireUser(w, r, "admin.route.system.temporary_assets.view"); !ok {
		return
	}
	switch {
	case len(parts) == 1 && parts[0] == "settings":
		s.handleTemporaryAssetSettings(w, r)
	case len(parts) == 1 && parts[0] == "cleanup-candidates" && r.Method == http.MethodGet:
		page, pageSize := queryPage(r, 1, 20)
		result, err := s.store.ListTemporaryAssetCleanupCandidates(page, pageSize)
		if err != nil {
			writeError(w, http.StatusBadRequest, "待清理素材获取失败")
			return
		}
		writeJSON(w, http.StatusOK, result)
	case len(parts) == 1 && parts[0] == "cleanup-logs" && r.Method == http.MethodGet:
		result, err := s.store.ListTemporaryAssetCleanupLogs()
		if err != nil {
			writeError(w, http.StatusBadRequest, "素材清理日志获取失败")
			return
		}
		writeJSON(w, http.StatusOK, result)
	case len(parts) == 1 && parts[0] == "disk-space" && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, map[string]any{"availableBytes": availableDiskBytes(filepath.Join(s.config.DataDir, "files"))})
	case len(parts) == 1 && parts[0] == "orphan-files" && r.Method == http.MethodGet:
		s.inspectOrphanFiles(w)
	case len(parts) == 2 && parts[0] == "orphan-files" && parts[1] == "delete" && r.Method == http.MethodPost:
		s.deleteOrphanFiles(w, r)
	case len(parts) == 1 && parts[0] == "cleanup-selected" && r.Method == http.MethodPost:
		s.cleanupSelectedTemporaryAssets(w, r)
	case len(parts) == 1 && parts[0] == "cleanup" && r.Method == http.MethodPost:
		s.cleanupExpiredTemporaryAssets(w)
	default:
		writeError(w, http.StatusNotFound, "临时素材接口不存在")
	}
}

func (s *Server) handleTemporaryAssetSettings(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		result, err := s.store.GetTemporaryAssetCleanupSettings()
		if err != nil {
			writeError(w, http.StatusInternalServerError, "临时素材清理设置读取失败")
			return
		}
		writeJSON(w, http.StatusOK, result)
		return
	}
	if r.Method != http.MethodPut {
		writeError(w, http.StatusMethodNotAllowed, "请求方法不支持")
		return
	}
	input, ok := decodeMap(w, r)
	if !ok {
		return
	}
	result, err := s.store.UpdateTemporaryAssetCleanupSettings(store.TemporaryAssetCleanupSettings{
		RetentionHours:         numberValue(input["retentionHours"], 24),
		CleanupIntervalMinutes: int(numberValue(input["cleanupIntervalMinutes"], 60)),
	})
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) cleanupSelectedTemporaryAssets(w http.ResponseWriter, r *http.Request) {
	input, ok := decodeMap(w, r)
	if !ok {
		return
	}
	raw, _ := input["assetIds"].([]any)
	if len(raw) == 0 || len(raw) > 100 {
		writeError(w, http.StatusBadRequest, "请选择 1 至 100 条临时素材")
		return
	}
	deleted := 0
	for _, value := range raw {
		id := strings.TrimSpace(fmt.Sprint(value))
		if id == "" {
			continue
		}
		asset, found, err := s.store.DeleteTemporaryAsset(id, false)
		if err != nil || !found {
			continue
		}
		removeStoredFile(asset.FilePath)
		_ = s.store.RecordTemporaryAssetCleanup(asset, "manual")
		deleted++
	}
	writeJSON(w, http.StatusOK, map[string]any{"deleted": deleted})
}

func (s *Server) cleanupExpiredTemporaryAssets(w http.ResponseWriter) {
	deleted := 0
	for {
		result, err := s.store.ListTemporaryAssetCleanupCandidates(1, 100)
		if err != nil {
			writeError(w, http.StatusBadRequest, "临时素材清理失败")
			return
		}
		items, _ := result["items"].([]map[string]any)
		if len(items) == 0 {
			break
		}
		progress := 0
		for _, item := range items {
			id, _ := item["id"].(string)
			asset, found, err := s.store.DeleteTemporaryAsset(id, true)
			if err != nil || !found {
				continue
			}
			removeStoredFile(asset.FilePath)
			_ = s.store.RecordTemporaryAssetCleanup(asset, "manual")
			deleted++
			progress++
		}
		if progress == 0 {
			break
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"deleted": deleted})
}

func (s *Server) inspectOrphanFiles(w http.ResponseWriter) {
	root := filepath.Join(s.config.DataDir, "files")
	managed, err := s.store.ListManagedFilePaths()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "孤立文件检查失败")
		return
	}
	managedSet := map[string]bool{}
	for _, value := range managed {
		if absolute, absoluteErr := filepath.Abs(value); absoluteErr == nil {
			managedSet[filepath.Clean(absolute)] = true
		}
	}
	type orphan struct {
		RelativePath string `json:"relativePath"`
		Size         int64  `json:"size"`
		ModifiedAt   string `json:"modifiedAt"`
	}
	scanned, orphanFiles := 0, []orphan{}
	var orphanBytes int64
	_ = filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil || entry.IsDir() || !entry.Type().IsRegular() {
			return nil
		}
		scanned++
		if managedSet[filepath.Clean(path)] {
			return nil
		}
		info, infoErr := entry.Info()
		if infoErr != nil {
			return nil
		}
		relative, relativeErr := filepath.Rel(root, path)
		if relativeErr != nil {
			return nil
		}
		orphanFiles = append(orphanFiles, orphan{RelativePath: filepath.ToSlash(relative), Size: info.Size(), ModifiedAt: info.ModTime().UTC().Format(time.RFC3339Nano)})
		orphanBytes += info.Size()
		return nil
	})
	sort.Slice(orphanFiles, func(i, j int) bool { return orphanFiles[i].Size > orphanFiles[j].Size })
	truncated := len(orphanFiles) > 500
	if truncated {
		orphanFiles = orphanFiles[:500]
	}
	writeJSON(w, http.StatusOK, map[string]any{"scannedFiles": scanned, "orphanFiles": len(orphanFiles), "orphanBytes": orphanBytes, "items": orphanFiles, "truncated": truncated})
}

func (s *Server) deleteOrphanFiles(w http.ResponseWriter, r *http.Request) {
	input, ok := decodeMap(w, r)
	if !ok {
		return
	}
	raw, _ := input["relativePaths"].([]any)
	if len(raw) == 0 || len(raw) > 500 {
		writeError(w, http.StatusBadRequest, "请选择 1 至 500 个孤立文件")
		return
	}
	managed, _ := s.store.ListManagedFilePaths()
	managedSet := map[string]bool{}
	for _, value := range managed {
		if absolute, err := filepath.Abs(value); err == nil {
			managedSet[filepath.Clean(absolute)] = true
		}
	}
	root, deleted := filepath.Clean(filepath.Join(s.config.DataDir, "files")), 0
	for _, value := range raw {
		relative := storePathValue(value)
		if relative == "" || filepath.IsAbs(relative) || strings.Contains(filepath.ToSlash(relative), "../") {
			continue
		}
		path := filepath.Clean(filepath.Join(root, filepath.FromSlash(relative)))
		if managedSet[path] || !strings.HasPrefix(path, root+string(filepath.Separator)) {
			continue
		}
		info, err := os.Lstat(path)
		if err != nil || !info.Mode().IsRegular() {
			continue
		}
		if os.Remove(path) == nil {
			deleted++
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"deleted": deleted})
}

func storePathValue(value any) string {
	return strings.Trim(strings.ReplaceAll(fmt.Sprint(value), "\\", "/"), "/")
}

func removeStoredFile(path string) {
	if path != "" {
		_ = os.Remove(path)
	}
}

func decodeJSONList(value string) []any {
	var result []any
	if err := json.Unmarshal([]byte(value), &result); err != nil || result == nil {
		return []any{}
	}
	return result
}

func nullStringPointerValue(value sql.NullString) any {
	if !value.Valid || value.String == "" {
		return nil
	}
	return value.String
}

func randomIDForHTTP() string {
	return fmt.Sprintf("%d", time.Now().UnixNano())
}
