package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"sweet-potato-go/internal/assetextract"
	"sweet-potato-go/internal/imagegen"
	"sweet-potato-go/internal/store"
)

const defaultAssetExtractionOptionsHash = "default"

func (s *Server) handleAssetExtraction(w http.ResponseWriter, r *http.Request, assetID string) {
	user, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	asset, found, err := s.store.FindContentAsset(assetID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "素材读取失败")
		return
	}
	if !found || (user.Role != "admin" && asset.UserID != user.ID) {
		writeError(w, http.StatusNotFound, "素材不存在")
		return
	}

	switch r.Method {
	case http.MethodGet:
		extraction, found, err := s.store.FindLatestAssetExtraction(asset.ID, asset.UserID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "解析记录读取失败")
			return
		}
		if !found {
			writeError(w, http.StatusNotFound, "素材尚未解析")
			return
		}
		writeJSON(w, http.StatusOK, extraction)
	case http.MethodPost:
		if strings.TrimSpace(asset.FilePath) == "" {
			writeError(w, http.StatusBadRequest, "素材没有可解析的本地文件")
			return
		}
		if _, err := os.Stat(asset.FilePath); err != nil {
			writeError(w, http.StatusBadRequest, "素材文件不存在，请重新上传")
			return
		}
		descriptor, err := s.assetExtract.DescriptorFor(assetExtractionInput(asset))
		if err != nil {
			if errors.Is(err, assetextract.ErrUnsupportedFormat) {
				writeError(w, http.StatusUnprocessableEntity, "当前仅支持解析 PPTX 和 PDF 文件")
				return
			}
			writeError(w, http.StatusInternalServerError, "解析器不可用")
			return
		}
		force := r.URL.Query().Get("force") == "true"
		latest, found, findErr := s.store.FindLatestAssetExtraction(asset.ID, asset.UserID)
		if findErr != nil {
			writeError(w, http.StatusInternalServerError, "解析记录读取失败")
			return
		}
		if found && latest.Parser == descriptor.Name && latest.ParserVersion == descriptor.Version && latest.OptionsHash == defaultAssetExtractionOptionsHash {
			if latest.Status == "queued" || latest.Status == "running" || (latest.Status == "completed" && !force) {
				status := http.StatusOK
				if latest.Status == "queued" || latest.Status == "running" {
					status = http.StatusAccepted
				}
				writeJSON(w, status, latest)
				return
			}
		}
		extraction, err := s.store.CreateAssetExtraction(store.AssetExtraction{
			AssetID: asset.ID, UserID: asset.UserID, Parser: descriptor.Name, ParserVersion: descriptor.Version,
			OptionsHash: defaultAssetExtractionOptionsHash,
		})
		if err != nil {
			writeError(w, http.StatusInternalServerError, "解析任务创建失败")
			return
		}
		s.startBackgroundTask(func() { s.executeAssetExtraction(extraction.ID, extraction.UserID) })
		writeJSON(w, http.StatusAccepted, extraction)
	default:
		writeError(w, http.StatusMethodNotAllowed, "请求方法不支持")
	}
}

