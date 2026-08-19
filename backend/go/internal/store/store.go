package store

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite"
)

var ErrUserAlreadyExists = errors.New("账号已存在")

type User struct {
	ID            string
	Username      string
	DisplayName   string
	AvatarURL     string
	Role          string
	AuthVersion   int
	IsBlacklisted bool
	CreditBalance float64
	PasswordHash  string
	Salt          string
	CreatedAt     string
	LastLoginAt   string
	RoleIDs       []string
	AssignedRoles []RoleSummary
	Permissions   []string
}

type RoleSummary struct {
	ID          string `json:"id"`
	Key         string `json:"key"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	IsSystem    bool   `json:"isSystem"`
	IsDefault   bool   `json:"isDefault"`
}

type Store struct {
	db *sql.DB
}

func Open(dataDir string) (*Store, error) {
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return nil, fmt.Errorf("create data directory: %w", err)
	}
	db, err := sql.Open("sqlite", filepath.Join(dataDir, "app.sqlite"))
	if err != nil {
		return nil, fmt.Errorf("open sqlite database: %w", err)
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;"); err != nil {
		db.Close()
		return nil, fmt.Errorf("configure sqlite database: %w", err)
	}
	if err := migrateFoundation(db); err != nil {
		db.Close()
		return nil, err
	}
	if err := migrateFoundationSeed(db); err != nil {
		db.Close()
		return nil, err
	}
	return &Store{db: db}, nil
}

func (s *Store) Close() error {
	return s.db.Close()
}

func (s *Store) Exec(query string, args ...any) (sql.Result, error) {
	return s.db.Exec(query, args...)
}

func (s *Store) QueryRows(query string, args ...any) (*sql.Rows, error) {
	return s.db.Query(query, args...)
}

func migrateFoundation(db *sql.DB) error {
	if _, err := db.Exec(foundationSchema); err != nil {
		return fmt.Errorf("migrate foundation schema: %w", err)
	}

	legacyColumns := []struct {
		table      string
		column     string
		definition string
	}{
		{"users", "avatar_url", "avatar_url TEXT"},
		{"route_resources", "visibility_mode", "visibility_mode TEXT NOT NULL DEFAULT 'permission'"},
		{"users", "role", "role TEXT NOT NULL DEFAULT 'user'"},
		{"users", "auth_version", "auth_version INTEGER NOT NULL DEFAULT 1"},
		{"users", "role_id", "role_id TEXT"},
		{"users", "is_blacklisted", "is_blacklisted INTEGER NOT NULL DEFAULT 0"},
		{"users", "credit_balance", "credit_balance REAL NOT NULL DEFAULT 0"},
		{"users", "last_login_at", "last_login_at TEXT"},
		{"site_access_logs", "user_id", "user_id TEXT NOT NULL DEFAULT ''"},
		{"site_access_logs", "username", "username TEXT NOT NULL DEFAULT ''"},
		{"billing_settings", "seedance_2_credits_per_second_720p", "seedance_2_credits_per_second_720p REAL NOT NULL DEFAULT 20"},
		{"billing_settings", "seedance_2_credits_per_second_480p", "seedance_2_credits_per_second_480p REAL NOT NULL DEFAULT 12"},
		{"billing_settings", "seedance_2_fast_credits_per_second_720p", "seedance_2_fast_credits_per_second_720p REAL NOT NULL DEFAULT 18"},
		{"billing_settings", "seedance_2_fast_credits_per_second_480p", "seedance_2_fast_credits_per_second_480p REAL NOT NULL DEFAULT 11"},
		{"billing_settings", "seedance_2_mini_credits_per_second_720p", "seedance_2_mini_credits_per_second_720p REAL NOT NULL DEFAULT 15"},
		{"billing_settings", "seedance_2_mini_credits_per_second_480p", "seedance_2_mini_credits_per_second_480p REAL NOT NULL DEFAULT 7"},
		{"billing_settings", "video_upload_credits_per_mb", "video_upload_credits_per_mb REAL NOT NULL DEFAULT 0"},
		{"billing_settings", "video_understanding_credits_per_1m_tokens", "video_understanding_credits_per_1m_tokens REAL NOT NULL DEFAULT 0"},
		{"billing_settings", "content_planning_analysis_credits_per_request", "content_planning_analysis_credits_per_request REAL NOT NULL DEFAULT 2"},
		{"billing_settings", "content_planning_generation_credits_per_request", "content_planning_generation_credits_per_request REAL NOT NULL DEFAULT 3"},
		{"billing_settings", "talking_video_prompt_credits_per_request", "talking_video_prompt_credits_per_request REAL NOT NULL DEFAULT 3"},
		{"billing_settings", "marketing_video_credits_per_request", "marketing_video_credits_per_request REAL NOT NULL DEFAULT 15"},
		{"billing_settings", "marketing_video_storyboard_model_config_id", "marketing_video_storyboard_model_config_id TEXT NOT NULL DEFAULT ''"},
		{"billing_settings", "video_upscale_credits_per_request", "video_upscale_credits_per_request REAL NOT NULL DEFAULT 20"},
		{"billing_settings", "subtitle_removal_credits_per_second", "subtitle_removal_credits_per_second REAL NOT NULL DEFAULT 2"},
		{"billing_settings", "video_translation_subtitle_credits_per_second", "video_translation_subtitle_credits_per_second REAL NOT NULL DEFAULT 1"},
		{"billing_settings", "video_translation_voice_credits_per_second", "video_translation_voice_credits_per_second REAL NOT NULL DEFAULT 2"},
		{"billing_settings", "video_translation_face_credits_per_second", "video_translation_face_credits_per_second REAL NOT NULL DEFAULT 2"},
		{"billing_settings", "video_translation_erase_source_credits_per_second", "video_translation_erase_source_credits_per_second REAL NOT NULL DEFAULT 2"},
		{"marketing_video_storyboards", "additional_prompt", "additional_prompt TEXT NOT NULL DEFAULT ''"},
		{"marketing_video_storyboards", "video_task_id", "video_task_id TEXT"},
		{"llm_usage_records", "credit_base_cost", "credit_base_cost REAL NOT NULL DEFAULT 0"},
		{"llm_usage_records", "credit_billed_cost", "credit_billed_cost REAL NOT NULL DEFAULT 0"},
		{"credit_ledger", "credit_base_cost", "credit_base_cost REAL"},
		{"credit_ledger", "credit_billed_cost", "credit_billed_cost REAL"},
		{"billable_usage_records", "credit_base_cost", "credit_base_cost REAL NOT NULL DEFAULT 0"},
		{"billable_usage_records", "credit_billed_cost", "credit_billed_cost REAL NOT NULL DEFAULT 0"},
		{"chat_messages", "reasoning_content", "reasoning_content TEXT"},
		{"chat_messages", "capability_context", "capability_context TEXT"},
		{"chat_messages", "image_model_config_id", "image_model_config_id TEXT"},
		{"chat_messages", "generation_job_id", "generation_job_id TEXT"},
		{"chat_messages", "image_generation_expected_count", "image_generation_expected_count INTEGER"},
		{"chat_messages", "image_generation_failures", "image_generation_failures TEXT NOT NULL DEFAULT '[]'"},
		{"chat_messages", "actions", "actions TEXT NOT NULL DEFAULT '[]'"},
		{"chat_messages", "is_completed", "is_completed INTEGER NOT NULL DEFAULT 1"},
		{"chat_messages", "attachments", "attachments TEXT NOT NULL DEFAULT '[]'"},
		{"chat_messages", "credit_cost", "credit_cost REAL"},
		{"generation_jobs", "payload", "payload TEXT NOT NULL DEFAULT '{}'"},
		{"generation_jobs", "result", "result TEXT NOT NULL DEFAULT '{}'"},
		{"chat_conversations", "metadata", "metadata TEXT NOT NULL DEFAULT '{}'"},
		{"skill_files", "command", "command TEXT NOT NULL DEFAULT 'skill'"},
		{"skill_files", "category", "category TEXT NOT NULL DEFAULT 'brand_style'"},
		{"skill_files", "scenario", "scenario TEXT NOT NULL DEFAULT ''"},
		{"skill_files", "enabled", "enabled INTEGER NOT NULL DEFAULT 1"},
		{"skill_files", "is_default", "is_default INTEGER NOT NULL DEFAULT 0"},
		{"agents", "run_mode", "run_mode TEXT NOT NULL DEFAULT 'quick'"},
		{"agents", "model_config_id", "model_config_id TEXT"},
		{"agents", "tools", "tools TEXT NOT NULL DEFAULT '[]'"},
		{"agents", "skills", "skills TEXT NOT NULL DEFAULT '[]'"},
		{"agents", "retrieval_strategy", "retrieval_strategy TEXT NOT NULL DEFAULT 'semantic'"},
		{"agents", "web_search_enabled", "web_search_enabled INTEGER NOT NULL DEFAULT 0"},
		{"agents", "multimodal", `multimodal TEXT NOT NULL DEFAULT '{"imageUpload":false,"fileUpload":true}'`},
		{"model_configs", "settings", "settings TEXT NOT NULL DEFAULT '{}'"},
		{"model_configs", "sort_order", "sort_order INTEGER NOT NULL DEFAULT 0"},
		{"content_assets", "resource_type", "resource_type TEXT NOT NULL DEFAULT 'other'"},
		{"content_assets", "type", "type TEXT NOT NULL DEFAULT 'file'"},
		{"content_assets", "source_url", "source_url TEXT"},
		{"content_assets", "file_size", "file_size INTEGER NOT NULL DEFAULT 0"},
		{"content_assets", "size", "size INTEGER NOT NULL DEFAULT 0"},
		{"content_assets", "original_file_name", "original_file_name TEXT NOT NULL DEFAULT ''"},
		{"content_assets", "stored_file_name", "stored_file_name TEXT NOT NULL DEFAULT ''"},
		{"content_assets", "mime_type", "mime_type TEXT NOT NULL DEFAULT 'application/octet-stream'"},
		{"content_assets", "file_path", "file_path TEXT NOT NULL DEFAULT ''"},
		{"content_assets", "file_url", "file_url TEXT NOT NULL DEFAULT ''"},
		{"content_assets", "asset_kind", "asset_kind TEXT NOT NULL DEFAULT 'library'"},
		{"content_assets", "lifecycle_status", "lifecycle_status TEXT NOT NULL DEFAULT 'permanent'"},
		{"content_assets", "parent_asset_id", "parent_asset_id TEXT"},
		{"content_assets", "expires_at", "expires_at TEXT"},
		{"content_assets", "retained_at", "retained_at TEXT"},
		{"discover_items", "like_count", "like_count INTEGER NOT NULL DEFAULT 0"},
		{"discover_items", "view_count", "view_count INTEGER NOT NULL DEFAULT 0"},
		{"discover_items", "duration", "duration REAL NOT NULL DEFAULT 0"},
		{"discover_items", "source_created_at", "source_created_at TEXT"},
		{"discover_items", "source_completed_at", "source_completed_at TEXT"},
		{"discover_items", "reference_assets", "reference_assets TEXT NOT NULL DEFAULT '[]'"},
		{"discover_items", "aspect_ratio", "aspect_ratio TEXT NOT NULL DEFAULT '1 / 1'"},
		{"discover_items", "cover_url", "cover_url TEXT NOT NULL DEFAULT ''"},
		{"file_upload_intents", "public_file_url", "public_file_url TEXT NOT NULL DEFAULT ''"},
		{"content_asset_groups", "resource_type", "resource_type TEXT NOT NULL DEFAULT 'other'"},
		{"content_asset_groups", "metadata", "metadata TEXT NOT NULL DEFAULT '{}'"},
		{"video_generation_tasks", "raw_parse_result", "raw_parse_result TEXT NOT NULL DEFAULT '{}'"},
		{"video_generation_tasks", "editable_parse_result", "editable_parse_result TEXT NOT NULL DEFAULT '{}'"},
		{"video_generation_tasks", "selected_digital_human_id", "selected_digital_human_id TEXT"},
		{"video_generation_tasks", "selected_voice_id", "selected_voice_id TEXT"},
		{"video_generation_tasks", "selected_scene_id", "selected_scene_id TEXT"},
		{"video_generation_tasks", "generated_video_url", "generated_video_url TEXT"},
		{"video_generation_tasks", "generated_cover_url", "generated_cover_url TEXT"},
		{"video_generation_tasks", "aspect_ratio", "aspect_ratio TEXT NOT NULL DEFAULT ''"},
		{"video_generation_tasks", "prompt", "prompt TEXT NOT NULL DEFAULT ''"},
		{"video_generation_tasks", "selected_skill_ids", "selected_skill_ids TEXT NOT NULL DEFAULT '[]'"},
		{"video_generation_tasks", "expert_context", "expert_context TEXT NOT NULL DEFAULT '{}'"},
	}
	for _, column := range legacyColumns {
		if err := ensureColumn(db, column.table, column.column, column.definition); err != nil {
			return err
		}
	}
	return nil
}

func ensureColumn(db *sql.DB, table string, column string, definition string) error {
	if hasColumn(db, table, column) {
		return nil
	}
	if _, err := db.Exec("ALTER TABLE " + table + " ADD COLUMN " + definition); err != nil {
		return fmt.Errorf("add %s.%s: %w", table, column, err)
	}
	return nil
}

func hasColumn(db *sql.DB, table string, column string) bool {
	rows, err := db.Query("PRAGMA table_info(" + table + ")")
	if err != nil {
		return false
	}
	found := false
	for rows.Next() {
		var cid int
		var name, columnType string
		var notNull, primaryKey int
		var defaultValue sql.NullString
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &primaryKey); err == nil && name == column {
			found = true
			break
		}
	}
	_ = rows.Close()
	return found
}

func (s *Store) FindUserByUsername(username string) (User, bool, error) {
	return s.findUser("WHERE username = ?", username)
}

func (s *Store) FindUserByID(id string) (User, bool, error) {
	return s.findUser("WHERE id = ?", id)
}

func (s *Store) findUser(condition string, argument string) (User, bool, error) {
	row := s.db.QueryRow(`
	SELECT id, username, display_name, COALESCE(avatar_url, ''), role,
       COALESCE(auth_version, 1), COALESCE(is_blacklisted, 0),
	COALESCE(credit_balance, 0), password_hash, salt, created_at,
       COALESCE(last_login_at, '')
FROM users `+condition, argument)

	var user User
	var blacklisted int
	if err := row.Scan(
		&user.ID,
		&user.Username,
		&user.DisplayName,
		&user.AvatarURL,
		&user.Role,
		&user.AuthVersion,
		&blacklisted,
		&user.CreditBalance,
		&user.PasswordHash,
		&user.Salt,
		&user.CreatedAt,
		&user.LastLoginAt,
	); errors.Is(err, sql.ErrNoRows) {
		return User{}, false, nil
	} else if err != nil {
		return User{}, false, fmt.Errorf("find user: %w", err)
	}
	user.IsBlacklisted = blacklisted != 0
	if err := s.enrichUser(&user); err != nil {
		return User{}, false, err
	}
	return user, true, nil
}

func (s *Store) enrichUser(user *User) error {
	rows, err := s.db.Query(`
SELECT r.id, r.key, r.name, r.description, r.is_system, r.is_default
FROM user_role_assignments a
JOIN roles r ON r.id = a.role_id
WHERE a.user_id = ?
ORDER BY r.created_at ASC`, user.ID)
	if err != nil {
		return fmt.Errorf("load user roles: %w", err)
	}
	for rows.Next() {
		var role RoleSummary
		var isSystem, isDefault int
		if err := rows.Scan(&role.ID, &role.Key, &role.Name, &role.Description, &isSystem, &isDefault); err != nil {
			rows.Close()
			return fmt.Errorf("scan user role: %w", err)
		}
		role.IsSystem = isSystem != 0
		role.IsDefault = isDefault != 0
		user.RoleIDs = append(user.RoleIDs, role.ID)
		user.AssignedRoles = append(user.AssignedRoles, role)
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("close user roles: %w", err)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate user roles: %w", err)
	}
	if user.Role == "admin" {
		rows, err := s.db.Query(`SELECT permission_code FROM route_resources WHERE status = 1 ORDER BY sort_order, created_at`)
		if err != nil {
			return fmt.Errorf("load admin permissions: %w", err)
		}
		for rows.Next() {
			var permission string
			if err := rows.Scan(&permission); err != nil {
				rows.Close()
				return fmt.Errorf("scan admin permission: %w", err)
			}
			user.Permissions = append(user.Permissions, permission)
		}
		if err := rows.Close(); err != nil {
			return err
		}
		return rows.Err()
	}
	if len(user.RoleIDs) == 0 && user.Role != "" {
		return nil
	}
	placeholders := make([]string, len(user.RoleIDs))
	args := make([]any, len(user.RoleIDs))
	for i, roleID := range user.RoleIDs {
		placeholders[i] = "?"
		args[i] = roleID
	}
	rows, err = s.db.Query(`SELECT DISTINCT rr.permission_code
FROM role_resource_permissions p JOIN route_resources rr ON rr.id = p.resource_id
WHERE rr.status = 1 AND p.role_id IN (`+joinStrings(placeholders, ",")+
		`) ORDER BY rr.sort_order, rr.created_at`, args...)
	if err != nil {
		return fmt.Errorf("load user permissions: %w", err)
	}
	for rows.Next() {
		var permission string
		if err := rows.Scan(&permission); err != nil {
			rows.Close()
			return fmt.Errorf("scan user permission: %w", err)
		}
		user.Permissions = append(user.Permissions, permission)
	}
	if err := rows.Close(); err != nil {
		return err
	}
	return rows.Err()
}

func joinStrings(values []string, separator string) string {
	result := ""
	for i, value := range values {
		if i > 0 {
			result += separator
		}
		result += value
	}
	return result
}

func (s *Store) CreateUser(username string, password string, displayName string) (User, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return User{}, fmt.Errorf("begin create user: %w", err)
	}
	defer tx.Rollback()

	var count int
	if err := tx.QueryRow("SELECT COUNT(*) FROM users").Scan(&count); err != nil {
		return User{}, fmt.Errorf("count users: %w", err)
	}
	var existing int
	if err := tx.QueryRow("SELECT COUNT(*) FROM users WHERE username = ?", username).Scan(&existing); err != nil {
		return User{}, fmt.Errorf("check username: %w", err)
	}
	if existing > 0 {
		return User{}, ErrUserAlreadyExists
	}

	salt, err := randomHex(16)
	if err != nil {
		return User{}, fmt.Errorf("generate password salt: %w", err)
	}
	id, err := randomHex(12)
	if err != nil {
		return User{}, fmt.Errorf("generate user id: %w", err)
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	role := "user"
	if count == 0 {
		role = "admin"
	}
	user := User{
		ID:            id,
		Username:      username,
		DisplayName:   displayName,
		Role:          role,
		AuthVersion:   1,
		CreditBalance: 0,
		PasswordHash:  hashPassword(password, salt),
		Salt:          salt,
		CreatedAt:     now,
		LastLoginAt:   now,
	}

	_, err = tx.Exec(`
INSERT INTO users (
  id, username, display_name, role, auth_version, is_blacklisted,
  credit_balance, password_hash, salt, created_at, last_login_at
) VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?)`,
		user.ID,
		user.Username,
		user.DisplayName,
		user.Role,
		user.AuthVersion,
		user.PasswordHash,
		user.Salt,
		user.CreatedAt,
		user.LastLoginAt,
	)
	if err != nil {
		return User{}, fmt.Errorf("insert user: %w", err)
	}
	if role == "user" {
		if _, err := tx.Exec(`INSERT OR IGNORE INTO user_role_assignments (user_id, role_id, created_at) VALUES (?, 'role-default-onboarding', ?)`, user.ID, now); err != nil {
			return User{}, fmt.Errorf("assign onboarding role: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return User{}, fmt.Errorf("commit user: %w", err)
	}
	if err := s.enrichUser(&user); err != nil {
		return User{}, err
	}
	return user, nil
}

func (s *Store) UpdateLastLogin(id string, timestamp string) error {
	_, err := s.db.Exec("UPDATE users SET last_login_at = ? WHERE id = ?", timestamp, id)
	if err != nil {
		return fmt.Errorf("update last login: %w", err)
	}
	return nil
}

func hashPassword(password string, salt string) string {
	digest := sha256.Sum256([]byte(salt + ":" + password))
	return hex.EncodeToString(digest[:])
}

func randomHex(size int) (string, error) {
	bytes := make([]byte, size)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}

func VerifyPassword(password string, user User) bool {
	return hashPassword(password, user.Salt) == user.PasswordHash
}

func PublicUser(user User) map[string]any {
	permissions := user.Permissions
	if permissions == nil {
		permissions = []string{}
	}
	roleIDs := user.RoleIDs
	if roleIDs == nil {
		roleIDs = []string{}
	}
	assignedRoles := user.AssignedRoles
	if assignedRoles == nil {
		assignedRoles = []RoleSummary{}
	}
	return map[string]any{
		"id":            user.ID,
		"username":      user.Username,
		"displayName":   user.DisplayName,
		"avatarUrl":     optionalString(user.AvatarURL),
		"role":          user.Role,
		"roleIds":       roleIDs,
		"assignedRoles": assignedRoles,
		"permissions":   permissions,
		"createdAt":     user.CreatedAt,
		"lastLoginAt":   optionalString(user.LastLoginAt),
		"creditBalance": user.CreditBalance,
	}
}

func optionalString(value string) any {
	if value == "" {
		return nil
	}
	return value
}
