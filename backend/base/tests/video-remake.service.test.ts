import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('video-remake service persists workflow, supports rule patches, resume, and cancel', async () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'video-remake-service-'));
  const dataDir = path.join(tempRoot, 'data');
  mkdirSync(dataDir, { recursive: true });
  const filePath = path.join(tempRoot, 'fixture.mp4');
  writeFileSync(filePath, Buffer.from('video-remake-fixture'));

  try {
    process.env.DATA_DIR = dataDir;

    const [{ migrateDatabase }, { createVideoRemakeService }, { videoRemakeRepository }] = await Promise.all([
      import('../src/db/schema.js'),
      import('../src/modules/video-remake/video-remake.service.js'),
      import('../src/modules/video-remake/video-remake.repository.js'),
    ]);
    migrateDatabase();

    const service = createVideoRemakeService();
    const session = service.createSession({ userId: 'user-service', filename: 'fixture.mp4' });
    assert.equal(session.status, 'created');

    const uploaded = await service.upload(session.id, {
      userId: 'user-service',
      originalFileName: 'fixture.mp4',
      storedFileName: 'fixture.mp4',
      mimeType: 'video/mp4',
      fileSize: Buffer.byteLength('video-remake-fixture'),
      filePath,
      fileUrl: '/files/content/fixture.mp4',
    });
    assert.equal(uploaded.status, 'running');
    assert.ok(uploaded.taskId);
    assert.equal(uploaded.workflow.runtime.vod?.sourceUrl, '/files/content/fixture.mp4');

    const running = await service.run(session.id);
    assert.equal(running.status, 'waiting_edit');
    assert.equal(running.workflow.pendingInterrupt?.cardType, 'basic_info');

    const basicCard = running.messages.find((message) => message.type === 'card' && message.cardType === 'basic_info');
    assert.ok(basicCard && basicCard.type === 'card');

    const confirmedBasic = await service.confirmCard(session.id, basicCard.cardId, {
      userId: 'user-service',
      cardType: 'basic_info',
      data: {
        ...(basicCard.data as Record<string, unknown>),
        title: '更新后的基础信息',
      },
    });
    assert.equal(confirmedBasic.workflow.pendingInterrupt?.cardType, 'character_setting');

    const characterCard = confirmedBasic.messages.find((message) => message.type === 'card' && message.cardType === 'character_setting');
    assert.ok(characterCard && characterCard.type === 'card');
    const confirmedCharacter = await service.confirmCard(session.id, characterCard.cardId, {
      userId: 'user-service',
      cardType: 'character_setting',
      data: {
        items: [{
          label: '人物 1',
          appearance: '外貌特征：短发',
          gesture: '动作/手势：挥手',
          expression: '表情/气质：认真',
          characterPrompt: '人物描述提示词：短发',
          required: true,
          referenceMode: 'prompt',
        }],
      },
    });
    const savedCharacter = (confirmedCharacter.workflow.artifacts.characterSetting as { items?: Array<Record<string, unknown>> }).items?.[0] || {};
    assert.equal(savedCharacter.appearance, undefined);
    assert.equal(savedCharacter.gesture, undefined);
    assert.equal(savedCharacter.expression, undefined);
    assert.match(String(savedCharacter.characterPrompt || ''), /短发/);
    assert.doesNotMatch(String(savedCharacter.characterPrompt || ''), /挥手/);
    assert.doesNotMatch(String(savedCharacter.characterPrompt || ''), /认真/);

    const sceneCard = confirmedCharacter.messages.find((message) => message.type === 'card' && message.cardType === 'scene_setting');
    assert.ok(sceneCard && sceneCard.type === 'card');
    const confirmedScene = await service.confirmCard(session.id, sceneCard.cardId, {
      userId: 'user-service',
      cardType: 'scene_setting',
      data: {
        items: [{
          label: '场景 1',
          description: '户外绿化场景',
          environment: '户外绿化场景',
          props: '木质长椅',
          lighting: '自然光',
          composition: '人物居中',
          camera: '固定机位',
          atmosphere: '平和',
          required: true,
          referenceMode: 'prompt',
        }],
      },
    });
    const savedScene = (confirmedScene.workflow.artifacts.sceneSetting as { items?: Array<Record<string, unknown>> }).items?.[0] || {};
    assert.equal(savedScene.environment, undefined);
    assert.equal(savedScene.props, undefined);
    assert.equal(savedScene.lighting, undefined);
    assert.equal(savedScene.composition, undefined);
    assert.equal(savedScene.camera, undefined);
    assert.equal(savedScene.atmosphere, undefined);
    assert.match(String(savedScene.description || ''), /户外绿化场景/);
    assert.doesNotMatch(String(savedScene.description || ''), /环境：户外绿化场景/);
    assert.match(String(savedScene.description || ''), /道具：木质长椅/);
    assert.match(String(savedScene.description || ''), /灯光：自然光/);
    assert.match(String(savedScene.description || ''), /构图：人物居中/);
    assert.match(String(savedScene.description || ''), /机位：固定机位/);
    assert.match(String(savedScene.description || ''), /氛围：平和/);

    const pipEdit = await service.sendChat(session.id, {
      userId: 'user-service',
      message: '我要改画中画',
    });
    const firstPipCard = pipEdit.session.messages
      .filter((message) => message.type === 'card' && message.cardType === 'pip_setting')
      .at(-1);
    assert.ok(firstPipCard && firstPipCard.type === 'card');

    const productEdit = await service.sendChat(session.id, {
      userId: 'user-service',
      message: '我要改产品',
    });
    const productCard = productEdit.session.messages
      .filter((message) => message.type === 'card' && message.cardType === 'product_setting')
      .at(-1);
    assert.ok(productCard && productCard.type === 'card');
    const confirmedProduct = await service.confirmCard(session.id, productCard.cardId, {
      userId: 'user-service',
      cardType: 'product_setting',
      data: productCard.data,
    });
    const pipCardsAfterProduct = confirmedProduct.messages
      .filter((message) => message.type === 'card' && message.cardType === 'pip_setting');
    assert.equal(pipCardsAfterProduct.length, 1);
    assert.equal(confirmedProduct.workflow.pendingInterrupt?.cardId, firstPipCard.cardId);
    assert.equal(confirmedProduct.workflow.pendingInterrupt?.cardType, 'pip_setting');

    const [{ defaultVideoRemakeNodeAdapters }] = await Promise.all([
      import('../src/modules/video-remake/video-remake.node-adapters.js'),
    ]);
    confirmedProduct.workflow.artifacts.storyboardScript = [{
      shotId: 'shot_1',
      startTime: 0,
      endTime: 4,
      duration: 4,
      narration: '你再说一遍',
      visualDescription: '承接口播重点',
    }];
    confirmedProduct.workflow.artifacts.voiceAudioSetting = {
      voice: '原声',
      voiceStyle: '温柔女声',
      bgm: '轻快、干净、不压人声',
      soundEffects: '仅保留必要转场和动作音效',
      items: [{
        label: '人物 1 声音',
        characterLabel: '人物 1',
        characterIndex: 0,
        voice: '原声',
        voiceStyle: '温柔女声',
      }],
    };
    confirmedProduct.workflow.artifacts.pipSetting = {
      appeared: false,
      summary: '视频中仅展示一位女性在户外进行养生内容分享的主画面，未出现后期叠加的独立内容区域，如叠加视频、图片、截图、录屏窗口、分屏或其他可复刻的视觉叠加层',
      items: [{
        type: 'unknown',
        content: '视频中仅展示一位女性在户外进行养生内容分享的主画面，未出现后期叠加的独立内容区域，如叠加视频、图片、截图、录屏窗口、分屏或其他可复刻的视觉叠加层',
        replacementPrompt: '视频中仅展示一位女性在户外进行养生内容分享的主画面，未出现后期叠加的独立内容区域，如叠加视频、图片、截图、录屏窗口、分屏或其他可复刻的视觉叠加层',
      }],
    };
    const seedancePrompts = await defaultVideoRemakeNodeAdapters.generateSeedancePrompts({
      sessionId: confirmedProduct.id,
      userId: confirmedProduct.userId,
      taskId: confirmedProduct.taskId,
      workflow: confirmedProduct.workflow,
      emit: () => undefined,
    });
    const visiblePrompt = String((seedancePrompts[0]?.prompt as Record<string, unknown> | undefined)?.mainPrompt || '');
    assert.match(visiblePrompt, /# 人物/);
    assert.match(visiblePrompt, /人物描述提示词：短发/);
    assert.doesNotMatch(visiblePrompt, /人物外观和动作以已确认人物卡片为准/);
    assert.doesNotMatch(visiblePrompt, /未出现后期叠加/);
    assert.doesNotMatch(visiblePrompt, /# 本段画中画/);
    assert.doesNotMatch(visiblePrompt, /# 音频/);

    confirmedProduct.workflow.artifacts.seedancePrompts = seedancePrompts;
    const videoSegments = await defaultVideoRemakeNodeAdapters.generateVideoSegments({
      sessionId: confirmedProduct.id,
      userId: confirmedProduct.userId,
      taskId: confirmedProduct.taskId,
      workflow: confirmedProduct.workflow,
      emit: () => undefined,
    });
    assert.equal(videoSegments[0]?.status, 'pending');
    assert.equal(videoSegments[0]?.videoUrl, undefined);
    const seedancePrompt = String(videoSegments[0]?.seedancePrompt || '');
    assert.match(seedancePrompt, /# 音频/);
    assert.match(seedancePrompt, /温柔女声/);
    assert.match(seedancePrompt, /BGM：轻快、干净、不压人声/);
    assert.match(seedancePrompt, /音效：仅保留必要转场和动作音效/);

    const previousStoryboardDisableLlm = process.env.VIDEO_REMAKE_STORYBOARD_DISABLE_LLM;
    process.env.VIDEO_REMAKE_STORYBOARD_DISABLE_LLM = '1';
    try {
      const fallbackStoryboard = await defaultVideoRemakeNodeAdapters.generateStoryboard({
        sessionId: confirmedProduct.id,
        userId: confirmedProduct.userId,
        taskId: confirmedProduct.taskId,
        workflow: {
          ...confirmedProduct.workflow,
          source: { ...confirmedProduct.workflow.source, title: 'fallback-storyboard' },
          artifacts: {
            ...confirmedProduct.workflow.artifacts,
            scriptContent: {
              content: [
                '第一句',
                '第二句',
                '第三句',
                '第四句',
                '第五句',
              ].join('\n'),
            },
          },
        },
        emit: () => undefined,
      });
      const fallbackNarrations = fallbackStoryboard.map((shot) => String(shot.narration || ''));
      assert.ok(fallbackNarrations.length < 5);
      assert.ok(fallbackNarrations.some((text) => text.split('\n').length > 1));

    } finally {
      if (previousStoryboardDisableLlm === undefined) {
        delete process.env.VIDEO_REMAKE_STORYBOARD_DISABLE_LLM;
      } else {
        process.env.VIDEO_REMAKE_STORYBOARD_DISABLE_LLM = previousStoryboardDisableLlm;
      }
    }

    const chatResult = await service.sendChat(session.id, {
      userId: 'user-service',
      message: '把口播改得更夸张一点',
    });
    const patchedSession = chatResult.session;
    assert.equal(chatResult.intent.intent, 'modify_artifact_with_llm');
    assert.equal(patchedSession.workflow.pendingInterrupt?.cardType, 'script_content');
    const scriptContent = patchedSession.workflow.artifacts.scriptContent as Record<string, unknown>;
    assert.match(String(scriptContent.content || ''), /语气更直接|更夸张/);
    assert.ok(patchedSession.invalidArtifacts.includes('storyboard_script'));
    assert.ok(patchedSession.invalidArtifacts.includes('seedance_prompt'));
    assert.ok(patchedSession.invalidArtifacts.includes('final_video'));

    const resumed = await service.resume(session.id);
    assert.equal(resumed.workflow.pendingInterrupt?.cardType, 'script_content');

    const scriptCard = resumed.messages
      .filter((message) => message.type === 'card' && message.cardType === 'script_content')
      .at(-1);
    assert.ok(scriptCard && scriptCard.type === 'card');

    const canceled = service.cancelCard(session.id, scriptCard.cardId, { userId: 'user-service' });
    assert.equal(canceled.workflow.pendingInterrupt, undefined);

    const cancelledSession = service.cancelSession(session.id, { userId: 'user-service' });
    assert.equal(cancelledSession.status, 'cancelled');
    assert.equal(cancelledSession.currentStep, 'cancelled');

    const reloaded = videoRemakeRepository.findSession(session.id);
    assert.ok(reloaded);
    assert.equal(reloaded?.status, 'cancelled');
    assert.equal(reloaded?.workflow.pendingInterrupt, undefined);
    assert.ok((reloaded?.events.length || 0) >= 6);

  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
