import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  createTosUploadUrl,
  currentFileStorageProvider,
  fileStorageKey,
  fileStorageService,
  setFileStorageProviderResolver,
  setTosStorageConfigResolver,
  storageMetadata,
  tosPublicUrl,
} from '../src/shared/file-storage.js'

const baseTosConfig = {
  accessKey: 'test-access-key',
  secretKey: 'test-secret-key',
  region: 'cn-beijing',
  endpoint: 'https://tos-cn-beijing.volces.com',
  bucket: 'test-bucket',
  publicBaseUrl: '',
  keyPrefix: 'app-files',
}

test('local storage provider preserves local path and records portable metadata', async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'file-storage-'))
  const filePath = path.join(tempDir, 'asset.txt')
  writeFileSync(filePath, 'content')
  setFileStorageProviderResolver(() => 'local')
  setTosStorageConfigResolver(() => baseTosConfig)

  const stored = await fileStorageService.storeLocalFile({
    key: fileStorageKey('input_files/asset.txt'),
    filePath,
    fileUrl: '/files/input_files/asset.txt',
    mimeType: 'text/plain',
  })

  assert.equal(await currentFileStorageProvider(), 'local')
  assert.equal(stored.filePath, filePath)
  assert.equal(stored.fileUrl, '/files/input_files/asset.txt')
  assert.deepEqual(storageMetadata(stored), {
    storageProvider: 'local',
    storageKey: 'app-files/input_files/asset.txt',
  })

  await fileStorageService.deleteStoredFile({ metadata: storageMetadata(stored), filePath })
  assert.equal(existsSync(filePath), false)
})

test('tos public url uses virtual-hosted addressing', () => {
  setTosStorageConfigResolver(() => baseTosConfig)
  assert.equal(
    tosPublicUrl('app-files/image 1.png'),
    'https://test-bucket.tos-cn-beijing.volces.com/app-files/image%201.png',
  )
})

test('tos direct upload url is short-lived and uses an unsigned payload', () => {
  setTosStorageConfigResolver(() => baseTosConfig)
  const url = new URL(createTosUploadUrl({
    key: 'app-files/input/video/reference.mp4',
    expiresInSeconds: 900,
  }))

  assert.equal(url.host, 'test-bucket.tos-cn-beijing.volces.com')
  assert.equal(url.pathname, '/app-files/input/video/reference.mp4')
  assert.equal(url.searchParams.get('X-Tos-Expires'), '900')
  assert.equal(url.searchParams.get('X-Tos-Content-Sha256'), 'UNSIGNED-PAYLOAD')
})

test('unknown configured provider falls back to local', async () => {
  setFileStorageProviderResolver(() => 'unknown' as 'local')
  assert.equal(await currentFileStorageProvider(), 'local')
  setFileStorageProviderResolver(() => 'local')
})
