import { db } from '../../db/database.js'

export type FileStorageSettingsRecord = {
  enabled: boolean
  endpoint: string
  bucket: string
  region: string
  accessKey: string
  secretKey: string
  publicBaseUrl: string
  keyPrefix: string
}

function ensureSettings(defaults: FileStorageSettingsRecord) {
  db.prepare(`
    INSERT OR IGNORE INTO file_storage_settings (
      id, enabled, endpoint, bucket, region, access_key, secret_key,
      public_base_url, key_prefix, updated_at
    ) VALUES (
      'default', @enabled, @endpoint, @bucket, @region, @accessKey, @secretKey,
      @publicBaseUrl, @keyPrefix, @updatedAt
    )
  `).run({
    ...defaults,
    enabled: defaults.enabled ? 1 : 0,
    updatedAt: new Date().toISOString(),
  })
}

function mapRow(row: {
  enabled: number
  endpoint: string
  bucket: string
  region: string
  access_key: string
  secret_key: string
  public_base_url: string
  key_prefix: string
}) {
  return {
    enabled: Boolean(row.enabled),
    endpoint: row.endpoint,
    bucket: row.bucket,
    region: row.region,
    accessKey: row.access_key,
    secretKey: row.secret_key,
    publicBaseUrl: row.public_base_url,
    keyPrefix: row.key_prefix,
  } satisfies FileStorageSettingsRecord
}

export const fileStorageSettingsRepository = {
  get(defaults: FileStorageSettingsRecord) {
    ensureSettings(defaults)
    const row = db.prepare(`
      SELECT enabled, endpoint, bucket, region, access_key, secret_key,
        public_base_url, key_prefix
      FROM file_storage_settings
      WHERE id = 'default'
    `).get() as Parameters<typeof mapRow>[0]
    return mapRow(row)
  },

  update(input: FileStorageSettingsRecord) {
    db.prepare(`
      UPDATE file_storage_settings
      SET enabled = @enabled,
        endpoint = @endpoint,
        bucket = @bucket,
        region = @region,
        access_key = @accessKey,
        secret_key = @secretKey,
        public_base_url = @publicBaseUrl,
        key_prefix = @keyPrefix,
        updated_at = @updatedAt
      WHERE id = 'default'
    `).run({
      ...input,
      enabled: input.enabled ? 1 : 0,
      updatedAt: new Date().toISOString(),
    })
    return input
  },
}
