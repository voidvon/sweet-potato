package store

import (
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	_ "modernc.org/sqlite"
)

func TestOpenMigratesLegacyUsersTable(t *testing.T) {
	dataDir := t.TempDir()
	dbPath := filepath.Join(dataDir, "app.sqlite")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("open legacy database: %v", err)
	}
	_, err = db.Exec(`
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  auth_version INTEGER NOT NULL DEFAULT 1,
  role_id TEXT,
  is_blacklisted INTEGER NOT NULL DEFAULT 0,
  credit_balance REAL NOT NULL DEFAULT 0,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_login_at TEXT
);
INSERT INTO users (id, username, display_name, role, password_hash, salt, created_at)
VALUES ('legacy-id', 'legacy', 'Legacy', 'admin', 'hash', 'salt', '2026-01-01T00:00:00Z');`)
	if err != nil {
		db.Close()
		t.Fatalf("create legacy schema: %v", err)
	}
	if err := db.Close(); err != nil {
		t.Fatalf("close legacy database: %v", err)
	}

	dataStore, err := Open(dataDir)
	if err != nil {
		t.Fatalf("migrate legacy database: %v", err)
	}
	defer dataStore.Close()

	user, found, err := dataStore.FindUserByUsername("legacy")
	if err != nil || !found {
		t.Fatalf("find migrated user: found=%v err=%v", found, err)
	}
	if user.ID != "legacy-id" || user.AvatarURL != "" {
		t.Fatalf("unexpected migrated user: %+v", user)
	}
	if !hasColumn(dataStore.db, "users", "avatar_url") {
		t.Fatal("avatar_url column was not added")
	}
}

func TestOpenBackfillsDefaultDisplayNameTranslations(t *testing.T) {
	dataDir := t.TempDir()
	dataStore, err := Open(dataDir)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := dataStore.Exec(`UPDATE route_resources SET name_en = 'Image Creation' WHERE id = 'rr-web.module.chat'`); err != nil {
		t.Fatalf("set legacy route translation: %v", err)
	}
	if _, err := dataStore.Exec(`UPDATE route_resources SET name_en = 'Video Creation' WHERE id = 'rr-web.module.content.create_video'`); err != nil {
		t.Fatalf("set legacy video route translation: %v", err)
	}
	if _, err := dataStore.Exec(`
INSERT INTO discover_categories (id, name, name_en, slug, sort_order, status, created_at, updated_at)
VALUES ('talking', '口播', '', 'talking', 0, 'active', ?, ?),
       ('fashion', '女装', '', 'fashion', 10, 'active', ?, ?),
       ('custom', '口播', 'Spoken Content', 'custom', 20, 'active', ?, ?)`, now, now, now, now, now, now); err != nil {
		t.Fatalf("insert legacy categories: %v", err)
	}
	if err := dataStore.Close(); err != nil {
		t.Fatalf("close store: %v", err)
	}

	dataStore, err = Open(dataDir)
	if err != nil {
		t.Fatalf("reopen migrated store: %v", err)
	}
	defer dataStore.Close()
	resource, found, err := dataStore.FindRouteResource("rr-web.module.chat")
	if err != nil || !found || resource.NameEN != "Image" {
		t.Fatalf("route translation = %q, found=%v err=%v", resource.NameEN, found, err)
	}
	resource, found, err = dataStore.FindRouteResource("rr-web.module.content.create_video")
	if err != nil || !found || resource.NameEN != "Video" {
		t.Fatalf("video route translation = %q, found=%v err=%v", resource.NameEN, found, err)
	}
	categories, err := dataStore.ListDiscoverCategories(true)
	if err != nil {
		t.Fatalf("list categories: %v", err)
	}
	translations := make(map[string]string, len(categories))
	for _, category := range categories {
		translations[category.ID] = category.NameEN
	}
	if translations["talking"] != "Talking Head" || translations["fashion"] != "Women's Fashion" {
		t.Fatalf("default category translations not backfilled: %#v", translations)
	}
	if translations["custom"] != "Spoken Content" {
		t.Fatalf("custom category translation was overwritten: %#v", translations)
	}
}

