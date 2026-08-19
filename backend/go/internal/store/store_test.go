package store

import (
	"database/sql"
	"path/filepath"
	"testing"

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
