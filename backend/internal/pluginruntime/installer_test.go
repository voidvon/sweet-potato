package pluginruntime

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestInstallAndUninstallRemotionDependencies(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("fake Bun executable is a POSIX shell script")
	}
	source := t.TempDir()
	writeTestFile(t, filepath.Join(source, "package.json"), `{}`, 0o600)
	writeTestFile(t, filepath.Join(source, "bun.lock"), "lockfile", 0o600)
	if err := os.MkdirAll(filepath.Join(source, "server"), 0o700); err != nil {
		t.Fatalf("create server directory: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(source, "src"), 0o700); err != nil {
		t.Fatalf("create src directory: %v", err)
	}
	fakeBun := filepath.Join(t.TempDir(), "bun")
	writeTestFile(t, fakeBun, `#!/bin/sh
set -eu
if [ "${1:-}" = "--version" ]; then
  echo 1.2.3
elif [ "${1:-}" = "install" ]; then
  mkdir -p node_modules
elif [ "${1:-}" = "run" ] && [ "${2:-}" = "browser:ensure" ]; then
  mkdir -p node_modules/.remotion/chrome-headless-shell
else
  exit 2
fi
`, 0o700)
	t.Setenv("REMOTION_PLUGIN_DIR", "")
	t.Setenv("REMOTION_PLUGIN_SOURCE_DIR", source)
	t.Setenv("REMOTION_BUN_PATH", fakeBun)

	dataDir := t.TempDir()
	legacyRender := filepath.Join(dataDir, "plugins", "remotion-video", "renders", "existing.mp4")
	writeTestFile(t, legacyRender, "video", 0o600)
	manager := New(dataDir)
	if err := manager.Install(RemotionPluginKey, "1.0.0"); err != nil {
		t.Fatalf("install plugin: %v", err)
	}
	status := manager.Status(RemotionPluginKey)
	if !status.Installed || status.State != "stopped" || status.BunVersion != "1.2.3" {
		t.Fatalf("installed status = %+v", status)
	}
	if status.InstallStage != "" {
		t.Fatalf("completed install stage = %q", status.InstallStage)
	}
	if _, err := os.Stat(filepath.Join(status.PluginDir, "package.json")); err != nil {
		t.Fatalf("installed package: %v", err)
	}
	preservedRender := filepath.Join(dataDir, "plugin-data", "remotion-video", "renders", "existing.mp4")
	if content, err := os.ReadFile(preservedRender); err != nil || string(content) != "video" {
		t.Fatalf("preserved render = %q, %v", content, err)
	}
	if err := manager.Uninstall(RemotionPluginKey); err != nil {
		t.Fatalf("uninstall plugin: %v", err)
	}
	status = manager.Status(RemotionPluginKey)
	if status.Installed || status.State != "not_installed" {
		t.Fatalf("uninstalled status = %+v", status)
	}
	if _, err := os.Stat(preservedRender); err != nil {
		t.Fatalf("uninstall removed render data: %v", err)
	}
}

func TestExtractPluginSourceArchiveRejectsPathTraversal(t *testing.T) {
	archive := testPluginSourceArchive(t, true)
	path := filepath.Join(t.TempDir(), "unsafe.tar.gz")
	if err := os.WriteFile(path, archive, 0o600); err != nil {
		t.Fatalf("write archive: %v", err)
	}
	if err := extractPluginSourceArchive(path, t.TempDir()); err == nil {
		t.Fatal("expected path traversal archive to be rejected")
	}
}

func TestExtractBunExecutable(t *testing.T) {
	archivePath := filepath.Join(t.TempDir(), "bun.zip")
	file, err := os.Create(archivePath)
	if err != nil {
		t.Fatalf("create zip: %v", err)
	}
	archive := zip.NewWriter(file)
	entry, err := archive.Create("bun-test/" + executableName("bun"))
	if err != nil {
		t.Fatalf("create zip entry: %v", err)
	}
	if _, err := entry.Write([]byte("fake bun")); err != nil {
		t.Fatalf("write zip entry: %v", err)
	}
	if err := archive.Close(); err != nil {
		t.Fatalf("close zip: %v", err)
	}
	if err := file.Close(); err != nil {
		t.Fatalf("close zip file: %v", err)
	}
	target := filepath.Join(t.TempDir(), executableName("bun"))
	if err := extractBunExecutable(archivePath, target); err != nil {
		t.Fatalf("extract Bun: %v", err)
	}
	content, err := os.ReadFile(target)
	if err != nil || string(content) != "fake bun" {
		t.Fatalf("extracted Bun = %q, %v", content, err)
	}
}

func testPluginSourceArchive(t *testing.T, unsafe bool) []byte {
	t.Helper()
	var output bytes.Buffer
	compressed := gzip.NewWriter(&output)
	archive := tar.NewWriter(compressed)
	name := "remotion-video/package.json"
	if unsafe {
		name = "../escaped"
	}
	body := []byte(`{}`)
	header := &tar.Header{Name: name, Mode: 0o600, Typeflag: tar.TypeReg, Size: int64(len(body))}
	if err := archive.WriteHeader(header); err != nil {
		t.Fatalf("write header: %v", err)
	}
	if _, err := archive.Write(body); err != nil {
		t.Fatalf("write body: %v", err)
	}
	if err := archive.Close(); err != nil {
		t.Fatalf("close tar: %v", err)
	}
	if err := compressed.Close(); err != nil {
		t.Fatalf("close gzip: %v", err)
	}
	return output.Bytes()
}

func writeTestFile(t *testing.T, path, content string, mode os.FileMode) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatalf("create parent directory: %v", err)
	}
	if err := os.WriteFile(path, []byte(content), mode); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}
