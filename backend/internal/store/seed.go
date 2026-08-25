package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"time"
)

type seededResource struct {
	ID             string
	ParentID       string
	Name           string
	NameEN         string
	ResourceKey    string
	ResourceType   string
	Platform       string
	Path           string
	PermissionCode string
	VisibilityMode string
	SortOrder      int
	GrantDefault   bool
}

// The seed is intentionally kept in Go so a fresh installation and a legacy
// Legacy-created databases receive the same permission surface.
var foundationResources = []seededResource{
	{ID: "rr-web-discover", Name: "发现", NameEN: "Discover", ResourceKey: "web.discover", ResourceType: "menu", Platform: "web", Path: "/app/discover", PermissionCode: "web.route.discover.view", VisibilityMode: "always", GrantDefault: true},
	{ID: "rr-web-root-content", Name: "素材", NameEN: "Assets", ResourceKey: "web.root.content", ResourceType: "directory", Platform: "web", Path: "/app/content", PermissionCode: "web.directory.content", SortOrder: 40},
	{ID: "rr-web.module.chat", Name: "生图", NameEN: "Image", ResourceKey: "web.module.chat", ResourceType: "menu", Platform: "web", Path: "/app/image", PermissionCode: "web.module.chat", SortOrder: 10, GrantDefault: true},
	{ID: "rr-web.module.content.create_video", Name: "视频", NameEN: "Video", ResourceKey: "web.module.content.create_video", ResourceType: "menu", Platform: "web", Path: "/app/content/create_video", PermissionCode: "web.module.content.create_video", SortOrder: 20, GrantDefault: true},
	{ID: "rr-web.module.content.virtual_portrait_assets", ParentID: "rr-web-root-content", Name: "人物素材", NameEN: "Character Assets", ResourceKey: "web.module.content.virtual_portrait_assets", ResourceType: "menu", Platform: "web", Path: "/app/content/virtual_portrait_assets", PermissionCode: "web.module.content.virtual_portrait_assets", SortOrder: 10, GrantDefault: true},
	{ID: "rr-web.module.content.ai_voice", ParentID: "rr-web-root-content", Name: "人声素材", NameEN: "Voice Assets", ResourceKey: "web.module.content.ai_voice", ResourceType: "menu", Platform: "web", Path: "/app/content/ai_voice", PermissionCode: "web.module.content.ai_voice", SortOrder: 20, GrantDefault: true},
	{ID: "rr-web.module.content.scene_library", ParentID: "rr-web-root-content", Name: "场景素材", NameEN: "Scene Assets", ResourceKey: "web.module.content.scene_library", ResourceType: "menu", Platform: "web", Path: "/app/content/scene_library", PermissionCode: "web.module.content.scene_library", SortOrder: 30, GrantDefault: true},
	{ID: "rr-web.module.content.product_assets", ParentID: "rr-web-root-content", Name: "产品素材", NameEN: "Product Assets", ResourceKey: "web.module.content.product_assets", ResourceType: "menu", Platform: "web", Path: "/app/content/product_assets", PermissionCode: "web.module.content.product_assets", SortOrder: 40, GrantDefault: true},
	{ID: "rr-web.module.content.finished_assets", Name: "作品", NameEN: "Works", ResourceKey: "web.module.content.finished_assets", ResourceType: "menu", Platform: "web", Path: "/app/content/finished_assets", PermissionCode: "web.module.content.finished_assets", SortOrder: 50, GrantDefault: true},
	{ID: "rr-web.module.content.batch_generation", Name: "批量", NameEN: "Batch", ResourceKey: "web.module.content.batch_generation", ResourceType: "menu", Platform: "web", Path: "/app/content/batch-generation", PermissionCode: "web.module.content.batch_generation", SortOrder: 40, GrantDefault: true},
	{ID: "rr-admin-root-users", Name: "用户管理", NameEN: "User Management", ResourceKey: "admin.root.users", ResourceType: "directory", Platform: "admin", Path: "/users", PermissionCode: "admin.directory.users", SortOrder: 10},
	{ID: "rr-admin-users-accounts", ParentID: "rr-admin-root-users", Name: "账号管理", NameEN: "Account Management", ResourceKey: "admin.users.accounts", ResourceType: "menu", Platform: "admin", Path: "/users/accounts", PermissionCode: "admin.route.users.accounts.view", SortOrder: 20},
	{ID: "rr-admin-users-roles", ParentID: "rr-admin-root-users", Name: "角色管理", NameEN: "Role Management", ResourceKey: "admin.users.roles", ResourceType: "menu", Platform: "admin", Path: "/users/roles", PermissionCode: "admin.route.users.roles.view", SortOrder: 30},
	{ID: "rr-admin-all-works", Name: "全部作品", NameEN: "All Works", ResourceKey: "admin.all_works", ResourceType: "menu", Platform: "admin", Path: "/works", PermissionCode: "admin.route.all_works.view", SortOrder: 35},
	{ID: "rr-admin-discover", Name: "发现", NameEN: "Discover", ResourceKey: "admin.discover", ResourceType: "menu", Platform: "admin", Path: "/discover", PermissionCode: "admin.route.discover.view", SortOrder: 37},
	{ID: "rr-admin-system-billing", Name: "积分设置", NameEN: "Credit Settings", ResourceKey: "admin.system.billing", ResourceType: "menu", Platform: "admin", Path: "/billing", PermissionCode: "admin.route.system.billing.view", SortOrder: 40},
	{ID: "rr-admin-system-models", Name: "模型配置", NameEN: "Model Configuration", ResourceKey: "admin.system.models", ResourceType: "menu", Platform: "admin", Path: "/models", PermissionCode: "admin.route.system.models.view", SortOrder: 50},
	{ID: "rr-admin-system-route-resources", Name: "路由管理", NameEN: "Route Management", ResourceKey: "admin.system.route_resources", ResourceType: "menu", Platform: "admin", Path: "/system/routes", PermissionCode: "admin.route.system.route_resources.view", SortOrder: 60},
	{ID: "rr-admin-system-file-management", Name: "文件管理", NameEN: "File Management", ResourceKey: "admin.system.file_management", ResourceType: "menu", Platform: "admin", Path: "/system/files", PermissionCode: "admin.route.system.file_management.view", SortOrder: 70},
	{ID: "rr-admin-system-temporary-assets", Name: "临时素材清理", NameEN: "Temporary Asset Cleanup", ResourceKey: "admin.system.temporary_assets", ResourceType: "menu", Platform: "admin", Path: "/system/temporary-assets", PermissionCode: "admin.route.system.temporary_assets.view", SortOrder: 80},
	{ID: "rr-admin-system-settings", Name: "系统设置", NameEN: "System Settings", ResourceKey: "admin.system.settings", ResourceType: "menu", Platform: "admin", Path: "/system/settings", PermissionCode: "admin.route.system.settings.view", SortOrder: 90},
	{ID: "rr-admin-system-access-logs", Name: "站点访问日志", NameEN: "Site Access Logs", ResourceKey: "admin.system.access_logs", ResourceType: "menu", Platform: "admin", Path: "/system/access-logs", PermissionCode: "admin.route.system.access_logs.view", SortOrder: 100},
	{ID: "rr-admin-system-about", Name: "关于我们", NameEN: "About", ResourceKey: "admin.system.about", ResourceType: "menu", Platform: "admin", Path: "/system/about", PermissionCode: "admin.route.system.about.view", SortOrder: 110},
}

