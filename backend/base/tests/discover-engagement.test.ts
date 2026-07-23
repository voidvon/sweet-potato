import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

test('discover engagement counters persist independently for published items', async () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'discover-engagement-'))
  const previousDataDir = process.env.DATA_DIR
  process.env.DATA_DIR = path.join(tempRoot, 'data')

  try {
    const [{ migrateDatabase }, { discoverRepository }] = await Promise.all([
      import('../src/db/schema.js'),
      import('../src/modules/discover/discover.repository.js'),
    ])
    migrateDatabase()

    const category = discoverRepository.createCategory({ name: '推荐', slug: 'recommended', sortOrder: 0 })
    const baseItem: Parameters<typeof discoverRepository.createItem>[0] = {
      categoryId: category.id,
      sourceAssetId: 'asset-base',
      title: '发现作品',
      description: '',
      mediaType: 'image',
      mimeType: 'image/png',
      fileUrl: '/files/published.png',
      originalFileName: 'published.png',
      fileSize: 100,
      likeCount: 2,
      viewCount: 3,
      duration: 0,
      sourceCreatedAt: null,
      sourceCompletedAt: null,
      referenceAssets: [],
      aspectRatio: '1 / 1',
      status: 'published',
      sortOrder: 0,
    }
    const publishedItem = discoverRepository.createItem({
      ...baseItem,
      sourceAssetId: 'asset-published',
      title: '已发布作品',
    })
    const hiddenItem = discoverRepository.createItem({
      ...baseItem,
      sourceAssetId: 'asset-hidden',
      status: 'hidden',
    })

    assert.deepEqual(discoverRepository.incrementLikeCount(publishedItem.id), { likeCount: 3, viewCount: 3 })
    assert.deepEqual(discoverRepository.incrementViewCount(publishedItem.id), { likeCount: 3, viewCount: 4 })
    assert.equal(discoverRepository.incrementLikeCount(hiddenItem.id), null)
    assert.equal(discoverRepository.incrementViewCount('missing-item'), null)
  } finally {
    if (previousDataDir === undefined) delete process.env.DATA_DIR
    else process.env.DATA_DIR = previousDataDir
    rmSync(tempRoot, { recursive: true, force: true })
  }
})
