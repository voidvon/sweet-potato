import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function finalCards(session: { messages: Array<{ type: string; cardType?: string; status?: string; data?: unknown }> }) {
  return session.messages.filter((message) => message.type === 'card' && message.cardType === 'final_video');
}

test('final video regenerate creates a new generating card immediately', async () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'video-remake-final-regenerate-'));
  const dataDir = path.join(tempRoot, 'data');
  mkdirSync(dataDir, { recursive: true });

  try {
    process.env.DATA_DIR = dataDir;

    const [{ migrateDatabase }, { videoRemakeRepository }, { videoRemakeService }, { defaultVideoRemakeNodeAdapters }] = await Promise.all([
      import('../src/db/schema.js'),
      import('../src/modules/video-remake/video-remake.repository.js'),
      import('../src/modules/video-remake/video-remake.service.js'),
      import('../src/modules/video-remake/video-remake.node-adapters.js'),
    ]);
    migrateDatabase();

    const userId = 'user-final-regenerate-test';
    const session = videoRemakeService.createSession({ userId, filename: 'final-regenerate.mp4' });
    const completedCard = {
      id: 'card-row-final-v1',
      type: 'card' as const,
      role: 'assistant' as const,
      cardId: 'final-card-v1',
      cardType: 'final_video' as const,
      title: '最终视频',
      status: 'confirmed' as const,
      data: {
        status: 'completed',
        message: '视频生成完成。',
        videoUrl: '/files/content/final-v1.mp4',
        versionNumber: 1,
        versionLabel: 'v1',
        segments: [{ segmentIndex: 1, prompt: '镜头 1', videoUrl: '/files/content/segment-v1.mp4' }],
      },
      createdAt: new Date().toISOString(),
    };
    videoRemakeRepository.upsertCard(session.id, completedCard);

    const originalMergeVideo = defaultVideoRemakeNodeAdapters.mergeVideo;
    let releaseMergeVideo: (() => void) | undefined;
    const mergeVideoStarted = new Promise<void>((resolve) => {
      defaultVideoRemakeNodeAdapters.mergeVideo = async () => {
        resolve();
        await new Promise<void>((release) => {
          releaseMergeVideo = release;
        });
        return {
          provider: 'volcengine-seedance',
          model: 'doubao-seedance-2-0-260128',
          status: 'completed',
          videoUrl: '/files/content/final-v2.mp4',
          assetId: 'asset-final-v2',
          renderMode: 'single_seedance',
          segments: [],
        };
      };
    });
    try {
      const regeneratePromise = videoRemakeService.regenerateCard(session.id, completedCard.cardId, {
        userId,
        cardType: 'final_video',
      });
      await mergeVideoStarted;

      const generatingSession = videoRemakeService.getSession(session.id);
      const cardsDuringRegeneration = finalCards(generatingSession);
      assert.equal(cardsDuringRegeneration.length, 2);
      assert.equal(cardsDuringRegeneration[0]?.status, 'confirmed');
      assert.equal(cardsDuringRegeneration[1]?.status, 'pending');
      assert.match(JSON.stringify(cardsDuringRegeneration[1]?.data || {}), /视频生成中/);

      releaseMergeVideo?.();
      const completedSession = await regeneratePromise;
      const cardsAfterRegeneration = finalCards(completedSession);
      assert.equal(cardsAfterRegeneration.length, 2);
      assert.equal(cardsAfterRegeneration[1]?.status, 'confirmed');
      assert.match(JSON.stringify(cardsAfterRegeneration[1]?.data || {}), /final-v2/);
    } finally {
      defaultVideoRemakeNodeAdapters.mergeVideo = originalMergeVideo;
      releaseMergeVideo?.();
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
