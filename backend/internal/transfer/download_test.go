package transfer

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDownloadDoesNotReplaceDestinationWhenResponseExceedsLimit(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		_, _ = writer.Write([]byte("too-large"))
	}))
	defer server.Close()

	destination := filepath.Join(t.TempDir(), "video.mp4")
	if err := os.WriteFile(destination, []byte("existing"), 0o644); err != nil {
		t.Fatal(err)
	}
	_, err := Download(context.Background(), server.Client(), server.URL, destination, int64(len("too-large")-1))
	if err == nil || !strings.Contains(err.Error(), "limit") {
		t.Fatalf("expected size limit error, got %v", err)
	}
	content, readErr := os.ReadFile(destination)
	if readErr != nil {
		t.Fatal(readErr)
	}
	if string(content) != "existing" {
		t.Fatalf("destination was replaced: %q", content)
	}
}

func TestValidatePublicHTTPURLRejectsLoopback(t *testing.T) {
	if err := ValidatePublicHTTPURL("http://127.0.0.1/image.png"); err == nil {
		t.Fatal("expected loopback URL to be rejected")
	}
}
