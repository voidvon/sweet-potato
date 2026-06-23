import { db } from './database.js';
import { defaultAgents } from '../modules/agents/agent.defaults.js';
import { listAudioModelProviders } from '../modules/audio-models/audio-model.registry.js';
import { llmModelPricingSeeds } from '../modules/model-configs/llm-model-pricing.seed.js';
import { defaultModelConfig } from '../modules/model-configs/model-config.defaults.js';

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

export function migrateDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
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
      video_upload_credits_per_mb REAL NOT NULL DEFAULT 0,
      video_understanding_credits_per_1m_tokens REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
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
      reasoning_content TEXT,
      actions TEXT NOT NULL DEFAULT '[]',
      agent_id TEXT NOT NULL,
      model_config_id TEXT,
      attachments TEXT NOT NULL DEFAULT '[]',
      is_completed INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
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
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
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

  addColumnIfMissing('users', 'avatar_url', 'avatar_url TEXT');
  addColumnIfMissing('users', 'role', "role TEXT NOT NULL DEFAULT 'user'");
  addColumnIfMissing('users', 'is_blacklisted', 'is_blacklisted INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing('users', 'credit_balance', 'credit_balance REAL NOT NULL DEFAULT 0');
  addColumnIfMissing('users', 'last_login_at', 'last_login_at TEXT');
  addColumnIfMissing('billing_settings', 'video_upload_credits_per_mb', 'video_upload_credits_per_mb REAL NOT NULL DEFAULT 0');
  addColumnIfMissing('billing_settings', 'video_understanding_credits_per_1m_tokens', 'video_understanding_credits_per_1m_tokens REAL NOT NULL DEFAULT 0');
  addColumnIfMissing('llm_usage_records', 'credit_base_cost', 'credit_base_cost REAL NOT NULL DEFAULT 0');
  addColumnIfMissing('llm_usage_records', 'credit_billed_cost', 'credit_billed_cost REAL NOT NULL DEFAULT 0');
  addColumnIfMissing('credit_ledger', 'credit_base_cost', 'credit_base_cost REAL');
  addColumnIfMissing('credit_ledger', 'credit_billed_cost', 'credit_billed_cost REAL');
  addColumnIfMissing('billable_usage_records', 'credit_base_cost', 'credit_base_cost REAL NOT NULL DEFAULT 0');
  addColumnIfMissing('billable_usage_records', 'credit_billed_cost', 'credit_billed_cost REAL NOT NULL DEFAULT 0');
  addColumnIfMissing('chat_messages', 'reasoning_content', 'reasoning_content TEXT');
  addColumnIfMissing('chat_messages', 'actions', "actions TEXT NOT NULL DEFAULT '[]'");
  addColumnIfMissing('chat_messages', 'is_completed', 'is_completed INTEGER NOT NULL DEFAULT 1');
  addColumnIfMissing('chat_messages', 'attachments', "attachments TEXT NOT NULL DEFAULT '[]'");
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
  addColumnIfMissing('content_asset_groups', 'resource_type', "resource_type TEXT NOT NULL DEFAULT 'other'");
  addColumnIfMissing('content_asset_groups', 'metadata', "metadata TEXT NOT NULL DEFAULT '{}'");
  addColumnIfMissing('video_generation_tasks', 'raw_parse_result', "raw_parse_result TEXT NOT NULL DEFAULT '{}'");
  addColumnIfMissing('video_generation_tasks', 'editable_parse_result', "editable_parse_result TEXT NOT NULL DEFAULT '{}'");
  addColumnIfMissing('video_generation_tasks', 'selected_digital_human_id', 'selected_digital_human_id TEXT');
  addColumnIfMissing('video_generation_tasks', 'selected_voice_id', 'selected_voice_id TEXT');
  addColumnIfMissing('video_generation_tasks', 'selected_scene_id', 'selected_scene_id TEXT');
  addColumnIfMissing('video_generation_tasks', 'generated_video_url', 'generated_video_url TEXT');
  addColumnIfMissing('video_generation_tasks', 'prompt', "prompt TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing('video_generation_tasks', 'selected_skill_ids', "selected_skill_ids TEXT NOT NULL DEFAULT '[]'");
  addColumnIfMissing('video_generation_tasks', 'expert_context', "expert_context TEXT NOT NULL DEFAULT '{}'");
  addColumnIfMissing('xingtu_search_drafts', 'automation_filters', 'automation_filters TEXT');

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
  db.prepare(`
    INSERT OR IGNORE INTO billing_settings (
      id, enabled, video_upload_credits_per_mb, video_understanding_credits_per_1m_tokens, created_at, updated_at
    )
    VALUES (1, 1, 0, 0, @createdAt, @updatedAt)
  `).run({
    createdAt: now,
    updatedAt: now,
  });

  db.prepare(`
    INSERT OR IGNORE INTO model_configs (
      id, type, name, provider, model, api_key, base_url, temperature, settings, is_default, created_at, updated_at
    )
    VALUES (
      @id, @type, @name, @provider, @model, @apiKey, @baseUrl, @temperature, @settings, @isDefault, @createdAt, @updatedAt
    )
  `).run({ ...defaultModelConfig, settings: JSON.stringify(defaultModelConfig.settings || {}), isDefault: 1 });

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
