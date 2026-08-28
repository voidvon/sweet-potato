package assetextract

import (
	"archive/zip"
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestServiceSelectsParserAndRejectsUnsupportedFiles(t *testing.T) {
	service := NewService(NewPPTXParser(), NewPDFParser())
	descriptors := service.Descriptors()
	if len(descriptors) != 2 || descriptors[0].Name != "pptx-openxml" || descriptors[1].Name != "pdf-page-renderer" {
		t.Fatalf("descriptors = %#v", descriptors)
	}
	_, err := service.Parse(context.Background(), Input{FileName: "notes.txt", MimeType: "text/plain", Bytes: []byte("hello")})
	if !errors.Is(err, ErrUnsupportedFormat) {
		t.Fatalf("unsupported error = %v", err)
	}
}

func TestPPTXParserExtractsSlideTextAndEmbeddedImage(t *testing.T) {
	imageData := bytes.Repeat([]byte{0xff}, 60*1024)
	pptx := makePPTXFixture(t, imageData)
	result, err := NewService(NewPPTXParser()).Parse(t.Context(), Input{
		FileName: "campaign.pptx",
		MimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
		Bytes:    pptx,
	})
	if err != nil {
		t.Fatalf("parse PPTX: %v", err)
	}
	if result.Kind != "presentation" || result.Parser != "pptx-openxml" || result.Text != "新品发布 核心卖点" {
		t.Fatalf("result summary = %#v", result)
	}
	if len(result.Units) != 1 || result.Units[0].Locator.Kind != "slide" || result.Units[0].Locator.Index != 1 {
		t.Fatalf("units = %#v", result.Units)
	}
	if len(result.Artifacts) != 1 {
		t.Fatalf("artifacts = %#v", result.Artifacts)
	}
	image := result.Artifacts[0]
	if image.Kind != "embedded-image" || image.MimeType != "image/jpeg" || !bytes.Equal(image.Data, imageData) {
		t.Fatalf("image = %#v", image)
	}
	if image.Metadata["category"] != "content" || image.Metadata["included"] != true {
		t.Fatalf("image classification = %#v", image.Metadata)
	}
	if image.Metadata["imageFilterVersion"] != ImageFilterVersion {
		t.Fatalf("image filter version = %#v", image.Metadata["imageFilterVersion"])
	}
	placements, ok := image.Metadata["placements"].([]map[string]any)
	if !ok || len(placements) != 1 || placements[0]["slideNumber"] != 1 {
		t.Fatalf("placements = %#v", image.Metadata["placements"])
	}
}

func TestPDFParserProducesPageUnits(t *testing.T) {
	tempDir := t.TempDir()
	rendererPath := filepath.Join(tempDir, "fake-pdftocairo")
	renderer := "#!/bin/sh\nfor last\ndo\n  :\ndone\nprintf 'page-one' > \"${last}-1.png\"\nprintf 'page-two' > \"${last}-2.png\"\n"
	if err := os.WriteFile(rendererPath, []byte(renderer), 0o755); err != nil {
		t.Fatalf("write renderer: %v", err)
	}
	pdfPath := filepath.Join(tempDir, "brief.pdf")
	if err := os.WriteFile(pdfPath, []byte("fake PDF"), 0o600); err != nil {
		t.Fatalf("write PDF: %v", err)
	}
	parser := NewPDFParser()
	parser.RendererPath = rendererPath
	result, err := NewService(parser).Parse(t.Context(), Input{FileName: "brief.pdf", MimeType: "application/pdf", FilePath: pdfPath})
	if err != nil {
		t.Fatalf("parse PDF: %v", err)
	}
	if result.Kind != "pdf" || len(result.Units) != 2 || len(result.Artifacts) != 2 {
		t.Fatalf("result = %#v", result)
	}
	if result.Units[1].Locator.Kind != "page" || result.Units[1].Locator.Index != 2 || string(result.Artifacts[1].Data) != "page-two" {
		t.Fatalf("second page = unit %#v, artifact %#v", result.Units[1], result.Artifacts[1])
	}
	for _, artifact := range result.Artifacts {
		if artifact.Metadata["category"] != "document-page" || artifact.Metadata["included"] != true || artifact.Metadata["imageFilterVersion"] != ImageFilterVersion {
			t.Fatalf("PDF image filter metadata = %#v", artifact.Metadata)
		}
	}
}

func TestImageFilterSharesRulesAcrossDocumentFormats(t *testing.T) {
	tests := []struct {
		name     string
		input    ImageFilterInput
		category string
		included bool
	}{
		{
			name:     "small embedded image",
			input:    ImageFilterInput{Role: ImageRoleEmbedded, Size: 1024},
			category: "small-file",
		},
		{
			name:     "transparent embedded image",
			input:    ImageFilterInput{Role: ImageRoleEmbedded, Size: 80 * 1024, HasTransparentChannel: true},
			category: "transparent",
		},
		{
			name:     "document page remains usable",
			input:    ImageFilterInput{Role: ImageRoleDocumentPage, Size: 10, HasTransparentChannel: true},
			category: "document-page",
			included: true,
		},
		{
			name: "repeated corner image is logo",
			input: ImageFilterInput{
				Role: ImageRoleEmbedded, Size: 80 * 1024, UnitIndexes: []int{1, 2}, UnitCount: 4,
				Placements: []ImagePlacement{
					{UnitIndex: 1, XRatio: floatPointer(0.02), YRatio: floatPointer(0.02), WidthRatio: floatPointer(0.1), HeightRatio: floatPointer(0.1), AreaRatio: floatPointer(0.01)},
					{UnitIndex: 2, XRatio: floatPointer(0.02), YRatio: floatPointer(0.02), WidthRatio: floatPointer(0.1), HeightRatio: floatPointer(0.1), AreaRatio: floatPointer(0.01)},
				},
			},
			category: "logo",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			result := FilterImage(test.input)
			if result.Category != test.category || result.Included != test.included || result.Version != ImageFilterVersion {
				t.Fatalf("filter result = %#v", result)
			}
		})
	}
}

func makePPTXFixture(t *testing.T, imageData []byte) []byte {
	t.Helper()
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	files := map[string][]byte{
		"[Content_Types].xml":  []byte(`<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`),
		"ppt/presentation.xml": []byte(`<?xml version="1.0"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`),
		"ppt/slides/slide1.xml": []byte(`<?xml version="1.0"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:cSld><p:spTree>
    <p:sp><p:txBody><a:p><a:r><a:t>新品发布</a:t></a:r><a:r><a:t>核心卖点</a:t></a:r></a:p></p:txBody></p:sp>
    <p:pic><p:blipFill><a:blip r:embed="rId1"/></p:blipFill><p:spPr><a:xfrm><a:off x="1219200" y="685800"/><a:ext cx="6096000" cy="3429000"/></a:xfrm></p:spPr></p:pic>
  </p:spTree></p:cSld>
</p:sld>`),
		"ppt/slides/_rels/slide1.xml.rels": []byte(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/photo.jpg"/></Relationships>`),
		"ppt/media/photo.jpg":              imageData,
	}
	for name, data := range files {
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatalf("create ZIP entry: %v", err)
		}
		if _, err := entry.Write(data); err != nil {
			t.Fatalf("write ZIP entry: %v", err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close ZIP: %v", err)
	}
	return buffer.Bytes()
}
