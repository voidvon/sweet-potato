package httpapi

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"

	"ai-marketing-go/internal/store"
)

const (
	permissionUsers          = "admin.route.users.accounts.view"
	permissionRoles          = "admin.route.users.roles.view"
	permissionResources      = "admin.route.system.route_resources.view"
	permissionModels         = "admin.route.system.models.view"
	permissionBilling        = "admin.route.system.billing.view"
	permissionSettings       = "admin.route.system.settings.view"
	permissionAccessLogs     = "admin.route.system.access_logs.view"
	permissionFileManagement = "admin.route.system.file_management.view"
)

func (s *Server) requireUser(w http.ResponseWriter, r *http.Request, permissions ...string) (store.User, bool) {
	user, ok := s.authenticatedUser(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "请先登录")
		return store.User{}, false
	}
	if len(permissions) == 0 || user.Role == "admin" {
		return user, true
	}
	for _, permission := range permissions {
		for _, granted := range user.Permissions {
			if granted == permission {
				return user, true
			}
		}
	}
	writeError(w, http.StatusForbidden, "当前账号无权访问该功能")
	return store.User{}, false
}

func (s *Server) handleListUsers(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireUser(w, r, permissionUsers); !ok {
		return
	}
	users, err := s.store.ListUsers(r.URL.Query().Get("username"), r.URL.Query().Get("sortBy"), r.URL.Query().Get("sortOrder"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "用户列表读取失败")
		return
	}
	writeJSON(w, http.StatusOK, users)
}

func (s *Server) handleUpdateProfile(w http.ResponseWriter, r *http.Request) {
	current, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	if current.ID != r.PathValue("id") {
		writeError(w, http.StatusForbidden, "无权修改该用户")
		return
	}
	var input struct {
		DisplayName string `json:"displayName"`
		AvatarURL   string `json:"avatarUrl"`
	}
	if !decodeJSONBody(w, r, &input) {
		return
	}
	input.DisplayName = strings.TrimSpace(input.DisplayName)
	if len([]rune(input.DisplayName)) < 2 {
		writeError(w, http.StatusBadRequest, "用户名至少 2 位")
		return
	}
	user, err := s.store.UpdateProfile(current.ID, input.DisplayName, strings.TrimSpace(input.AvatarURL))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "用户资料更新失败")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": store.PublicUser(user)})
}

