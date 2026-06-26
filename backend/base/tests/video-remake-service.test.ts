import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function latestCard(session: { messages: Array<{ type: string; cardType?: string; status?: string; cardId?: string; data?: unknown }> }, cardType: string) {
  const cards = session.messages.filter((message) => message.type === 'card' && message.cardType === cardType);
  return cards[cards.length - 1];
}

function cardsOfType(session: { messages: Array<{ type: string; cardType?: string; status?: string; cardId?: string; data?: unknown }> }, cardType: string) {
  return session.messages.filter((message) => message.type === 'card' && message.cardType === cardType);
}

function findCardDataText(session: { messages: Array<{ type: string; cardType?: string; status?: string; data?: unknown }> }, cardType: string, pattern: RegExp) {
  return session.messages.find((message) => (
    message.type === 'card'
    && message.cardType === cardType
    && pattern.test(JSON.stringify(message.data || {}))
  ));
}

test('video remake workflow runs cards through final video independently', async () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'video-remake-service-'));
  const dataDir = path.join(tempRoot, 'data');
  mkdirSync(dataDir, { recursive: true });

  try {
    process.env.DATA_DIR = dataDir;

    const [{ migrateDatabase }, { videoRemakeService }, { defaultVideoRemakeNodeAdapters }, { videoRemakeRepository }] = await Promise.all([
      import('../src/db/schema.js'),
      import('../src/modules/video-remake/video-remake.service.js'),
      import('../src/modules/video-remake/video-remake.node-adapters.js'),
      import('../src/modules/video-remake/video-remake.repository.js'),
    ]);
    migrateDatabase();

    const created = videoRemakeService.createSession({ userId: 'user-video-remake-test' });
    const parsed = await videoRemakeService.parseSessionUrl(created.id, {
      userId: 'user-video-remake-test',
      url: 'https://example.com/pip-demo.mp4',
    });
    assert.ok(parsed.taskId);

    let session = await videoRemakeService.run(parsed.id);
    assert.equal(session.status, 'waiting_edit');
    assert.equal(session.workflow.runtime.langGraph?.package, '@langchain/langgraph');
    assert.equal(findCardDataText(session, 'uploading', /uploaded|已上传/)?.status, 'confirmed');
    const uploadCard = latestCard(session, 'uploading');
    assert.ok(uploadCard?.cardId);
    const uploadCompletedEventIndex = session.events.findIndex((event) => (
      event.type === 'card.update'
      && event.cardId === uploadCard.cardId
      && event.status === 'confirmed'
      && /uploaded|已上传/.test(JSON.stringify(event.data || {}))
    ));
    const basicInfoCreateEventIndex = session.events.findIndex((event) => (
      event.type === 'card.create'
      && event.card.cardType === 'video_basic_info'
    ));
    assert.ok(uploadCompletedEventIndex >= 0, 'uploading card should receive uploaded update');
    assert.ok(basicInfoCreateEventIndex >= 0, 'video basic info card should be created');
    assert.ok(uploadCompletedEventIndex < basicInfoCreateEventIndex, 'uploading card should be marked uploaded before basic info card appears');
    const progressCard = findCardDataText(session, 'generation_progress', /视频解析完成/);
    assert.equal(progressCard?.status, 'confirmed');
    assert.match(JSON.stringify(progressCard?.data || {}), /视频解析完成/);
    const expertCards = cardsOfType(session, 'expert_analysis');
    assert.equal(expertCards.length, 3);
    assert.match(JSON.stringify(expertCards.map((card) => card.data)), /音频理解专家/);
    assert.match(JSON.stringify(expertCards.map((card) => card.data)), /视频理解专家/);
    assert.match(JSON.stringify(expertCards.map((card) => card.data)), /画中画理解专家/);
    assert.equal(latestCard(session, 'basic_info')?.status, 'editing');

    for (const cardType of ['basic_info', 'character_setting', 'scene_setting', 'voice_audio_setting', 'script_content']) {
      const card = latestCard(session, cardType);
      assert.ok(card?.cardId, `${cardType} card should exist`);
      session = await videoRemakeService.confirmCard(session.id, card.cardId, {
        userId: 'user-video-remake-test',
        cardType: cardType as never,
        data: card.data,
      });
    }
    assert.equal(latestCard(session, 'product_setting'), undefined, 'no product card should be created when parsing found no product');
    assert.equal(latestCard(session, 'pip_setting'), undefined, 'no pip card should be created when parsing found no picture-in-picture');

    const productChat = await videoRemakeService.sendChat(session.id, {
      userId: 'user-video-remake-test',
      message: '我要改产品',
    });
    session = productChat.session;
    const productCard = latestCard(session, 'product_setting');
    assert.equal(productCard?.status, 'editing');
    session = await videoRemakeService.confirmCard(session.id, productCard?.cardId || '', {
      userId: 'user-video-remake-test',
      cardType: 'product_setting',
      data: productCard?.data,
    });

    const storyboard = latestCard(session, 'storyboard_script');
    assert.equal(storyboard?.status, 'editing');
    assert.ok(Array.isArray(storyboard?.data));
    session = await videoRemakeService.confirmCard(session.id, storyboard.cardId || '', {
      userId: 'user-video-remake-test',
      cardType: 'storyboard_script',
      data: storyboard.data,
    });

    const seedance = latestCard(session, 'seedance_prompt');
    assert.equal(seedance?.status, 'editing');
    assert.ok(Array.isArray(seedance?.data));
    session = await videoRemakeService.confirmCard(session.id, seedance.cardId || '', {
      userId: 'user-video-remake-test',
      cardType: 'seedance_prompt',
      data: seedance.data,
    });

    const finalCard = latestCard(session, 'final_video');
    assert.equal(finalCard?.status, 'editing');
    const originalMergeVideo = defaultVideoRemakeNodeAdapters.mergeVideo;
    defaultVideoRemakeNodeAdapters.mergeVideo = async () => ({
      provider: 'volcengine-seedance',
      model: 'doubao-seedance-2-0-260128',
      status: 'completed',
      videoUrl: '/files/content/generated-video-video-remake-test.mp4',
      assetId: 'asset-generated-video-remake-test',
      renderMode: 'single_seedance',
      segments: [],
    });
    try {
      session = await videoRemakeService.confirmCard(session.id, finalCard.cardId || '', {
        userId: 'user-video-remake-test',
        cardType: 'final_video',
        data: finalCard.data,
      });
    } finally {
      defaultVideoRemakeNodeAdapters.mergeVideo = originalMergeVideo;
    }

    assert.equal(session.status, 'completed');
    assert.equal(session.currentStep, 'completed');
    assert.match(String(session.task?.generatedVideoUrl || ''), /generated-video-video-remake-test/);
    assert.equal(cardsOfType(session, 'generation_progress').length, 1);
    const completedFinalCard = latestCard(session, 'final_video');
    assert.equal(completedFinalCard?.cardId, finalCard.cardId);
    assert.equal(completedFinalCard?.status, 'confirmed');
    assert.match(JSON.stringify(completedFinalCard?.data || {}), /generated-video-video-remake-test/);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('retrying an expert emits a director normalize card before returning to editable cards', async () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'video-remake-retry-expert-'));
  const dataDir = path.join(tempRoot, 'data');
  mkdirSync(dataDir, { recursive: true });

  try {
    process.env.DATA_DIR = dataDir;

    const [{ migrateDatabase }, { videoRemakeService }, { defaultVideoRemakeNodeAdapters }, { videoRemakeRepository }] = await Promise.all([
      import('../src/db/schema.js'),
      import('../src/modules/video-remake/video-remake.service.js'),
      import('../src/modules/video-remake/video-remake.node-adapters.js'),
      import('../src/modules/video-remake/video-remake.repository.js'),
    ]);
    migrateDatabase();

    let session = videoRemakeService.createSession({ userId: 'user-video-remake-retry-expert' });
    session.messages.push({
      id: 'audio-card-message',
      type: 'card',
      role: 'assistant',
      cardId: 'audio-card',
      cardType: 'expert_analysis',
      title: '专家解析',
      status: 'confirmed',
      data: {
        expertKey: 'audio',
        roleName: '音频理解专家',
        content: '旧音频结果',
      },
      createdAt: new Date().toISOString(),
    });
    session.workflow.runtime.analyses = {
      audio: { roleName: '音频理解专家', content: '旧音频结果' },
      visual: { roleName: '视频理解专家', content: '视频结果', characters: [], scenes: [] },
      pip: { roleName: '画中画理解专家', content: '', appeared: false, items: [] },
    };
    session.workflow.runtime.viralUnderstanding = {
      outputs: {
        audio_expert: { roleName: '音频理解专家', content: '旧音频结果' },
        video_expert: { roleName: '视频理解专家', content: '视频结果' },
        picture_in_picture_expert: { roleName: '画中画理解专家', content: '' },
      },
      executions: [],
    };
    session.workflow.artifacts.expertAnalysis = {
      audio: session.workflow.runtime.analyses.audio,
      visual: session.workflow.runtime.analyses.visual,
      pip: session.workflow.runtime.analyses.pip,
    };
    const audioCard = session.messages.find((message) => message.type === 'card' && message.cardId === 'audio-card');
    assert.ok(audioCard && audioCard.type === 'card');
    videoRemakeRepository.upsertCard(session.id, audioCard);
    videoRemakeRepository.updateSession(session.id, {
      status: session.status,
      currentStep: session.currentStep,
      invalidArtifacts: session.invalidArtifacts,
      artifacts: session.artifacts,
      workflow: session.workflow,
    });

    const originalAnalyzeAudio = defaultVideoRemakeNodeAdapters.analyzeAudio;
    const originalDirectorNormalize = defaultVideoRemakeNodeAdapters.directorNormalize;
    defaultVideoRemakeNodeAdapters.analyzeAudio = async () => ({
      roleName: '音频理解专家',
      content: '新音频结果',
      spokenContent: '新口播',
    });
    defaultVideoRemakeNodeAdapters.directorNormalize = async () => ({
      basicInfo: { title: '重试后标题' },
      characterSetting: { items: [] },
      sceneSetting: { items: [{ label: '场景 1', description: '重试后场景' }] },
      voiceAudioSetting: { voice: '原声参考', items: [] },
      scriptContent: { content: '新口播' },
    });
    try {
      session = await videoRemakeService.retryExpert(session.id, 'audio-card', {
        userId: 'user-video-remake-retry-expert',
      });
    } finally {
      defaultVideoRemakeNodeAdapters.analyzeAudio = originalAnalyzeAudio;
      defaultVideoRemakeNodeAdapters.directorNormalize = originalDirectorNormalize;
    }

    const directorCards = cardsOfType(session, 'director_normalize');
    assert.equal(directorCards.length, 1);
    assert.equal(directorCards[0]?.status, 'confirmed');
    assert.match(JSON.stringify(directorCards[0]?.data || {}), /expert_retry/);
    assert.equal(latestCard(session, 'basic_info')?.status, 'editing');
    assert.equal(session.workflow.pendingInterrupt?.cardType, 'basic_info');
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
