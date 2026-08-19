package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

type ManagedUser struct {
	ID                   string        `json:"id"`
	Username             string        `json:"username"`
	DisplayName          string        `json:"displayName"`
	Role                 string        `json:"role"`
	RoleIDs              []string      `json:"roleIds"`
	AssignedRoles        []RoleSummary `json:"assignedRoles"`
	Permissions          []string      `json:"permissions"`
	IsBlacklisted        bool          `json:"isBlacklisted"`
	CreditBalance        float64       `json:"creditBalance"`
	TotalRechargeCredits float64       `json:"totalRechargeCredits"`
	TotalUsageCredits    float64       `json:"totalUsageCredits"`
	CreatedAt            string        `json:"createdAt"`
	LastLoginAt          *string       `json:"lastLoginAt"`
}

type Role struct {
	RoleSummary
	GrantedResourceIDs []string        `json:"grantedResourceIds"`
	GrantedResources   []ResourceGrant `json:"grantedResources"`
	AssignedUserCount  int             `json:"assignedUserCount"`
	CreatedAt          string          `json:"createdAt"`
	UpdatedAt          string          `json:"updatedAt"`
}

type RouteResource struct {
	ID             string          `json:"id"`
	ParentID       *string         `json:"parentId"`
	Name           string          `json:"name"`
	ResourceKey    string          `json:"resourceKey"`
	ResourceType   string          `json:"resourceType"`
	Platform       string          `json:"platform"`
	Path           string          `json:"path"`
	PermissionCode string          `json:"permissionCode"`
	VisibilityMode string          `json:"visibilityMode"`
	Status         bool            `json:"status"`
	SortOrder      int             `json:"sortOrder"`
	IsSystem       bool            `json:"isSystem"`
	CreatedAt      string          `json:"createdAt"`
	UpdatedAt      string          `json:"updatedAt"`
	Children       []RouteResource `json:"children,omitempty"`
}

type ResourceGrant struct {
	ResourceID     string `json:"resourceId"`
	Name           string `json:"name"`
	ResourceKey    string `json:"resourceKey"`
	ResourceType   string `json:"resourceType"`
	Platform       string `json:"platform"`
	PermissionCode string `json:"permissionCode"`
}

type ModelConfig struct {
	ID          string         `json:"id"`
	Type        string         `json:"type"`
	Name        string         `json:"name"`
	Provider    string         `json:"provider"`
	Model       string         `json:"model"`
	APIKey      string         `json:"apiKey"`
	BaseURL     string         `json:"baseUrl"`
	Temperature float64        `json:"temperature"`
	Settings    map[string]any `json:"settings"`
	IsDefault   bool           `json:"isDefault"`
	SortOrder   int            `json:"sortOrder"`
	CreatedAt   string         `json:"createdAt"`
	UpdatedAt   string         `json:"updatedAt"`
}

type LlmModelPricing struct {
	ID                    string  `json:"id"`
	Provider              string  `json:"provider"`
	ProviderName          string  `json:"providerName"`
	Model                 string  `json:"model"`
	DisplayName           string  `json:"displayName"`
	DefaultBaseURL        string  `json:"defaultBaseUrl"`
	Currency              string  `json:"currency"`
	InputPricePer1M       float64 `json:"inputPricePer1M"`
	OutputPricePer1M      float64 `json:"outputPricePer1M"`
	CachedInputPricePer1M float64 `json:"cachedInputPricePer1M"`
	PriceSource           string  `json:"priceSource"`
	PriceUpdatedAt        string  `json:"priceUpdatedAt"`
	CreatedAt             string  `json:"createdAt"`
	UpdatedAt             string  `json:"updatedAt"`
}

type BillingSettings struct {
	ID                                    int     `json:"id"`
	Enabled                               bool    `json:"enabled"`
	Seedance2CreditsPerSecond720p         float64 `json:"seedance2CreditsPerSecond720p"`
	Seedance2CreditsPerSecond480p         float64 `json:"seedance2CreditsPerSecond480p"`
	Seedance2FastCreditsPerSecond720p     float64 `json:"seedance2FastCreditsPerSecond720p"`
	Seedance2FastCreditsPerSecond480p     float64 `json:"seedance2FastCreditsPerSecond480p"`
	Seedance2MiniCreditsPerSecond720p     float64 `json:"seedance2MiniCreditsPerSecond720p"`
	Seedance2MiniCreditsPerSecond480p     float64 `json:"seedance2MiniCreditsPerSecond480p"`
	VideoUploadCreditsPerMB               float64 `json:"videoUploadCreditsPerMb"`
	VideoUnderstandingCreditsPer1MTokens  float64 `json:"videoUnderstandingCreditsPer1mTokens,omitempty"`
	ContentPlanningAnalysisCredits        float64 `json:"contentPlanningAnalysisCreditsPerRequest"`
	ContentPlanningGenerationCredits      float64 `json:"contentPlanningGenerationCreditsPerRequest"`
	TalkingVideoPromptCredits             float64 `json:"talkingVideoPromptCreditsPerRequest"`
	MarketingVideoCredits                 float64 `json:"marketingVideoCreditsPerRequest"`
	MarketingVideoStoryboardModelConfigID string  `json:"marketingVideoStoryboardModelConfigId"`
	VideoUpscaleCredits                   float64 `json:"videoUpscaleCreditsPerRequest"`
	SubtitleRemovalCreditsPerSecond       float64 `json:"subtitleRemovalCreditsPerSecond"`
	VideoTranslationSubtitleCreditsPerSec float64 `json:"videoTranslationSubtitleCreditsPerSecond"`
	VideoTranslationVoiceCreditsPerSecond float64 `json:"videoTranslationVoiceCreditsPerSecond"`
	VideoTranslationFaceCreditsPerSecond  float64 `json:"videoTranslationFaceCreditsPerSecond"`
	VideoTranslationEraseCreditsPerSecond float64 `json:"videoTranslationEraseSourceCreditsPerSecond"`
	CreatedAt                             string  `json:"createdAt"`
	UpdatedAt                             string  `json:"updatedAt"`
}