func (s *Server) handleUpdatePassword(w http.ResponseWriter, r *http.Request) {
	current, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	if current.ID != r.PathValue("id") {
		writeError(w, http.StatusForbidden, "无权修改该用户")
		return
	}
	var input struct {
		CurrentPassword string `json:"currentPassword"`
		NextPassword    string `json:"nextPassword"`
	}
	if !decodeJSONBody(w, r, &input) {
		return
	}
	if !store.VerifyPassword(input.CurrentPassword, current) {
		writeError(w, http.StatusUnauthorized, "当前密码不正确")
		return
	}
	if len([]rune(input.NextPassword)) < 6 {
		writeError(w, http.StatusBadRequest, "新密码至少 6 位")
		return
	}
	if err := s.store.UpdatePassword(current.ID, input.NextPassword); err != nil {
		writeError(w, http.StatusInternalServerError, "密码更新失败")
		return
	}
	updated, found, err := s.store.FindUserByID(current.ID)
	if err != nil || !found {
		writeError(w, http.StatusInternalServerError, "用户读取失败")
		return
	}
	s.setAuthCookie(w, r, s.tokens.Create(updated.ID, updated.Role, updated.AuthVersion))
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleAdminPassword(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireUser(w, r, permissionUsers); !ok {
		return
	}
	target, found, err := s.store.FindUserByID(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "用户读取失败")
		return
	}
	if !found {
		writeError(w, http.StatusNotFound, "用户不存在")
		return
	}
	if target.Role == "admin" {
		writeError(w, http.StatusBadRequest, "管理员账号不支持修改密码")
		return
	}
	var input struct {
		NextPassword string `json:"nextPassword"`
	}
	if !decodeJSONBody(w, r, &input) {
		return
	}
	if len([]rune(input.NextPassword)) < 6 {
		writeError(w, http.StatusBadRequest, "新密码至少 6 位")
		return
	}
	if err := s.store.UpdatePassword(target.ID, input.NextPassword); err != nil {
		writeError(w, http.StatusInternalServerError, "密码更新失败")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleAdjustCredits(w http.ResponseWriter, r *http.Request) {
	operator, ok := s.requireUser(w, r, permissionUsers)
	if !ok {
		return
	}
	target, found, err := s.store.FindUserByID(r.PathValue("id"))
	if err != nil || !found {
		writeError(w, http.StatusNotFound, "用户不存在")
		return
	}
	var input struct {
		Delta json.Number `json:"delta"`
	}
	if !decodeJSONBody(w, r, &input) {
		return
	}
	delta, err := input.Delta.Float64()
	if err != nil || !isFinite(delta) || delta == 0 {
		writeError(w, http.StatusBadRequest, "请输入有效的积分变动值")
		return
	}
	updated, err := s.store.AdjustCredits(target.ID, operator.ID, delta)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": managedUserPayload(updated, s.store)})
}

func (s *Server) handleBlacklist(w http.ResponseWriter, r *http.Request) {
	current, ok := s.requireUser(w, r, permissionUsers)
	if !ok {
		return
	}
	target, found, err := s.store.FindUserByID(r.PathValue("id"))
	if err != nil || !found {
		writeError(w, http.StatusNotFound, "用户不存在")
		return
	}
	if current.ID == target.ID {
		writeError(w, http.StatusBadRequest, "不能拉黑自己")
		return
	}
	var input struct {
		IsBlacklisted bool `json:"isBlacklisted"`
	}
	if !decodeJSONBody(w, r, &input) {
		return
	}
	if input.IsBlacklisted && target.Role == "admin" {
		count, err := s.store.CountActiveAdmins()
		if err != nil {
			writeError(w, http.StatusInternalServerError, "管理员数量读取失败")
			return
		}
		if count <= 1 {
			writeError(w, http.StatusBadRequest, "至少保留一个未拉黑的管理员")
			return
		}
	}
	if err := s.store.UpdateBlacklist(target.ID, input.IsBlacklisted); err != nil {
		writeError(w, http.StatusInternalServerError, "黑名单更新失败")
		return
	}
	updated, _, _ := s.store.FindUserByID(target.ID)
	writeJSON(w, http.StatusOK, map[string]any{"user": managedUserPayload(updated, s.store)})
}

func (s *Server) handleRoleAssignment(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireUser(w, r, permissionUsers); !ok {
		return
	}
	var input struct {
		RoleIDs []string `json:"roleIds"`
	}
	if !decodeJSONBody(w, r, &input) {
		return
	}
	updated, _, err := s.store.AssignUserRoles(r.PathValue("id"), input.RoleIDs)
	if err != nil {
		status := http.StatusBadRequest
		if errors.Is(err, sql.ErrNoRows) {
			status = http.StatusNotFound
		}
		writeError(w, status, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": managedUserPayload(updated, s.store), "assignedRoles": updated.AssignedRoles})
}

func managedUserPayload(user store.User, dataStore *store.Store) store.ManagedUser {
	// The totals are only used by admin tables. A failed summary should not make
	// a successful user mutation unusable, so leave them at zero here.
	roleIDs := user.RoleIDs
	if roleIDs == nil {
		roleIDs = []string{}
	}
	assignedRoles := user.AssignedRoles
	if assignedRoles == nil {
		assignedRoles = []store.RoleSummary{}
	}
	permissions := user.Permissions
	if permissions == nil {
		permissions = []string{}
	}
	return store.ManagedUser{
		ID: user.ID, Username: user.Username, DisplayName: user.DisplayName, Role: user.Role,
		RoleIDs: roleIDs, AssignedRoles: assignedRoles, Permissions: permissions,
		IsBlacklisted: user.IsBlacklisted, CreditBalance: user.CreditBalance, CreatedAt: user.CreatedAt,
		LastLoginAt: optionalTime(user.LastLoginAt),
	}
}

func optionalTime(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

func (s *Server) handleListRoles(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireUser(w, r, permissionRoles); !ok {
		return
	}
	roles, err := s.store.ListRoles()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "角色列表读取失败")
		return
	}
	writeJSON(w, http.StatusOK, roles)
}

func (s *Server) handleCreateRole(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireUser(w, r, permissionRoles); !ok {
		return
	}
	input, ok := decodeMap(w, r)
	if !ok {
		return
	}
	role, err := s.store.CreateRole(stringValue(input, "name"), stringValue(input, "description"), stringSlice(input["resourceIds"]), boolValue(input["isDefault"]))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"role": role})
}

func (s *Server) handleUpdateRole(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireUser(w, r, permissionRoles); !ok {
		return
	}
	input, ok := decodeMap(w, r)
	if !ok {
		return
	}
	role, _, err := s.store.UpdateRole(r.PathValue("id"), stringValue(input, "name"), stringValue(input, "description"), stringSlice(input["resourceIds"]), boolValue(input["isDefault"]))
	if err != nil {
		status := http.StatusBadRequest
		if err.Error() == "角色不存在" {
			status = http.StatusNotFound
		}
		writeError(w, status, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"role": role})
}

func (s *Server) handleDeleteRole(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireUser(w, r, permissionRoles); !ok {
		return
	}
	if err := s.store.DeleteRole(r.PathValue("id")); err != nil {
		status := http.StatusBadRequest
		if err.Error() == "角色不存在" {
			status = http.StatusNotFound
		}
		writeError(w, status, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleRoleResourceTree(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireUser(w, r, permissionRoles); !ok {
		return
	}
	tree, err := s.store.ListRouteResourceTree(false, validPlatform(r.URL.Query().Get("platform")))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "资源树读取失败")
		return
	}
	writeJSON(w, http.StatusOK, tree)
}

func (s *Server) handlePublicRouteTree(w http.ResponseWriter, r *http.Request) {
	// This endpoint is consumed by the public Web shell. Never allow callers to
	// switch it to the admin platform through a query parameter.
	tree, err := s.store.ListRouteResourceTree(false, "web")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "资源树读取失败")
		return
	}
	language := setLocalizedResponseHeaders(w)
	writeJSON(w, http.StatusOK, publicRouteResources(tree, language))
}

