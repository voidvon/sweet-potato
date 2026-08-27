package httpapi

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"sweet-potato-go/internal/store"
)

const (
	pdfPageDPI      = 200
	pdfPageMaxPages = 20
)

func (s *Server) pdfPageReferenceCandidates(ctx context.Context, userID string, history []store.ChatMessage) ([]imageReferenceCandidate, error) {
	result := []imageReferenceCandidate{}
	seen := map[string]bool{}
	for messageIndex, message := range history {
		for attachmentIndex, rawAttachment := range message.Attachments {
			attachment := objectValue(rawAttachment)
			if !strings.EqualFold(strings.TrimSpace(stringValue(attachment, "type")), "application/pdf") {
				continue
			}
			assetID := strings.TrimPrefix(valueOr(stringValue(attachment, "assetId"), stringValue(attachment, "id")), "chat-attachment-")
			if assetID == "" || seen[assetID] {
				continue
			}
			seen[assetID] = true
			pdfAsset, found, err := s.store.FindContentAsset(assetID)
			if err != nil {
				return nil, err
			}
			if !found || pdfAsset.UserID != userID || !strings.EqualFold(pdfAsset.MimeType, "application/pdf") {
				continue
			}
			pages, err := s.renderPDFPageAssets(ctx, pdfAsset)
			if err != nil {
				return nil, err
			}
			for pageIndex, page := range pages {
				result = append(result, imageReferenceCandidate{
					Asset:              page,
					MessageID:          message.ID,
					MessageRole:        message.Role,
					MessagePosition:    messageIndex + 1,
					AttachmentPosition: attachmentIndex + 1,
					PDFPage:            pageIndex + 1,
					PDFSourceName:      pdfAsset.OriginalFileName,
				})
			}
		}
	}
	return result, nil
}

func (s *Server) renderPDFPageAssets(ctx context.Context, pdfAsset store.ContentAsset) ([]store.ContentAsset, error) {
	if strings.TrimSpace(pdfAsset.FilePath) == "" {
		return nil, errors.New("PDF 文件路径为空，无法转换页面图片")
	}
	if _, err := os.Stat(pdfAsset.FilePath); err != nil {
		return nil, fmt.Errorf("读取 PDF 文件失败: %w", err)
	}
	cached := make([]store.ContentAsset, 0, pdfPageMaxPages)
	for page := 1; page <= pdfPageMaxPages; page++ {
		name := pdfPageStoredName(pdfAsset.ID, page)
		asset, found, err := s.store.FindContentAssetByStoredFileName(name)
		if err != nil {
			return nil, err
		}
		if !found || asset.UserID != pdfAsset.UserID || stringValue(asset.Metadata, "sourcePDFAssetId") != pdfAsset.ID {
			break
		}
		if _, err := os.Stat(asset.FilePath); err != nil {
			break
		}
		cached = append(cached, asset)
	}
	if len(cached) > 0 {
		return cached, nil
	}

	renderer := strings.TrimSpace(os.Getenv("PDFTOCAIRO_PATH"))
	if renderer == "" {
		var err error
		renderer, err = exec.LookPath("pdftocairo")
		if err != nil {
			return nil, errors.New("PDF 高清转换组件未安装：请安装 Poppler（pdftocairo）后重试")
		}
	}
	tempDir, err := os.MkdirTemp("", "sweet-potato-pdf-pages-")
	if err != nil {
		return nil, fmt.Errorf("创建 PDF 转换临时目录失败: %w", err)
	}
	defer os.RemoveAll(tempDir)
	prefix := filepath.Join(tempDir, "page")
	command := exec.CommandContext(ctx, renderer, "-png", "-r", strconv.Itoa(pdfPageDPI), "-f", "1", "-l", strconv.Itoa(pdfPageMaxPages), pdfAsset.FilePath, prefix)
	if output, err := command.CombinedOutput(); err != nil {
		if errors.Is(ctx.Err(), context.Canceled) {
			return nil, ctx.Err()
		}
		return nil, fmt.Errorf("PDF 转换为 %d DPI 图片失败: %s", pdfPageDPI, truncateRunes(strings.TrimSpace(string(output)), 300))
	}
	paths, err := filepath.Glob(prefix + "-*.png")
	if err != nil {
		return nil, err
	}
	sort.Slice(paths, func(left, right int) bool {
		return pdfRenderedPageNumber(paths[left]) < pdfRenderedPageNumber(paths[right])
	})
	if len(paths) == 0 {
		return nil, errors.New("PDF 转换完成但没有生成页面图片")
	}

	expiresAt := time.Now().UTC().Add(24 * time.Hour).Format(time.RFC3339Nano)
	assets := make([]store.ContentAsset, 0, len(paths))
	for _, sourcePath := range paths {
		page := pdfRenderedPageNumber(sourcePath)
		if page < 1 || page > pdfPageMaxPages {
			continue
		}
		storedName := pdfPageStoredName(pdfAsset.ID, page)
		targetPath := filepath.Join(s.config.DataDir, "files", storedName)
		if err := os.Rename(sourcePath, targetPath); err != nil {
			return nil, fmt.Errorf("保存 PDF 第 %d 页图片失败: %w", page, err)
		}
		info, err := os.Stat(targetPath)
		if err != nil {
			return nil, err
		}
		parentID := pdfAsset.ID
		asset, err := s.store.CreateContentAsset(store.ContentAsset{
			UserID:           pdfAsset.UserID,
			GroupID:          pdfAsset.GroupID,
			ResourceType:     pdfAsset.ResourceType,
			Type:             "generated",
			Name:             fmt.Sprintf("%s 第 %d 页", strings.TrimSuffix(pdfAsset.OriginalFileName, filepath.Ext(pdfAsset.OriginalFileName)), page),
			Description:      fmt.Sprintf("PDF 第 %d 页的 %d DPI 高清参考图", page, pdfPageDPI),
			OriginalFileName: fmt.Sprintf("%s-page-%d.png", strings.TrimSuffix(pdfAsset.OriginalFileName, filepath.Ext(pdfAsset.OriginalFileName)), page),
			StoredFileName:   storedName,
			MimeType:         "image/png",
			FileSize:         info.Size(),
			Size:             info.Size(),
			FilePath:         targetPath,
			FileURL:          "/files/" + storedName,
			AssetKind:        "pdf_page_reference",
			LifecycleStatus:  "temporary",
			ParentAssetID:    &parentID,
			ExpiresAt:        &expiresAt,
			Metadata: map[string]any{
				"sourceType":       "pdf_page",
				"sourcePDFAssetId": pdfAsset.ID,
				"sourcePDFName":    pdfAsset.OriginalFileName,
				"page":             page,
				"dpi":              pdfPageDPI,
			},
		})
		if err != nil {
			_ = os.Remove(targetPath)
			return nil, fmt.Errorf("记录 PDF 第 %d 页图片失败: %w", page, err)
		}
		assets = append(assets, asset)
	}
	return assets, nil
}

func pdfPageStoredName(pdfAssetID string, page int) string {
	return fmt.Sprintf("pdf-page-%s-%03d-%ddpi.png", sanitizeUploadName(pdfAssetID), page, pdfPageDPI)
}

func pdfRenderedPageNumber(path string) int {
	name := strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
	separator := strings.LastIndex(name, "-")
	if separator < 0 {
		return 0
	}
	page, _ := strconv.Atoi(name[separator+1:])
	return page
}