type seededModel struct {
	ID, Type, Name, Provider, Model, BaseURL string
	Temperature                              float64
	Settings                                 map[string]any
	IsDefault                                bool
	SortOrder                                int
}

var foundationModels = []seededModel{
	{ID: "default-llm", Type: "llm", Name: "默认 LLM 模型", Provider: "openai", Model: "gpt-4.1-mini", BaseURL: "https://api.openai.com/v1", Temperature: 0.7, Settings: map[string]any{"billing": map[string]any{"multiplier": 1, "maxOutputCreditsForReserve": 0}}, IsDefault: true},
	{ID: "default-image", Type: "image", Name: "默认图片模型", Provider: "volcengine-seedream", Model: "doubao-seedream-5-0-lite-260128", BaseURL: "https://ark.cn-beijing.volces.com/api/v3", Temperature: 0.7, Settings: map[string]any{"imageGeneration": map[string]any{"adapter": "volcengine-seedream"}, "billing": map[string]any{"creditsPerRequest": 0, "priceSource": "official-manual"}}, IsDefault: true},
	{ID: "openai-image", Type: "image", Name: "OpenAI Images", Provider: "openai-images", Model: "gpt-image-1", BaseURL: "https://api.openai.com/v1", Temperature: 0.7, SortOrder: 1, Settings: map[string]any{"imageSize": "1024x1024", "imageGeneration": map[string]any{"adapter": "compatible"}, "billing": map[string]any{"creditsPerRequest": 0, "priceSource": "official-manual"}}},
}