type publicRouteResource struct {
	ID             string                `json:"id"`
	ParentID       *string               `json:"parentId"`
	Name           string                `json:"name"`
	ResourceKey    string                `json:"resourceKey"`
	ResourceType   string                `json:"resourceType"`
	Platform       string                `json:"platform"`
	Path           string                `json:"path"`
	PermissionCode string                `json:"permissionCode"`
	VisibilityMode string                `json:"visibilityMode"`
	Status         bool                  `json:"status"`
	SortOrder      int                   `json:"sortOrder"`
	IsSystem       bool                  `json:"isSystem"`
	CreatedAt      string                `json:"createdAt"`
	UpdatedAt      string                `json:"updatedAt"`
	Children       []publicRouteResource `json:"children,omitempty"`
}

func publicRouteResources(resources []store.RouteResource, language string) []publicRouteResource {
	result := make([]publicRouteResource, 0, len(resources))
	for _, resource := range resources {
		name := resource.Name
		if language == languageEnglish && strings.TrimSpace(resource.NameEN) != "" {
			name = resource.NameEN
		}
		result = append(result, publicRouteResource{
			ID: resource.ID, ParentID: resource.ParentID, Name: name, ResourceKey: resource.ResourceKey,
			ResourceType: resource.ResourceType, Platform: resource.Platform, Path: resource.Path,
			PermissionCode: resource.PermissionCode, VisibilityMode: resource.VisibilityMode,
			Status: resource.Status, SortOrder: resource.SortOrder, IsSystem: resource.IsSystem,
			CreatedAt: resource.CreatedAt, UpdatedAt: resource.UpdatedAt,
			Children: publicRouteResources(resource.Children, language),
		})
	}
	return result
}

func (s *Server) handleListRouteResources(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireUser(w, r, permissionResources); !ok {
		return
	}
	resources, err := s.store.ListRouteResources(boolQuery(r, "includeDisabled"), validPlatform(r.URL.Query().Get("platform")))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "路由资源读取失败")
		return
	}
	writeJSON(w, http.StatusOK, resources)
}

func (s *Server) handleRouteResourceTree(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireUser(w, r, permissionResources); !ok {
		return
	}
	tree, err := s.store.ListRouteResourceTree(boolQuery(r, "includeDisabled"), validPlatform(r.URL.Query().Get("platform")))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "路由资源树读取失败")
		return
	}
	writeJSON(w, http.StatusOK, tree)
}

func (s *Server) handleFindRouteResource(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireUser(w, r, permissionResources); !ok {
		return
	}
	resource, found, err := s.store.FindRouteResource(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "资源读取失败")
		return
	}
	if !found {
		writeError(w, http.StatusNotFound, "资源不存在")
		return
	}
	writeJSON(w, http.StatusOK, resource)
}

func (s *Server) handleCreateRouteResource(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireUser(w, r, permissionResources); !ok {
		return
	}
	input, ok := decodeMap(w, r)
	if !ok {
		return
	}
	resource, err := s.store.SaveRouteResource("", input)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"resource": resource})
}

func (s *Server) handleUpdateRouteResource(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireUser(w, r, permissionResources); !ok {
		return
	}
	input, ok := decodeMap(w, r)
	if !ok {
		return
	}
	resource, err := s.store.SaveRouteResource(r.PathValue("id"), input)
	if err != nil {
		status := http.StatusBadRequest
		if err.Error() == "资源不存在" {
			status = http.StatusNotFound
		}
		writeError(w, status, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"resource": resource})
}

