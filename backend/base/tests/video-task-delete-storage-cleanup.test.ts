import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

test('deleting a work removes unshared task uploads and preserves permanent or shared materials', async () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'video-task-delete-storage-'))
  const previousDataDir = process.env.DATA_DIR
  process.env.DATA_DIR = path.join(tempRoot, 'data')

  try {
    const [
      { migrateDatabase },
      { contentRepository, emptyVideoParseResult },
      { contentService },
    ] = await Promise.all([
      import('../src/db/schema.js'),
      import('../src/modules/content/content.repository.js'),
      import('../src/modules/content/content.service.js'),
    ])
    migrateDatabase()

    const userId = 'work-owner'
    const group = contentRepository.createGroup({
      userId,
      resourceType: 'product',
      name: '作品素材',
    })
    assert.ok(group)

    const createFileAsset = (name: string, options: { temporary: boolean }) => {
      const filePath = path.join(tempRoot, name)
      mkdirSync(path.dirname(filePath), { recursive: true })
      writeFileSync(filePath, name)
      const asset = contentRepository.createAsset({
        userId,
        groupId: group.id,
        resourceType: 'product',
        name,
        originalFileName: name,
        storedFileName: name,
        mimeType: 'image/png',
        fileSize: name.length,
        filePath,
        fileUrl: `/files/${name}`,
        lifecycleStatus: options.temporary ? 'temporary' : 'permanent',
        metadata: options.temporary ? { temporary: true, storageProvider: 'local' } : {},
      })
      assert.ok(asset)
      return { asset, filePath }
    }

    const taskUpload = createFileAsset('task-upload.png', { temporary: true })
    const historicalUpload = createFileAsset('historical-upload.png', { temporary: true })
    const sharedUpload = createFileAsset('shared-upload.png', { temporary: true })
    const libraryAsset = createFileAsset('library-asset.png', { temporary: false })

    const task = contentRepository.createVideoTaskFromPrompt({
      userId,
      prompt: '生成视频',
      selectedSkillIds: [],
      title: '待删除作品',
      parseResult: emptyVideoParseResult,
      expertContext: {
        mode: 'video_create',
        referenceImageIds: [taskUpload.asset.id, sharedUpload.asset.id, libraryAsset.asset.id],
        originalReferenceImageIds: [historicalUpload.asset.id],
      },
      aspectRatio: '9:16',
    })
    const otherTask = contentRepository.createVideoTaskFromPrompt({
      userId,
      prompt: '另一个视频',
      selectedSkillIds: [],
      title: '保留作品',
      parseResult: emptyVideoParseResult,
      expertContext: { mode: 'video_create', referenceImageIds: [sharedUpload.asset.id] },
      aspectRatio: '9:16',
    })
    assert.ok(task)
    assert.ok(otherTask)
    contentRepository.retainAssetsForReference({
      assetIds: [taskUpload.asset.id, sharedUpload.asset.id, libraryAsset.asset.id],
      userId,
      referenceType: 'video_generation_task',
      referenceId: task.id,
    })
    contentRepository.retainAssetsForReference({
      assetIds: [sharedUpload.asset.id],
      userId,
      referenceType: 'video_generation_task',
      referenceId: otherTask.id,
    })

    const finishedGroup = contentRepository.createGroup({
      userId,
      resourceType: 'finished_video',
      name: '作品',
    })
    assert.ok(finishedGroup)
    const finishedFilePath = path.join(tempRoot, 'finished.mp4')
    writeFileSync(finishedFilePath, 'finished')
    const finishedAsset = contentRepository.createAsset({
      userId,
      groupId: finishedGroup.id,
      resourceType: 'finished_video',
      name: '待删除成片',
      originalFileName: 'finished.mp4',
      storedFileName: 'finished.mp4',
      mimeType: 'video/mp4',
      fileSize: 8,
      filePath: finishedFilePath,
      fileUrl: '/files/finished.mp4',
      metadata: {
        videoTaskId: task.id,
        materialContext: { sourceAssetId: historicalUpload.asset.id },
      },
    })
    assert.ok(finishedAsset)

    await contentService.deleteAsset(finishedAsset.id, { userId, role: 'admin' })

    assert.equal(contentRepository.findVideoTask(task.id), null)
    assert.equal(contentRepository.findAsset(finishedAsset.id), null)
    assert.equal(existsSync(finishedFilePath), false)
    assert.equal(contentRepository.findAsset(taskUpload.asset.id), null)
    assert.equal(contentRepository.findAsset(historicalUpload.asset.id), null)
    assert.equal(existsSync(taskUpload.filePath), false)
    assert.equal(existsSync(historicalUpload.filePath), false)
    assert.ok(contentRepository.findAsset(sharedUpload.asset.id))
    assert.ok(contentRepository.findAsset(libraryAsset.asset.id))
    assert.equal(existsSync(sharedUpload.filePath), true)
    assert.equal(existsSync(libraryAsset.filePath), true)
  } finally {
    if (previousDataDir === undefined) delete process.env.DATA_DIR
    else process.env.DATA_DIR = previousDataDir
    rmSync(tempRoot, { recursive: true, force: true })
  }
})
