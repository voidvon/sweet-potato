package assetextract

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

const (
	DefaultPDFPageDPI      = 200
	DefaultPDFPageMaxPages = 20
)

type PDFParser struct {
	RendererPath string
	DPI          int
	MaxPages     int
}

func NewPDFParser() *PDFParser {
	return &PDFParser{DPI: DefaultPDFPageDPI, MaxPages: DefaultPDFPageMaxPages}
}

func (p *PDFParser) Descriptor() Descriptor {
	return Descriptor{Name: "pdf-page-renderer", Version: "1", Kinds: []string{"pdf"}}
}

func (p *PDFParser) Supports(input Input) bool {
	return normalizedMimeType(input.MimeType) == "application/pdf" || strings.EqualFold(filepath.Ext(input.FileName), ".pdf")
}

func (p *PDFParser) Parse(ctx context.Context, input Input) (Result, error) {
	dpi := p.DPI
	if dpi <= 0 {
		dpi = DefaultPDFPageDPI
	}
	maxPages := p.MaxPages
	if maxPages <= 0 {
		maxPages = DefaultPDFPageMaxPages
	}

	sourcePath, cleanup, err := materializeInput(input, "asset-extract-pdf-*.pdf")
	if err != nil {
		return Result{}, err
	}
	defer cleanup()

	renderer := strings.TrimSpace(p.RendererPath)
	if renderer == "" {
		renderer = strings.TrimSpace(os.Getenv("PDFTOCAIRO_PATH"))
	}
	if renderer == "" {
		renderer, err = exec.LookPath("pdftocairo")
		if err != nil {
			return Result{}, errors.New("PDF 高清转换组件未安装：请安装 Poppler（pdftocairo）后重试")
		}
	}

	tempDir, err := os.MkdirTemp("", "asset-extract-pdf-pages-")
	if err != nil {
		return Result{}, fmt.Errorf("创建 PDF 转换临时目录失败: %w", err)
	}
	defer os.RemoveAll(tempDir)
	prefix := filepath.Join(tempDir, "page")
	command := exec.CommandContext(ctx, renderer, "-png", "-r", strconv.Itoa(dpi), "-f", "1", "-l", strconv.Itoa(maxPages), sourcePath, prefix)
	if output, runErr := command.CombinedOutput(); runErr != nil {
		if errors.Is(ctx.Err(), context.Canceled) || errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return Result{}, ctx.Err()
		}
		return Result{}, fmt.Errorf("PDF 转换为 %d DPI 图片失败: %s", dpi, truncate(strings.TrimSpace(string(output)), 300))
	}
	paths, err := filepath.Glob(prefix + "-*.png")
	if err != nil {
		return Result{}, err
	}
	sort.Slice(paths, func(left, right int) bool {
		return PDFRenderedPageNumber(paths[left]) < PDFRenderedPageNumber(paths[right])
	})
	if len(paths) == 0 {
		return Result{}, errors.New("PDF 转换完成但没有生成页面图片")
	}

	result := Result{
		FileName: input.FileName,
		Kind:     "pdf",
		Parser:   p.Descriptor().Name,
		Version:  p.Descriptor().Version,
		Metadata: map[string]any{"dpi": dpi, "maxPages": maxPages},
	}
	for _, pagePath := range paths {
		page := PDFRenderedPageNumber(pagePath)
		if page < 1 || page > maxPages {
			continue
		}
		data, readErr := os.ReadFile(pagePath)
		if readErr != nil {
			return Result{}, fmt.Errorf("读取 PDF 第 %d 页图片失败: %w", page, readErr)
		}
		locator := Locator{Kind: "page", Index: page}
		artifactID := fmt.Sprintf("pdf-page-%03d", page)
		hasTransparency := ImageHasTransparentChannel("image/png", data)
		filter := FilterImage(ImageFilterInput{
			Role:                  ImageRoleDocumentPage,
			Size:                  len(data),
			HasTransparentChannel: hasTransparency,
			Placements: []ImagePlacement{{
				UnitIndex: page,
				AreaRatio: floatPointer(1),
			}},
			UnitIndexes: []int{page},
			UnitCount:   len(paths),
		})
		filterMetadata := filter.Metadata()
		filterMetadata["hasTransparentChannel"] = hasTransparency
		filterMetadata["size"] = len(data)
		result.Artifacts = append(result.Artifacts, Artifact{
			ID:       artifactID,
			Kind:     "page-image",
			FileName: fmt.Sprintf("%s-page-%d.png", strings.TrimSuffix(input.FileName, filepath.Ext(input.FileName)), page),
			MimeType: "image/png",
			Data:     data,
			Locator:  &locator,
			Metadata: mergeMetadata(filterMetadata, map[string]any{"page": page, "dpi": dpi}),
		})
		result.Units = append(result.Units, ContentUnit{Locator: locator, ArtifactIDs: []string{artifactID}})
	}
	result.Metadata["pageCount"] = len(result.Units)
	return result, nil
}

func mergeMetadata(base map[string]any, extra map[string]any) map[string]any {
	result := make(map[string]any, len(base)+len(extra))
	for key, value := range base {
		result[key] = value
	}
	for key, value := range extra {
		result[key] = value
	}
	return result
}

func PDFRenderedPageNumber(filePath string) int {
	name := strings.TrimSuffix(filepath.Base(filePath), filepath.Ext(filePath))
	separator := strings.LastIndex(name, "-")
	if separator < 0 {
		return 0
	}
	page, _ := strconv.Atoi(name[separator+1:])
	return page
}

func materializeInput(input Input, pattern string) (string, func(), error) {
	if input.FilePath != "" {
		if _, err := os.Stat(input.FilePath); err != nil {
			return "", func() {}, fmt.Errorf("读取文件失败: %w", err)
		}
		return input.FilePath, func() {}, nil
	}
	if len(input.Bytes) == 0 {
		return "", func() {}, errors.New("文件内容为空")
	}
	file, err := os.CreateTemp("", pattern)
	if err != nil {
		return "", func() {}, fmt.Errorf("创建解析临时文件失败: %w", err)
	}
	path := file.Name()
	cleanup := func() { _ = os.Remove(path) }
	if _, err := io.Copy(file, bytes.NewReader(input.Bytes)); err != nil {
		_ = file.Close()
		cleanup()
		return "", func() {}, fmt.Errorf("写入解析临时文件失败: %w", err)
	}
	if err := file.Close(); err != nil {
		cleanup()
		return "", func() {}, err
	}
	return path, cleanup, nil
}

func truncate(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit]) + "…"
}