func TestListManagedFilesUsesLocalStorageMetadataAndFilters(t *testing.T) {
	dataDir := t.TempDir()
	dataStore, err := Open(dataDir)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer dataStore.Close()

	user, err := dataStore.CreateUser("file-owner", "password123", "File Owner")
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	group, err := dataStore.CreateContentGroup(user.ID, "product", "Files", "", nil)
	if err != nil {
		t.Fatalf("create group: %v", err)
	}
	filePath := filepath.Join(dataDir, "files", "product.png")
	if err := os.MkdirAll(filepath.Dir(filePath), 0o755); err != nil {
		t.Fatalf("create files directory: %v", err)
	}
	if err := os.WriteFile(filePath, []byte("image"), 0o644); err != nil {
		t.Fatalf("write file: %v", err)
	}
	createdAt := time.Now().UTC().Add(-time.Minute).Format(time.RFC3339Nano)
	asset, err := dataStore.CreateContentAsset(ContentAsset{
		UserID: user.ID, GroupID: group.ID, ResourceType: "product", Name: "Product image",
		OriginalFileName: "product.png", StoredFileName: "product.png", MimeType: "image/png",
		FileSize: 5, Size: 5, FilePath: filePath, FileURL: "/files/product.png",
		LifecycleStatus: "retained", CreatedAt: createdAt,
	})
	if err != nil {
		t.Fatalf("create asset: %v", err)
	}
	if _, err := dataStore.Exec(`INSERT INTO content_asset_references (asset_id, reference_type, reference_id, role, created_at) VALUES (?, 'test', 'reference', 'input', ?)`, asset.ID, createdAt); err != nil {
		t.Fatalf("create asset reference: %v", err)
	}

	result, err := dataStore.ListManagedFiles(ManagedFileListFilters{
		Page: 1, PageSize: 20, StorageProvider: "local", MediaType: "image", Search: "owner",
		LifecycleStatus: "retained", CreatedAtFrom: createdAt,
	})
	if err != nil {
		t.Fatalf("list managed files: %v", err)
	}
	if result.Total != 1 || len(result.Items) != 1 {
		t.Fatalf("unexpected managed file result: %+v", result)
	}
	item := result.Items[0]
	if item.StorageProvider != "local" || item.StorageKey != "product.png" || item.MediaType != "image" || item.Username != "file-owner" || item.ReferenceCount != 1 {
		t.Fatalf("unexpected managed file: %+v", item)
	}
	if result.Summary.TotalCount != 1 || result.Summary.LocalCount != 1 || result.Summary.TOSCount != 0 || result.Summary.TotalBytes != 5 {
		t.Fatalf("unexpected managed file summary: %+v", result.Summary)
	}
}

func TestNewPasswordUsesVersionedSlowHash(t *testing.T) {
	dataStore, err := Open(t.TempDir())
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer dataStore.Close()
	user, err := dataStore.CreateUser("hash-user", "password123", "Hash User")
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	if !strings.HasPrefix(user.PasswordHash, passwordHashPrefix+"$") {
		t.Fatalf("password hash is not versioned: %q", user.PasswordHash)
	}
	if !VerifyPassword("password123", user) || VerifyPassword("wrong", user) {
		t.Fatal("password verification result is incorrect")
	}
}

func TestDisabledDiscoverCategoryDoesNotPublishFiles(t *testing.T) {
	dataStore, err := Open(t.TempDir())
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer dataStore.Close()

	category, err := dataStore.SaveDiscoverCategory("", map[string]any{"name": "Public", "slug": "public"})
	if err != nil {
		t.Fatalf("create category: %v", err)
	}
	if _, err := dataStore.CreateDiscoverItem(DiscoverItem{CategoryID: category.ID, SourceAssetID: "asset", MediaType: "image", MimeType: "image/png", FileURL: "/files/public.png"}); err != nil {
		t.Fatalf("create discover item: %v", err)
	}
	public, err := dataStore.IsPublicDiscoverFile("public.png")
	if err != nil || !public {
		t.Fatalf("active discover item public=%v err=%v", public, err)
	}
	if _, err := dataStore.SaveDiscoverCategory(category.ID, map[string]any{"status": "disabled"}); err != nil {
		t.Fatalf("disable category: %v", err)
	}
	public, err = dataStore.IsPublicDiscoverFile("public.png")
	if err != nil {
		t.Fatalf("check disabled discover file: %v", err)
	}
	if public {
		t.Fatal("disabled discover item still publishes its file")
	}
}