func (s *Server) handleDeleteRouteResource(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireUser(w, r, permissionResources); !ok {
		return
	}
	if err := s.store.DeleteRouteResource(r.PathValue("id")); err != nil {
		status := http.StatusBadRequest
		if err.Error() == "资源不存在" {
			status = http.StatusNotFound
		}
		writeError(w, status, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleListModelConfigs(w http.ResponseWriter, r *http.Request) {
	typeName := strings.TrimSpace(r.URL.Query().Get("type"))
	if typeName == "image" {
		if _, ok := s.requireUser(w, r, "admin.route.system.models.view", "web.module.chat"); !ok {
			return
		}
	} else if _, ok := s.requireUser(w, r, permissionModels); !ok {
		return
	}
	models, err := s.store.ListModelConfigs(typeName)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "模型配置读取失败")
		return
	}
	user, _ := s.authenticatedUser(r)
	if user.Role != "admin" && typeName == "image" {
		result := make([]map[string]any, 0, len(models))
		for _, model := range models {
			result = append(result, redactModelConfig(model))
		}
		writeJSON(w, http.StatusOK, result)
		return
	}
	writeJSON(w, http.StatusOK, redactModelConfigs(models))
}

func (s *Server) handleAIModelConfig(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireUser(w, r, permissionModels); !ok {
		return
	}
	models, err := s.store.ListModelConfigs("llm")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "模型配置读取失败")
		return
	}
	if r.Method == http.MethodGet {
		if len(models) == 0 {
			writeJSON(w, http.StatusOK, redactModelConfig(defaultLLMModel()))
			return
		}
		for _, model := range models {
			if model.IsDefault {
				writeJSON(w, http.StatusOK, redactModelConfig(model))
				return
			}
		}
		writeJSON(w, http.StatusOK, redactModelConfig(models[0]))
		return
	}
	input, ok := decodeMap(w, r)
	if !ok {
		return
	}
	var current store.ModelConfig
	if len(models) > 0 {
		current = models[0]
	}
	model := mergeModelInput(current, input)
	model.Type, model.IsDefault = "llm", true
	if model.Name == "" {
		model.Name = "默认 LLM 模型"
	}
	result, err := s.store.SaveModelConfig(model, current.ID == "")
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, redactModelConfig(result))
}

func (s *Server) handleModelProviders(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	if strings.HasSuffix(path, "/video-providers") {
		if _, ok := s.requireUser(w, r, permissionModels, "web.module.content.batch_generation"); !ok {
			return
		}
		writeJSON(w, http.StatusOK, videoProviders())
		return
	}
	if _, ok := s.requireUser(w, r, permissionModels); !ok {
		return
	}
	if strings.HasSuffix(path, "/audio-providers") {
		writeJSON(w, http.StatusOK, audioProviders())
		return
	}
	writeJSON(w, http.StatusOK, imageProviders())
}

func (s *Server) handleModelConfigSubtree(w http.ResponseWriter, r *http.Request) {
	relative := strings.TrimPrefix(strings.TrimPrefix(r.URL.Path, "/api/model-configs/"), "/")
	switch {
	case relative == "audio-providers" || relative == "image-providers" || relative == "video-providers":
		s.handleModelProviders(w, r)
	case relative == "llm-model-pricing":
		s.handleModelPricing(w, r)
	case strings.HasPrefix(relative, "llm-model-pricing/") && r.Method == http.MethodDelete:
		s.handleDeletePricing(w, r)
	case strings.HasPrefix(relative, "llm-model-pricing/"):
		s.handleModelPricing(w, r)
	case relative == "order":
		s.handleModelConfigMutation(w, r)
	default:
		s.handleModelConfigMutation(w, r)
	}
}

func (s *Server) handleModelPricing(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireUser(w, r, permissionModels); !ok {
		return
	}
	if r.Method == http.MethodGet {
		items, err := s.store.ListPricing()
		if err != nil {
			writeError(w, http.StatusInternalServerError, "模型价格读取失败")
			return
		}
		writeJSON(w, http.StatusOK, items)
		return
	}
	input, ok := decodeMap(w, r)
	if !ok {
		return
	}
	item := pricingInput(input)
	id := r.PathValue("id")
	if id == "" {
		relative := strings.TrimPrefix(strings.TrimPrefix(r.URL.Path, "/api/model-configs/llm-model-pricing"), "/")
		id = strings.TrimSpace(relative)
	}
	insert := id == ""
	if !insert {
		item.ID = id
	}
	result, err := s.store.SavePricing(item, insert)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	status := http.StatusOK
	if insert {
		status = http.StatusCreated
	}
	writeJSON(w, status, result)
}