func (s *Server) executeAssetExtraction(extractionID, userID string) {
	extraction, found, err := s.store.FindAssetExtraction(extractionID, userID)
	if err != nil || !found {
		return
	}
	asset, found, err := s.store.FindContentAsset(extraction.AssetID)
	if err != nil || !found || asset.UserID != userID {
		_, _ = s.store.FailAssetExtraction(extraction.ID, userID, "asset_not_found", "素材不存在或已被删除")
		return
	}
	contentHash, err := hashLocalFile(asset.FilePath)
	if err != nil {
		_, _ = s.store.FailAssetExtraction(extraction.ID, userID, "source_unavailable", err.Error())
		return
	}
	if _, err := s.store.MarkAssetExtractionRunning(extraction.ID, userID, contentHash); err != nil {
		return
	}
	result, err := s.assetExtract.Parse(s.taskContext(), assetExtractionInput(asset))
	if err != nil {
		code := "parse_failed"
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			code = "parse_cancelled"
		}
		_, _ = s.store.FailAssetExtraction(extraction.ID, userID, code, err.Error())
		return
	}
	filterSummary := extractionFilterSummary(result.Artifacts)
	derivedAssets, artifactIDs, err := s.persistExtractionArtifacts(asset, extraction.ID, result)
	if err != nil {
		_, _ = s.store.FailAssetExtraction(extraction.ID, userID, "artifact_persist_failed", err.Error())
		return
	}
	persistedArtifacts := make([]assetextract.Artifact, 0, len(derivedAssets))
	filteredArtifacts := make([]assetextract.Artifact, 0)
	for _, artifact := range result.Artifacts {
		localID := artifact.ID
		if assetID := artifactIDs[localID]; assetID != "" {
			artifact.Metadata = mergeAnyMaps(artifact.Metadata, map[string]any{"sourceArtifactId": localID})
			artifact.ID = assetID
			artifact.Data = nil
			if extractionArtifactIncluded(artifact) {
				persistedArtifacts = append(persistedArtifacts, artifact)
			} else {
				filteredArtifacts = append(filteredArtifacts, artifact)
			}
		}
	}
	result.Artifacts = persistedArtifacts
	result.FilteredArtifacts = filteredArtifacts
	for unitIndex := range result.Units {
		persistedIDs := make([]string, 0, len(result.Units[unitIndex].ArtifactIDs))
		for _, localID := range result.Units[unitIndex].ArtifactIDs {
			if assetID := artifactIDs[localID]; assetID != "" {
				persistedIDs = append(persistedIDs, assetID)
			}
		}
		result.Units[unitIndex].ArtifactIDs = persistedIDs
	}
	result.Metadata = mergeAnyMaps(result.Metadata, map[string]any{"filterSummary": filterSummary})
	resultMap, err := assetExtractionResultMap(result)
	if err != nil {
		_, _ = s.store.FailAssetExtraction(extraction.ID, userID, "result_encode_failed", err.Error())
		return
	}
	derivedIDs := make([]string, 0, len(persistedArtifacts))
	for _, artifact := range persistedArtifacts {
		derivedIDs = append(derivedIDs, artifact.ID)
	}
	if _, err := s.store.CompleteAssetExtraction(extraction.ID, userID, resultMap, derivedIDs); err == nil {
		_, _ = s.store.PruneAssetExtractionHistory(asset.ID, userID, 3)
	}
}

func assetExtractionInput(asset store.ContentAsset) assetextract.Input {
	return assetextract.Input{FileName: asset.OriginalFileName, MimeType: asset.MimeType, FilePath: asset.FilePath}
}

