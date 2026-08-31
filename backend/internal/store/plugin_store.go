package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

var ErrPluginNotFound = errors.New("插件不存在")

type Plugin struct {
	Key                 string   `json:"key"`
	Name                string   `json:"name"`
	Category            string   `json:"category"`
	Version             string   `json:"version"`
	RequiredPermission  string   `json:"requiredPermission"`
	WorkflowVersion     string   `json:"workflowVersion"`
	RenderAdapter       string   `json:"renderAdapter"`
	AcceptedAttachments []string `json:"acceptedAttachments"`
	Enabled             bool     `json:"enabled"`
	SortOrder           int      `json:"sortOrder"`
	TimeoutSeconds      int      `json:"timeoutSeconds"`
	MaxConcurrency      int      `json:"maxConcurrency"`
	TemplateVersion     string   `json:"templateVersion"`
	UpdatedAt           string   `json:"updatedAt"`
}

type PluginSettingsUpdate struct {
	Enabled         bool
	SortOrder       int
	TimeoutSeconds  int
	MaxConcurrency  int
	TemplateVersion string
}

const pluginSelect = `SELECT d.plugin_key, d.name, d.category, d.version,
d.required_permission, d.workflow_version, d.render_adapter, d.accepted_attachments,
s.enabled, s.sort_order, s.timeout_seconds,
s.max_concurrency, s.template_version, s.updated_at
FROM plugin_definitions d JOIN plugin_settings s ON s.plugin_key = d.plugin_key`

func (s *Store) ListPlugins() ([]Plugin, error) {
	rows, err := s.db.Query(pluginSelect + ` ORDER BY s.sort_order, d.plugin_key`)
	if err != nil {
		return nil, fmt.Errorf("list plugins: %w", err)
	}
	defer rows.Close()
	plugins := make([]Plugin, 0)
	for rows.Next() {
		plugin, err := scanPlugin(rows)
		if err != nil {
			return nil, err
		}
		plugins = append(plugins, plugin)
	}
	return plugins, rows.Err()
}

func (s *Store) FindPlugin(key string) (Plugin, bool, error) {
	plugin, err := scanPlugin(s.db.QueryRow(pluginSelect+` WHERE d.plugin_key = ?`, strings.TrimSpace(key)))
	if errors.Is(err, sql.ErrNoRows) {
		return Plugin{}, false, nil
	}
	if err != nil {
		return Plugin{}, false, err
	}
	return plugin, true, nil
}

func (s *Store) UpdatePluginSettings(key string, input PluginSettingsUpdate) (Plugin, error) {
	_, found, err := s.FindPlugin(key)
	if err != nil {
		return Plugin{}, err
	}
	if !found {
		return Plugin{}, ErrPluginNotFound
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	result, err := s.db.Exec(`UPDATE plugin_settings SET enabled = ?, sort_order = ?,
timeout_seconds = ?, max_concurrency = ?,
template_version = ?, updated_at = ? WHERE plugin_key = ?`,
		boolInt(input.Enabled), input.SortOrder,
		input.TimeoutSeconds, input.MaxConcurrency, strings.TrimSpace(input.TemplateVersion), now, key)
	if err != nil {
		return Plugin{}, fmt.Errorf("update plugin settings: %w", err)
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		return Plugin{}, ErrPluginNotFound
	}
	updated, _, err := s.FindPlugin(key)
	return updated, err
}

func scanPlugin(row rowScanner) (Plugin, error) {
	var plugin Plugin
	var acceptedJSON string
	var enabled int
	if err := row.Scan(&plugin.Key, &plugin.Name, &plugin.Category, &plugin.Version,
		&plugin.RequiredPermission, &plugin.WorkflowVersion, &plugin.RenderAdapter, &acceptedJSON,
		&enabled, &plugin.SortOrder, &plugin.TimeoutSeconds,
		&plugin.MaxConcurrency, &plugin.TemplateVersion, &plugin.UpdatedAt); err != nil {
		return Plugin{}, err
	}
	if err := json.Unmarshal([]byte(acceptedJSON), &plugin.AcceptedAttachments); err != nil {
		return Plugin{}, fmt.Errorf("decode plugin attachments: %w", err)
	}
	plugin.Enabled = enabled != 0
	return plugin, nil
}