type CreditLedgerEntry struct {
	ID                 string  `json:"id"`
	UserID             string  `json:"userId"`
	Type               string  `json:"type"`
	CreditDelta        float64 `json:"creditDelta"`
	CreditBalanceAfter float64 `json:"creditBalanceAfter"`
	SourceType         *string `json:"sourceType"`
	SourceID           *string `json:"sourceId"`
	CreatedAt          string  `json:"createdAt"`
}

type UsageRecord struct {
	ID                 string  `json:"id"`
	UserID             string  `json:"userId"`
	ModelConfigID      string  `json:"modelConfigId"`
	SourceType         string  `json:"sourceType"`
	PromptTokens       int     `json:"promptTokens"`
	CompletionTokens   int     `json:"completionTokens"`
	CachedPromptTokens int     `json:"cachedPromptTokens"`
	CreditCost         float64 `json:"creditCost"`
	Status             string  `json:"status"`
	CreatedAt          string  `json:"createdAt"`
}

type BillableUsageRecord struct {
	ID          string  `json:"id"`
	UserID      string  `json:"userId"`
	Category    string  `json:"category"`
	Provider    *string `json:"provider"`
	Model       *string `json:"model"`
	SourceType  string  `json:"sourceType"`
	PricingMode string  `json:"pricingMode"`
	CreditCost  float64 `json:"creditCost"`
	Status      string  `json:"status"`
	CreatedAt   string  `json:"createdAt"`
}

func (s *Store) ListUsers(username, sortBy, sortOrder string) ([]ManagedUser, error) {
	rows, err := s.db.Query(`SELECT id FROM users ORDER BY created_at ASC`)
	if err != nil {
		return nil, fmt.Errorf("list users: %w", err)
	}
	var userIDs []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, fmt.Errorf("scan user id: %w", err)
		}
		userIDs = append(userIDs, id)
	}
	if err := rows.Close(); err != nil {
		return nil, fmt.Errorf("close user list: %w", err)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate users: %w", err)
	}
	var users []ManagedUser
	for _, id := range userIDs {
		user, found, err := s.FindUserByID(id)
		if err != nil || !found {
			if err != nil {
				return nil, err
			}
			continue
		}
		if username != "" && !strings.Contains(strings.ToLower(user.Username), strings.ToLower(username)) {
			continue
		}
		summary, err := s.creditSummary(user.ID)
		if err != nil {
			return nil, err
		}
		users = append(users, managedUser(user, summary.recharge, summary.usage))
	}
	if sortBy != "" && (sortOrder == "asc" || sortOrder == "desc") {
		direction := 1
		if sortOrder == "desc" {
			direction = -1
		}
		sort.SliceStable(users, func(i, j int) bool {
			left, right := users[i], users[j]
			var a, b float64
			switch sortBy {
			case "creditBalance":
				a, b = left.CreditBalance, right.CreditBalance
			case "totalRechargeCredits":
				a, b = left.TotalRechargeCredits, right.TotalRechargeCredits
			case "totalUsageCredits":
				a, b = left.TotalUsageCredits, right.TotalUsageCredits
			default:
				return false
			}
			if a == b {
				return left.CreatedAt < right.CreatedAt
			}
			return direction == 1 && a < b || direction == -1 && a > b
		})
	}
	return users, nil
}

type creditTotals struct{ recharge, usage float64 }

func (s *Store) creditSummary(userID string) (creditTotals, error) {
	var totals creditTotals
	err := s.db.QueryRow(`
SELECT COALESCE(SUM(CASE WHEN credit_delta > 0 THEN credit_delta ELSE 0 END), 0),
       COALESCE(SUM(CASE WHEN credit_delta < 0 THEN -credit_delta ELSE 0 END), 0)
FROM credit_ledger WHERE user_id = ?`, userID).Scan(&totals.recharge, &totals.usage)
	if err != nil {
		return creditTotals{}, fmt.Errorf("load credit summary: %w", err)
	}
	return totals, nil
}

func managedUser(user User, recharge, usage float64) ManagedUser {
	lastLogin := nullableString(user.LastLoginAt)
	roleIDs := user.RoleIDs
	if roleIDs == nil {
		roleIDs = []string{}
	}
	assignedRoles := user.AssignedRoles
	if assignedRoles == nil {
		assignedRoles = []RoleSummary{}
	}
	permissions := user.Permissions
	if permissions == nil {
		permissions = []string{}
	}
	return ManagedUser{ID: user.ID, Username: user.Username, DisplayName: user.DisplayName, Role: user.Role, RoleIDs: roleIDs, AssignedRoles: assignedRoles, Permissions: permissions, IsBlacklisted: user.IsBlacklisted, CreditBalance: user.CreditBalance, TotalRechargeCredits: recharge, TotalUsageCredits: usage, CreatedAt: user.CreatedAt, LastLoginAt: lastLogin}
}

