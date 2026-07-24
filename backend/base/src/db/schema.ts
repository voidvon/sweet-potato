import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { dataDir, db } from './database.js';
import { defaultAgents } from '../modules/agents/agent.defaults.js';
import { listAudioModelProviders } from '../modules/audio-models/audio-model.registry.js';
import { llmModelPricingSeeds } from '../modules/model-configs/llm-model-pricing.seed.js';
import { defaultImageModelConfig, defaultModelConfig, openaiImageModelConfig } from '../modules/model-configs/model-config.defaults.js';
import { defaultAppRoleKey, defaultOnboardingRoleKey } from '../modules/roles/permission-catalog.js';
import { defaultRoleResourceIds, seededRouteResources } from '../modules/route-resources/route-resource.seed.js';

function addColumnIfMissing(table: string, column: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  }
}

function hasColumn(table: string, column: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return columns.some((item) => item.name === column);
}

function quoteIdentifier(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function migrateContentFilesDirectory() {
  const oldFilesDir = path.join(dataDir, 'content-files');
  const newFilesDir = path.join(dataDir, 'files');
  if (existsSync(oldFilesDir)) {
    if (!existsSync(newFilesDir)) {
      renameSync(oldFilesDir, newFilesDir);
    } else {
      mkdirSync(newFilesDir, { recursive: true });
      readdirSync(oldFilesDir).forEach((fileName) => {
        const oldFilePath = path.join(oldFilesDir, fileName);
        const newFilePath = path.join(newFilesDir, fileName);
        if (!existsSync(newFilePath)) {
          cpSync(oldFilePath, newFilePath, { recursive: true });
        }
      });
      rmSync(oldFilesDir, { recursive: true, force: true });
    }
  } else {
    mkdirSync(newFilesDir, { recursive: true });
  }

  const tables = db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND name NOT LIKE 'sqlite_%'
  `).all() as Array<{ name: string }>;
  tables.forEach(({ name }) => {
    const tableName = quoteIdentifier(name);
    const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string; type: string }>;
    columns
      .filter((column) => String(column.type || '').toUpperCase().includes('TEXT'))
      .forEach((column) => {
        const columnName = quoteIdentifier(column.name);
        db.prepare(`
          UPDATE ${tableName}
          SET ${columnName} = replace(replace(${columnName}, @oldUrl, @newUrl), @oldDir, @newDir)
          WHERE ${columnName} LIKE @oldUrlLike
            OR ${columnName} LIKE @oldDirLike
        `).run({
          oldUrl: '/files/content/',
          newUrl: '/files/',
          oldUrlLike: '%/files/content/%',
          oldDir: oldFilesDir,
          newDir: newFilesDir,
          oldDirLike: `%${oldFilesDir}%`,
        });
      });
  });
}

function backfillSettledContentPlanningLedgerTypes() {
  db.prepare(`
    UPDATE credit_ledger
    SET type = 'usage_debit'
    WHERE type = 'reserve_debit'
      AND source_type IN ('content_planning_analysis', 'content_planning_generation')
      AND EXISTS (
        SELECT 1
        FROM credit_reservations
        WHERE credit_reservations.user_id = credit_ledger.user_id
          AND credit_reservations.source_type = credit_ledger.source_type
          AND credit_reservations.source_id = credit_ledger.source_id
          AND credit_reservations.status = 'settled'
      )
  `).run();
}

export function migrateDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      role_id TEXT,
      is_blacklisted INTEGER NOT NULL DEFAULT 0,
      credit_balance REAL NOT NULL DEFAULT 0,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_login_at TEXT
    );

    CREATE TABLE IF NOT EXISTS billing_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      enabled INTEGER NOT NULL DEFAULT 1,
      seedance_2_credits_per_second_720p REAL NOT NULL DEFAULT 20,
      seedance_2_credits_per_second_480p REAL NOT NULL DEFAULT 12,
      seedance_2_fast_credits_per_second_720p REAL NOT NULL DEFAULT 18,
      seedance_2_fast_credits_per_second_480p REAL NOT NULL DEFAULT 11,
      seedance_2_mini_credits_per_second_720p REAL NOT NULL DEFAULT 15,
      seedance_2_mini_credits_per_second_480p REAL NOT NULL DEFAULT 7,
      video_upload_credits_per_mb REAL NOT NULL DEFAULT 0,
      video_understanding_credits_per_1m_tokens REAL NOT NULL DEFAULT 0,
      content_planning_analysis_credits_per_request REAL NOT NULL DEFAULT 2,
      content_planning_generation_credits_per_request REAL NOT NULL DEFAULT 3,
      talking_video_prompt_credits_per_request REAL NOT NULL DEFAULT 3,
      marketing_video_credits_per_request REAL NOT NULL DEFAULT 15,
      marketing_video_storyboard_model_config_id TEXT NOT NULL DEFAULT '',
      video_upscale_credits_per_request REAL NOT NULL DEFAULT 20,
      subtitle_removal_credits_per_second REAL NOT NULL DEFAULT 2,
      video_translation_subtitle_credits_per_second REAL NOT NULL DEFAULT 1,
      video_translation_voice_credits_per_second REAL NOT NULL DEFAULT 2,
      video_translation_face_credits_per_second REAL NOT NULL DEFAULT 2,
      video_translation_erase_source_credits_per_second REAL NOT NULL DEFAULT 2,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS roles (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      is_system INTEGER NOT NULL DEFAULT 0,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS role_permissions (
      role_id TEXT NOT NULL,
      permission_key TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (role_id, permission_key)
    );

    CREATE TABLE IF NOT EXISTS route_resources (
      id TEXT PRIMARY KEY,
      parent_id TEXT,
      name TEXT NOT NULL,
      resource_key TEXT NOT NULL UNIQUE,
      resource_type TEXT NOT NULL,
      platform TEXT NOT NULL,
      path TEXT NOT NULL DEFAULT '',
      permission_code TEXT NOT NULL UNIQUE,
      status INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_system INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS role_resource_permissions (
      role_id TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (role_id, resource_id)
    );

    CREATE TABLE IF NOT EXISTS user_role_assignments (
      user_id TEXT NOT NULL,
      role_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, role_id)
    );

    CREATE TABLE IF NOT EXISTS credit_reservations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      reserved_credits REAL NOT NULL,
      status TEXT NOT NULL,
      snapshot TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      settled_at TEXT
    );

    CREATE TABLE IF NOT EXISTS llm_usage_records (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      model_config_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      cached_prompt_tokens INTEGER NOT NULL DEFAULT 0,
      usage_raw TEXT NOT NULL DEFAULT '{}',
      billing_snapshot TEXT NOT NULL DEFAULT '{}',
      credit_base_cost REAL NOT NULL DEFAULT 0,
      credit_billed_cost REAL NOT NULL DEFAULT 0,
      credit_cost REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS credit_ledger (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      credit_delta REAL NOT NULL,
      credit_balance_after REAL NOT NULL,
      credit_base_cost REAL,
      credit_billed_cost REAL,
      source_type TEXT,
      source_id TEXT,
      snapshot TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS billable_usage_records (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      category TEXT NOT NULL,
      model_config_id TEXT,
      provider TEXT,
      model TEXT,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      task_id TEXT,
      session_id TEXT,
      group_id TEXT,
      pricing_mode TEXT NOT NULL,
      quantity_snapshot TEXT NOT NULL DEFAULT '{}',
      usage_raw TEXT NOT NULL DEFAULT '{}',
      request_snapshot TEXT NOT NULL DEFAULT '{}',
      response_snapshot TEXT NOT NULL DEFAULT '{}',
      credit_base_cost REAL NOT NULL DEFAULT 0,
      credit_billed_cost REAL NOT NULL DEFAULT 0,
      credit_cost REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_model_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      api_key TEXT NOT NULL DEFAULT '',
      base_url TEXT NOT NULL,
      temperature REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS model_configs (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      api_key TEXT NOT NULL DEFAULT '',
      base_url TEXT NOT NULL,
      temperature REAL NOT NULL DEFAULT 0.7,
      settings TEXT NOT NULL DEFAULT '{}',
      is_default INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS llm_model_pricing (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      provider_name TEXT NOT NULL,
      model TEXT NOT NULL,
      display_name TEXT NOT NULL,
      default_base_url TEXT NOT NULL,
      currency TEXT NOT NULL,
      input_price_per_1m REAL NOT NULL DEFAULT 0,
      output_price_per_1m REAL NOT NULL DEFAULT 0,
      cached_input_price_per_1m REAL NOT NULL DEFAULT 0,
      price_source TEXT NOT NULL DEFAULT 'official-manual',
      price_updated_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      icon TEXT NOT NULL,
      built_in INTEGER NOT NULL DEFAULT 0,
      capabilities TEXT NOT NULL,
      run_mode TEXT NOT NULL DEFAULT 'quick',
      model_config_id TEXT,
      system_prompt TEXT NOT NULL,
      tools TEXT NOT NULL DEFAULT '[]',
      skills TEXT NOT NULL DEFAULT '[]',
      retrieval_strategy TEXT NOT NULL DEFAULT 'semantic',
      web_search_enabled INTEGER NOT NULL DEFAULT 0,
      multimodal TEXT NOT NULL DEFAULT '{"imageUpload":false,"fileUpload":true}',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_conversations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      model_config_id TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      capability_context TEXT,
      image_model_config_id TEXT,
      generation_job_id TEXT,
      image_generation_expected_count INTEGER,
      image_generation_failures TEXT NOT NULL DEFAULT '[]',
      reasoning_content TEXT,
      actions TEXT NOT NULL DEFAULT '[]',
      agent_id TEXT NOT NULL,
      model_config_id TEXT,
      attachments TEXT NOT NULL DEFAULT '[]',
      is_completed INTEGER NOT NULL DEFAULT 1,
      credit_cost REAL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS generation_jobs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      source_module TEXT NOT NULL,
      conversation_id TEXT,
      user_message_id TEXT,
      assistant_message_id TEXT,
      status TEXT NOT NULL,
      expected_count INTEGER NOT NULL DEFAULT 1,
      completed_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      payload TEXT NOT NULL DEFAULT '{}',
      result TEXT NOT NULL DEFAULT '{}',
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS generation_job_items (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      slot_index INTEGER NOT NULL,
      status TEXT NOT NULL,
      input TEXT NOT NULL DEFAULT '{}',
      attachment_id TEXT,
      error TEXT,
      started_at TEXT,
      completed_at TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS skill_files (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      command TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'brand_style',
      scenario TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      is_default INTEGER NOT NULL DEFAULT 0,
      original_file_name TEXT NOT NULL,
      stored_file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_url TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS creative_tasks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      module_code TEXT NOT NULL,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL,
      resource_mode TEXT NOT NULL,
      estimated_cost INTEGER NOT NULL DEFAULT 0,
      actual_cost INTEGER NOT NULL DEFAULT 0,
      result TEXT NOT NULL DEFAULT '',
      failure_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS content_asset_groups (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      resource_type TEXT NOT NULL DEFAULT 'other',
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      metadata TEXT NOT NULL DEFAULT '{}',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS content_assets (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'file',
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      source_url TEXT,
      original_file_name TEXT NOT NULL,
      stored_file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_size INTEGER NOT NULL DEFAULT 0,
      size INTEGER NOT NULL DEFAULT 0,
      file_path TEXT NOT NULL,
      file_url TEXT NOT NULL,
      asset_kind TEXT NOT NULL DEFAULT 'library',
      lifecycle_status TEXT NOT NULL DEFAULT 'permanent',
      parent_asset_id TEXT,
      expires_at TEXT,
      retained_at TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS content_asset_references (
      asset_id TEXT NOT NULL,
      reference_type TEXT NOT NULL,
      reference_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'input',
      created_at TEXT NOT NULL,
      PRIMARY KEY (asset_id, reference_type, reference_id, role)
    );

    CREATE TABLE IF NOT EXISTS discover_categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS discover_items (
      id TEXT PRIMARY KEY,
      category_id TEXT NOT NULL,
      source_asset_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      media_type TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_url TEXT NOT NULL,
      cover_url TEXT NOT NULL DEFAULT '',
      original_file_name TEXT NOT NULL DEFAULT '',
      file_size INTEGER NOT NULL DEFAULT 0,
      like_count INTEGER NOT NULL DEFAULT 0,
      view_count INTEGER NOT NULL DEFAULT 0,
      duration REAL NOT NULL DEFAULT 0,
      source_created_at TEXT,
      source_completed_at TEXT,
      reference_assets TEXT NOT NULL DEFAULT '[]',
      aspect_ratio TEXT NOT NULL DEFAULT '1 / 1',
      published_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS marketing_video_storyboards (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      product_name TEXT NOT NULL,
      product_category TEXT NOT NULL,
      selling_points TEXT NOT NULL,
      additional_prompt TEXT NOT NULL DEFAULT '',
      prompt TEXT NOT NULL,
      reference_image_ids TEXT NOT NULL DEFAULT '[]',
      model_config_id TEXT NOT NULL,
      model_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'generating',
      image_asset_id TEXT,
      image_url TEXT,
      video_task_id TEXT,
      reservation_id TEXT,
      credit_cost REAL NOT NULL DEFAULT 0,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_marketing_video_storyboards_user_created
      ON marketing_video_storyboards(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS temporary_asset_cleanup_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      username TEXT NOT NULL DEFAULT '',
      asset_kind TEXT NOT NULL,
      name TEXT NOT NULL,
      file_url TEXT NOT NULL,
      file_size INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT,
      trigger_type TEXT NOT NULL,
      cleaned_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS site_access_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ip TEXT NOT NULL,
      user_id TEXT NOT NULL DEFAULT '',
      username TEXT NOT NULL DEFAULT '',
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      user_agent TEXT NOT NULL DEFAULT '',
      status_code INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      accessed_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_site_access_logs_accessed_at
      ON site_access_logs(accessed_at DESC);

    CREATE INDEX IF NOT EXISTS idx_site_access_logs_ip_accessed_at
      ON site_access_logs(ip, accessed_at DESC);

    CREATE TABLE IF NOT EXISTS site_access_log_settings (
      id TEXT PRIMARY KEY,
      retention_days INTEGER NOT NULL DEFAULT 7,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS batch_request_settings (
      id TEXT PRIMARY KEY,
      max_count INTEGER NOT NULL DEFAULT 20,
      max_duration_seconds INTEGER NOT NULL DEFAULT 300,
      max_file_size_mb INTEGER NOT NULL DEFAULT 100,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS file_storage_settings (
      id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 0,
      endpoint TEXT NOT NULL DEFAULT '',
      bucket TEXT NOT NULL DEFAULT '',
      region TEXT NOT NULL DEFAULT '',
      access_key TEXT NOT NULL DEFAULT '',
      secret_key TEXT NOT NULL DEFAULT '',
      public_base_url TEXT NOT NULL DEFAULT '',
      key_prefix TEXT NOT NULL DEFAULT 'app-files',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS file_upload_intents (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      group_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      bucket TEXT NOT NULL,
      object_key TEXT NOT NULL,
      public_file_url TEXT NOT NULL DEFAULT '',
      resource_type TEXT NOT NULL,
      original_file_name TEXT NOT NULL,
      stored_file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_size INTEGER NOT NULL DEFAULT 0,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      asset_kind TEXT NOT NULL DEFAULT 'upload',
      lifecycle_status TEXT NOT NULL DEFAULT 'temporary',
      metadata TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending',
      asset_id TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_file_upload_intents_user_status
      ON file_upload_intents(user_id, status, expires_at);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_file_upload_intents_object
      ON file_upload_intents(bucket, object_key);

    CREATE TABLE IF NOT EXISTS rate_limit_rules (
      id TEXT PRIMARY KEY,
      url_pattern TEXT NOT NULL,
      max_requests INTEGER NOT NULL,
      interval_seconds INTEGER NOT NULL,
      target_user TEXT NOT NULL DEFAULT 'all',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ip_blacklist_entries (
      rule TEXT PRIMARY KEY,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS video_generation_tasks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      source_url TEXT NOT NULL,
      prompt TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      raw_parse_result TEXT NOT NULL DEFAULT '{}',
      editable_parse_result TEXT NOT NULL DEFAULT '{}',
      selected_skill_ids TEXT NOT NULL DEFAULT '[]',
      expert_context TEXT NOT NULL DEFAULT '{}',
      selected_digital_human_id TEXT,
      selected_voice_id TEXT,
      selected_scene_id TEXT,
      generated_video_url TEXT,
      generated_cover_url TEXT,
      aspect_ratio TEXT NOT NULL DEFAULT '',
      failure_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS xingtu_search_drafts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      profile_id TEXT NOT NULL,
      keyword TEXT NOT NULL,
      search_mode TEXT NOT NULL,
      criteria TEXT NOT NULL DEFAULT '[]',
      automation_filters TEXT,
      source_text TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      last_run_task_id TEXT,
      last_result_summary TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS video_remake_sessions (
      id TEXT PRIMARY KEY,
      task_id TEXT,
      user_id TEXT NOT NULL,
      filename TEXT,
      status TEXT NOT NULL,
      current_step TEXT NOT NULL,
      invalid_artifacts TEXT NOT NULL DEFAULT '[]',
      artifacts TEXT NOT NULL DEFAULT '{}',
      workflow_state TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      cancelled_at TEXT
    );

    CREATE TABLE IF NOT EXISTS video_remake_cards (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      card_id TEXT NOT NULL,
      card_type TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      data TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS video_remake_events (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS video_remake_final_segments (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      card_id TEXT NOT NULL,
      version_label TEXT NOT NULL DEFAULT '',
      version_number INTEGER NOT NULL DEFAULT 0,
      segment_index INTEGER NOT NULL,
      video_url TEXT,
      file_path TEXT,
      status TEXT NOT NULL DEFAULT 'completed',
      prompt TEXT NOT NULL DEFAULT '{}',
      data TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_chat_conversations_user_updated
    ON chat_conversations(user_id, updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation_created
    ON chat_messages(conversation_id, created_at ASC);

    CREATE INDEX IF NOT EXISTS idx_generation_jobs_conversation
    ON generation_jobs(conversation_id, updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_generation_job_items_job_slot
    ON generation_job_items(job_id, slot_index ASC);

    CREATE INDEX IF NOT EXISTS idx_skill_files_user_updated
    ON skill_files(user_id, updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_creative_tasks_user_updated
    ON creative_tasks(user_id, updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_content_asset_groups_user_updated
    ON content_asset_groups(user_id, updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_content_assets_user_updated
    ON content_assets(user_id, updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_content_assets_group_updated
    ON content_assets(group_id, updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_content_assets_resource_updated
    ON content_assets(resource_type, updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_discover_items_category_published
    ON discover_items(category_id, published_at DESC, updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_discover_items_source_asset
    ON discover_items(source_asset_id);

    CREATE INDEX IF NOT EXISTS idx_video_generation_tasks_user_updated
    ON video_generation_tasks(user_id, updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_video_generation_tasks_user_created
    ON video_generation_tasks(user_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_xingtu_search_drafts_user_updated
    ON xingtu_search_drafts(user_id, updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_video_remake_sessions_user_updated
    ON video_remake_sessions(user_id, updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_credit_reservations_user_created
    ON credit_reservations(user_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_llm_usage_records_user_created
    ON llm_usage_records(user_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_credit_ledger_user_created
    ON credit_ledger(user_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_billable_usage_records_user_created
    ON billable_usage_records(user_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_video_remake_cards_session_created
    ON video_remake_cards(session_id, created_at ASC);

    CREATE INDEX IF NOT EXISTS idx_video_remake_events_session_created
    ON video_remake_events(session_id, created_at ASC);

    CREATE INDEX IF NOT EXISTS idx_video_remake_final_segments_session_version
    ON video_remake_final_segments(session_id, card_id, version_label, segment_index ASC);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_video_remake_final_segments_unique
    ON video_remake_final_segments(session_id, card_id, version_label, segment_index);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_model_configs_type_default
    ON model_configs(type)
    WHERE is_default = 1;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_llm_model_pricing_provider_model
    ON llm_model_pricing(provider, model);
  `);

  db.exec('DROP INDEX IF EXISTS idx_discover_items_category_status_order');
  db.exec('DROP INDEX IF EXISTS idx_discover_items_category_order');
  if (hasColumn('discover_items', 'status')) {
    db.exec(`
      UPDATE discover_items
      SET published_at = COALESCE(published_at, created_at);

      ALTER TABLE discover_items DROP COLUMN status;
    `);
  }
  if (hasColumn('discover_items', 'sort_order')) {
    db.exec('ALTER TABLE discover_items DROP COLUMN sort_order');
  }

  addColumnIfMissing('users', 'avatar_url', 'avatar_url TEXT');
  addColumnIfMissing('users', 'role', "role TEXT NOT NULL DEFAULT 'user'");
  addColumnIfMissing('users', 'role_id', 'role_id TEXT');
  addColumnIfMissing('users', 'is_blacklisted', 'is_blacklisted INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing('users', 'credit_balance', 'credit_balance REAL NOT NULL DEFAULT 0');
  addColumnIfMissing('users', 'last_login_at', 'last_login_at TEXT');
  addColumnIfMissing('site_access_logs', 'user_id', "user_id TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing('site_access_logs', 'username', "username TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing('billing_settings', 'seedance_2_credits_per_second_720p', 'seedance_2_credits_per_second_720p REAL NOT NULL DEFAULT 20');
  addColumnIfMissing('billing_settings', 'seedance_2_credits_per_second_480p', 'seedance_2_credits_per_second_480p REAL NOT NULL DEFAULT 12');
  addColumnIfMissing('billing_settings', 'seedance_2_fast_credits_per_second_720p', 'seedance_2_fast_credits_per_second_720p REAL NOT NULL DEFAULT 18');
  addColumnIfMissing('billing_settings', 'seedance_2_fast_credits_per_second_480p', 'seedance_2_fast_credits_per_second_480p REAL NOT NULL DEFAULT 11');
  addColumnIfMissing('billing_settings', 'seedance_2_mini_credits_per_second_720p', 'seedance_2_mini_credits_per_second_720p REAL NOT NULL DEFAULT 15');
  addColumnIfMissing('billing_settings', 'seedance_2_mini_credits_per_second_480p', 'seedance_2_mini_credits_per_second_480p REAL NOT NULL DEFAULT 7');
  addColumnIfMissing('billing_settings', 'video_upload_credits_per_mb', 'video_upload_credits_per_mb REAL NOT NULL DEFAULT 0');
  addColumnIfMissing('billing_settings', 'video_understanding_credits_per_1m_tokens', 'video_understanding_credits_per_1m_tokens REAL NOT NULL DEFAULT 0');
  addColumnIfMissing('billing_settings', 'content_planning_analysis_credits_per_request', 'content_planning_analysis_credits_per_request REAL NOT NULL DEFAULT 2');
  addColumnIfMissing('billing_settings', 'content_planning_generation_credits_per_request', 'content_planning_generation_credits_per_request REAL NOT NULL DEFAULT 3');
  addColumnIfMissing('billing_settings', 'talking_video_prompt_credits_per_request', 'talking_video_prompt_credits_per_request REAL NOT NULL DEFAULT 3');
  addColumnIfMissing('billing_settings', 'marketing_video_credits_per_request', 'marketing_video_credits_per_request REAL NOT NULL DEFAULT 15');
  addColumnIfMissing('billing_settings', 'marketing_video_storyboard_model_config_id', "marketing_video_storyboard_model_config_id TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing('billing_settings', 'video_upscale_credits_per_request', 'video_upscale_credits_per_request REAL NOT NULL DEFAULT 20');
  addColumnIfMissing('billing_settings', 'subtitle_removal_credits_per_second', 'subtitle_removal_credits_per_second REAL NOT NULL DEFAULT 2');
  addColumnIfMissing('billing_settings', 'video_translation_subtitle_credits_per_second', 'video_translation_subtitle_credits_per_second REAL NOT NULL DEFAULT 1');
  addColumnIfMissing('billing_settings', 'video_translation_voice_credits_per_second', 'video_translation_voice_credits_per_second REAL NOT NULL DEFAULT 2');
  addColumnIfMissing('billing_settings', 'video_translation_face_credits_per_second', 'video_translation_face_credits_per_second REAL NOT NULL DEFAULT 2');
  addColumnIfMissing('billing_settings', 'video_translation_erase_source_credits_per_second', 'video_translation_erase_source_credits_per_second REAL NOT NULL DEFAULT 2');
  addColumnIfMissing('marketing_video_storyboards', 'additional_prompt', "additional_prompt TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing('marketing_video_storyboards', 'video_task_id', 'video_task_id TEXT');
  db.exec(`
    UPDATE marketing_video_storyboards AS storyboard
    SET video_task_id = (
      SELECT video_task.id
      FROM video_generation_tasks AS video_task
      WHERE video_task.user_id = storyboard.user_id
        AND video_task.created_at >= storyboard.created_at
        AND EXISTS (
          SELECT 1
          FROM json_each(video_task.expert_context, '$.referenceImageIds') AS reference_image
          WHERE CAST(reference_image.value AS TEXT) = storyboard.image_asset_id
        )
      ORDER BY video_task.created_at DESC
      LIMIT 1
    )
    WHERE storyboard.video_task_id IS NULL
      AND storyboard.image_asset_id IS NOT NULL
  `);
  const storyboardRetentionNow = new Date().toISOString();
  db.prepare(`
    INSERT OR IGNORE INTO content_asset_references (
      asset_id, reference_type, reference_id, role, created_at
    )
    SELECT
      CAST(image_id.value AS TEXT),
      'marketing_video_storyboard',
      storyboard.id,
      'input',
      @now
    FROM marketing_video_storyboards storyboard
    JOIN json_each(
      CASE WHEN json_valid(storyboard.reference_image_ids)
        THEN storyboard.reference_image_ids
        ELSE '[]'
      END
    ) image_id
    INNER JOIN content_assets asset
      ON asset.id = CAST(image_id.value AS TEXT)
      AND asset.user_id = storyboard.user_id
  `).run({ now: storyboardRetentionNow });
  db.prepare(`
    UPDATE content_assets
    SET lifecycle_status = 'retained', expires_at = NULL,
        retained_at = @now, updated_at = @now
    WHERE lifecycle_status = 'temporary'
      AND EXISTS (
        SELECT 1
        FROM content_asset_references reference
        WHERE reference.asset_id = content_assets.id
          AND reference.reference_type = 'marketing_video_storyboard'
      )
  `).run({ now: storyboardRetentionNow });
  addColumnIfMissing('llm_usage_records', 'credit_base_cost', 'credit_base_cost REAL NOT NULL DEFAULT 0');
  addColumnIfMissing('llm_usage_records', 'credit_billed_cost', 'credit_billed_cost REAL NOT NULL DEFAULT 0');
  addColumnIfMissing('credit_ledger', 'credit_base_cost', 'credit_base_cost REAL');
  addColumnIfMissing('credit_ledger', 'credit_billed_cost', 'credit_billed_cost REAL');
  addColumnIfMissing('billable_usage_records', 'credit_base_cost', 'credit_base_cost REAL NOT NULL DEFAULT 0');
  addColumnIfMissing('billable_usage_records', 'credit_billed_cost', 'credit_billed_cost REAL NOT NULL DEFAULT 0');
  addColumnIfMissing('chat_messages', 'reasoning_content', 'reasoning_content TEXT');
  addColumnIfMissing('chat_messages', 'capability_context', 'capability_context TEXT');
  addColumnIfMissing('chat_messages', 'image_model_config_id', 'image_model_config_id TEXT');
  addColumnIfMissing('chat_messages', 'generation_job_id', 'generation_job_id TEXT');
  addColumnIfMissing('chat_messages', 'image_generation_expected_count', 'image_generation_expected_count INTEGER');
  addColumnIfMissing('chat_messages', 'image_generation_failures', "image_generation_failures TEXT NOT NULL DEFAULT '[]'");
  addColumnIfMissing('chat_messages', 'actions', "actions TEXT NOT NULL DEFAULT '[]'");
  addColumnIfMissing('chat_messages', 'is_completed', 'is_completed INTEGER NOT NULL DEFAULT 1');
  addColumnIfMissing('chat_messages', 'attachments', "attachments TEXT NOT NULL DEFAULT '[]'");
  addColumnIfMissing('chat_messages', 'credit_cost', 'credit_cost REAL');
  addColumnIfMissing('generation_jobs', 'payload', "payload TEXT NOT NULL DEFAULT '{}'");
  addColumnIfMissing('generation_jobs', 'result', "result TEXT NOT NULL DEFAULT '{}'");
  addColumnIfMissing('chat_conversations', 'metadata', "metadata TEXT NOT NULL DEFAULT '{}'");
  addColumnIfMissing('skill_files', 'command', "command TEXT NOT NULL DEFAULT 'skill'");
  addColumnIfMissing('skill_files', 'category', "category TEXT NOT NULL DEFAULT 'brand_style'");
  addColumnIfMissing('skill_files', 'scenario', "scenario TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing('skill_files', 'enabled', 'enabled INTEGER NOT NULL DEFAULT 1');
  addColumnIfMissing('skill_files', 'is_default', 'is_default INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing('agents', 'run_mode', "run_mode TEXT NOT NULL DEFAULT 'quick'");
  addColumnIfMissing('agents', 'model_config_id', 'model_config_id TEXT');
  addColumnIfMissing('agents', 'tools', "tools TEXT NOT NULL DEFAULT '[]'");
  addColumnIfMissing('agents', 'skills', "skills TEXT NOT NULL DEFAULT '[]'");
  addColumnIfMissing('agents', 'retrieval_strategy', "retrieval_strategy TEXT NOT NULL DEFAULT 'semantic'");
  addColumnIfMissing('agents', 'web_search_enabled', 'web_search_enabled INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing('agents', 'multimodal', 'multimodal TEXT NOT NULL DEFAULT \'{"imageUpload":false,"fileUpload":true}\'');
  addColumnIfMissing('model_configs', 'settings', "settings TEXT NOT NULL DEFAULT '{}'");
  addColumnIfMissing('model_configs', 'sort_order', 'sort_order INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing('content_assets', 'resource_type', "resource_type TEXT NOT NULL DEFAULT 'other'");
  addColumnIfMissing('content_assets', 'type', "type TEXT NOT NULL DEFAULT 'file'");
  addColumnIfMissing('content_assets', 'source_url', 'source_url TEXT');
  addColumnIfMissing('content_assets', 'file_size', 'file_size INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing('content_assets', 'size', 'size INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing('content_assets', 'original_file_name', "original_file_name TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing('content_assets', 'stored_file_name', "stored_file_name TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing('content_assets', 'mime_type', "mime_type TEXT NOT NULL DEFAULT 'application/octet-stream'");
  addColumnIfMissing('content_assets', 'file_path', "file_path TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing('content_assets', 'file_url', "file_url TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing('content_assets', 'asset_kind', "asset_kind TEXT NOT NULL DEFAULT 'library'");
  addColumnIfMissing('content_assets', 'lifecycle_status', "lifecycle_status TEXT NOT NULL DEFAULT 'permanent'");
  addColumnIfMissing('content_assets', 'parent_asset_id', 'parent_asset_id TEXT');
  addColumnIfMissing('content_assets', 'expires_at', 'expires_at TEXT');
  addColumnIfMissing('content_assets', 'retained_at', 'retained_at TEXT');
  addColumnIfMissing('discover_items', 'like_count', 'like_count INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing('discover_items', 'view_count', 'view_count INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing('discover_items', 'duration', 'duration REAL NOT NULL DEFAULT 0');
  addColumnIfMissing('discover_items', 'source_created_at', 'source_created_at TEXT');
  addColumnIfMissing('discover_items', 'source_completed_at', 'source_completed_at TEXT');
  addColumnIfMissing('discover_items', 'reference_assets', "reference_assets TEXT NOT NULL DEFAULT '[]'");
  addColumnIfMissing('discover_items', 'aspect_ratio', "aspect_ratio TEXT NOT NULL DEFAULT '1 / 1'");
  addColumnIfMissing('discover_items', 'cover_url', "cover_url TEXT NOT NULL DEFAULT ''");
  db.exec(`
    UPDATE discover_items
    SET cover_url = COALESCE((
      SELECT json_extract(asset.metadata, '$.coverUrl')
      FROM content_assets asset
      WHERE asset.id = discover_items.source_asset_id
    ), '')
    WHERE media_type = 'video' AND TRIM(cover_url) = '';

    UPDATE discover_items
    SET aspect_ratio = REPLACE(aspect_ratio, ':', ' / ')
    WHERE aspect_ratio LIKE '%:%';
    UPDATE discover_items
    SET aspect_ratio = COALESCE(
      NULLIF(REPLACE((SELECT json_extract(asset.metadata, '$.ratio') FROM content_assets asset WHERE asset.id = discover_items.source_asset_id), ':', ' / '), ''),
      NULLIF(REPLACE((SELECT json_extract(asset.metadata, '$.aspectRatio') FROM content_assets asset WHERE asset.id = discover_items.source_asset_id), ':', ' / '), ''),
      CASE
        WHEN (SELECT CAST(json_extract(asset.metadata, '$.width') AS REAL) FROM content_assets asset WHERE asset.id = discover_items.source_asset_id) > 0
         AND (SELECT CAST(json_extract(asset.metadata, '$.height') AS REAL) FROM content_assets asset WHERE asset.id = discover_items.source_asset_id) > 0
        THEN (SELECT CAST(json_extract(asset.metadata, '$.width') AS REAL) || ' / ' || CAST(json_extract(asset.metadata, '$.height') AS REAL) FROM content_assets asset WHERE asset.id = discover_items.source_asset_id)
        ELSE '1 / 1'
      END
    )
    WHERE aspect_ratio IS NULL OR TRIM(aspect_ratio) = '' OR aspect_ratio = '1 / 1';
  `);
  db.exec(`
    UPDATE discover_items
    SET source_created_at = COALESCE(source_created_at, (
          SELECT asset.created_at FROM content_assets asset WHERE asset.id = discover_items.source_asset_id
        )),
        source_completed_at = COALESCE(source_completed_at, (
          SELECT COALESCE(
            json_extract(asset.metadata, '$.completedAt'),
            json_extract(asset.metadata, '$.generatedAt'),
            asset.updated_at
          )
          FROM content_assets asset WHERE asset.id = discover_items.source_asset_id
        )),
        duration = CASE WHEN duration > 0 THEN duration ELSE COALESCE((
          SELECT CAST(REPLACE(REPLACE(json_extract(asset.metadata, '$.duration'), '秒', ''), 's', '') AS REAL)
          FROM content_assets asset WHERE asset.id = discover_items.source_asset_id
        ), 0) END
    WHERE source_created_at IS NULL OR source_completed_at IS NULL OR duration = 0;

    UPDATE discover_items
    SET reference_assets = COALESCE((
      SELECT json_group_array(json_object(
        'id', reference.id,
        'name', reference.name,
        'originalFileName', reference.original_file_name,
        'mimeType', reference.mime_type,
        'fileUrl', reference.file_url,
        'metadata', json(CASE WHEN json_valid(reference.metadata) THEN reference.metadata ELSE '{}' END)
      ))
      FROM content_assets source
      INNER JOIN content_assets reference ON reference.user_id = source.user_id
      WHERE source.id = discover_items.source_asset_id
        AND reference.id IN (
          SELECT CAST(value AS TEXT)
          FROM json_tree(CASE WHEN json_valid(source.metadata) THEN source.metadata ELSE '{}' END, '$.materialContext')
          WHERE key IN ('id', 'sourceAssetId') AND type = 'text'
          UNION
          SELECT CAST(json_extract(source.metadata, '$.sourceAssetId') AS TEXT)
          WHERE json_type(source.metadata, '$.sourceAssetId') = 'text'
        )
    ), '[]')
    WHERE reference_assets = '[]';
  `);
  const discoverRetentionNow = new Date().toISOString();
  db.prepare(`
    INSERT OR IGNORE INTO content_asset_references (
      asset_id, reference_type, reference_id, role, created_at
    )
    SELECT reference.id, 'discover_item', discover.id, 'input', @now
    FROM discover_items discover
    INNER JOIN content_assets source ON source.id = discover.source_asset_id
    INNER JOIN content_assets reference ON reference.user_id = source.user_id
    WHERE reference.id IN (
      SELECT CAST(value AS TEXT)
      FROM json_tree(CASE WHEN json_valid(source.metadata) THEN source.metadata ELSE '{}' END, '$.materialContext')
      WHERE key IN ('id', 'sourceAssetId') AND type = 'text'
      UNION
      SELECT CAST(json_extract(source.metadata, '$.sourceAssetId') AS TEXT)
      WHERE json_type(source.metadata, '$.sourceAssetId') = 'text'
    )
  `).run({ now: discoverRetentionNow });
  db.prepare(`
    UPDATE content_assets
    SET lifecycle_status = 'retained', expires_at = NULL,
        retained_at = @now, updated_at = @now
    WHERE lifecycle_status = 'temporary'
      AND EXISTS (
        SELECT 1 FROM content_asset_references reference
        WHERE reference.asset_id = content_assets.id
          AND reference.reference_type = 'discover_item'
      )
  `).run({ now: discoverRetentionNow });
  addColumnIfMissing('file_upload_intents', 'public_file_url', "public_file_url TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing('content_asset_groups', 'resource_type', "resource_type TEXT NOT NULL DEFAULT 'other'");
  addColumnIfMissing('content_asset_groups', 'metadata', "metadata TEXT NOT NULL DEFAULT '{}'");
  addColumnIfMissing('video_generation_tasks', 'raw_parse_result', "raw_parse_result TEXT NOT NULL DEFAULT '{}'");
  addColumnIfMissing('video_generation_tasks', 'editable_parse_result', "editable_parse_result TEXT NOT NULL DEFAULT '{}'");
  addColumnIfMissing('video_generation_tasks', 'selected_digital_human_id', 'selected_digital_human_id TEXT');
  addColumnIfMissing('video_generation_tasks', 'selected_voice_id', 'selected_voice_id TEXT');
  addColumnIfMissing('video_generation_tasks', 'selected_scene_id', 'selected_scene_id TEXT');
  addColumnIfMissing('video_generation_tasks', 'generated_video_url', 'generated_video_url TEXT');
  addColumnIfMissing('video_generation_tasks', 'generated_cover_url', 'generated_cover_url TEXT');
  addColumnIfMissing('video_generation_tasks', 'aspect_ratio', "aspect_ratio TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing('video_generation_tasks', 'prompt', "prompt TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing('video_generation_tasks', 'selected_skill_ids', "selected_skill_ids TEXT NOT NULL DEFAULT '[]'");
  addColumnIfMissing('video_generation_tasks', 'expert_context', "expert_context TEXT NOT NULL DEFAULT '{}'");
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_video_generation_tasks_user_ratio_created
    ON video_generation_tasks(user_id, aspect_ratio, created_at DESC)
  `);
  addColumnIfMissing('xingtu_search_drafts', 'automation_filters', 'automation_filters TEXT');

  migrateContentFilesDirectory();
  backfillSettledContentPlanningLedgerTypes();

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_content_assets_expiration
    ON content_assets(lifecycle_status, expires_at)
    WHERE lifecycle_status = 'temporary';

    CREATE INDEX IF NOT EXISTS idx_content_assets_parent
    ON content_assets(parent_asset_id);

    CREATE INDEX IF NOT EXISTS idx_content_asset_references_owner
    ON content_asset_references(reference_type, reference_id);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_roles_key
    ON roles(key);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_roles_single_default
    ON roles(is_default)
    WHERE is_default = 1;

    CREATE INDEX IF NOT EXISTS idx_users_role_id
    ON users(role_id);

    CREATE INDEX IF NOT EXISTS idx_role_permissions_role_id
    ON role_permissions(role_id);

    CREATE INDEX IF NOT EXISTS idx_route_resources_parent_id
    ON route_resources(parent_id);

    CREATE INDEX IF NOT EXISTS idx_route_resources_platform
    ON route_resources(platform);

    CREATE INDEX IF NOT EXISTS idx_role_resource_permissions_role_id
    ON role_resource_permissions(role_id);

    CREATE INDEX IF NOT EXISTS idx_user_role_assignments_user_id
    ON user_role_assignments(user_id);

    CREATE INDEX IF NOT EXISTS idx_user_role_assignments_role_id
    ON user_role_assignments(role_id);
  `);

  if (hasColumn('billing_settings', 'video_upload_credits_per_second')) {
    db.exec(`
      UPDATE billing_settings
      SET video_upload_credits_per_mb = video_upload_credits_per_second
      WHERE video_upload_credits_per_mb = 0
        AND video_upload_credits_per_second > 0
    `);
  }

  if (
    hasColumn('billing_settings', 'video_understanding_usd_per_1m_tokens')
    && hasColumn('billing_settings', 'usd_to_credit_rate')
  ) {
    db.exec(`
      UPDATE billing_settings
      SET video_understanding_credits_per_1m_tokens = video_understanding_usd_per_1m_tokens * usd_to_credit_rate
      WHERE video_understanding_credits_per_1m_tokens = 0
        AND video_understanding_usd_per_1m_tokens > 0
        AND usd_to_credit_rate > 0
    `);
  }

  db.exec('DELETE FROM creative_tasks');

  db.prepare(`
    INSERT OR IGNORE INTO ai_model_config (id, provider, model, api_key, base_url, temperature)
    VALUES (1, @provider, @model, @apiKey, @baseUrl, @temperature)
  `).run(defaultModelConfig);

  const now = new Date().toISOString();

  const videoUpscaleDefaultPriceMigrationId = '20260715-video-upscale-default-price-20';
  const videoUpscaleDefaultPriceMigrationApplied = db.prepare(`
    SELECT 1
    FROM app_migrations
    WHERE id = ?
  `).get(videoUpscaleDefaultPriceMigrationId);
  if (!videoUpscaleDefaultPriceMigrationApplied) {
    db.transaction(() => {
      db.prepare(`
        UPDATE billing_settings
        SET video_upscale_credits_per_request = 20,
            updated_at = @updatedAt
        WHERE video_upscale_credits_per_request = 0
      `).run({ updatedAt: now });
      db.prepare(`
        INSERT INTO app_migrations (id, applied_at)
        VALUES (?, ?)
      `).run(videoUpscaleDefaultPriceMigrationId, now);
    })();
  }

  const defaultRoleId = 'role-default-full-access';
  const onboardingRoleId = 'role-default-onboarding';
  db.prepare(`
    INSERT OR IGNORE INTO roles (id, key, name, description, is_system, is_default, created_at, updated_at)
    VALUES (@id, @key, @name, @description, 1, 0, @createdAt, @updatedAt)
  `).run({
    id: defaultRoleId,
    key: defaultAppRoleKey,
    name: '默认全量权限',
    description: '当前全部 web 权限。',
    createdAt: now,
    updatedAt: now,
  });
  db.prepare(`
    INSERT OR IGNORE INTO roles (id, key, name, description, is_system, is_default, created_at, updated_at)
    VALUES (@id, @key, @name, @description, 1, 0, @createdAt, @updatedAt)
  `).run({
    id: onboardingRoleId,
    key: defaultOnboardingRoleKey,
    name: '默认入门权限',
    description: '新注册非管理员默认角色，仅保留账号访问，不授予业务功能权限。',
    createdAt: now,
    updatedAt: now,
  });
  const existingDefaultRole = db.prepare(`
    SELECT id, key
    FROM roles
    WHERE is_default = 1
    LIMIT 1
  `).get() as { id: string; key: string } | undefined;
  if (!existingDefaultRole) {
    db.prepare(`
      UPDATE roles
      SET is_default = 1,
          updated_at = @updatedAt
      WHERE id = @id
    `).run({
      id: onboardingRoleId,
      updatedAt: now,
    });
  } else if (existingDefaultRole.key === defaultAppRoleKey) {
    db.prepare(`
      UPDATE roles
      SET is_default = CASE
        WHEN id = @onboardingRoleId THEN 1
        ELSE 0
      END,
      updated_at = @updatedAt
      WHERE id IN (@defaultRoleId, @onboardingRoleId)
    `).run({
      defaultRoleId,
      onboardingRoleId,
      updatedAt: now,
    });
  }

  const upsertRouteResource = db.prepare(`
    INSERT INTO route_resources (
      id, parent_id, name, resource_key, resource_type, platform, path, permission_code,
      status, sort_order, is_system, created_at, updated_at
    )
    VALUES (
      @id, @parentId, @name, @resourceKey, @resourceType, @platform, @path, @permissionCode,
      @status, @sortOrder, @isSystem, @createdAt, @updatedAt
    )
    ON CONFLICT(id) DO NOTHING
  `);
  seededRouteResources.forEach((resource) => {
    upsertRouteResource.run({
      id: resource.id,
      parentId: resource.parentId || null,
      name: resource.name,
      resourceKey: resource.resourceKey,
      resourceType: resource.resourceType,
      platform: resource.platform,
      path: resource.path || '',
      permissionCode: resource.permissionCode,
      status: resource.status === false ? 0 : 1,
      sortOrder: Number(resource.sortOrder || 0),
      isSystem: resource.isSystem ? 1 : 0,
      createdAt: now,
      updatedAt: now,
    });
  });
  db.prepare(`
    UPDATE route_resources
    SET name = '发现', updated_at = @updatedAt
    WHERE id = 'rr-admin-discover' AND is_system = 1
  `).run({ updatedAt: now });

  const restoreSystemCreateVideoRouteMigrationId = '20260720-restore-system-create-video-route';
  const restoreSystemCreateVideoRouteMigrationApplied = db.prepare(`
    SELECT 1
    FROM app_migrations
    WHERE id = ?
  `).get(restoreSystemCreateVideoRouteMigrationId);
  if (!restoreSystemCreateVideoRouteMigrationApplied) {
    db.transaction(() => {
      db.prepare(`
        INSERT INTO route_resources (
          id, parent_id, name, resource_key, resource_type, platform, path, permission_code,
          status, sort_order, is_system, created_at, updated_at
        )
        VALUES (
          @id, NULL, @name, @resourceKey, @resourceType, @platform, @path, @permissionCode,
          @status, @sortOrder, 1, @createdAt, @updatedAt
        )
        ON CONFLICT(id) DO UPDATE SET
          parent_id = NULL,
          name = excluded.name,
          resource_key = excluded.resource_key,
          resource_type = excluded.resource_type,
          platform = excluded.platform,
          path = excluded.path,
          permission_code = excluded.permission_code,
          status = excluded.status,
          sort_order = excluded.sort_order,
          is_system = 1,
          updated_at = excluded.updated_at
      `).run({
        id: 'rr-web.module.content.create_video',
        name: '视频创作',
        resourceKey: 'web.module.content.create_video',
        resourceType: 'menu',
        platform: 'web',
        path: '/app/content/create_video',
        permissionCode: 'web.module.content.create_video',
        status: 1,
        sortOrder: 20,
        createdAt: now,
        updatedAt: now,
      });
      db.prepare(`
        INSERT OR IGNORE INTO role_resource_permissions (role_id, resource_id, created_at)
        VALUES (?, ?, ?)
      `).run(defaultRoleId, 'rr-web.module.content.create_video', now);
      db.prepare(`
        INSERT INTO app_migrations (id, applied_at)
        VALUES (?, ?)
      `).run(restoreSystemCreateVideoRouteMigrationId, now);
    })();
  }

  const removeVideoRootMigrationId = '20260720-remove-video-root-route';
  const removeVideoRootMigrationApplied = db.prepare(`
    SELECT 1
    FROM app_migrations
    WHERE id = ?
  `).get(removeVideoRootMigrationId);
  if (!removeVideoRootMigrationApplied) {
    db.transaction(() => {
      db.prepare(`
        UPDATE route_resources
        SET parent_id = NULL, updated_at = ?
        WHERE parent_id = 'rr-web-root-video'
      `).run(now);
      db.prepare(`
        DELETE FROM role_resource_permissions
        WHERE resource_id = 'rr-web-root-video'
      `).run();
      db.prepare(`
        DELETE FROM route_resources
        WHERE id = 'rr-web-root-video'
      `).run();
      db.prepare(`
        INSERT INTO app_migrations (id, applied_at)
        VALUES (?, ?)
      `).run(removeVideoRootMigrationId, now);
    })();
  }

  const temporaryAssetsAdminSortMigrationId = '20260716-admin-temporary-assets-last';
  const temporaryAssetsAdminSortMigrationApplied = db.prepare(`
    SELECT 1
    FROM app_migrations
    WHERE id = ?
  `).get(temporaryAssetsAdminSortMigrationId);
  if (!temporaryAssetsAdminSortMigrationApplied) {
    db.transaction(() => {
      db.prepare(`
        UPDATE route_resources
        SET sort_order = 70, updated_at = @updatedAt
        WHERE resource_key = 'admin.system.temporary_assets'
      `).run({ updatedAt: now });
      db.prepare(`
        INSERT INTO app_migrations (id, applied_at)
        VALUES (?, ?)
      `).run(temporaryAssetsAdminSortMigrationId, now);
    })();
  }

  const fileManagementAdminRouteMigrationId = '20260722-add-admin-file-management-route';
  const fileManagementAdminRouteMigrationApplied = db.prepare(`
    SELECT 1
    FROM app_migrations
    WHERE id = ?
  `).get(fileManagementAdminRouteMigrationId);
  if (!fileManagementAdminRouteMigrationApplied) {
    db.transaction(() => {
      const sortOrders: Record<string, number> = {
        'admin.system.file_management': 70,
        'admin.system.temporary_assets': 80,
        'admin.system.settings': 90,
        'admin.system.access_logs': 100,
      };
      const update = db.prepare(`
        UPDATE route_resources
        SET sort_order = @sortOrder, updated_at = @updatedAt
        WHERE resource_key = @resourceKey
      `);
      Object.entries(sortOrders).forEach(([resourceKey, sortOrder]) => {
        update.run({ resourceKey, sortOrder, updatedAt: now });
      });
      db.prepare(`
        INSERT INTO app_migrations (id, applied_at)
        VALUES (?, ?)
      `).run(fileManagementAdminRouteMigrationId, now);
    })();
  }

  const seededRouteResourceIds = seededRouteResources.map((resource) => resource.id);
  const seededRouteResourcePlaceholders = seededRouteResourceIds.map((_, index) => `@resourceId${index}`).join(', ');
  const seededRouteResourceParams = Object.fromEntries(seededRouteResourceIds.map((resourceId, index) => [`resourceId${index}`, resourceId]));
  db.prepare(`
    DELETE FROM role_resource_permissions
    WHERE resource_id IN (
      SELECT id
      FROM route_resources
      WHERE is_system = 1
        AND id NOT IN (${seededRouteResourcePlaceholders})
    )
  `).run(seededRouteResourceParams);
  db.prepare(`
    DELETE FROM route_resources
    WHERE is_system = 1
      AND id NOT IN (${seededRouteResourcePlaceholders})
  `).run(seededRouteResourceParams);

  const insertRoleResourcePermission = db.prepare(`
    INSERT OR IGNORE INTO role_resource_permissions (role_id, resource_id, created_at)
    VALUES (@roleId, @resourceId, @createdAt)
  `);
  defaultRoleResourceIds.forEach((resourceId) => {
    insertRoleResourcePermission.run({
      roleId: defaultRoleId,
      resourceId,
      createdAt: now,
    });
  });

  db.exec(`
    INSERT OR IGNORE INTO role_resource_permissions (role_id, resource_id, created_at)
    SELECT
      rp.role_id,
      rr.id,
      rp.created_at
    FROM role_permissions rp
    INNER JOIN route_resources rr
      ON rr.permission_code = rp.permission_key
  `);

  db.exec(`
    INSERT OR IGNORE INTO user_role_assignments (user_id, role_id, created_at)
    SELECT id, role_id, COALESCE(created_at, '${now}')
    FROM users
    WHERE role_id IS NOT NULL
      AND role_id != ''
  `);

  db.prepare(`
    INSERT OR IGNORE INTO billing_settings (
      id, enabled, video_upload_credits_per_mb, video_understanding_credits_per_1m_tokens, created_at, updated_at
    )
    VALUES (1, 1, 0, 0, @createdAt, @updatedAt)
  `).run({
    createdAt: now,
    updatedAt: now,
  });

  const insertDefaultModelConfig = db.prepare(`
    INSERT OR IGNORE INTO model_configs (
      id, type, name, provider, model, api_key, base_url, temperature, settings, is_default, created_at, updated_at
    )
    VALUES (
      @id, @type, @name, @provider, @model, @apiKey, @baseUrl, @temperature, @settings, @isDefault, @createdAt, @updatedAt
    )
  `);
  [defaultModelConfig, defaultImageModelConfig, openaiImageModelConfig].forEach((config) => {
    insertDefaultModelConfig.run({
      ...config,
      settings: JSON.stringify(config.settings || {}),
      isDefault: config.isDefault ? 1 : 0,
    });
  });

  db.exec(`
    UPDATE billing_settings
    SET marketing_video_storyboard_model_config_id = COALESCE((
      SELECT id
      FROM model_configs
      WHERE type = 'image'
      ORDER BY is_default DESC, sort_order ASC, updated_at DESC
      LIMIT 1
    ), '')
    WHERE marketing_video_storyboard_model_config_id = ''
  `);

  const llmModelPricingCount = db.prepare('SELECT COUNT(*) as count FROM llm_model_pricing').get() as { count: number };
  if (llmModelPricingCount.count === 0) {
    const insertLlmModelPricing = db.prepare(`
      INSERT INTO llm_model_pricing (
        id,
        provider,
        provider_name,
        model,
        display_name,
        default_base_url,
        currency,
        input_price_per_1m,
        output_price_per_1m,
        cached_input_price_per_1m,
        price_source,
        price_updated_at,
        created_at,
        updated_at
      )
      VALUES (
        @id,
        @provider,
        @providerName,
        @model,
        @displayName,
        @defaultBaseUrl,
        @currency,
        @inputPricePer1M,
        @outputPricePer1M,
        @cachedInputPricePer1M,
        @priceSource,
        @priceUpdatedAt,
        @createdAt,
        @updatedAt
      )
    `);

    llmModelPricingSeeds.forEach((item) => {
      insertLlmModelPricing.run(item);
    });
  }

  const audioProviderIds = listAudioModelProviders().map((provider) => provider.id);
  if (audioProviderIds.length) {
    const placeholders = audioProviderIds.map((_, index) => `@provider${index}`).join(', ');
    const params = Object.fromEntries(audioProviderIds.map((id, index) => [`provider${index}`, id]));
    db.prepare(`
      DELETE FROM model_configs
      WHERE type = 'audio'
        AND provider NOT IN (${placeholders})
    `).run(params);
  }

  const insertAgent = db.prepare(`
    INSERT OR IGNORE INTO agents (
      id, name, description, icon, built_in, capabilities, run_mode, model_config_id,
      system_prompt, tools, skills, retrieval_strategy, web_search_enabled, multimodal, created_at
    )
    VALUES (
      @id, @name, @description, @icon, @builtIn, @capabilities, @runMode, @modelConfigId,
      @systemPrompt, @tools, @skills, @retrievalStrategy, @webSearchEnabled, @multimodal, @createdAt
    )
  `);

  defaultAgents.forEach((agent) => {
    insertAgent.run({
      ...agent,
      builtIn: agent.builtIn ? 1 : 0,
      capabilities: JSON.stringify(agent.capabilities),
      modelConfigId: agent.modelConfigId || null,
      tools: JSON.stringify(agent.tools),
      skills: JSON.stringify(agent.skills),
      webSearchEnabled: agent.webSearchEnabled ? 1 : 0,
      multimodal: JSON.stringify(agent.multimodal),
    });
  });
}
