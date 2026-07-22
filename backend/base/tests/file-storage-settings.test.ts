import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

test('file storage settings persist and update the runtime provider', async () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'file-storage-settings-'))
  const previousDataDir = process.env.DATA_DIR
  process.env.DATA_DIR = path.join(tempRoot, 'data')

  try {
    const [
      { migrateDatabase },
      { fileStorageSettingsService },
      { currentFileStorageProvider, currentTosStorageConfig },
    ] = await Promise.all([
      import('../src/db/schema.js'),
      import('../src/modules/file-storage-settings/file-storage-settings.service.js'),
      import('../src/shared/file-storage.js'),
    ])
    migrateDatabase()

    const saved = fileStorageSettingsService.updateSettings({
      enabled: true,
      endpoint: 'https://tos-cn-beijing.volces.com',
      bucket: 'runtime-bucket',
      region: 'cn-beijing',
      accessKey: 'runtime-access-key',
      secretKey: 'runtime-secret-key',
      publicBaseUrl: 'https://runtime-bucket.tos-cn-beijing.volces.com',
      keyPrefix: 'runtime-files',
    })

    assert.equal(saved.secretKey, '')
    assert.equal(saved.secretKeyConfigured, true)
    assert.equal(await currentFileStorageProvider(), 'tos')
    assert.equal(currentTosStorageConfig().bucket, 'runtime-bucket')

    fileStorageSettingsService.updateSettings({
      ...saved,
      secretKey: '',
      bucket: 'updated-bucket',
    })
    assert.equal(fileStorageSettingsService.getRuntimeSettings().secretKey, 'runtime-secret-key')
    assert.equal(currentTosStorageConfig().bucket, 'updated-bucket')

    fileStorageSettingsService.updateSettings({
      ...saved,
      enabled: false,
      secretKey: '',
    })
    assert.equal(await currentFileStorageProvider(), 'local')
  } finally {
    if (previousDataDir === undefined) delete process.env.DATA_DIR
    else process.env.DATA_DIR = previousDataDir
    rmSync(tempRoot, { recursive: true, force: true })
  }
})