func nullableString(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

func (s *Store) UpdateProfile(id, displayName, avatarURL string) (User, error) {
	if _, err := s.db.Exec(`UPDATE users SET display_name = ?, avatar_url = ? WHERE id = ?`, displayName, avatarURL, id); err != nil {
		return User{}, fmt.Errorf("update profile: %w", err)
	}
	user, found, err := s.FindUserByID(id)
	if err != nil {
		return User{}, err
	}
	if !found {
		return User{}, sql.ErrNoRows
	}
	return user, nil
}

func (s *Store) UpdatePassword(id, password string) error {
	salt, err := randomHex(16)
	if err != nil {
		return fmt.Errorf("generate password salt: %w", err)
	}
	if _, err := s.db.Exec(`UPDATE users SET password_hash = ?, salt = ?, auth_version = auth_version + 1 WHERE id = ?`, hashPassword(password, salt), salt, id); err != nil {
		return fmt.Errorf("update password: %w", err)
	}
	return nil
}

func (s *Store) UpdateBlacklist(id string, blacklisted bool) error {
	if _, err := s.db.Exec(`UPDATE users SET is_blacklisted = ? WHERE id = ?`, boolInt(blacklisted), id); err != nil {
		return fmt.Errorf("update blacklist: %w", err)
	}
	return nil
}

func (s *Store) CountActiveAdmins() (int, error) {
	var count int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM users WHERE role = 'admin' AND is_blacklisted = 0`).Scan(&count); err != nil {
		return 0, fmt.Errorf("count active admins: %w", err)
	}
	return count, nil
}

func (s *Store) AssignUserRoles(userID string, roleIDs []string) (User, bool, error) {
	unique := uniqueStrings(roleIDs)
	for _, roleID := range unique {
		var exists int
		if err := s.db.QueryRow(`SELECT COUNT(*) FROM roles WHERE id = ?`, roleID).Scan(&exists); err != nil {
			return User{}, false, fmt.Errorf("check role: %w", err)
		}
		if exists == 0 {
			return User{}, false, errors.New("角色不存在")
		}
	}
	currentRows, err := s.db.Query(`SELECT role_id FROM user_role_assignments WHERE user_id = ? ORDER BY role_id`, userID)
	if err != nil {
		return User{}, false, fmt.Errorf("load role assignments: %w", err)
	}
	var current []string
	for currentRows.Next() {
		var roleID string
		if err := currentRows.Scan(&roleID); err != nil {
			currentRows.Close()
			return User{}, false, err
		}
		current = append(current, roleID)
	}
	currentRows.Close()
	sort.Strings(unique)
	sort.Strings(current)
	changed := !sameStrings(current, unique)
	tx, err := s.db.Begin()
	if err != nil {
		return User{}, false, fmt.Errorf("begin role assignment: %w", err)
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`DELETE FROM user_role_assignments WHERE user_id = ?`, userID); err != nil {
		return User{}, false, fmt.Errorf("clear role assignments: %w", err)
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	for _, roleID := range unique {
		if _, err := tx.Exec(`INSERT INTO user_role_assignments (user_id, role_id, created_at) VALUES (?, ?, ?)`, userID, roleID, now); err != nil {
			return User{}, false, fmt.Errorf("insert role assignment: %w", err)
		}
	}
	var roleID any
	if len(unique) > 0 {
		roleID = unique[0]
	}
	if _, err := tx.Exec(`UPDATE users SET role_id = ?, auth_version = auth_version + ? WHERE id = ?`, roleID, boolInt(changed), userID); err != nil {
		return User{}, false, fmt.Errorf("update user role: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return User{}, false, fmt.Errorf("commit role assignment: %w", err)
	}
	user, found, err := s.FindUserByID(userID)
	if err != nil {
		return User{}, false, err
	}
	if !found {
		return User{}, false, sql.ErrNoRows
	}
	return user, changed, nil
}

func (s *Store) AdjustCredits(userID, operatorID string, delta float64) (User, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return User{}, fmt.Errorf("begin credit adjustment: %w", err)
	}
	defer tx.Rollback()
	var balance float64
	if err := tx.QueryRow(`SELECT credit_balance FROM users WHERE id = ?`, userID).Scan(&balance); err != nil {
		return User{}, fmt.Errorf("load credit balance: %w", err)
	}
	balance += delta
	if _, err := tx.Exec(`UPDATE users SET credit_balance = ? WHERE id = ?`, balance, userID); err != nil {
		return User{}, fmt.Errorf("update credit balance: %w", err)
	}
	sourceType := "admin_adjust"
	snapshot, _ := json.Marshal(map[string]any{"operatorUserId": operatorID})
	if _, err := tx.Exec(`INSERT INTO credit_ledger (id, user_id, type, credit_delta, credit_balance_after, source_type, snapshot, created_at) VALUES (?, ?, 'admin_adjust', ?, ?, ?, ?, ?)`, mustRandomID(), userID, delta, balance, sourceType, string(snapshot), time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
		return User{}, fmt.Errorf("write credit ledger: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return User{}, fmt.Errorf("commit credit adjustment: %w", err)
	}
	user, found, err := s.FindUserByID(userID)
	if err != nil {
		return User{}, err
	}
	if !found {
		return User{}, sql.ErrNoRows
	}
	return user, nil
}

func mustRandomID() string {
	id, err := randomHex(16)
	if err != nil {
		return fmt.Sprintf("fallback-%d", time.Now().UnixNano())
	}
	return id
}

func uniqueStrings(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}

func sameStrings(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for i := range left {
		if left[i] != right[i] {
			return false
		}
	}
	return true
}

func (s *Store) ListRoles() ([]Role, error) {
	rows, err := s.db.Query(`SELECT id, key, name, description, is_system, is_default, created_at, updated_at FROM roles ORDER BY is_system DESC, created_at ASC`)
	if err != nil {
		return nil, fmt.Errorf("list roles: %w", err)
	}
	var rowsData []struct {
		role                Role
		isSystem, isDefault int
	}
	for rows.Next() {
		var item struct {
			role                Role
			isSystem, isDefault int
		}
		if err := rows.Scan(&item.role.ID, &item.role.Key, &item.role.Name, &item.role.Description, &item.isSystem, &item.isDefault, &item.role.CreatedAt, &item.role.UpdatedAt); err != nil {
			rows.Close()
			return nil, fmt.Errorf("scan role: %w", err)
		}
		rowsData = append(rowsData, item)
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	result := make([]Role, 0)
	for _, item := range rowsData {
		role := item.role
		role.IsSystem, role.IsDefault = item.isSystem != 0, item.isDefault != 0
		role, err = s.populateRole(role)
		if err != nil {
			return nil, err
		}
		result = append(result, role)
	}
	return result, nil
}

func (s *Store) populateRole(role Role) (Role, error) {
	role.GrantedResourceIDs = []string{}
	role.GrantedResources = []ResourceGrant{}
	rows, err := s.db.Query(`SELECT rr.id, rr.name, rr.resource_key, rr.resource_type, rr.platform, rr.permission_code
FROM role_resource_permissions p JOIN route_resources rr ON rr.id = p.resource_id
WHERE p.role_id = ? ORDER BY rr.sort_order, rr.permission_code`, role.ID)
	if err != nil {
		return role, fmt.Errorf("load role grants: %w", err)
	}
	for rows.Next() {
		var grant ResourceGrant
		if err := rows.Scan(&grant.ResourceID, &grant.Name, &grant.ResourceKey, &grant.ResourceType, &grant.Platform, &grant.PermissionCode); err != nil {
			return role, fmt.Errorf("scan role grant: %w", err)
		}
		role.GrantedResourceIDs = append(role.GrantedResourceIDs, grant.ResourceKey)
		role.GrantedResources = append(role.GrantedResources, grant)
	}
	if err := rows.Close(); err != nil {
		return role, err
	}
	if err := s.db.QueryRow(`SELECT COUNT(DISTINCT user_id) FROM user_role_assignments WHERE role_id = ?`, role.ID).Scan(&role.AssignedUserCount); err != nil {
		return role, fmt.Errorf("count role users: %w", err)
	}
	return role, rows.Err()
}

func (s *Store) CreateRole(name, description string, resourceIDs []string, isDefault bool) (Role, error) {
	name = strings.TrimSpace(name)
	if len([]rune(name)) < 2 {
		return Role{}, errors.New("角色名称至少 2 位")
	}
	id := mustRandomID()
	key := slugify(name, id[:8])
	now := time.Now().UTC().Format(time.RFC3339Nano)
	tx, err := s.db.Begin()
	if err != nil {
		return Role{}, err
	}
	defer tx.Rollback()
	if isDefault {
		if _, err := tx.Exec(`UPDATE roles SET is_default = 0`); err != nil {
			return Role{}, err
		}
	}
	if _, err := tx.Exec(`INSERT INTO roles (id, key, name, description, is_system, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?)`, id, key, name, strings.TrimSpace(description), boolInt(isDefault), now, now); err != nil {
		return Role{}, fmt.Errorf("create role: %w", err)
	}
	if err := s.replaceRoleGrantsTx(tx, id, resourceIDs, now); err != nil {
		return Role{}, err
	}
	if err := tx.Commit(); err != nil {
		return Role{}, err
	}
	roles, err := s.ListRoles()
	if err != nil {
		return Role{}, err
	}
	for _, role := range roles {
		if role.ID == id {
			return role, nil
		}
	}
	return Role{}, sql.ErrNoRows
}

func slugify(value, fallback string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	var b strings.Builder
	lastDash := false
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
			lastDash = false
		} else if !lastDash && b.Len() > 0 {
			b.WriteByte('-')
			lastDash = true
		}
	}
	key := strings.Trim(b.String(), "-")
	if key == "" {
		return "custom-role-" + fallback
	}
	return key + "-" + fallback
}

func (s *Store) UpdateRole(id, name, description string, resourceIDs []string, isDefault bool) (Role, bool, error) {
	var isSystem, wasDefault int
	if err := s.db.QueryRow(`SELECT is_system, is_default FROM roles WHERE id = ?`, id).Scan(&isSystem, &wasDefault); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Role{}, false, errors.New("角色不存在")
		}
		return Role{}, false, err
	}
	if len([]rune(strings.TrimSpace(name))) < 2 {
		return Role{}, false, errors.New("角色名称至少 2 位")
	}
	oldIDs, err := s.roleResourceIDs(id)
	if err != nil {
		return Role{}, false, err
	}
	newIDs := uniqueStrings(resourceIDs)
	sort.Strings(oldIDs)
	sort.Strings(newIDs)
	changed := !sameStrings(oldIDs, newIDs)
	now := time.Now().UTC().Format(time.RFC3339Nano)
	tx, err := s.db.Begin()
	if err != nil {
		return Role{}, false, err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`UPDATE roles SET name = ?, description = ?, is_default = ?, updated_at = ? WHERE id = ?`, strings.TrimSpace(name), strings.TrimSpace(description), boolInt(isDefault), now, id); err != nil {
		return Role{}, false, err
	}
	if isDefault {
		if _, err := tx.Exec(`UPDATE roles SET is_default = 0 WHERE id != ?`, id); err != nil {
			return Role{}, false, err
		}
	} else if wasDefault != 0 {
		if _, err := tx.Exec(`UPDATE roles SET is_default = 0 WHERE id = ?`, id); err != nil {
			return Role{}, false, err
		}
	}
	if err := s.replaceRoleGrantsTx(tx, id, resourceIDs, now); err != nil {
		return Role{}, false, err
	}
	if changed {
		if _, err := tx.Exec(`UPDATE users SET auth_version = auth_version + 1 WHERE id IN (SELECT user_id FROM user_role_assignments WHERE role_id = ?)`, id); err != nil {
			return Role{}, false, err
		}
	}
	if err := tx.Commit(); err != nil {
		return Role{}, false, err
	}
	roles, err := s.ListRoles()
	if err != nil {
		return Role{}, false, err
	}
	for _, role := range roles {
		if role.ID == id {
			return role, changed, nil
		}
	}
	_ = isSystem
	return Role{}, false, sql.ErrNoRows
}

func (s *Store) DeleteRole(id string) error {
	var isSystem, isDefault, assigned int
	if err := s.db.QueryRow(`SELECT is_system, is_default, (SELECT COUNT(*) FROM user_role_assignments WHERE role_id = ?) FROM roles WHERE id = ?`, id, id).Scan(&isSystem, &isDefault, &assigned); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return errors.New("角色不存在")
		}
		return err
	}
	if isSystem != 0 || isDefault != 0 {
		return errors.New("系统内置角色不支持删除")
	}
	if assigned > 0 {
		return errors.New("已有账号使用该角色，无法删除")
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`DELETE FROM role_resource_permissions WHERE role_id = ?`, id); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM role_permissions WHERE role_id = ?`, id); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM roles WHERE id = ?`, id); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) roleResourceIDs(roleID string) ([]string, error) {
	rows, err := s.db.Query(`SELECT resource_id FROM role_resource_permissions WHERE role_id = ?`, roleID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func (s *Store) replaceRoleGrantsTx(tx *sql.Tx, roleID string, resourceIDs []string, now string) error {
	if _, err := tx.Exec(`DELETE FROM role_resource_permissions WHERE role_id = ?`, roleID); err != nil {
		return fmt.Errorf("clear role grants: %w", err)
	}
	for _, value := range uniqueStrings(resourceIDs) {
		var id string
		if err := tx.QueryRow(`SELECT id FROM route_resources WHERE id = ? OR resource_key = ?`, value, value).Scan(&id); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				continue
			}
			return err
		}
		if _, err := tx.Exec(`INSERT OR IGNORE INTO role_resource_permissions (role_id, resource_id, created_at) VALUES (?, ?, ?)`, roleID, id, now); err != nil {
			return fmt.Errorf("insert role grant: %w", err)
		}
	}
	return nil
}

func (s *Store) ListRouteResources(includeDisabled bool, platform string) ([]RouteResource, error) {
	query := `SELECT id, parent_id, name, resource_key, resource_type, platform, path, permission_code, visibility_mode, status, sort_order, is_system, created_at, updated_at FROM route_resources`
	conditions := []string{}
	args := []any{}
	if !includeDisabled {
		conditions = append(conditions, "status = 1")
	}
	if platform == "web" || platform == "admin" {
		conditions = append(conditions, "platform = ?")
		args = append(args, platform)
	}
	if len(conditions) > 0 {
		query += " WHERE " + strings.Join(conditions, " AND ")
	}
	query += " ORDER BY platform ASC, sort_order ASC, created_at ASC"
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("list route resources: %w", err)
	}
	defer rows.Close()
	result := make([]RouteResource, 0)
	for rows.Next() {
		resource, err := scanRouteResource(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, resource)
	}
	return result, rows.Err()
}

type rowScanner interface{ Scan(...any) error }

func scanRouteResource(scanner rowScanner) (RouteResource, error) {
	var resource RouteResource
	var parentID sql.NullString
	var status, isSystem int
	if err := scanner.Scan(&resource.ID, &parentID, &resource.Name, &resource.ResourceKey, &resource.ResourceType, &resource.Platform, &resource.Path, &resource.PermissionCode, &resource.VisibilityMode, &status, &resource.SortOrder, &isSystem, &resource.CreatedAt, &resource.UpdatedAt); err != nil {
		return RouteResource{}, fmt.Errorf("scan route resource: %w", err)
	}
	if parentID.Valid {
		resource.ParentID = &parentID.String
	}
	resource.Status, resource.IsSystem = status != 0, isSystem != 0
	return resource, nil
}

func routeTree(items []RouteResource) []RouteResource {
	nodes := make(map[string]RouteResource, len(items))
	children := make(map[string][]string)
	var rootIDs []string
	for _, item := range items {
		item.Children = []RouteResource{}
		nodes[item.ID] = item
	}
	for _, item := range items {
		if item.ParentID != nil {
			if _, ok := nodes[*item.ParentID]; ok {
				children[*item.ParentID] = append(children[*item.ParentID], item.ID)
				continue
			}
		}
		rootIDs = append(rootIDs, item.ID)
	}
	var build func(string) RouteResource
	build = func(id string) RouteResource {
		result := nodes[id]
		for _, childID := range children[id] {
			result.Children = append(result.Children, build(childID))
		}
		return result
	}
	roots := make([]RouteResource, 0, len(rootIDs))
	for _, id := range rootIDs {
		roots = append(roots, build(id))
	}
	var sortNodes func([]RouteResource)
	sortNodes = func(values []RouteResource) {
		sort.SliceStable(values, func(i, j int) bool {
			if values[i].SortOrder == values[j].SortOrder {
				return values[i].CreatedAt < values[j].CreatedAt
			}
			return values[i].SortOrder < values[j].SortOrder
		})
		for i := range values {
			sortNodes(values[i].Children)
		}
	}
	sortNodes(roots)
	return roots
}

func (s *Store) ListRouteResourceTree(includeDisabled bool, platform string) ([]RouteResource, error) {
	items, err := s.ListRouteResources(includeDisabled, platform)
	if err != nil {
		return nil, err
	}
	return routeTree(items), nil
}

func (s *Store) FindRouteResource(id string) (RouteResource, bool, error) {
	row := s.db.QueryRow(`SELECT id, parent_id, name, resource_key, resource_type, platform, path, permission_code, visibility_mode, status, sort_order, is_system, created_at, updated_at FROM route_resources WHERE id = ?`, id)
	resource, err := scanRouteResource(row)
	if errors.Is(err, sql.ErrNoRows) {
		return RouteResource{}, false, nil
	}
	return resource, err == nil, err
}

func (s *Store) SaveRouteResource(id string, input map[string]any) (RouteResource, error) {
	current, found, err := s.FindRouteResource(id)
	if err != nil {
		return RouteResource{}, err
	}
	if id != "" && !found {
		return RouteResource{}, errors.New("资源不存在")
	}
	if id == "" {
		id = mustRandomID()
	}
	next := current
	if !found {
		next = RouteResource{ID: id, ResourceType: "menu", Platform: "web", VisibilityMode: "permission", Status: true}
	}
	setString(input, "name", &next.Name)
	setString(input, "resourceKey", &next.ResourceKey)
	setString(input, "resourceType", &next.ResourceType)
	setString(input, "platform", &next.Platform)
	setString(input, "path", &next.Path)
	setString(input, "permissionCode", &next.PermissionCode)
	setString(input, "visibilityMode", &next.VisibilityMode)
	if value, ok := input["status"]; ok {
		next.Status = toBool(value, next.Status)
	}
	if value, ok := input["sortOrder"]; ok {
		next.SortOrder = int(toFloat(value, float64(next.SortOrder)))
	}
	if value, ok := input["isSystem"]; ok && !found {
		next.IsSystem = toBool(value, false)
	}
	if next.Name == "" || next.ResourceKey == "" || next.PermissionCode == "" {
		return RouteResource{}, errors.New("资源名称、resourceKey 和 permissionCode 不能为空")
	}
	if next.ResourceType != "directory" && next.ResourceType != "menu" {
		return RouteResource{}, errors.New("资源类型仅支持目录或菜单")
	}
	if next.Platform != "web" && next.Platform != "admin" {
		return RouteResource{}, errors.New("所属平台仅支持 Web 或 Admin")
	}
	if next.VisibilityMode != "always" && next.VisibilityMode != "permission" {
		next.VisibilityMode = "permission"
	}
	if found && current.IsSystem && (current.ResourceKey != next.ResourceKey || current.PermissionCode != next.PermissionCode || current.Platform != next.Platform || current.ResourceType != next.ResourceType) {
		return RouteResource{}, errors.New("系统资源不允许修改关键标识")
	}
	if value, ok := input["parentId"]; ok {
		parent := strings.TrimSpace(fmt.Sprint(value))
		if parent == "" || parent == "<nil>" {
			next.ParentID = nil
		} else {
			next.ParentID = &parent
		}
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if !found {
		next.CreatedAt, next.UpdatedAt = now, now
		_, err = s.db.Exec(`INSERT INTO route_resources (id, parent_id, name, resource_key, resource_type, platform, path, permission_code, visibility_mode, status, sort_order, is_system, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, next.ID, nullablePtr(next.ParentID), next.Name, next.ResourceKey, next.ResourceType, next.Platform, next.Path, next.PermissionCode, next.VisibilityMode, boolInt(next.Status), next.SortOrder, boolInt(next.IsSystem), now, now)
	} else {
		next.UpdatedAt = now
		_, err = s.db.Exec(`UPDATE route_resources SET parent_id = ?, name = ?, resource_key = ?, resource_type = ?, platform = ?, path = ?, permission_code = ?, visibility_mode = ?, status = ?, sort_order = ?, updated_at = ? WHERE id = ?`, nullablePtr(next.ParentID), next.Name, next.ResourceKey, next.ResourceType, next.Platform, next.Path, next.PermissionCode, next.VisibilityMode, boolInt(next.Status), next.SortOrder, now, id)
	}
	if err != nil {
		return RouteResource{}, fmt.Errorf("save route resource: %w", err)
	}
	return next, nil
}