func (s *Server) handleDeletePricing(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireUser(w, r, permissionModels); !ok {
		return
	}
	id := r.PathValue("id")
	if id == "" {
		id = strings.TrimPrefix(strings.TrimPrefix(r.URL.Path, "/api/model-configs/llm-model-pricing"), "/")
	}
	if err := s.store.DeletePricing(id); err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleModelConfigMutation(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireUser(w, r, permissionModels); !ok {
		return
	}
	id := r.PathValue("id")
	if id == "" {
		relative := strings.TrimPrefix(strings.TrimPrefix(r.URL.Path, "/api/model-configs/"), "/")
		id = strings.TrimSuffix(relative, "/default")
		if id == "order" {
			id = ""
		}
	}
	if r.Method == http.MethodDelete {
		if err := s.store.DeleteModelConfig(id); err != nil {
			writeError(w, http.StatusNotFound, err.Error())
			return
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if strings.HasSuffix(r.URL.Path, "/default") {
		model, found, err := s.store.FindModelConfig(id)
		if err != nil || !found {
			writeError(w, http.StatusNotFound, "模型配置不存在")
			return
		}
		model.IsDefault = true
		result, err := s.store.SaveModelConfig(model, false)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, redactModelConfig(result))
		return
	}
	if strings.HasSuffix(r.URL.Path, "/order") {
		input, ok := decodeMap(w, r)
		if !ok {
			return
		}
		typeName := stringValue(input, "type")
		ids := stringSlice(input["orderedIds"])
		models, err := s.store.ListModelConfigs(typeName)
		if err != nil || len(models) != len(ids) {
			writeError(w, http.StatusBadRequest, "排序列表与当前模型配置不一致，请刷新后重试")
			return
		}
		if err := s.store.ReorderModelConfigs(typeName, ids); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		models, _ = s.store.ListModelConfigs(typeName)
		writeJSON(w, http.StatusOK, redactModelConfigs(models))
		return
	}
	input, ok := decodeMap(w, r)
	if !ok {
		return
	}
	current, found, err := s.store.FindModelConfig(id)
	if err != nil || !found {
		writeError(w, http.StatusNotFound, "模型配置不存在")
		return
	}
	result, err := s.store.SaveModelConfig(mergeModelInput(current, input), false)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, redactModelConfig(result))
}

func (s *Server) handleCreateModelConfig(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireUser(w, r, permissionModels); !ok {
		return
	}
	input, ok := decodeMap(w, r)
	if !ok {
		return
	}
	result, err := s.store.SaveModelConfig(mergeModelInput(store.ModelConfig{}, input), true)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, redactModelConfig(result))
}

func (s *Server) handleBilling(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	if strings.HasSuffix(path, "/me/summary") {
		user, ok := s.requireUser(w, r)
		if !ok {
			return
		}
		result, err := s.store.GetCreditSummary(user.ID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "积分摘要读取失败")
			return
		}
		writeJSON(w, http.StatusOK, result)
		return
	}
	if strings.HasSuffix(path, "/me/ledger") {
		user, ok := s.requireUser(w, r)
		if !ok {
			return
		}
		result, err := s.store.ListLedger(user.ID, queryLimit(r))
		if err != nil {
			writeError(w, http.StatusInternalServerError, "积分流水读取失败")
			return
		}
		writeJSON(w, http.StatusOK, result)
		return
	}
	if strings.HasSuffix(path, "/me/usage") || strings.HasSuffix(path, "/me/billable-usage") {
		writeError(w, http.StatusForbidden, "当前账户无权访问明细")
		return
	}
	if _, ok := s.requireUser(w, r, permissionBilling); !ok {
		return
	}
	if strings.HasSuffix(path, "/settings") {
		settings, err := s.store.GetBillingSettings()
		if err != nil {
			writeError(w, http.StatusInternalServerError, "计费配置读取失败")
			return
		}
		if r.Method == http.MethodGet {
			writeJSON(w, http.StatusOK, settings)
			return
		}
		input, ok := decodeMap(w, r)
		if !ok {
			return
		}
		applyBillingMap(&settings, input)
		result, err := s.store.UpdateBillingSettings(settings)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, result)
		return
	}
	userID := r.URL.Query().Get("userId")
	switch {
	case strings.HasSuffix(path, "/ledger"):
		result, err := s.store.ListLedger(userID, queryLimit(r))
		if err != nil {
			writeError(w, http.StatusInternalServerError, "积分流水读取失败")
			return
		}
		writeJSON(w, http.StatusOK, result)
	case strings.HasSuffix(path, "/usage"):
		result, err := s.store.ListUsage(userID, queryLimit(r))
		if err != nil {
			writeError(w, http.StatusInternalServerError, "模型用量读取失败")
			return
		}
		writeJSON(w, http.StatusOK, result)
	case strings.HasSuffix(path, "/billable-usage"):
		result, err := s.store.ListBillableUsage(userID, queryLimit(r))
		if err != nil {
			writeError(w, http.StatusInternalServerError, "业务消费读取失败")
			return
		}
		writeJSON(w, http.StatusOK, result)
	}
}

