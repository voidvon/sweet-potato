import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

test('file management lists and filters local and TOS business files', async () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'file-management-'))
  const previousDataDir = process.env.DATA_DIR
  process.env.DATA_DIR = path.join(tempRoot, 'data')

  try {
    const [
      { migrateDatabase },
      { contentRepository },
      { fileManagementService, managedFilePublicUrl },
      { db },
    ] = await Promise.all([
      import('../src/db/schema.js'),
      import('../src/modules/content/content.repository.js'),
      import('../src/modules/file-management/file-management.service.js'),
      import('../src/db/database.js'),
    ])
    migrateDatabase()

    const fileManagementRoute = db.prepare(`
      SELECT path, sort_order AS sortOrder
      FROM route_resources
      WHERE resource_key = 'admin.system.file_management'
    `).get() as { path: string; sortOrder: number }
    const temporaryAssetsRoute = db.prepare(`
      SELECT sort_order AS sortOrder
      FROM route_resources
      WHERE resource_key = 'admin.system.temporary_assets'
    `).get() as { sortOrder: number }
    assert.equal(fileManagementRoute.path, '/system/files')
    assert.equal(fileManagementRoute.sortOrder, 70)
    assert.equal(temporaryAssetsRoute.sortOrder, 80)

    const group = contentRepository.createGroup({
      userId: 'file-owner',
      resourceType: 'product',
      name: '文件管理测试',
    })
    assert.ok(group)

    const localAsset = contentRepository.createAsset({
      userId: 'file-owner',
      groupId: group.id,
      resourceType: 'product',
      name: '本地商品图',
      originalFileName: 'local-product.png',
      storedFileName: 'local-product.png',
      mimeType: 'image/png',
      fileSize: 1024,
      filePath: '/data/files/local-product.png',
      fileUrl: '/files/local-product.png',
    })
    const tosAsset = contentRepository.createAsset({
      userId: 'file-owner',
      groupId: group.id,
      resourceType: 'product',
      name: '对象存储视频',
      originalFileName: 'tos-video.mp4',
      storedFileName: 'tos-video.mp4',
      mimeType: 'video/mp4',
      fileSize: 4096,
      filePath: '/data/files/tos-video.mp4',
      fileUrl: 'https://example.com/app-files/tos-video.mp4',
      lifecycleStatus: 'retained',
      metadata: {
        storageProvider: 'tos',
        storageKey: 'app-files/tos-video.mp4',
        storageBucket: 'media-bucket',
      },
    })
    assert.ok(localAsset)
    assert.ok(tosAsset)
    db.prepare(`
      INSERT INTO content_asset_references (asset_id, reference_type, reference_id, role, created_at)
      VALUES (?, 'test', 'test-reference', 'input', ?)
    `).run(tosAsset.id, new Date().toISOString())

    const allFiles = fileManagementService.list({ page: 1, pageSize: 20 })
    assert.equal(allFiles.total, 2)
    assert.equal(allFiles.summary.localCount, 1)
    assert.equal(allFiles.summary.tosCount, 1)
    assert.equal(allFiles.summary.totalBytes, 5120)

    const tosVideos = fileManagementService.list({
      storageProvider: 'tos',
      mediaType: 'video',
      search: 'tos-video',
    })
    assert.equal(tosVideos.total, 1)
    assert.equal(tosVideos.items[0]?.storageKey, 'app-files/tos-video.mp4')
    assert.equal(tosVideos.items[0]?.storageBucket, 'media-bucket')
    assert.equal(tosVideos.items[0]?.referenceCount, 1)

    const localImages = fileManagementService.list({ storageProvider: 'local', mediaType: 'image' })
    assert.equal(localImages.total, 1)
    assert.equal(localImages.items[0]?.id, localAsset.id)
    assert.equal(managedFilePublicUrl(localImages.items[0]!, 'https://files.example.com'), 'https://files.example.com/files/local-product.png')
    assert.equal(managedFilePublicUrl(tosVideos.items[0]!, 'https://files.example.com'), 'https://example.com/app-files/tos-video.mp4')

    await assert.rejects(
      fileManagementService.delete({ id: tosAsset.id, storageKey: 'app-files/tos-video.mp4' }),
      /仍被业务引用/,
    )
    await fileManagementService.delete({ id: localAsset.id })
    assert.equal(contentRepository.findAsset(localAsset.id), null)
  } finally {
    if (previousDataDir === undefined) delete process.env.DATA_DIR
    else process.env.DATA_DIR = previousDataDir
    rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('TOS storage summary uses real object sizes for the whole bucket and configured prefix', async () => {
  const { summarizeTosObjects } = await import('../src/modules/file-management/file-management-tos.service.js')
  const summary = summarizeTosObjects({
    bucket: 'media-bucket',
    keyPrefix: 'app-files',
    objects: [
      { Key: 'app-files/image.png', Size: 1024 },
      { Key: 'app-files/videos/video.mp4', Size: 4096 },
      { Key: 'other-service/archive.zip', Size: 8192 },
    ],
  })
  assert.equal(summary.objectCount, 3)
  assert.equal(summary.totalBytes, 13_312)
  assert.equal(summary.prefixObjectCount, 2)
  assert.equal(summary.prefixBytes, 5120)
})
