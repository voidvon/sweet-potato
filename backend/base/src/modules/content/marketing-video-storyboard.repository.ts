import { db } from '../../db/database.js';

export type MarketingVideoStoryboardStatus = 'generating' | 'ready' | 'failed';

export type MarketingVideoStoryboard = {
  id: string;
  userId: string;
  title: string;
  productName: string;
  productCategory: string;
  sellingPoints: string;
  prompt: string;
  referenceImageIds: string[];
  modelConfigId: string;
  modelName: string;
  status: MarketingVideoStoryboardStatus;
  imageAssetId: string | null;
  imageUrl: string | null;
  reservationId: string | null;
  creditCost: number;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

type MarketingVideoStoryboardRow = {
  id: string;
  user_id: string;
  title: string;
  product_name: string;
  product_category: string;
  selling_points: string;
  prompt: string;
  reference_image_ids: string;
  model_config_id: string;
  model_name: string;
  status: MarketingVideoStoryboardStatus;
  image_asset_id: string | null;
  image_url: string | null;
  reservation_id: string | null;
  credit_cost: number;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

function parseStringArray(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function serialize(row: MarketingVideoStoryboardRow): MarketingVideoStoryboard {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    productName: row.product_name,
    productCategory: row.product_category,
    sellingPoints: row.selling_points,
    prompt: row.prompt,
    referenceImageIds: parseStringArray(row.reference_image_ids),
    modelConfigId: row.model_config_id,
    modelName: row.model_name,
    status: row.status,
    imageAssetId: row.image_asset_id,
    imageUrl: row.image_url,
    reservationId: row.reservation_id,
    creditCost: Number(row.credit_cost || 0),
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const marketingVideoStoryboardRepository = {
  create(task: MarketingVideoStoryboard) {
    db.prepare(`
      INSERT INTO marketing_video_storyboards (
        id, user_id, title, product_name, product_category, selling_points, prompt,
        reference_image_ids, model_config_id, model_name, status, image_asset_id,
        image_url, reservation_id, credit_cost, error_message, created_at, updated_at
      ) VALUES (
        @id, @userId, @title, @productName, @productCategory, @sellingPoints, @prompt,
        @referenceImageIds, @modelConfigId, @modelName, @status, @imageAssetId,
        @imageUrl, @reservationId, @creditCost, @errorMessage, @createdAt, @updatedAt
      )
    `).run({ ...task, referenceImageIds: JSON.stringify(task.referenceImageIds) });
    return task;
  },

  findById(id: string) {
    const row = db.prepare('SELECT * FROM marketing_video_storyboards WHERE id = ?')
      .get(id) as MarketingVideoStoryboardRow | undefined;
    return row ? serialize(row) : null;
  },

  listByUser(userId: string) {
    return (db.prepare(`
      SELECT * FROM marketing_video_storyboards
      WHERE user_id = ?
      ORDER BY created_at DESC
    `).all(userId) as MarketingVideoStoryboardRow[]).map(serialize);
  },

  delete(id: string) {
    db.prepare('DELETE FROM marketing_video_storyboards WHERE id = ?').run(id);
  },

  markGenerating(id: string, input: { reservationId: string | null; creditCost: number; modelConfigId: string; modelName: string }) {
    const updatedAt = new Date().toISOString();
    db.prepare(`
      UPDATE marketing_video_storyboards
      SET status = 'generating', image_asset_id = NULL, image_url = NULL,
          reservation_id = @reservationId, credit_cost = @creditCost,
          model_config_id = @modelConfigId, model_name = @modelName,
          error_message = NULL, updated_at = @updatedAt
      WHERE id = @id
    `).run({ id, ...input, updatedAt });
    return this.findById(id);
  },

  markReady(id: string, input: { imageAssetId: string; imageUrl: string }) {
    const updatedAt = new Date().toISOString();
    db.prepare(`
      UPDATE marketing_video_storyboards
      SET status = 'ready', image_asset_id = @imageAssetId, image_url = @imageUrl,
          error_message = NULL, updated_at = @updatedAt
      WHERE id = @id
    `).run({ id, ...input, updatedAt });
    return this.findById(id);
  },

  markFailed(id: string, errorMessage: string) {
    const updatedAt = new Date().toISOString();
    db.prepare(`
      UPDATE marketing_video_storyboards
      SET status = 'failed', error_message = ?, updated_at = ?
      WHERE id = ?
    `).run(errorMessage, updatedAt, id);
    return this.findById(id);
  },
};