func (s *Server) handleSiteConfig(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireUser(w, r); !ok {
		return
	}
	settings, err := s.store.GetBillingSettings()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "站点配置读取失败")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"billing": publicBillingMap(settings)})
}

func publicBillingMap(settings store.BillingSettings) map[string]any {
	value := map[string]any{
		"seedance2CreditsPerSecond720p":               settings.Seedance2CreditsPerSecond720p,
		"seedance2CreditsPerSecond480p":               settings.Seedance2CreditsPerSecond480p,
		"seedance2FastCreditsPerSecond720p":           settings.Seedance2FastCreditsPerSecond720p,
		"seedance2FastCreditsPerSecond480p":           settings.Seedance2FastCreditsPerSecond480p,
		"seedance2MiniCreditsPerSecond720p":           settings.Seedance2MiniCreditsPerSecond720p,
		"seedance2MiniCreditsPerSecond480p":           settings.Seedance2MiniCreditsPerSecond480p,
		"videoUploadCreditsPerMb":                     settings.VideoUploadCreditsPerMB,
		"contentPlanningAnalysisCreditsPerRequest":    settings.ContentPlanningAnalysisCredits,
		"contentPlanningGenerationCreditsPerRequest":  settings.ContentPlanningGenerationCredits,
		"talkingVideoPromptCreditsPerRequest":         settings.TalkingVideoPromptCredits,
		"marketingVideoCreditsPerRequest":             settings.MarketingVideoCredits,
		"marketingVideoStoryboardModelConfigId":       settings.MarketingVideoStoryboardModelConfigID,
		"videoUpscaleCreditsPerRequest":               settings.VideoUpscaleCredits,
		"subtitleRemovalCreditsPerSecond":             settings.SubtitleRemovalCreditsPerSecond,
		"videoTranslationSubtitleCreditsPerSecond":    settings.VideoTranslationSubtitleCreditsPerSec,
		"videoTranslationVoiceCreditsPerSecond":       settings.VideoTranslationVoiceCreditsPerSecond,
		"videoTranslationFaceCreditsPerSecond":        settings.VideoTranslationFaceCreditsPerSecond,
		"videoTranslationEraseSourceCreditsPerSecond": settings.VideoTranslationEraseCreditsPerSecond,
		"updatedAt": settings.UpdatedAt,
	}
	return value
}

func decodeJSONBody(w http.ResponseWriter, r *http.Request, target any) bool {
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 20<<20))
	decoder.UseNumber()
	if err := decoder.Decode(target); err != nil {
		writeError(w, http.StatusBadRequest, "请求体格式错误")
		return false
	}
	return true
}

func decodeMap(w http.ResponseWriter, r *http.Request) (map[string]any, bool) {
	var value map[string]any
	if !decodeJSONBody(w, r, &value) {
		return nil, false
	}
	if value == nil {
		value = map[string]any{}
	}
	return value, true
}

func stringValue(input map[string]any, key string) string {
	value, ok := input[key]
	if !ok || value == nil {
		return ""
	}
	return strings.TrimSpace(fmt.Sprint(value))
}

func stringSlice(value any) []string {
	items, ok := value.([]any)
	if !ok {
		if typed, ok := value.([]string); ok {
			return typed
		}
		return nil
	}
	result := make([]string, 0, len(items))
	for _, item := range items {
		if value := strings.TrimSpace(fmt.Sprint(item)); value != "" && value != "<nil>" {
			result = append(result, value)
		}
	}
	return result
}

func boolValue(value any) bool {
	if value == nil {
		return false
	}
	return value == true || fmt.Sprint(value) == "true" || fmt.Sprint(value) == "1"
}

func boolQuery(r *http.Request, key string) bool {
	value := r.URL.Query().Get(key)
	return value == "1" || strings.EqualFold(value, "true")
}

func validPlatform(value string) string {
	if value == "web" || value == "admin" {
		return value
	}
	return ""
}

func queryLimit(r *http.Request) int {
	value, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if value <= 0 {
		return 100
	}
	if value > 1000 {
		return 1000
	}
	return value
}

func isFinite(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0)
}

