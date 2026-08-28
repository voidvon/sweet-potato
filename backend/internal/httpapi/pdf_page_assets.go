package httpapi

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"sweet-potato-go/internal/assetextract"
	"sweet-potato-go/internal/imagegen"
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
		asset, found, err := s.findCachedPDFPageAsset(pdfAsset, page)
		if err != nil {
			return nil, err
		}
		if !found {
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

	result, err := s.assetExtract.Parse(ctx, assetextract.Input{
		FileName: pdfAsset.OriginalFileName,
		MimeType: pdfAsset.MimeType,
		FilePath: pdfAsset.FilePath,
	})
	if err != nil {
		return nil, err
	}
	if len(result.Artifacts) == 0 {
		return nil, errors.New("PDF 转换完成但没有生成页面图片")
	}

	assets := make([]store.ContentAsset, 0, len(result.Artifacts))
	for _, artifact := range result.Artifacts {
		page := 0
		if artifact.Locator != nil && artifact.Locator.Kind == "page" {
			page = artifact.Locator.Index
		}
		if page < 1 || page > pdfPageMaxPages {
			continue
		}
		optimized, encodingMetadata := optimizeGeneratedImageForStorage(imagegen.Output{Bytes: artifact.Data, MimeType: artifact.MimeType})
		extension := imageExtension(optimized.MimeType)
		storedName := pdfPageStoredName(pdfAsset.ID, page, extension)
		targetPath := filepath.Join(s.config.DataDir, "files", storedName)
		if err := os.WriteFile(targetPath, optimized.Bytes, 0o600); err != nil {
			return nil, fmt.Errorf("保存 PDF 第 %d 页图片失败: %w", page, err)
		}
		info, err := os.Stat(targetPath)
		if err != nil {
			return nil, err
		}
		parentID := pdfAsset.ID
		lifecycleStatus := valueOr(pdfAsset.LifecycleStatus, "permanent")
		metadata := map[string]any{
			"sourceType":          "pdf_page",
			"sourcePDFAssetId":    pdfAsset.ID,
			"sourcePDFName":       pdfAsset.OriginalFileName,
			"page":                page,
			"dpi":                 pdfPageDPI,
			"extractionParser":    result.Parser,
			"extractionVersion":   result.Version,
			"extractionPageCount": len(result.Artifacts),
		}
		for key, value := range artifact.Metadata {
			metadata[key] = value
		}
		for key, value := range encodingMetadata {
			metadata[key] = value
		}
		asset, err := s.store.CreateContentAsset(store.ContentAsset{
			UserID:           pdfAsset.UserID,
			GroupID:          pdfAsset.GroupID,
			ResourceType:     pdfAsset.ResourceType,
			Type:             "generated",
			Name:             fmt.Sprintf("%s 第 %d 页", strings.TrimSuffix(pdfAsset.OriginalFileName, filepath.Ext(pdfAsset.OriginalFileName)), page),
			Description:      fmt.Sprintf("PDF 第 %d 页的 %d DPI 高清参考图", page, pdfPageDPI),
			OriginalFileName: fmt.Sprintf("%s-page-%d.%s", strings.TrimSuffix(pdfAsset.OriginalFileName, filepath.Ext(pdfAsset.OriginalFileName)), page, extension),
			StoredFileName:   storedName,
			MimeType:         optimized.MimeType,
			FileSize:         info.Size(),
			Size:             info.Size(),
			FilePath:         targetPath,
			FileURL:          "/files/" + storedName,
			AssetKind:        "pdf_page_reference",
			LifecycleStatus:  lifecycleStatus,
			ParentAssetID:    &parentID,
			ExpiresAt:        pdfAsset.ExpiresAt,
			Metadata:         metadata,
		})
		if err != nil {
			_ = os.Remove(targetPath)
			return nil, fmt.Errorf("记录 PDF 第 %d 页图片失败: %w", page, err)
		}
		assets = append(assets, asset)
	}
	return assets, nil
}

func (s *Server) findCachedPDFPageAsset(pdfAsset store.ContentAsset, page int) (store.ContentAsset, bool, error) {
	for _, extension := range []string{"webp", "png"} {
		asset, found, err := s.store.FindContentAssetByStoredFileName(pdfPageStoredName(pdfAsset.ID, page, extension))
		if err != nil {
			return store.ContentAsset{}, false, err
		}
		if !found || asset.UserID != pdfAsset.UserID || stringValue(asset.Metadata, "sourcePDFAssetId") != pdfAsset.ID {
			continue
		}
		if _, err := os.Stat(asset.FilePath); err != nil {
			if errors.Is(err, fs.ErrNotExist) {
				continue
			}
			return store.ContentAsset{}, false, err
		}
		return asset, true, nil
	}
	return store.ContentAsset{}, false, nil
}

func pdfPageStoredName(pdfAssetID string, page int, extension string) string {
	return fmt.Sprintf("pdf-page-v2-%s-%03d-%ddpi.%s", sanitizeUploadName(pdfAssetID), page, pdfPageDPI, extension)
}

func pdfRenderedPageNumber(path string) int {
	return assetextract.PDFRenderedPageNumber(path)
}
