import assert from 'node:assert/strict'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import sharp from 'sharp'
import {
  contentAssetThumbnailPath,
  normalizeContentThumbnailSize,
} from '../src/modules/content/internals/content-asset-thumbnail.js'
import type { ContentAsset } from '../src/modules/content/content.types.js'

function imageAsset(filePath: string): ContentAsset {
  return {
    id: 'thumbnail-test-asset',
    groupId: 'thumbnail-test-group',
    userId: 'thumbnail-test-user',
    resourceType: 'scene',
    name: 'thumbnail test',
    description: '',
    originalFileName: 'source.png',
    storedFileName: 'source.png',
    mimeType: 'image/png',
    fileSize: 0,
    filePath,
    fileUrl: '',
    assetKind: 'library',
    lifecycleStatus: 'permanent',
    parentAssetId: null,
    expiresAt: null,
    retainedAt: null,
    metadata: {},
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z',
  }
}

test('normalizes content thumbnail sizes to a bounded range', () => {
  assert.equal(normalizeContentThumbnailSize(undefined), 256)
  assert.equal(normalizeContentThumbnailSize('16'), 64)
  assert.equal(normalizeContentThumbnailSize('320'), 320)
  assert.equal(normalizeContentThumbnailSize('2048'), 512)
  assert.equal(normalizeContentThumbnailSize('invalid'), 256)
})

test('creates and reuses a square webp thumbnail', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'content-thumbnail-'))
  const sourcePath = path.join(directory, 'source.png')
  const cacheDir = path.join(directory, 'cache')
  try {
    await sharp({
      create: {
        width: 800,
        height: 400,
        channels: 4,
        background: '#1677ff',
      },
    }).png().toFile(sourcePath)

    const firstPath = await contentAssetThumbnailPath(imageAsset(sourcePath), 128, cacheDir)
    const firstStat = await stat(firstPath)
    const metadata = await sharp(firstPath).metadata()
    const secondPath = await contentAssetThumbnailPath(imageAsset(sourcePath), 128, cacheDir)
    const secondStat = await stat(secondPath)

    assert.equal(metadata.format, 'webp')
    assert.equal(metadata.width, 128)
    assert.equal(metadata.height, 128)
    assert.equal(secondPath, firstPath)
    assert.equal(secondStat.mtimeMs, firstStat.mtimeMs)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test('rejects non-image assets', async () => {
  const asset = {
    ...imageAsset('/tmp/not-used.mp4'),
    mimeType: 'video/mp4',
  }
  await assert.rejects(
    () => contentAssetThumbnailPath(asset, 128),
    /当前素材不是图片/,
  )
})
