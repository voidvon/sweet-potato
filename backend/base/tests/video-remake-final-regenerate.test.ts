import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function finalCards(session: { messages: Array<{ type: string; cardType?: string; status?: string; data?: unknown }> }) {
  return session.messages.filter((message) => message.type === 'card' && message.cardType === 'final_video');
}

function primerPlanFixture() {
  return {
    mode: 'scene_spans',
    segmentPrimerMap: {
      '1': 'primer_span_1',
      '2': 'primer_span_1',
      '3': 'primer_span_2',
    },
    spans: [
      {
        spanId: 'primer_span_1',
        segmentIndexes: [1, 2],
        segmentStartIndex: 1,
        segmentEndIndex: 2,
        sceneLabels: ['场景 1'],
        people: ['人物 1', '人物 2'],
        narration: '场景一参考口播',
        gapKinds: ['character', 'scene'],
        primer: {
          assetId: 'reference-primer-asset-1',
          videoUrl: 'https://cdn.example.com/reference-primer-1.mp4',
        },
      },
      {
        spanId: 'primer_span_2',
        segmentIndexes: [3],
        segmentStartIndex: 3,
        segmentEndIndex: 3,
        sceneLabels: ['场景 2'],
        people: ['人物 1'],
        narration: '场景二参考口播',
        gapKinds: ['character', 'scene'],
        primer: {
          assetId: 'reference-primer-asset-2',
          videoUrl: 'https://cdn.example.com/reference-primer-2.mp4',
        },
      },
    ],
  };
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
        videoUrl: '/files/final-v1.mp4',
        versionNumber: 1,
        versionLabel: 'v1',
        segments: [{ segmentIndex: 1, prompt: '镜头 1', videoUrl: '/files/segment-v1.mp4' }],
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
          videoUrl: '/files/final-v2.mp4',
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
      const existingCard = cardsDuringRegeneration.find((card) => card.cardId === completedCard.cardId);
      const generatingCard = cardsDuringRegeneration.find((card) => card.cardId !== completedCard.cardId);
      assert.equal(existingCard?.status, 'confirmed');
      assert.equal(generatingCard?.status, 'pending');
      assert.match(JSON.stringify(generatingCard?.data || {}), /视频生成中/);

      releaseMergeVideo?.();
      const completedSession = await regeneratePromise;
      const cardsAfterRegeneration = finalCards(completedSession);
      assert.equal(cardsAfterRegeneration.length, 2);
      const regeneratedCard = cardsAfterRegeneration.find((card) => card.cardId !== completedCard.cardId);
      assert.equal(regeneratedCard?.status, 'confirmed');
      assert.match(JSON.stringify(regeneratedCard?.data || {}), /final-v2/);
    } finally {
      defaultVideoRemakeNodeAdapters.mergeVideo = originalMergeVideo;
      releaseMergeVideo?.();
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('final video segment regenerate keeps original card and creates a new segment regeneration card', async () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'video-remake-final-segment-regenerate-'));
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

    const userId = 'user-final-segment-regenerate-test';
    const session = videoRemakeService.createSession({ userId, filename: 'final-segment-regenerate.mp4' });
    const createdAt = new Date().toISOString();
    const completedCard = {
      id: 'card-row-final-v1-segment',
      type: 'card' as const,
      role: 'assistant' as const,
      cardId: 'final-card-v1-segment',
      cardType: 'final_video' as const,
      title: '最终视频',
      status: 'confirmed' as const,
      data: {
        status: 'completed',
        message: '视频生成完成。',
        videoUrl: '/files/final-v1.mp4',
        versionNumber: 1,
        versionLabel: 'v1',
        segments: [
          { segmentIndex: 1, prompt: { mainPrompt: '镜头 1' }, seedancePrompt: '镜头 1', videoUrl: '/files/segment-v1-1.mp4', status: 'completed' },
          { segmentIndex: 2, prompt: { mainPrompt: '镜头 2' }, seedancePrompt: '镜头 2', videoUrl: '/files/segment-v1-2.mp4', status: 'completed' },
        ],
        generatedSegments: [
          { segmentIndex: 1, prompt: { mainPrompt: '镜头 1' }, seedancePrompt: '镜头 1', videoUrl: '/files/segment-v1-1.mp4', status: 'completed' },
          { segmentIndex: 2, prompt: { mainPrompt: '镜头 2' }, seedancePrompt: '镜头 2', videoUrl: '/files/segment-v1-2.mp4', status: 'completed' },
        ],
        videos: [
          {
            versionNumber: 1,
            versionLabel: 'v1',
            videoUrl: '/files/final-v1.mp4',
            segments: [
              { segmentIndex: 1, videoUrl: '/files/segment-v1-1.mp4', status: 'completed' },
              { segmentIndex: 2, videoUrl: '/files/segment-v1-2.mp4', status: 'completed' },
            ],
          },
        ],
      },
      createdAt,
    };
    videoRemakeRepository.upsertCard(session.id, completedCard);

    const originalRegenerateVideoSegment = defaultVideoRemakeNodeAdapters.regenerateVideoSegment;
    let releaseRegenerate: (() => void) | undefined;
    const regenerateStarted = new Promise<void>((resolve) => {
      defaultVideoRemakeNodeAdapters.regenerateVideoSegment = async () => {
        resolve();
        await new Promise<void>((release) => {
          releaseRegenerate = release;
        });
        return {
          status: 'completed',
          videoUrl: '/files/final-v1-segment-2.mp4',
          renderMode: 'segment_regenerated_ffmpeg',
          regeneratedSegmentIndex: 2,
          generatedSegments: [
            { segmentIndex: 1, prompt: { mainPrompt: '镜头 1' }, seedancePrompt: '镜头 1', videoUrl: '/files/segment-v1-1.mp4', status: 'completed' },
            { segmentIndex: 2, prompt: { mainPrompt: '镜头 2 新版' }, seedancePrompt: '镜头 2 新版', videoUrl: '/files/segment-v1-2b.mp4', status: 'completed', regeneratedAt: new Date().toISOString() },
          ],
          segments: [
            { segmentIndex: 1, prompt: { mainPrompt: '镜头 1' }, seedancePrompt: '镜头 1', videoUrl: '/files/segment-v1-1.mp4', status: 'completed' },
            { segmentIndex: 2, prompt: { mainPrompt: '镜头 2 新版' }, seedancePrompt: '镜头 2 新版', videoUrl: '/files/segment-v1-2b.mp4', status: 'completed', regeneratedAt: new Date().toISOString() },
          ],
        };
      };
    });

    try {
      const regeneratePromise = videoRemakeService.regenerateFinalVideoSegment(session.id, completedCard.cardId, {
        userId,
        segmentIndex: 2,
      });
      await regenerateStarted;

      const generatingSession = videoRemakeService.getSession(session.id);
      const cardsDuringRegeneration = finalCards(generatingSession);
      assert.equal(cardsDuringRegeneration.length, 2);
      const originalCard = cardsDuringRegeneration.find((entry) => entry.cardId === completedCard.cardId);
      const regenerationCard = cardsDuringRegeneration.find((entry) => entry.cardId !== completedCard.cardId);
      assert.equal(originalCard?.status, 'confirmed');
      assert.equal((originalCard?.data as { videoUrl?: string })?.videoUrl, '/files/final-v1.mp4');
      assert.ok(regenerationCard);
      assert.notEqual(regenerationCard?.cardId, completedCard.cardId);
      assert.equal(regenerationCard?.status, 'pending');
      assert.equal((regenerationCard?.data as { regenerationMode?: string })?.regenerationMode, 'segment');
      assert.equal((regenerationCard?.data as { regeneratedSegmentIndex?: number })?.regeneratedSegmentIndex, 2);
      const draftSegments = (regenerationCard?.data as { segments?: Array<{ status?: string; videoUrl?: string }> })?.segments || [];
      assert.equal(draftSegments.length, 2);
      assert.equal(draftSegments[0]?.status, 'completed');
      assert.equal(draftSegments[0]?.videoUrl, '/files/segment-v1-1.mp4');
      assert.equal(draftSegments[1]?.status, 'generating');
      assert.equal(draftSegments[1]?.videoUrl, undefined);

      releaseRegenerate?.();
      const completedSession = await regeneratePromise;
      const cardsAfterRegeneration = finalCards(completedSession);
      assert.equal(cardsAfterRegeneration.length, 2);
      const originalCompletedCard = cardsAfterRegeneration.find((entry) => entry.cardId === completedCard.cardId);
      const regeneratedCompletedCard = cardsAfterRegeneration.find((entry) => entry.cardId !== completedCard.cardId);
      assert.equal(originalCompletedCard?.status, 'confirmed');
      assert.equal((originalCompletedCard?.data as { videoUrl?: string })?.videoUrl, '/files/final-v1.mp4');
      assert.equal(regeneratedCompletedCard?.status, 'confirmed');
      assert.equal((regeneratedCompletedCard?.data as { videoUrl?: string })?.videoUrl, '/files/final-v1-segment-2.mp4');
    } finally {
      defaultVideoRemakeNodeAdapters.regenerateVideoSegment = originalRegenerateVideoSegment;
      releaseRegenerate?.();
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('final video regeneration preserves referencePrimerPlan in draft, completed card, and history', async () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'video-remake-final-primer-plan-'));
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

    const userId = 'user-final-primer-plan-test';
    const session = videoRemakeService.createSession({ userId, filename: 'final-primer-plan.mp4' });
    const referencePrimerPlan = primerPlanFixture();
    const completedCard = {
      id: 'card-row-final-primer-v1',
      type: 'card' as const,
      role: 'assistant' as const,
      cardId: 'final-card-primer-v1',
      cardType: 'final_video' as const,
      title: '最终视频',
      status: 'confirmed' as const,
      data: {
        status: 'completed',
        message: '视频生成完成。',
        videoUrl: '/files/final-primer-v1.mp4',
        versionNumber: 1,
        versionLabel: 'v1',
        referencePrimerPlan,
        segments: [
          { segmentIndex: 1, prompt: '镜头 1', videoUrl: '/files/segment-primer-v1-1.mp4' },
          { segmentIndex: 2, prompt: '镜头 2', videoUrl: '/files/segment-primer-v1-2.mp4' },
          { segmentIndex: 3, prompt: '镜头 3', videoUrl: '/files/segment-primer-v1-3.mp4' },
        ],
        videos: [
          {
            versionNumber: 1,
            versionLabel: 'v1',
            videoUrl: '/files/final-primer-v1.mp4',
            referencePrimerPlan,
            segments: [
              { segmentIndex: 1, prompt: '镜头 1', videoUrl: '/files/segment-primer-v1-1.mp4' },
              { segmentIndex: 2, prompt: '镜头 2', videoUrl: '/files/segment-primer-v1-2.mp4' },
              { segmentIndex: 3, prompt: '镜头 3', videoUrl: '/files/segment-primer-v1-3.mp4' },
            ],
          },
        ],
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
          videoUrl: '/files/final-primer-v2.mp4',
          assetId: 'asset-final-primer-v2',
          renderMode: 'single_seedance',
          referencePrimerPlan,
          segments: [
            { segmentIndex: 1, prompt: '镜头 1', videoUrl: '/files/segment-primer-v2-1.mp4' },
            { segmentIndex: 2, prompt: '镜头 2', videoUrl: '/files/segment-primer-v2-2.mp4' },
            { segmentIndex: 3, prompt: '镜头 3', videoUrl: '/files/segment-primer-v2-3.mp4' },
          ],
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
      const draftCard = cardsDuringRegeneration.find((card) => card.cardId !== completedCard.cardId);
      assert.deepEqual((draftCard?.data as { referencePrimerPlan?: unknown })?.referencePrimerPlan, referencePrimerPlan);

      releaseMergeVideo?.();
      const completedSession = await regeneratePromise;
      const cardsAfterRegeneration = finalCards(completedSession);
      const regeneratedCard = cardsAfterRegeneration.find((card) => card.cardId !== completedCard.cardId);
      const regeneratedData = regeneratedCard?.data as { referencePrimerPlan?: unknown; videos?: Array<{ referencePrimerPlan?: unknown }> };
      assert.deepEqual(regeneratedData.referencePrimerPlan, referencePrimerPlan);
      assert.equal(regeneratedData.videos?.length, 1);
      assert.deepEqual(regeneratedData.videos?.[0]?.referencePrimerPlan, referencePrimerPlan);
    } finally {
      defaultVideoRemakeNodeAdapters.mergeVideo = originalMergeVideo;
      releaseMergeVideo?.();
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
