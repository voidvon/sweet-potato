package httpapi

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"sweet-potato-go/internal/assetextract"
	"sweet-potato-go/internal/config"
	"sweet-potato-go/internal/store"
)

func TestContentAssetExtractionCreatesReusableDerivedAssets(t *testing.T) {
	dataDir := t.TempDir()
	server, err := New(config.Config{DataDir: dataDir, AuthTokenSecret: "test-secret"})
	if err != nil {
		t.Fatalf("create server: %v", err)
	}
	defer server.Close()
	user, err := server.store.CreateUser("extraction-user", "password123", "Extraction User")
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	group, err := server.store.CreateContentGroup(user.ID, "other", "Documents", "", nil)
	if err != nil {
		t.Fatalf("create group: %v", err)
	}
	pptxPath := filepath.Join(dataDir, "files", "campaign.pptx")
	if err := os.WriteFile(pptxPath, makeHTTPPPTXFixture(t), 0o600); err != nil {
		t.Fatalf("write PPTX: %v", err)
	}
	info, _ := os.Stat(pptxPath)
	asset, err := server.store.CreateContentAsset(store.ContentAsset{
		UserID: user.ID, GroupID: group.ID, ResourceType: "other", Name: "Campaign",
		OriginalFileName: "campaign.pptx", StoredFileName: "campaign.pptx",
		MimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
		FileSize: info.Size(), Size: info.Size(), FilePath: pptxPath, FileURL: "/files/campaign.pptx",
	})
	if err != nil {
		t.Fatalf("create content asset: %v", err)
	}
	token := server.tokens.Create(user.ID, user.Role, user.AuthVersion)

	post := authenticatedAssetExtractionRequest(t, server, token, http.MethodPost, "/api/content/assets/"+asset.ID+"/extraction")
	if post.Code != http.StatusAccepted {
		t.Fatalf("POST status = %d, body = %s", post.Code, post.Body.String())
	}
	var queued store.AssetExtraction
	if err := json.NewDecoder(post.Body).Decode(&queued); err != nil {
		t.Fatalf("decode queued extraction: %v", err)
	}

	var completed store.AssetExtraction
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		current, found, findErr := server.store.FindAssetExtraction(queued.ID, user.ID)
		if findErr != nil {
			t.Fatalf("find extraction: %v", findErr)
		}
		if found && (current.Status == "completed" || current.Status == "failed") {
			completed = current
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if completed.Status != "completed" {
		t.Fatalf("completed extraction = %#v", completed)
	}
	if completed.ContentHash == "" || len(completed.DerivedAssetIDs) != 1 || completed.Result["text"] != "新品发布 核心卖点" {
		t.Fatalf("completed payload = %#v", completed)
	}
	metadata, _ := completed.Result["metadata"].(map[string]any)
	filterSummary, _ := metadata["filterSummary"].(map[string]any)
	if filterSummary["total"] != float64(2) || filterSummary["included"] != float64(1) || filterSummary["excluded"] != float64(1) {
		t.Fatalf("filter summary = %#v", filterSummary)
	}
	derived, found, err := server.store.FindContentAsset(completed.DerivedAssetIDs[0])
	if err != nil || !found {
		t.Fatalf("find derived asset: found=%v, err=%v", found, err)
	}
	if derived.ParentAssetID == nil || *derived.ParentAssetID != asset.ID || derived.AssetKind != "extracted_embedded_image" {
		t.Fatalf("derived asset = %#v", derived)
	}
	if derived.Metadata["imageFilterVersion"] != assetextract.ImageFilterVersion || derived.Metadata["sourceExtractionId"] != completed.ID {
		t.Fatalf("derived metadata = %#v", derived.Metadata)
	}

	get := authenticatedAssetExtractionRequest(t, server, token, http.MethodGet, "/api/content/assets/"+asset.ID+"/extraction")
	if get.Code != http.StatusOK {
		t.Fatalf("GET status = %d, body = %s", get.Code, get.Body.String())
	}
	reused := authenticatedAssetExtractionRequest(t, server, token, http.MethodPost, "/api/content/assets/"+asset.ID+"/extraction")
	if reused.Code != http.StatusOK {
		t.Fatalf("reused POST status = %d, body = %s", reused.Code, reused.Body.String())
	}
	var reusedExtraction store.AssetExtraction
	if err := json.NewDecoder(reused.Body).Decode(&reusedExtraction); err != nil || reusedExtraction.ID != completed.ID {
		t.Fatalf("reused extraction = %#v, err=%v", reusedExtraction, err)
	}
}

func authenticatedAssetExtractionRequest(t *testing.T, server *Server, token, method, target string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(method, target, nil)
	request.Header.Set("Cookie", (&http.Cookie{Name: authCookieName, Value: token}).String())
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	return response
}

func makeHTTPPPTXFixture(t *testing.T) []byte {
	t.Helper()
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	imageData := bytes.Repeat([]byte{0xff}, 60*1024)
	files := map[string][]byte{
		"[Content_Types].xml":              []byte(`<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`),
		"ppt/presentation.xml":             []byte(`<?xml version="1.0"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`),
		"ppt/slides/slide1.xml":            []byte(`<?xml version="1.0"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>新品发布</a:t></a:r><a:r><a:t>核心卖点</a:t></a:r></a:p></p:txBody></p:sp><p:pic><p:blipFill><a:blip r:embed="rId1"/></p:blipFill><p:spPr><a:xfrm><a:off x="1219200" y="685800"/><a:ext cx="6096000" cy="3429000"/></a:xfrm></p:spPr></p:pic><p:pic><p:blipFill><a:blip r:embed="rId2"/></p:blipFill></p:pic></p:spTree></p:cSld></p:sld>`),
		"ppt/slides/_rels/slide1.xml.rels": []byte(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/photo.jpg"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/icon.png"/></Relationships>`),
		"ppt/media/photo.jpg":              imageData,
		"ppt/media/icon.png":               bytes.Repeat([]byte{0x01}, 1024),
	}
	for name, data := range files {
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatalf("create PPTX entry: %v", err)
		}
		if _, err := entry.Write(data); err != nil {
			t.Fatalf("write PPTX entry: %v", err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close PPTX: %v", err)
	}
	return buffer.Bytes()
}