func setString(input map[string]any, key string, target *string) {
	if value, ok := input[key]; ok {
		*target = strings.TrimSpace(fmt.Sprint(value))
	}
}

func nullablePtr(value *string) any {
	if value == nil || *value == "" {
		return nil
	}
	return *value
}

func toBool(value any, fallback bool) bool {
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		return typed == "true" || typed == "1"
	case float64:
		return typed != 0
	default:
		return fallback
	}
}

func toFloat(value any, fallback float64) float64 {
	switch typed := value.(type) {
	case float64:
		return typed
	case float32:
		return float64(typed)
	case int:
		return float64(typed)
	case string:
		var parsed float64
		if _, err := fmt.Sscan(typed, &parsed); err == nil {
			return parsed
		}
	}
	return fallback
}

func (s *Store) DeleteRouteResource(id string) error {
	var isSystem int
	if err := s.db.QueryRow(`SELECT is_system FROM route_resources WHERE id = ?`, id).Scan(&isSystem); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return errors.New("资源不存在")
		}
		return err
	}
	if isSystem != 0 {
		return errors.New("系统资源不支持删除")
	}
	var children int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM route_resources WHERE parent_id = ?`, id).Scan(&children); err != nil {
		return err
	}
	if children > 0 {
		return errors.New("请先删除子资源")
	}
	_, err := s.db.Exec(`DELETE FROM route_resources WHERE id = ?`, id)
	return err
}

func (s *Store) ListModelConfigs(modelType string) ([]ModelConfig, error) {
	query := `SELECT id, type, name, provider, model, api_key, base_url, temperature, settings, is_default, sort_order, created_at, updated_at FROM model_configs`
	args := []any{}
	if modelType != "" {
		query += ` WHERE type = ?`
		args = append(args, modelType)
	}
	query += ` ORDER BY type ASC, sort_order ASC, is_default DESC, updated_at DESC`
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("list model configs: %w", err)
	}
	defer rows.Close()
	result := make([]ModelConfig, 0)
	for rows.Next() {
		var model ModelConfig
		var settings string
		var isDefault int
		if err := rows.Scan(&model.ID, &model.Type, &model.Name, &model.Provider, &model.Model, &model.APIKey, &model.BaseURL, &model.Temperature, &settings, &isDefault, &model.SortOrder, &model.CreatedAt, &model.UpdatedAt); err != nil {
			return nil, err
		}
		model.IsDefault = isDefault != 0
		model.Settings = decodeObject(settings)
		result = append(result, model)
	}
	return result, rows.Err()
}

func (s *Store) FindModelConfig(id string) (ModelConfig, bool, error) {
	models, err := s.ListModelConfigs("")
	if err != nil {
		return ModelConfig{}, false, err
	}
	for _, model := range models {
		if model.ID == id {
			return model, true, nil
		}
	}
	return ModelConfig{}, false, nil
}

func (s *Store) SaveModelConfig(model ModelConfig, insert bool) (ModelConfig, error) {
	model.Type = strings.TrimSpace(model.Type)
	if model.Type != "llm" && model.Type != "image" && model.Type != "video" && model.Type != "audio" {
		return ModelConfig{}, errors.New("模型类型不支持")
	}
	if model.ID == "" {
		model.ID = mustRandomID()
	}
	if model.Name == "" || model.Provider == "" || model.Model == "" || model.BaseURL == "" {
		return ModelConfig{}, errors.New("模型名称、供应商、模型和服务地址不能为空")
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if model.CreatedAt == "" {
		model.CreatedAt = now
	}
	model.UpdatedAt = now
	settings, _ := json.Marshal(model.SettingsOrEmpty())
	tx, err := s.db.Begin()
	if err != nil {
		return ModelConfig{}, err
	}
	defer tx.Rollback()
	if model.IsDefault {
		if _, err := tx.Exec(`UPDATE model_configs SET is_default = 0 WHERE type = ?`, model.Type); err != nil {
			return ModelConfig{}, err
		}
	}
	if insert {
		_, err = tx.Exec(`INSERT INTO model_configs (id, type, name, provider, model, api_key, base_url, temperature, settings, is_default, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, model.ID, model.Type, model.Name, model.Provider, model.Model, model.APIKey, model.BaseURL, model.Temperature, string(settings), boolInt(model.IsDefault), model.SortOrder, model.CreatedAt, model.UpdatedAt)
	} else {
		_, err = tx.Exec(`UPDATE model_configs SET type = ?, name = ?, provider = ?, model = ?, api_key = ?, base_url = ?, temperature = ?, settings = ?, is_default = ?, sort_order = ?, updated_at = ? WHERE id = ?`, model.Type, model.Name, model.Provider, model.Model, model.APIKey, model.BaseURL, model.Temperature, string(settings), boolInt(model.IsDefault), model.SortOrder, model.UpdatedAt, model.ID)
	}
	if err != nil {
		return ModelConfig{}, fmt.Errorf("save model config: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return ModelConfig{}, err
	}
	result, found, err := s.FindModelConfig(model.ID)
	if err != nil {
		return ModelConfig{}, err
	}
	if !found {
		return ModelConfig{}, sql.ErrNoRows
	}
	return result, nil
}

