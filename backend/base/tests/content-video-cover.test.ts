import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

test('generated video cover is extracted, stored, and linked to the task', async () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'content-video-cover-'))
  const previousDataDir = process.env.DATA_DIR
  process.env.DATA_DIR = path.join(tempRoot, 'data')

  try {
    const [
      { migrateDatabase },
      { contentRepository, emptyVideoParseResult },
      { generateVideoCover },
    ] = await Promise.all([
      import('../src/db/schema.js'),
      import('../src/modules/content/content.repository.js'),
      import('../src/modules/content/internals/content-video-local-mirror.js'),
    ])
    migrateDatabase()

    const userId = 'video-cover-user'
    const task = contentRepository.createVideoTaskFromPrompt({
      userId,
      prompt: '生成视频封面',
      selectedSkillIds: [],
      title: '封面测试',
      parseResult: emptyVideoParseResult,
      expertContext: { mode: 'video_create' },
      aspectRatio: '16:9',
    })
    assert.ok(task)
    const group = contentRepository.createGroup({
      userId,
      resourceType: 'finished_video',
      name: '生成成片',
    })
    assert.ok(group)

    const videoFilePath = path.join(tempRoot, 'source.mp4')
    execFileSync('ffmpeg', [
      '-y',
      '-f', 'lavfi',
      '-i', 'color=c=red:s=320x180:d=1',
      '-pix_fmt', 'yuv420p',
      videoFilePath,
    ], { stdio: 'ignore' })
    const asset = contentRepository.createAsset({
      userId,
      groupId: group.id,
      resourceType: 'finished_video',
      name: '封面测试成片',
      originalFileName: 'source.mp4',
      storedFileName: 'source.mp4',
      mimeType: 'video/mp4',
      fileSize: 1,
      filePath: videoFilePath,
      fileUrl: '/files/source.mp4',
      metadata: { videoTaskId: task.id },
    })
    assert.ok(asset)

    const cover = await generateVideoCover({
      assetId: asset.id,
      taskId: task.id,
      videoFilePath,
    })

    assert.ok(cover)
    assert.match(cover.coverUrl, /-cover\.jpg$/u)
    const updatedAsset = contentRepository.findAsset(asset.id)
    assert.equal(updatedAsset?.metadata.coverStatus, 'completed')
    assert.equal(updatedAsset?.metadata.coverUrl, cover.coverUrl)
    assert.equal(updatedAsset?.metadata.coverMimeType, 'image/jpeg')
    assert.equal(existsSync(String(updatedAsset?.metadata.coverFilePath || '')), true)
    assert.equal(contentRepository.findVideoTask(task.id)?.generatedCoverUrl, cover.coverUrl)
  } finally {
    if (previousDataDir === undefined) delete process.env.DATA_DIR
    else process.env.DATA_DIR = previousDataDir
    rmSync(tempRoot, { recursive: true, force: true })
  }
})
