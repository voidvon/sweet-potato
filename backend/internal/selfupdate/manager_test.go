package selfupdate

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestManagerChecksAndStagesVerifiedRelease(t *testing.T) {
	binary := []byte("new sweet potato binary")
	archive := makeTarArchive(t, "sweet-potato", binary)
	digest := sha256.Sum256(archive)
	digestText := hex.EncodeToString(digest[:])
	assetName := "sweet-potato-v0.1.55-linux-amd64.tar.gz"

	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/repos/voidvon/sweet-potato/releases/latest":
			_ = json.NewEncoder(w).Encode(release{
				TagName: "v0.1.55", HTMLURL: server.URL + "/release", PublishedAt: "2026-08-20T00:00:00Z", Body: "notes",
				Assets: []releaseAsset{
					{Name: assetName, BrowserDownloadURL: server.URL + "/asset", Digest: "sha256:" + digestText},
					{Name: "SHA256SUMS.txt", BrowserDownloadURL: server.URL + "/checksums"},
				},
			})
		case "/asset":
			_, _ = w.Write(archive)
		case "/checksums":
			_, _ = w.Write([]byte(digestText + "  " + assetName + "\n"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	targetPath := filepath.Join(t.TempDir(), "sweet-potato")
	if err := os.WriteFile(targetPath, []byte("old"), 0o755); err != nil {
		t.Fatal(err)
	}
	manager := &Manager{
		CurrentVersion: "0.1.54",
		Repository:     DefaultRepository,
		APIBaseURL:     server.URL,
		Client:         server.Client(),
		GOOS:           "linux",
		GOARCH:         "amd64",
		Executable:     func() (string, error) { return targetPath, nil },
	}

	info, err := manager.Check(context.Background())
	if err != nil {
		t.Fatalf("check release: %v", err)
	}
	if !info.UpdateAvailable || !info.Supported || info.LatestVersion != "0.1.55" || info.AssetName != assetName {
		t.Fatalf("unexpected update info: %+v", info)
	}
	update, err := manager.Stage(context.Background())
	if err != nil {
		t.Fatalf("stage release: %v", err)
	}
	staged, err := os.ReadFile(update.StagedPath)
	if err != nil {
		t.Fatalf("read staged binary: %v", err)
	}
	if !bytes.Equal(staged, binary) || update.TargetPath != targetPath || update.Version != "0.1.55" {
		t.Fatalf("unexpected staged update: %+v data=%q", update, staged)
	}
}

func TestChecksumAndArchiveValidation(t *testing.T) {
	if _, err := checksumFor([]byte("invalid  asset.tar.gz\n"), "asset.tar.gz"); err == nil {
		t.Fatal("invalid checksum was accepted")
	}
	archive := makeTarArchive(t, "../sweet-potato", []byte("unsafe"))
	if _, err := extractBinary("sweet-potato-v0.1.55-linux-amd64.tar.gz", archive, "linux"); err == nil {
		t.Fatal("unsafe archive path was accepted")
	}
	if _, ok := parseVersion("v0.1.55"); !ok {
		t.Fatal("valid version was rejected")
	}
	if _, ok := parseVersion("0.1"); ok {
		t.Fatal("invalid version was accepted")
	}
}

func TestManagerFallsBackToLatestReleaseRedirect(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/repos/voidvon/sweet-potato/releases/latest":
			http.Error(w, "rate limited", http.StatusForbidden)
		case "/voidvon/sweet-potato/releases/latest":
			http.Redirect(w, r, "/voidvon/sweet-potato/releases/tag/v0.1.55", http.StatusFound)
		case "/voidvon/sweet-potato/releases/tag/v0.1.55":
			_, _ = w.Write([]byte("release"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	manager := &Manager{
		CurrentVersion: "0.1.54",
		Repository:     DefaultRepository,
		APIBaseURL:     server.URL,
		WebBaseURL:     server.URL,
		Client:         server.Client(),
		GOOS:           "linux",
		GOARCH:         "amd64",
	}
	info, err := manager.Check(context.Background())
	if err != nil {
		t.Fatalf("fallback check: %v", err)
	}
	if !info.UpdateAvailable || !info.Supported || info.LatestVersion != "0.1.55" {
		t.Fatalf("unexpected fallback info: %+v", info)
	}
}

func makeTarArchive(t *testing.T, name string, data []byte) []byte {
	t.Helper()
	var result bytes.Buffer
	gzipWriter := gzip.NewWriter(&result)
	tarWriter := tar.NewWriter(gzipWriter)
	if err := tarWriter.WriteHeader(&tar.Header{Name: name, Mode: 0o755, Size: int64(len(data)), Typeflag: tar.TypeReg}); err != nil {
		t.Fatal(err)
	}
	if _, err := tarWriter.Write(data); err != nil {
		t.Fatal(err)
	}
	if err := tarWriter.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gzipWriter.Close(); err != nil {
		t.Fatal(err)
	}
	return result.Bytes()
}
