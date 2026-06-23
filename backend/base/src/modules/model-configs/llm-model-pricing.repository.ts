import { db } from '../../db/database.js';

export type LlmModelPricingRecord = {
  id: string;
  provider: string;
  providerName: string;
  model: string;
  displayName: string;
  defaultBaseUrl: string;
  currency: 'USD' | 'CNY';
  inputPricePer1M: number;
  outputPricePer1M: number;
  cachedInputPricePer1M: number;
  priceSource: string;
  priceUpdatedAt: string;
  createdAt: string;
  updatedAt: string;
};

const llmModelPricingSelect = `
  SELECT
    id,
    provider,
    provider_name as providerName,
    model,
    display_name as displayName,
    default_base_url as defaultBaseUrl,
    currency,
    input_price_per_1m as inputPricePer1M,
    output_price_per_1m as outputPricePer1M,
    cached_input_price_per_1m as cachedInputPricePer1M,
    price_source as priceSource,
    price_updated_at as priceUpdatedAt,
    created_at as createdAt,
    updated_at as updatedAt
  FROM llm_model_pricing
`;

export const llmModelPricingRepository = {
  list() {
    const query = db.prepare(`
      ${llmModelPricingSelect}
      ORDER BY provider_name COLLATE NOCASE ASC, display_name COLLATE NOCASE ASC, model COLLATE NOCASE ASC
    `);
    return query.all() as LlmModelPricingRecord[];
  },

  findById(id: string) {
    const query = db.prepare(`
      ${llmModelPricingSelect}
      WHERE id = ?
    `);
    return query.get(id) as LlmModelPricingRecord | undefined;
  },

  findByProviderAndModel(provider: string, model: string) {
    const query = db.prepare(`
      ${llmModelPricingSelect}
      WHERE lower(provider) = lower(?)
        AND model = ?
      LIMIT 1
    `);
    return query.get(provider.trim(), model.trim()) as LlmModelPricingRecord | undefined;
  },

  save(record: LlmModelPricingRecord, mode: 'insert' | 'update') {
    const insertQuery = db.prepare(`
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
    const updateQuery = db.prepare(`
      UPDATE llm_model_pricing
      SET
        provider = @provider,
        provider_name = @providerName,
        model = @model,
        display_name = @displayName,
        default_base_url = @defaultBaseUrl,
        currency = @currency,
        input_price_per_1m = @inputPricePer1M,
        output_price_per_1m = @outputPricePer1M,
        cached_input_price_per_1m = @cachedInputPricePer1M,
        price_source = @priceSource,
        price_updated_at = @priceUpdatedAt,
        updated_at = @updatedAt
      WHERE id = @id
    `);

    if (mode === 'insert') {
      insertQuery.run(record);
      return;
    }

    updateQuery.run(record);
  },

  delete(id: string) {
    const query = db.prepare(`
      DELETE FROM llm_model_pricing
      WHERE id = ?
    `);
    query.run(id);
  },
};