func mergeModelInput(current store.ModelConfig, input map[string]any) store.ModelConfig {
	result := current
	if value, ok := input["id"]; ok {
		result.ID = stringOr(result.ID, value)
	}
	if value, ok := input["type"]; ok {
		result.Type = stringOr(result.Type, value)
	}
	if value, ok := input["name"]; ok {
		result.Name = stringOr(result.Name, value)
	}
	if value, ok := input["provider"]; ok {
		result.Provider = stringOr(result.Provider, value)
	}
	if value, ok := input["model"]; ok {
		result.Model = stringOr(result.Model, value)
	}
	if value, ok := input["apiKey"]; ok {
		if value := strings.TrimSpace(fmt.Sprint(value)); value != "" {
			result.APIKey = value
		}
	}
	if value, ok := input["baseUrl"]; ok {
		result.BaseURL = stringOr(result.BaseURL, value)
	}
	if value, ok := input["temperature"]; ok {
		result.Temperature = toNumber(value, result.Temperature)
	}
	if value, ok := input["settings"]; ok {
		if settings, ok := value.(map[string]any); ok {
			result.Settings = settings
		}
	}
	if value, ok := input["isDefault"]; ok {
		result.IsDefault = boolValue(value)
	}
	if value, ok := input["sortOrder"]; ok {
		result.SortOrder = int(toNumber(value, float64(result.SortOrder)))
	}
	return result
}

func redactModelConfig(model store.ModelConfig) map[string]any {
	return map[string]any{
		"id": model.ID, "type": model.Type, "name": model.Name, "provider": model.Provider,
		"model": model.Model, "apiKey": "", "isConfigured": strings.TrimSpace(model.APIKey) != "",
		"baseUrl": model.BaseURL, "temperature": model.Temperature, "settings": model.Settings,
		"isDefault": model.IsDefault, "sortOrder": model.SortOrder, "createdAt": model.CreatedAt, "updatedAt": model.UpdatedAt,
	}
}

func redactModelConfigs(models []store.ModelConfig) []map[string]any {
	result := make([]map[string]any, 0, len(models))
	for _, model := range models {
		result = append(result, redactModelConfig(model))
	}
	return result
}

func stringOr(fallback string, value any) string {
	if value == nil {
		return fallback
	}
	return strings.TrimSpace(fmt.Sprint(value))
}

func toNumber(value any, fallback float64) float64 {
	if number, ok := value.(json.Number); ok {
		parsed, err := number.Float64()
		if err == nil {
			return parsed
		}
	}
	if number, ok := value.(float64); ok {
		return number
	}
	parsed, err := strconv.ParseFloat(fmt.Sprint(value), 64)
	if err == nil {
		return parsed
	}
	return fallback
}

func defaultLLMModel() store.ModelConfig {
	return store.ModelConfig{ID: "default-llm", Type: "llm", Name: "默认 LLM 模型", Provider: "openai", Model: "gpt-4.1-mini", BaseURL: "https://api.openai.com/v1", Temperature: 0.7, IsDefault: true, Settings: map[string]any{"billing": map[string]any{"multiplier": 1}}}
}

func pricingInput(input map[string]any) store.LlmModelPricing {
	return store.LlmModelPricing{Provider: stringValue(input, "provider"), ProviderName: stringValue(input, "providerName"), Model: stringValue(input, "model"), DisplayName: stringValue(input, "displayName"), DefaultBaseURL: stringValue(input, "defaultBaseUrl"), Currency: stringValue(input, "currency"), InputPricePer1M: toNumber(input["inputPricePer1M"], 0), OutputPricePer1M: toNumber(input["outputPricePer1M"], 0), CachedInputPricePer1M: toNumber(input["cachedInputPricePer1M"], 0), PriceSource: stringValue(input, "priceSource"), PriceUpdatedAt: stringValue(input, "priceUpdatedAt")}
}

