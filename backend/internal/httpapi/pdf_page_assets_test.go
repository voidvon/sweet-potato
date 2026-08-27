package httpapi

import (
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"testing"

	"sweet-potato-go/internal/config"
	"sweet-potato-go/internal/store"
)

func TestRenderPDFPageAssetsCreatesAndReusesTemporary200DPIAssets(t *testing.T) {
	tempDir := t.TempDir()
	pngPath := filepath.Join(tempDir, "page.png")
	pngFile, err := os.Create(pngPath)
	if err != nil {
		t.Fatalf("create fixture PNG: %v", err)
	}
	fixture := image.NewRGBA(image.Rect(0, 0, 512, 724))
	for y := 0; y < 724; y++ {
		for x := 0; x < 512; x++ {
			value := uint8(255)
			if x%67 < 2 || y%83 < 2 {
				value = 24
			}
			fixture.SetRGBA(x, y, color.RGBA{R: value, G: value, B: value, A: 255})
		}
	}
	if err := png.Encode(pngFile, fixture); err != nil {
		t.Fatalf("encode fixture PNG: %v", err)
	}
	if err := pngFile.Close(); err != nil {
		t.Fatalf("close fixture PNG: %v", err)
	}

	rendererPath := filepath.Join(tempDir, "fake-pdftocairo")
	renderer := "#!/bin/sh\nfor last\ndo\n  :\ndone\ncp \"$FAKE_PDF_PAGE_PNG\" \"${last}-1.png\"\ncp \"$FAKE_PDF_PAGE_PNG\" \"${last}-2.png\"\n"
	if err := os.WriteFile(rendererPath, []byte(renderer), 0o755); err != nil {
		t.Fatalf("write fake renderer: %v", err)
	}
	t.Setenv("PDFTOCAIRO_PATH", rendererPath)
	t.Setenv("FAKE_PDF_PAGE_PNG", pngPath)

	server, err := New(config.Config{DataDir: t.TempDir()})
	if err != nil {
		t.Fatalf("create server: %v", err)
	}
	defer server.Close()
	user, err := server.store.CreateUser("pdf-page-user", "password123", "PDF Page User")
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	pdfPath := filepath.Join(tempDir, "product.pdf")
	if err := os.WriteFile(pdfPath, []byte("fake PDF handled by test renderer"), 0o600); err != nil {
		t.Fatalf("write PDF fixture: %v", err)
	}
	pdfAsset, err := server.store.CreateContentAsset(store.ContentAsset{
		UserID: user.ID, OriginalFileName: "product.pdf", StoredFileName: "product.pdf",
		MimeType: "application/pdf", FilePath: pdfPath, FileURL: "/files/product.pdf",
	})
	if err != nil {
		t.Fatalf("create PDF asset: %v", err)
	}

	assets, err := server.renderPDFPageAssets(t.Context(), pdfAsset)
	if err != nil {
		t.Fatalf("render PDF pages: %v", err)
	}
	if len(assets) != 2 {
		t.Fatalf("page asset count = %d, want 2", len(assets))
	}
	for index, asset := range assets {
		if asset.MimeType != "image/webp" || asset.AssetKind != "pdf_page_reference" || asset.LifecycleStatus != "temporary" {
			t.Fatalf("page %d asset = %#v", index+1, asset)
		}
		if got := int(numberValue(asset.Metadata["dpi"], 0)); got != pdfPageDPI {
			t.Fatalf("page %d dpi = %d", index+1, got)
		}
		if got := int(numberValue(asset.Metadata["page"], 0)); got != index+1 {
			t.Fatalf("page metadata = %d, want %d", got, index+1)
		}
		if int(numberValue(asset.Metadata["originalSize"], 0)) < int(asset.FileSize) {
			t.Fatalf("page %d original size = %#v, encoded size = %d", index+1, asset.Metadata["originalSize"], asset.FileSize)
		}
		if asset.Metadata["encodingApplied"] != true || asset.Metadata["encoding"] != "webp" {
			t.Fatalf("page %d encoding metadata = %#v", index+1, asset.Metadata)
		}
	}

	t.Setenv("PDFTOCAIRO_PATH", filepath.Join(tempDir, "missing-renderer"))
	cached, err := server.renderPDFPageAssets(t.Context(), pdfAsset)
	if err != nil {
		t.Fatalf("reuse PDF page cache: %v", err)
	}
	if len(cached) != 2 || cached[0].ID != assets[0].ID || cached[1].ID != assets[1].ID {
		t.Fatalf("cached assets = %#v", cached)
	}
}

func TestPDFRenderedPageNumber(t *testing.T) {
	if got := pdfRenderedPageNumber("/tmp/page-12.png"); got != 12 {
		t.Fatalf("page number = %d, want 12", got)
	}
}