var foundationLLMMetadata = []LlmModelPricing{
	{ID: "openai:gpt-5.6-sol", Provider: "openai", ProviderName: "OpenAI", Model: "gpt-5.6-sol", DisplayName: "GPT-5.6 Sol", DefaultBaseURL: "https://api.openai.com/v1", Currency: "USD", InputPricePer1M: 4, OutputPricePer1M: 20, CachedInputPricePer1M: 0.4, ContextWindowTokens: 272000, EffectiveWindowPercent: 95, PriceSource: "openai-official", PriceUpdatedAt: "2026-08-25"},
	{ID: "openai:gpt-4.1-mini", Provider: "openai", ProviderName: "OpenAI", Model: "gpt-4.1-mini", DisplayName: "GPT-4.1 Mini", DefaultBaseURL: "https://api.openai.com/v1", Currency: "USD", InputPricePer1M: 0.4, OutputPricePer1M: 1.6, CachedInputPricePer1M: 0.1, ContextWindowTokens: 1047576, EffectiveWindowPercent: 95, PriceSource: "openai-official", PriceUpdatedAt: "2026-08-25"},
	{ID: "openai:gpt-4.1", Provider: "openai", ProviderName: "OpenAI", Model: "gpt-4.1", DisplayName: "GPT-4.1", DefaultBaseURL: "https://api.openai.com/v1", Currency: "USD", InputPricePer1M: 2, OutputPricePer1M: 8, CachedInputPricePer1M: 0.5, ContextWindowTokens: 1047576, EffectiveWindowPercent: 95, PriceSource: "openai-official", PriceUpdatedAt: "2026-08-25"},
	{ID: "openai:gpt-4o", Provider: "openai", ProviderName: "OpenAI", Model: "gpt-4o", DisplayName: "GPT-4o", DefaultBaseURL: "https://api.openai.com/v1", Currency: "USD", InputPricePer1M: 2.5, OutputPricePer1M: 10, CachedInputPricePer1M: 1.25, ContextWindowTokens: 128000, EffectiveWindowPercent: 95, PriceSource: "openai-official", PriceUpdatedAt: "2026-08-25"},
}

