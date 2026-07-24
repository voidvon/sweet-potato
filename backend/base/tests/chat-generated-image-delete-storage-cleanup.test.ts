import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

test('deleting the last generated image removes its TOS-shaped temporary reference asset', async () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'chat-image-delete-storage-'))
  const previousDataDir = process.env.DATA_DIR
  process.env.DATA_DIR = path.join(tempRoot, 'data')

  try {
    const [
      { migrateDatabase },
      { chatRepository },
      { contentRepository },
      { contentService },
    ] = await Promise.all([
      import('../src/db/schema.js'),
      import('../src/modules/chat/chat.repository.js'),
      import('../src/modules/content/content.repository.js'),
      import('../src/modules/content/content.service.js'),
    ])
    migrateDatabase()

    const userId = 'chat-image-owner'
    const conversationId = 'chat-image-conversation'
    const now = new Date().toISOString()
    const inputGroup = contentRepository.createGroup({
      userId,
      resourceType: 'other',
      name: '临时输入图片',
    })
    const outputGroup = contentRepository.createGroup({
      userId,
      resourceType: 'finished_video',
      name: '生成图片',
    })
    assert.ok(inputGroup)
    assert.ok(outputGroup)

    const inputFilePath = path.join(tempRoot, 'reference.png')
    const outputFilePath = path.join(tempRoot, 'generated.png')
    writeFileSync(inputFilePath, 'reference')
    writeFileSync(outputFilePath, 'generated')
    const inputUrl = 'https://example.tos-cn-beijing.volces.com/app/input_images/reference.png'
    const outputUrl = 'https://example.tos-cn-beijing.volces.com/app/generated_images/generated.png'
    const inputAsset = contentRepository.createAsset({
      userId,
      groupId: inputGroup.id,
      resourceType: 'other',
      name: '参考图片',
      originalFileName: 'reference.png',
      storedFileName: 'input_images/reference.png',
      mimeType: 'image/png',
      fileSize: 9,
      filePath: inputFilePath,
      fileUrl: inputUrl,
      lifecycleStatus: 'temporary',
      metadata: { temporary: true, storageProvider: 'local' },
    })
    const outputAsset = contentRepository.createAsset({
      userId,
      groupId: outputGroup.id,
      resourceType: 'finished_video',
      name: '生成图片',
      originalFileName: 'generated.png',
      storedFileName: 'generated_images/generated.png',
      mimeType: 'image/png',
      fileSize: 9,
      filePath: outputFilePath,
      fileUrl: outputUrl,
      metadata: {
        generatedBy: 'image_model',
        conversationId,
        storageProvider: 'local',
      },
    })
    assert.ok(inputAsset)
    assert.ok(outputAsset)
    contentRepository.retainAssetsForReference({
      assetIds: [inputAsset.id],
      userId,
      referenceType: 'content_asset',
      referenceId: outputAsset.id,
    })

    chatRepository.createConversation({
      id: conversationId,
      userId,
      title: '图片生成',
      agentId: 'image-generation',
      modelConfigId: null,
      createdAt: now,
      updatedAt: now,
    })
    chatRepository.createMessages([
      {
        id: 'chat-image-user-message',
        conversationId,
        role: 'user',
        content: '处理参考图片',
        agentId: 'image-generation',
        attachments: [{
          id: 'reference-attachment',
          assetId: inputAsset.id,
          kind: 'image',
          name: 'reference.png',
          size: 9,
          type: 'image/png',
          url: inputUrl,
        }],
        createdAt: now,
      },
      {
        id: 'chat-image-assistant-message',
        conversationId,
        role: 'assistant',
        content: '图片已生成',
        agentId: 'image-generation',
        attachments: [{
          id: 'generated-attachment',
          kind: 'image',
          name: 'generated.png',
          size: 9,
          type: 'image/png',
          url: outputUrl,
        }],
        createdAt: new Date(Date.parse(now) + 1).toISOString(),
      },
    ])

    await contentService.deleteAsset(outputAsset.id, { userId, role: 'admin' })

    assert.equal(contentRepository.findAsset(outputAsset.id), null)
    assert.equal(contentRepository.findAsset(inputAsset.id), null)
    assert.equal(existsSync(outputFilePath), false)
    assert.equal(existsSync(inputFilePath), false)
  } finally {
    if (previousDataDir === undefined) delete process.env.DATA_DIR
    else process.env.DATA_DIR = previousDataDir
    rmSync(tempRoot, { recursive: true, force: true })
  }
})
