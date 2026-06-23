import { db } from '../../db/database.js';
import type { AiModelConfig, ModelType } from './model-config.types.js';

const modelConfigSelect = `
  SELECT
    id,
    type,
    name,
    provider,
    model,
    api_key as apiKey,
    base_url as baseUrl,
    temperature,
    settings,
    is_default as isDefault,
    created_at as createdAt,
    updated_at as updatedAt
  FROM model_configs
`;

function parseModelConfig(row: AiModelConfig & { settings?: string | Record<string, unknown> }) {
  let settings: Record<string, unknown> = {};
  if (typeof row.settings === 'string') {
    try {
      settings = JSON.parse(row.settings || '{}') as Record<string, unknown>;
    } catch {
      settings = {};
    }
  } else {
    settings = row.settings || {};
  }

  return {
    ...row,
    settings,
  } as AiModelConfig;
}

export const modelConfigRepository = {
  list(type?: ModelType) {
    const listAllQuery = db.prepare(`
      ${modelConfigSelect}
      ORDER BY type ASC, is_default DESC, updated_at DESC
    `);
    const listByTypeQuery = db.prepare(`
      ${modelConfigSelect}
      WHERE type = ?
      ORDER BY is_default DESC, updated_at DESC
    `);

    return ((type ? listByTypeQuery.all(type) : listAllQuery.all()) as Array<AiModelConfig & { settings?: string }>)
      .map(parseModelConfig);
  },

  find(id: string) {
    const findQuery = db.prepare(`
      ${modelConfigSelect}
      WHERE id = ?
    `);

    const row = findQuery.get(id) as (AiModelConfig & { settings?: string }) | undefined;
    return row ? parseModelConfig(row) : undefined;
  },

  save(config: AiModelConfig, mode: 'insert' | 'update') {
    const insertQuery = db.prepare(`
      INSERT INTO model_configs (
        id, type, name, provider, model, api_key, base_url, temperature, settings, is_default, created_at, updated_at
      )
      VALUES (
        @id, @type, @name, @provider, @model, @apiKey, @baseUrl, @temperature, @settings, @isDefault, @createdAt, @updatedAt
      )
    `);
    const updateQuery = db.prepare(`
      UPDATE model_configs
      SET
        type = @type,
        name = @name,
        provider = @provider,
        model = @model,
        api_key = @apiKey,
        base_url = @baseUrl,
        temperature = @temperature,
        settings = @settings,
        is_default = @isDefault,
        updated_at = @updatedAt
      WHERE id = @id
    `);
    const unsetDefaultForTypeQuery = db.prepare(`
      UPDATE model_configs
      SET is_default = 0
      WHERE type = ?
    `);

    const record = {
      ...config,
      settings: JSON.stringify(config.settings || {}),
      isDefault: config.isDefault ? 1 : 0,
    };
    const transaction = db.transaction(() => {
      if (config.isDefault) {
        unsetDefaultForTypeQuery.run(config.type);
      }
      if (mode === 'insert') {
        insertQuery.run(record);
      } else {
        updateQuery.run(record);
      }
    });

    transaction();
  },

  delete(id: string) {
    const deleteQuery = db.prepare(`
      DELETE FROM model_configs
      WHERE id = ?
    `);

    deleteQuery.run(id);
  },
};