func migrateFoundationSeed(db *sql.DB) error {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := db.Exec(`
INSERT OR IGNORE INTO roles (id, key, name, description, is_system, is_default, created_at, updated_at)
VALUES ('role-default-full-access', 'default-full-access', '默认全量权限', '当前全部 web 权限。', 1, 0, ?, ?),
       ('role-default-onboarding', 'default-onboarding', '默认入门权限', '新注册非管理员默认角色，仅保留账号访问，不授予业务功能权限。', 1, 1, ?, ?)`, now, now, now, now); err != nil {
		return fmt.Errorf("seed default roles: %w", err)
	}

	insertResource := `INSERT OR IGNORE INTO route_resources (
	id, parent_id, name, name_en, resource_key, resource_type, platform, path, permission_code,
	visibility_mode, status, sort_order, is_system, created_at, updated_at)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 1, ?, ?)`
	for _, resource := range foundationResources {
		visibility := resource.VisibilityMode
		if visibility == "" {
			visibility = "permission"
		}
		if _, err := db.Exec(insertResource, resource.ID, nullable(resource.ParentID), resource.Name, resource.NameEN, resource.ResourceKey, resource.ResourceType, resource.Platform, resource.Path, resource.PermissionCode, visibility, resource.SortOrder, now, now); err != nil {
			return fmt.Errorf("seed route resource %s: %w", resource.ID, err)
		}
		if _, err := db.Exec(`UPDATE route_resources SET name_en = ? WHERE id = ? AND TRIM(COALESCE(name_en, '')) = ''`, resource.NameEN, resource.ID); err != nil {
			return fmt.Errorf("backfill route resource translation %s: %w", resource.ID, err)
		}
	}
	if _, err := db.Exec(`UPDATE route_resources SET name_en = 'Image' WHERE id = 'rr-web.module.chat' AND name_en = 'Image Creation'`); err != nil {
		return fmt.Errorf("update default image route translation: %w", err)
	}
	if _, err := db.Exec(`UPDATE route_resources SET name_en = 'Video' WHERE id = 'rr-web.module.content.create_video' AND name_en = 'Video Creation'`); err != nil {
		return fmt.Errorf("update default video route translation: %w", err)
	}
	if _, err := db.Exec(`UPDATE route_resources SET name = '生图' WHERE id = 'rr-web.module.chat' AND name = '图片创作'`); err != nil {
		return fmt.Errorf("update default image route name: %w", err)
	}
	if _, err := db.Exec(`UPDATE route_resources SET name = '视频' WHERE id = 'rr-web.module.content.create_video' AND name = '视频创作'`); err != nil {
		return fmt.Errorf("update default video route name: %w", err)
	}

	categoryTranslations := []struct {
		name   string
		nameEN string
	}{
		{name: "口播", nameEN: "Talking Head"},
		{name: "女装", nameEN: "Women's Fashion"},
	}
	for _, category := range categoryTranslations {
		if _, err := db.Exec(`UPDATE discover_categories SET name_en = ? WHERE name = ? AND TRIM(COALESCE(name_en, '')) = ''`, category.nameEN, category.name); err != nil {
			return fmt.Errorf("backfill discover category translation %s: %w", category.name, err)
		}
	}

	for _, resource := range foundationResources {
		if !resource.GrantDefault {
			continue
		}
		if _, err := db.Exec(`INSERT OR IGNORE INTO role_resource_permissions (role_id, resource_id, created_at) VALUES ('role-default-full-access', ?, ?)`, resource.ID, now); err != nil {
			return fmt.Errorf("seed default role grant %s: %w", resource.ID, err)
		}
	}
	if _, err := db.Exec(`
INSERT OR IGNORE INTO role_resource_permissions (role_id, resource_id, created_at)
SELECT 'role-default-full-access', id, ? FROM route_resources`, now); err != nil {
		return fmt.Errorf("seed admin route grants: %w", err)
	}
	if _, err := db.Exec(`INSERT OR IGNORE INTO user_role_assignments (user_id, role_id, created_at)
SELECT id, role_id, COALESCE(created_at, ?) FROM users WHERE role_id IS NOT NULL AND role_id != ''`, now); err != nil {
		return fmt.Errorf("migrate legacy role assignments: %w", err)
	}

	for _, model := range foundationModels {
		settings, err := json.Marshal(model.Settings)
		if err != nil {
			return fmt.Errorf("encode model settings: %w", err)
		}
		if _, err := db.Exec(`INSERT OR IGNORE INTO model_configs (
id, type, name, provider, model, api_key, base_url, temperature, settings, is_default, sort_order, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?)`, model.ID, model.Type, model.Name, model.Provider, model.Model, model.BaseURL, model.Temperature, string(settings), boolInt(model.IsDefault), model.SortOrder, now, now); err != nil {
			return fmt.Errorf("seed model %s: %w", model.ID, err)
		}
	}

	for _, metadata := range foundationLLMMetadata {
		if metadata.DisplayName != "" {
			if _, err := db.Exec(`INSERT OR IGNORE INTO llm_model_pricing (id, provider, provider_name, model, display_name, default_base_url, currency, input_price_per_1m, output_price_per_1m, cached_input_price_per_1m, context_window_tokens, effective_context_window_percent, price_source, price_updated_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, metadata.ID, metadata.Provider, metadata.ProviderName, metadata.Model, metadata.DisplayName, metadata.DefaultBaseURL, metadata.Currency, metadata.InputPricePer1M, metadata.OutputPricePer1M, metadata.CachedInputPricePer1M, metadata.ContextWindowTokens, metadata.EffectiveWindowPercent, metadata.PriceSource, metadata.PriceUpdatedAt, now, now); err != nil {
				return fmt.Errorf("seed LLM metadata %s: %w", metadata.ID, err)
			}
		}
		if _, err := db.Exec(`UPDATE llm_model_pricing SET context_window_tokens = ?, effective_context_window_percent = ? WHERE id = ? AND context_window_tokens = 0`, metadata.ContextWindowTokens, metadata.EffectiveWindowPercent, metadata.ID); err != nil {
			return fmt.Errorf("backfill LLM metadata %s: %w", metadata.ID, err)
		}
	}

	if _, err := db.Exec(`INSERT OR IGNORE INTO billing_settings (id, enabled, created_at, updated_at) VALUES (1, 1, ?, ?)`, now, now); err != nil {
		return fmt.Errorf("seed billing settings: %w", err)
	}
	if _, err := db.Exec(`INSERT OR IGNORE INTO batch_request_settings (id, max_count, max_duration_seconds, max_file_size_mb, updated_at) VALUES ('default', 20, 300, 100, ?)`, now); err != nil {
		return fmt.Errorf("seed batch settings: %w", err)
	}
	if _, err := db.Exec(`INSERT OR IGNORE INTO file_storage_settings (id, enabled, key_prefix, updated_at) VALUES ('default', 0, 'app-files', ?)`, now); err != nil {
		return fmt.Errorf("seed file settings: %w", err)
	}
	if _, err := db.Exec(`INSERT OR IGNORE INTO site_access_log_settings (id, retention_days, updated_at) VALUES ('default', 7, ?)`, now); err != nil {
		return fmt.Errorf("seed access log settings: %w", err)
	}
	if _, err := db.Exec(`INSERT OR IGNORE INTO temporary_asset_settings (id, retention_hours, cleanup_interval_minutes, updated_at) VALUES ('default', 24, 60, ?)`, now); err != nil {
		return fmt.Errorf("seed temporary asset settings: %w", err)
	}
	if _, err := db.Exec(`INSERT OR IGNORE INTO agents (id, name, description, icon, built_in, capabilities, run_mode, system_prompt, tools, skills, retrieval_strategy, web_search_enabled, multimodal, created_at)
VALUES ('quick-answer', '快速问答', '适合直接向模型提问，快速获得结构化答案。', 'chat', 1, '["chat","fileUpload","mention"]', 'quick', '你是一个高效、准确的 AI 助手，回答要简洁清楚。', '[]', '["通用问答"]', 'semantic', 1, '{"imageUpload":false,"fileUpload":true}', ?),
       ('reasoning', '智能推理', '适合复杂任务拆解、策略推演和多步骤分析。', 'cube', 1, '["chat","reasoning","fileUpload","mention"]', 'reasoning', '你是一个擅长推理和拆解复杂问题的智能体。', '["任务拆解","步骤推理"]', '["复杂问题分析"]', 'hybrid', 0, '{"imageUpload":false,"fileUpload":true}', ?),
       ('data-analyst', '数据分析师', '适合指标分析、表格解释和运营数据洞察。', 'chart', 1, '["chat","analysis","fileUpload"]', 'quick', '你是一个严谨的数据分析师，善于用指标和结论表达。', '["指标解释"]', '["数据洞察"]', 'keyword', 0, '{"imageUpload":false,"fileUpload":true}', ?)`, now, now, now); err != nil {
		return fmt.Errorf("seed agents: %w", err)
	}
	// Keep the built-in quick-answer agent current for databases created by
	// earlier versions, where web search defaulted to disabled.
	if _, err := db.Exec(`UPDATE agents SET web_search_enabled = 1 WHERE id = 'quick-answer' AND built_in = 1`); err != nil {
		return fmt.Errorf("enable quick-answer web search: %w", err)
	}
	return nil
}

func nullable(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}
