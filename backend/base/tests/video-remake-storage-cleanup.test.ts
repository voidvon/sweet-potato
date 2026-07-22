import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

test('video remake session deletion removes its source and pip uploads', async () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'video-remake-storage-cleanup-'))
  const previousDataDir = process.env.DATA_DIR
  process.env.DATA_DIR = path.join(tempRoot, 'data')

  try {
    const [
      { migrateDatabase },
      { videoRemakeRepository },
      { videoRemakeService },
      { setFileStorageProviderResolver },
    ] = await Promise.all([
      import('../src/db/schema.js'),
      import('../src/modules/video-remake/video-remake.repository.js'),
      import('../src/modules/video-remake/video-remake.service.js'),
      import('../src/shared/file-storage.js'),
    ])
    migrateDatabase()
    setFileStorageProviderResolver(() => 'local')

    const sourcePath = path.join(tempRoot, 'source.mp4')
    const pipPath = path.join(tempRoot, 'pip.png')
    mkdirSync(path.dirname(sourcePath), { recursive: true })
    writeFileSync(sourcePath, 'video')
    writeFileSync(pipPath, 'image')

    const userId = 'video-remake-storage-owner'
    const created = videoRemakeService.createSession({ userId })
    await videoRemakeService.upload(created.id, {
      userId,
      originalFileName: 'source.mp4',
      storedFileName: 'input_files/video/source.mp4',
      mimeType: 'video/mp4',
      fileSize: 5,
      filePath: sourcePath,
      fileUrl: '/files/input_files/video/source.mp4',
      storageProvider: 'local',
      storageKey: 'app-files/input_files/video/source.mp4',
    })
    videoRemakeService.uploadPipAsset(created.id, {
      userId,
      originalFileName: 'pip.png',
      storedFileName: 'input_files/image/pip.png',
      mimeType: 'image/png',
      fileSize: 5,
      filePath: pipPath,
      fileUrl: '/files/input_files/image/pip.png',
      storageProvider: 'local',
      storageKey: 'app-files/input_files/image/pip.png',
    })

    await videoRemakeService.deleteSession(created.id, { userId })

    assert.equal(videoRemakeRepository.findSession(created.id), null)
    assert.equal(existsSync(sourcePath), false)
    assert.equal(existsSync(pipPath), false)
  } finally {
    if (previousDataDir === undefined) delete process.env.DATA_DIR
    else process.env.DATA_DIR = previousDataDir
    rmSync(tempRoot, { recursive: true, force: true })
  }
})
