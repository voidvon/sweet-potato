package store

// foundationSchema is the current SQLite schema shared with the legacy service.
// Later migrations are kept in Go code so old databases can be upgraded safely.
const foundationSchema = `
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      auth_version INTEGER NOT NULL DEFAULT 1,
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
      name_en TEXT NOT NULL DEFAULT '',
      resource_key TEXT NOT NULL UNIQUE,
      resource_type TEXT NOT NULL,
      platform TEXT NOT NULL,
      path TEXT NOT NULL DEFAULT '',
      permission_code TEXT NOT NULL UNIQUE,
      visibility_mode TEXT NOT NULL DEFAULT 'permission',
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

    CREATE TABLE IF NOT EXISTS user_model_configs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
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
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_user_model_configs_owner_type_order
      ON user_model_configs(user_id, type, sort_order, updated_at DESC);

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

    CREATE TABLE IF NOT EXISTS talking_video_prompt_history (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'thinking',
      phase TEXT NOT NULL DEFAULT 'uploading_assets',
      reasoning TEXT NOT NULL DEFAULT '',
      prompt TEXT NOT NULL DEFAULT '',
      error_message TEXT NOT NULL DEFAULT '',
      metrics TEXT NOT NULL DEFAULT '{}',
      server_timings TEXT NOT NULL DEFAULT '{}',
      source_video TEXT NOT NULL DEFAULT '{}',
      reference_images TEXT NOT NULL DEFAULT '[]',
      deep_think INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_talking_video_prompt_history_user_created
      ON talking_video_prompt_history(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS batch_generation_sheets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      capability_key TEXT NOT NULL,
      media_kind TEXT NOT NULL,
      global_params TEXT NOT NULL DEFAULT '{}',
      schema_version INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      revision INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS batch_generation_rows (
      id TEXT PRIMARY KEY,
      sheet_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      params TEXT NOT NULL DEFAULT '{}',
      validation_status TEXT NOT NULL DEFAULT 'draft',
      validation_errors TEXT NOT NULL DEFAULT '[]',
      execution_status TEXT NOT NULL DEFAULT 'idle',
      latest_attempt_id TEXT,
      actual_credits REAL NOT NULL DEFAULT 0,
      revision INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS batch_generation_runs (
      id TEXT PRIMARY KEY,
      sheet_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      status TEXT NOT NULL,
      total_count INTEGER NOT NULL DEFAULT 0,
      completed_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      estimated_credits REAL NOT NULL DEFAULT 0,
      actual_credits REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS batch_generation_attempts (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      row_id TEXT NOT NULL,
      attempt_no INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL,
      effective_params TEXT NOT NULL DEFAULT '{}',
      model_config_snapshot TEXT NOT NULL DEFAULT '{}',
      generation_job_id TEXT,
      estimated_credits REAL NOT NULL DEFAULT 0,
      actual_credits REAL NOT NULL DEFAULT 0,
      error_code TEXT,
      error_message TEXT,
      queued_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS batch_generation_outputs (
      id TEXT PRIMARY KEY,
      attempt_id TEXT NOT NULL,
      slot_index INTEGER NOT NULL,
      asset_id TEXT NOT NULL,
      media_kind TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
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

    CREATE TABLE IF NOT EXISTS content_planning_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      source_surface TEXT NOT NULL DEFAULT 'create_video',
      status TEXT NOT NULL DEFAULT 'draft',
      ui_step TEXT NOT NULL DEFAULT 'step1',
      job_stage TEXT NOT NULL DEFAULT 'idle',
      material_bundle TEXT NOT NULL DEFAULT '{}',
      analysis TEXT NOT NULL DEFAULT '{}',
      settings TEXT NOT NULL DEFAULT '{}',
      generation TEXT NOT NULL DEFAULT '{}',
      apply_snapshot TEXT NOT NULL DEFAULT 'null',
      error_message TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_content_planning_sessions_user_updated
      ON content_planning_sessions(user_id, updated_at DESC);

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
      name_en TEXT NOT NULL DEFAULT '',
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

    CREATE TABLE IF NOT EXISTS temporary_asset_settings (
      id TEXT PRIMARY KEY,
      retention_hours REAL NOT NULL DEFAULT 24,
      cleanup_interval_minutes INTEGER NOT NULL DEFAULT 60,
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

    CREATE INDEX IF NOT EXISTS idx_chat_conversations_user_updated
    ON chat_conversations(user_id, updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation_created
    ON chat_messages(conversation_id, created_at ASC);

    CREATE INDEX IF NOT EXISTS idx_generation_jobs_conversation
    ON generation_jobs(conversation_id, updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_generation_job_items_job_slot
    ON generation_job_items(job_id, slot_index ASC);

    CREATE INDEX IF NOT EXISTS idx_batch_generation_sheets_user_sort
    ON batch_generation_sheets(user_id, sort_order ASC, created_at ASC);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_batch_generation_rows_sheet_position
    ON batch_generation_rows(sheet_id, position ASC);

    CREATE INDEX IF NOT EXISTS idx_batch_generation_runs_sheet_created
    ON batch_generation_runs(sheet_id, created_at DESC);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_batch_generation_attempts_run_row_no
    ON batch_generation_attempts(run_id, row_id, attempt_no);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_batch_generation_outputs_attempt_slot
    ON batch_generation_outputs(attempt_id, slot_index);

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

    CREATE INDEX IF NOT EXISTS idx_credit_reservations_user_created
    ON credit_reservations(user_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_llm_usage_records_user_created
    ON llm_usage_records(user_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_credit_ledger_user_created
    ON credit_ledger(user_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_billable_usage_records_user_created
    ON billable_usage_records(user_id, created_at DESC);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_model_configs_type_default
    ON model_configs(type)
    WHERE is_default = 1;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_llm_model_pricing_provider_model
    ON llm_model_pricing(provider, model);
`