func applyBillingMap(settings *store.BillingSettings, input map[string]any) {
	settings.Enabled = boolValueDefault(input, "enabled", settings.Enabled)
	settings.Seedance2CreditsPerSecond720p = numberDefault(input, "seedance2CreditsPerSecond720p", settings.Seedance2CreditsPerSecond720p)
	settings.Seedance2CreditsPerSecond480p = numberDefault(input, "seedance2CreditsPerSecond480p", settings.Seedance2CreditsPerSecond480p)
	settings.Seedance2FastCreditsPerSecond720p = numberDefault(input, "seedance2FastCreditsPerSecond720p", settings.Seedance2FastCreditsPerSecond720p)
	settings.Seedance2FastCreditsPerSecond480p = numberDefault(input, "seedance2FastCreditsPerSecond480p", settings.Seedance2FastCreditsPerSecond480p)
	settings.Seedance2MiniCreditsPerSecond720p = numberDefault(input, "seedance2MiniCreditsPerSecond720p", settings.Seedance2MiniCreditsPerSecond720p)
	settings.Seedance2MiniCreditsPerSecond480p = numberDefault(input, "seedance2MiniCreditsPerSecond480p", settings.Seedance2MiniCreditsPerSecond480p)
	settings.VideoUploadCreditsPerMB = numberDefault(input, "videoUploadCreditsPerMb", settings.VideoUploadCreditsPerMB)
	settings.ContentPlanningAnalysisCredits = numberDefault(input, "contentPlanningAnalysisCreditsPerRequest", settings.ContentPlanningAnalysisCredits)
	settings.ContentPlanningGenerationCredits = numberDefault(input, "contentPlanningGenerationCreditsPerRequest", settings.ContentPlanningGenerationCredits)
	settings.TalkingVideoPromptCredits = numberDefault(input, "talkingVideoPromptCreditsPerRequest", settings.TalkingVideoPromptCredits)
	settings.MarketingVideoCredits = numberDefault(input, "marketingVideoCreditsPerRequest", settings.MarketingVideoCredits)
	settings.MarketingVideoStoryboardModelConfigID = stringOr(settings.MarketingVideoStoryboardModelConfigID, input["marketingVideoStoryboardModelConfigId"])
	settings.VideoUpscaleCredits = numberDefault(input, "videoUpscaleCreditsPerRequest", settings.VideoUpscaleCredits)
	settings.SubtitleRemovalCreditsPerSecond = numberDefault(input, "subtitleRemovalCreditsPerSecond", settings.SubtitleRemovalCreditsPerSecond)
	settings.VideoTranslationSubtitleCreditsPerSec = numberDefault(input, "videoTranslationSubtitleCreditsPerSecond", settings.VideoTranslationSubtitleCreditsPerSec)
	settings.VideoTranslationVoiceCreditsPerSecond = numberDefault(input, "videoTranslationVoiceCreditsPerSecond", settings.VideoTranslationVoiceCreditsPerSecond)
	settings.VideoTranslationFaceCreditsPerSecond = numberDefault(input, "videoTranslationFaceCreditsPerSecond", settings.VideoTranslationFaceCreditsPerSecond)
	settings.VideoTranslationEraseCreditsPerSecond = numberDefault(input, "videoTranslationEraseSourceCreditsPerSecond", settings.VideoTranslationEraseCreditsPerSecond)
}

func numberDefault(input map[string]any, key string, fallback float64) float64 {
	if value, ok := input[key]; ok {
		return toNumber(value, fallback)
	}
	return fallback
}

func boolValueDefault(input map[string]any, key string, fallback bool) bool {
	if value, ok := input[key]; ok {
		return boolValue(value)
	}
	return fallback
}

func audioProviders() []map[string]any {
	return []map[string]any{{"id": "mimo-tts", "name": "Mimo TTS", "description": "兼容语音合成和音色克隆。", "keyLabel": "API Key", "keyPlaceholder": "输入 API Key", "defaultBaseUrl": "https://api.openai.com/v1", "defaultModel": "mimo-v2-tts"}}
}

func imageProviders() []map[string]any {
	return []map[string]any{{"id": "volcengine-seedream", "name": "火山 Seedream", "description": "火山方舟图片生成。", "keyLabel": "API Key", "keyPlaceholder": "输入 API Key", "defaultBaseUrl": "https://ark.cn-beijing.volces.com/api/v3", "defaultModel": "doubao-seedream-5-0-lite-260128", "models": []map[string]any{{"id": "doubao-seedream-5-0-lite-260128", "name": "Seedream 5.0 Lite"}}}, {"id": "openai-images", "name": "OpenAI Images", "description": "OpenAI 图片生成。", "keyLabel": "API Key", "keyPlaceholder": "输入 API Key", "defaultBaseUrl": "https://api.openai.com/v1", "defaultModel": "gpt-image-1", "models": []map[string]any{{"id": "gpt-image-1", "name": "GPT Image 1"}}}}
}

func videoProviders() []map[string]any {
	return []map[string]any{{"id": "volcengine-seedance", "name": "火山 Seedance", "description": "火山方舟视频生成。", "keyLabel": "API Key", "keyPlaceholder": "输入 API Key", "defaultBaseUrl": "https://ark.cn-beijing.volces.com/api/v3", "defaultModel": "doubao-seedance-2-0-260128", "models": []map[string]any{{"id": "doubao-seedance-2-0-260128", "name": "Seedance 2.0"}, {"id": "doubao-seedance-2-0-fast-260128", "name": "Seedance 2.0 Fast"}, {"id": "doubao-seedance-2-0-mini-260615", "name": "Seedance 2.0 Mini"}}}}
}