func (m ModelConfig) SettingsOrEmpty() map[string]any {
	if m.Settings == nil {
		return map[string]any{}
	}
	return m.Settings
}

func decodeObject(value string) map[string]any {
	result := map[string]any{}
	if err := json.Unmarshal([]byte(value), &result); err != nil || result == nil {
		return map[string]any{}
	}
	return result
}

func (s *Store) DeleteModelConfig(id string) error {
	result, err := s.db.Exec(`DELETE FROM model_configs WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if count, _ := result.RowsAffected(); count == 0 {
		return errors.New("模型配置不存在")
	}
	return nil
}

func (s *Store) ReorderModelConfigs(modelType string, ids []string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	now := time.Now().UTC().Format(time.RFC3339Nano)
	for i, id := range ids {
		if _, err := tx.Exec(`UPDATE model_configs SET sort_order = ?, updated_at = ? WHERE id = ? AND type = ?`, i, now, id, modelType); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) ListPricing() ([]LlmModelPricing, error) {
	rows, err := s.db.Query(`SELECT id, provider, provider_name, model, display_name, default_base_url, currency, input_price_per_1m, output_price_per_1m, cached_input_price_per_1m, price_source, price_updated_at, created_at, updated_at FROM llm_model_pricing ORDER BY provider_name, display_name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]LlmModelPricing, 0)
	for rows.Next() {
		var item LlmModelPricing
		if err := rows.Scan(&item.ID, &item.Provider, &item.ProviderName, &item.Model, &item.DisplayName, &item.DefaultBaseURL, &item.Currency, &item.InputPricePer1M, &item.OutputPricePer1M, &item.CachedInputPricePer1M, &item.PriceSource, &item.PriceUpdatedAt, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func (s *Store) SavePricing(item LlmModelPricing, insert bool) (LlmModelPricing, error) {
	if item.ID == "" {
		item.ID = item.Provider + ":" + item.Model
	}
	if item.Provider == "" || item.Model == "" || item.DisplayName == "" {
		return LlmModelPricing{}, errors.New("价格目录字段不完整")
	}
	if item.Currency != "USD" && item.Currency != "CNY" {
		return LlmModelPricing{}, errors.New("币种不支持")
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if item.PriceUpdatedAt == "" {
		item.PriceUpdatedAt = now[:10]
	}
	if insert {
		item.CreatedAt, item.UpdatedAt = now, now
		_, err := s.db.Exec(`INSERT INTO llm_model_pricing (id, provider, provider_name, model, display_name, default_base_url, currency, input_price_per_1m, output_price_per_1m, cached_input_price_per_1m, price_source, price_updated_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, item.ID, item.Provider, item.ProviderName, item.Model, item.DisplayName, item.DefaultBaseURL, item.Currency, item.InputPricePer1M, item.OutputPricePer1M, item.CachedInputPricePer1M, item.PriceSource, item.PriceUpdatedAt, item.CreatedAt, item.UpdatedAt)
		if err != nil {
			return LlmModelPricing{}, err
		}
	} else {
		item.UpdatedAt = now
		_, err := s.db.Exec(`UPDATE llm_model_pricing SET provider = ?, provider_name = ?, model = ?, display_name = ?, default_base_url = ?, currency = ?, input_price_per_1m = ?, output_price_per_1m = ?, cached_input_price_per_1m = ?, price_source = ?, price_updated_at = ?, updated_at = ? WHERE id = ?`, item.Provider, item.ProviderName, item.Model, item.DisplayName, item.DefaultBaseURL, item.Currency, item.InputPricePer1M, item.OutputPricePer1M, item.CachedInputPricePer1M, item.PriceSource, item.PriceUpdatedAt, item.UpdatedAt, item.ID)
		if err != nil {
			return LlmModelPricing{}, err
		}
	}
	items, err := s.ListPricing()
	if err != nil {
		return LlmModelPricing{}, err
	}
	for _, value := range items {
		if value.ID == item.ID {
			return value, nil
		}
	}
	return LlmModelPricing{}, sql.ErrNoRows
}

func (s *Store) DeletePricing(id string) error {
	result, err := s.db.Exec(`DELETE FROM llm_model_pricing WHERE id = ?`, id)
	if err != nil {
		return err
	}
	count, _ := result.RowsAffected()
	if count == 0 {
		return errors.New("LLM 官方价格目录不存在")
	}
	return nil
}

func (s *Store) GetBillingSettings() (BillingSettings, error) {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := s.db.Exec(`INSERT OR IGNORE INTO billing_settings (id, enabled, created_at, updated_at) VALUES (1, 1, ?, ?)`, now, now); err != nil {
		return BillingSettings{}, err
	}
	var settings BillingSettings
	var enabled int
	err := s.db.QueryRow(`SELECT id, enabled, seedance_2_credits_per_second_720p, seedance_2_credits_per_second_480p, seedance_2_fast_credits_per_second_720p, seedance_2_fast_credits_per_second_480p, seedance_2_mini_credits_per_second_720p, seedance_2_mini_credits_per_second_480p, video_upload_credits_per_mb, video_understanding_credits_per_1m_tokens, content_planning_analysis_credits_per_request, content_planning_generation_credits_per_request, talking_video_prompt_credits_per_request, marketing_video_credits_per_request, marketing_video_storyboard_model_config_id, video_upscale_credits_per_request, subtitle_removal_credits_per_second, video_translation_subtitle_credits_per_second, video_translation_voice_credits_per_second, video_translation_face_credits_per_second, video_translation_erase_source_credits_per_second, created_at, updated_at FROM billing_settings WHERE id = 1`).Scan(&settings.ID, &enabled, &settings.Seedance2CreditsPerSecond720p, &settings.Seedance2CreditsPerSecond480p, &settings.Seedance2FastCreditsPerSecond720p, &settings.Seedance2FastCreditsPerSecond480p, &settings.Seedance2MiniCreditsPerSecond720p, &settings.Seedance2MiniCreditsPerSecond480p, &settings.VideoUploadCreditsPerMB, &settings.VideoUnderstandingCreditsPer1MTokens, &settings.ContentPlanningAnalysisCredits, &settings.ContentPlanningGenerationCredits, &settings.TalkingVideoPromptCredits, &settings.MarketingVideoCredits, &settings.MarketingVideoStoryboardModelConfigID, &settings.VideoUpscaleCredits, &settings.SubtitleRemovalCreditsPerSecond, &settings.VideoTranslationSubtitleCreditsPerSec, &settings.VideoTranslationVoiceCreditsPerSecond, &settings.VideoTranslationFaceCreditsPerSecond, &settings.VideoTranslationEraseCreditsPerSecond, &settings.CreatedAt, &settings.UpdatedAt)
	if err != nil {
		return BillingSettings{}, err
	}
	settings.Enabled = enabled != 0
	return settings, nil
}

func (s *Store) UpdateBillingSettings(settings BillingSettings) (BillingSettings, error) {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	_, err := s.db.Exec(`UPDATE billing_settings SET enabled = ?, seedance_2_credits_per_second_720p = ?, seedance_2_credits_per_second_480p = ?, seedance_2_fast_credits_per_second_720p = ?, seedance_2_fast_credits_per_second_480p = ?, seedance_2_mini_credits_per_second_720p = ?, seedance_2_mini_credits_per_second_480p = ?, video_upload_credits_per_mb = ?, content_planning_analysis_credits_per_request = ?, content_planning_generation_credits_per_request = ?, talking_video_prompt_credits_per_request = ?, marketing_video_credits_per_request = ?, marketing_video_storyboard_model_config_id = ?, video_upscale_credits_per_request = ?, subtitle_removal_credits_per_second = ?, video_translation_subtitle_credits_per_second = ?, video_translation_voice_credits_per_second = ?, video_translation_face_credits_per_second = ?, video_translation_erase_source_credits_per_second = ?, updated_at = ? WHERE id = 1`, boolInt(settings.Enabled), settings.Seedance2CreditsPerSecond720p, settings.Seedance2CreditsPerSecond480p, settings.Seedance2FastCreditsPerSecond720p, settings.Seedance2FastCreditsPerSecond480p, settings.Seedance2MiniCreditsPerSecond720p, settings.Seedance2MiniCreditsPerSecond480p, settings.VideoUploadCreditsPerMB, settings.ContentPlanningAnalysisCredits, settings.ContentPlanningGenerationCredits, settings.TalkingVideoPromptCredits, settings.MarketingVideoCredits, settings.MarketingVideoStoryboardModelConfigID, settings.VideoUpscaleCredits, settings.SubtitleRemovalCreditsPerSecond, settings.VideoTranslationSubtitleCreditsPerSec, settings.VideoTranslationVoiceCreditsPerSecond, settings.VideoTranslationFaceCreditsPerSecond, settings.VideoTranslationEraseCreditsPerSecond, now)
	if err != nil {
		return BillingSettings{}, err
	}
	return s.GetBillingSettings()
}

func (s *Store) ListLedger(userID string, limit int) ([]CreditLedgerEntry, error) {
	limit = clampLimit(limit)
	query := `SELECT id, user_id, type, credit_delta, credit_balance_after, source_type, source_id, created_at FROM credit_ledger`
	args := []any{}
	if userID != "" {
		query += ` WHERE user_id = ?`
		args = append(args, userID)
	}
	query += ` ORDER BY created_at DESC LIMIT ?`
	args = append(args, limit)
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]CreditLedgerEntry, 0)
	for rows.Next() {
		var item CreditLedgerEntry
		var sourceType, sourceID sql.NullString
		if err := rows.Scan(&item.ID, &item.UserID, &item.Type, &item.CreditDelta, &item.CreditBalanceAfter, &sourceType, &sourceID, &item.CreatedAt); err != nil {
			return nil, err
		}
		if sourceType.Valid {
			item.SourceType = &sourceType.String
		}
		if sourceID.Valid {
			item.SourceID = &sourceID.String
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func clampLimit(limit int) int {
	if limit < 1 {
		return 100
	}
	if limit > 1000 {
		return 1000
	}
	return limit
}

func (s *Store) GetCreditSummary(userID string) (map[string]any, error) {
	totals, err := s.creditSummary(userID)
	if err != nil {
		return nil, err
	}
	return map[string]any{"userId": userID, "totalRechargeCredits": totals.recharge, "totalUsageCredits": totals.usage}, nil
}

func (s *Store) ListUsage(userID string, limit int) ([]UsageRecord, error) {
	limit = clampLimit(limit)
	query := `SELECT id, user_id, model_config_id, source_type, prompt_tokens, completion_tokens, cached_prompt_tokens, credit_cost, status, created_at FROM llm_usage_records`
	args := []any{}
	if userID != "" {
		query += ` WHERE user_id = ?`
		args = append(args, userID)
	}
	query += ` ORDER BY created_at DESC LIMIT ?`
	args = append(args, limit)
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]UsageRecord, 0)
	for rows.Next() {
		var item UsageRecord
		if err := rows.Scan(&item.ID, &item.UserID, &item.ModelConfigID, &item.SourceType, &item.PromptTokens, &item.CompletionTokens, &item.CachedPromptTokens, &item.CreditCost, &item.Status, &item.CreatedAt); err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func (s *Store) ListBillableUsage(userID string, limit int) ([]BillableUsageRecord, error) {
	limit = clampLimit(limit)
	query := `SELECT id, user_id, category, provider, model, source_type, pricing_mode, credit_cost, status, created_at FROM billable_usage_records`
	args := []any{}
	if userID != "" {
		query += ` WHERE user_id = ?`
		args = append(args, userID)
	}
	query += ` ORDER BY created_at DESC LIMIT ?`
	args = append(args, limit)
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]BillableUsageRecord, 0)
	for rows.Next() {
		var item BillableUsageRecord
		if err := rows.Scan(&item.ID, &item.UserID, &item.Category, &item.Provider, &item.Model, &item.SourceType, &item.PricingMode, &item.CreditCost, &item.Status, &item.CreatedAt); err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}