func hashLocalFile(filePath string) (string, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return "", fmt.Errorf("读取素材文件失败: %w", err)
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", fmt.Errorf("计算素材摘要失败: %w", err)
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func (s *Server) persistExtractionArtifacts(parent store.ContentAsset, extractionID string, result assetextract.Result) ([]store.ContentAsset, map[string]string, error) {
	assets := make([]store.ContentAsset, 0, len(result.Artifacts))
	artifactIDs := make(map[string]string, len(result.Artifacts))
	for _, artifact := range result.Artifacts {
		if len(artifact.Data) == 0 || artifact.ID == "" {
			continue
		}
		output := imagegen.Output{Bytes: artifact.Data, MimeType: artifact.MimeType}
		optimized, encodingMetadata := optimizeGeneratedImageForStorage(output)
		extension := strings.ToLower(filepath.Ext(artifact.FileName))
		if optimized.MimeType != artifact.MimeType {
			extension = "." + imageExtension(optimized.MimeType)
		}
		if extension == "" || len(extension) > 10 {
			extension = ".bin"
		}
		storedName := extractionArtifactStoredName(parent.ID, result.Parser, result.Version, artifact.ID, extension)
		if artifact.Kind == "page-image" && artifact.Locator != nil && artifact.Locator.Kind == "page" {
			storedName = pdfPageStoredName(parent.ID, artifact.Locator.Index, strings.TrimPrefix(extension, "."))
		}
		if cached, found, err := s.store.FindContentAssetByStoredFileName(storedName); err != nil {
			return nil, nil, err
		} else if found && cached.UserID == parent.UserID && cached.ParentAssetID != nil && *cached.ParentAssetID == parent.ID {
			if _, statErr := os.Stat(cached.FilePath); statErr == nil {
				assets = append(assets, cached)
				artifactIDs[artifact.ID] = cached.ID
				continue
			}
		}

		targetPath := filepath.Join(s.config.DataDir, "files", storedName)
		if err := os.WriteFile(targetPath, optimized.Bytes, 0o600); err != nil {
			return nil, nil, fmt.Errorf("保存解析派生文件失败: %w", err)
		}
		info, err := os.Stat(targetPath)
		if err != nil {
			_ = os.Remove(targetPath)
			return nil, nil, err
		}
		metadata := mergeAnyMaps(artifact.Metadata, encodingMetadata)
		metadata = mergeAnyMaps(metadata, map[string]any{
			"sourceType": "asset_extraction", "sourceAssetId": parent.ID, "sourceAssetName": parent.OriginalFileName,
			"sourceExtractionId": extractionID, "sourceArtifactId": artifact.ID, "extractionParser": result.Parser, "extractionVersion": result.Version,
		})
		assetKind := "extracted_embedded_image"
		if artifact.Kind == "page-image" {
			assetKind = "pdf_page_reference"
		} else if !extractionArtifactIncluded(artifact) {
			assetKind = "extracted_filtered_image"
		}
		name := strings.TrimSuffix(parent.OriginalFileName, filepath.Ext(parent.OriginalFileName)) + " · " + artifact.FileName
		parentID := parent.ID
		derived, err := s.store.CreateContentAsset(store.ContentAsset{
			UserID: parent.UserID, GroupID: parent.GroupID, ResourceType: parent.ResourceType, Type: "generated",
			Name: name, Description: "从 " + parent.OriginalFileName + " 解析得到的派生素材",
			OriginalFileName: artifact.FileName, StoredFileName: storedName, MimeType: optimized.MimeType,
			FileSize: info.Size(), Size: info.Size(), FilePath: targetPath, FileURL: "/files/" + storedName,
			AssetKind: assetKind, LifecycleStatus: parent.LifecycleStatus, ParentAssetID: &parentID, ExpiresAt: parent.ExpiresAt, Metadata: metadata,
		})
		if err != nil {
			_ = os.Remove(targetPath)
			return nil, nil, err
		}
		assets = append(assets, derived)
		artifactIDs[artifact.ID] = derived.ID
	}
	return assets, artifactIDs, nil
}

func extractionArtifactIncluded(artifact assetextract.Artifact) bool {
	included, found := artifact.Metadata["included"].(bool)
	return !found || included
}

func extractionFilterSummary(artifacts []assetextract.Artifact) map[string]any {
	categories := map[string]int{}
	included := 0
	for _, artifact := range artifacts {
		category, _ := artifact.Metadata["category"].(string)
		if category == "" {
			category = "unclassified"
		}
		categories[category]++
		if extractionArtifactIncluded(artifact) {
			included++
		}
	}
	return map[string]any{
		"total": len(artifacts), "included": included, "excluded": len(artifacts) - included, "categories": categories,
		"filterVersion": assetextract.ImageFilterVersion,
	}
}

func extractionArtifactStoredName(assetID, parser, version, artifactID, extension string) string {
	hash := sha256.Sum256([]byte(parser + "\x00" + version + "\x00" + artifactID))
	return sanitizeUploadName(fmt.Sprintf("asset-extract-v1-%s-%s%s", assetID, hex.EncodeToString(hash[:8]), extension))
}

func assetExtractionResultMap(result assetextract.Result) (map[string]any, error) {
	encoded, err := json.Marshal(result)
	if err != nil {
		return nil, err
	}
	var value map[string]any
	if err := json.Unmarshal(encoded, &value); err != nil {
		return nil, err
	}
	return value, nil
}

func mergeAnyMaps(base, extra map[string]any) map[string]any {
	result := make(map[string]any, len(base)+len(extra))
	for key, value := range base {
		result[key] = value
	}
	for key, value := range extra {
		result[key] = value
	}
	return result
}

func (s *Server) deleteContentAssetAndDerivedFiles(id, userID string) (store.ContentAsset, error) {
	assets, err := s.store.DeleteContentAssetTree(id, userID)
	if err != nil {
		return store.ContentAsset{}, err
	}
	for _, asset := range assets {
		removeStoredFile(asset.FilePath)
	}
	return assets[0], nil
}
