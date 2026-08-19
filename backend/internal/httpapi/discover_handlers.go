package httpapi

import (
	"errors"
	"net/http"
	"strings"

	"ai-marketing-go/internal/store"
)

func (s *Server) handleDiscover(w http.ResponseWriter, r *http.Request) {
	parts := splitPath(strings.TrimPrefix(strings.TrimPrefix(r.URL.Path, "/api/discover"), "/"))
	if len(parts) == 0 {
		writeError(w, http.StatusNotFound, "接口不存在")
		return
	}
	if len(parts) == 1 && parts[0] == "categories" && r.Method == http.MethodGet {
		categories, err := s.store.ListDiscoverCategories(false)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "发现分类读取失败")
			return
		}
		if categories == nil {
			categories = []store.DiscoverCategory{}
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": categories})
		return
	}
	if parts[0] != "items" {
		writeError(w, http.StatusNotFound, "接口不存在")
		return
	}
	if len(parts) == 1 && r.Method == http.MethodGet {
		page, pageSize := queryPage(r, 1, 20)
		_, result, err := s.store.ListDiscoverItems(true, page, pageSize, r.URL.Query().Get("categoryId"), r.URL.Query().Get("mediaType"), r.URL.Query().Get("search"))
		if err != nil {
			writeError(w, http.StatusInternalServerError, "发现内容读取失败")
			return
		}
		writeJSON(w, http.StatusOK, result)
		return
	}
	if len(parts) == 3 && (parts[2] == "like" || parts[2] == "view") && r.Method == http.MethodPost {
		column := "like_count"
		if parts[2] == "view" {
			column = "view_count"
		}
		counts, found, err := s.store.IncrementDiscoverCount(parts[1], column)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "发现内容计数更新失败")
			return
		}
		if !found {
			writeError(w, http.StatusNotFound, "发现条目不存在")
			return
		}
		writeJSON(w, http.StatusOK, counts)
		return
	}
	writeError(w, http.StatusNotFound, "接口不存在")
}

func (s *Server) handleAdminDiscover(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireUser(w, r, "admin.route.discover.view"); !ok {
		return
	}
	parts := splitPath(strings.TrimPrefix(strings.TrimPrefix(r.URL.Path, "/api/admin/discover"), "/"))
	if len(parts) == 0 {
		writeError(w, http.StatusNotFound, "接口不存在")
		return
	}
	if parts[0] == "categories" {
		s.handleAdminDiscoverCategories(w, r, parts[1:])
		return
	}
	if parts[0] == "items" {
		s.handleAdminDiscoverItems(w, r, parts[1:])
		return
	}
	writeError(w, http.StatusNotFound, "接口不存在")
}

func (s *Server) handleAdminDiscoverCategories(w http.ResponseWriter, r *http.Request, parts []string) {
	if len(parts) == 0 && r.Method == http.MethodGet {
		items, err := s.store.ListDiscoverCategories(true)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "发现分类读取失败")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": items})
		return
	}
	if len(parts) == 0 && r.Method == http.MethodPost {
		input, ok := decodeMap(w, r)
		if !ok {
			return
		}
		item, err := s.store.SaveDiscoverCategory("", input)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusCreated, item)
		return
	}
	if len(parts) == 1 {
		id := parts[0]
		if r.Method == http.MethodPatch || r.Method == http.MethodPut {
			input, ok := decodeMap(w, r)
			if !ok {
				return
			}
			item, err := s.store.SaveDiscoverCategory(id, input)
			if err != nil {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
			writeJSON(w, http.StatusOK, item)
			return
		}
		if r.Method == http.MethodDelete {
			if err := s.store.DeleteDiscoverCategory(id); err != nil {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
			writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
			return
		}
	}
	writeError(w, http.StatusMethodNotAllowed, "请求方法不支持")
}

func (s *Server) handleAdminDiscoverItems(w http.ResponseWriter, r *http.Request, parts []string) {
	if len(parts) == 0 && r.Method == http.MethodGet {
		page, pageSize := queryPage(r, 1, 100)
		_, result, err := s.store.ListDiscoverItems(false, page, pageSize, r.URL.Query().Get("categoryId"), "", "")
		if err != nil {
			writeError(w, http.StatusInternalServerError, "发现内容读取失败")
			return
		}
		writeJSON(w, http.StatusOK, result)
		return
	}
	if len(parts) == 0 && r.Method == http.MethodPost {
		input, ok := decodeMap(w, r)
		if !ok {
			return
		}
		item, err := s.createDiscoverItem(input)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusCreated, item)
		return
	}
	if len(parts) == 1 {
		id := parts[0]
		if r.Method == http.MethodPatch || r.Method == http.MethodPut {
			input, ok := decodeMap(w, r)
			if !ok {
				return
			}
			item, err := s.store.UpdateDiscoverItem(id, input)
			if err != nil {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
			writeJSON(w, http.StatusOK, item)
			return
		}
		if r.Method == http.MethodDelete {
			if err := s.store.DeleteDiscoverItem(id); err != nil {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
			writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
			return
		}
	}
	writeError(w, http.StatusMethodNotAllowed, "请求方法不支持")
}

func (s *Server) createDiscoverItem(input map[string]any) (store.DiscoverItem, error) {
	sourceID := stringValue(input, "sourceAssetId")
	categoryID := stringValue(input, "categoryId")
	asset, found, err := s.store.FindContentAsset(sourceID)
	if err != nil || !found {
		return store.DiscoverItem{}, errors.New("来源作品不存在")
	}
	if _, found, err := s.store.FindDiscoverCategory(categoryID); err != nil || !found {
		return store.DiscoverItem{}, errors.New("发现分类不存在")
	}
	mediaType := "video"
	if strings.HasPrefix(asset.MimeType, "image/") {
		mediaType = "image"
	}
	title := strings.TrimSpace(stringValue(input, "title"))
	if title == "" {
		title = asset.Name
	}
	coverURL := stringValue(input, "coverUrl")
	if coverURL == "" {
		if value, ok := asset.Metadata["coverUrl"].(string); ok {
			coverURL = value
		}
	}
	item := store.DiscoverItem{CategoryID: categoryID, SourceAssetID: sourceID, Title: title, Description: stringValue(input, "description"), MediaType: mediaType, MimeType: asset.MimeType, FileURL: asset.FileURL, CoverURL: coverURL, OriginalFileName: asset.OriginalFileName, FileSize: asset.FileSize, AspectRatio: "1 / 1", ReferenceAssets: []any{}}
	if value, ok := asset.Metadata["aspectRatio"].(string); ok && value != "" {
		item.AspectRatio = strings.ReplaceAll(value, ":", " / ")
	}
	return s.store.CreateDiscoverItem(item)
}
