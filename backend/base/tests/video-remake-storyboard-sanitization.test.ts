import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('storyboard strips product references when product is confirmed unnecessary', async () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'video-remake-storyboard-sanitize-'));
  const dataDir = path.join(tempRoot, 'data');
  mkdirSync(dataDir, { recursive: true });

  const previousDisableLlm = process.env.VIDEO_REMAKE_STORYBOARD_DISABLE_LLM;

  try {
    process.env.DATA_DIR = dataDir;
    process.env.VIDEO_REMAKE_STORYBOARD_DISABLE_LLM = '1';

    const [{ migrateDatabase }, { createVideoRemakeService }, { defaultVideoRemakeNodeAdapters }] = await Promise.all([
      import('../src/db/schema.js'),
      import('../src/modules/video-remake/video-remake.service.js'),
      import('../src/modules/video-remake/video-remake.node-adapters.js'),
    ]);
    migrateDatabase();

    const service = createVideoRemakeService();
    const session = service.createSession({ userId: 'storyboard-sanitize-user', filename: 'fixture.mp4' });

    session.workflow.artifacts.productSetting = {
      noProduct: true,
      items: [],
    };
    session.workflow.artifacts.scriptContent = {
      content: [
        '不要无孔插座，要斜五孔插座',
        '不要固定水龙头，要抽拉水龙头',
        '不要小双槽，要大单槽',
      ].join('\n'),
    };
    session.workflow.artifacts.characterSetting = {
      items: [{ label: '人物 1', characterPrompt: '讲解者坐在桌前讲解', required: true, referenceMode: 'prompt' }],
    };
    session.workflow.artifacts.sceneSetting = {
      items: [{ label: '场景 1', description: '室内讲解桌前场景', required: true, referenceMode: 'prompt' }],
    };

    const storyboard = await defaultVideoRemakeNodeAdapters.generateStoryboard({
      sessionId: session.id,
      userId: session.userId,
      taskId: session.taskId,
      workflow: session.workflow,
      emit: () => undefined,
    });

    assert.ok(storyboard.length > 0);
    const text = JSON.stringify(storyboard);
    assert.doesNotMatch(text, /产品\s*\d+/u);
    assert.doesNotMatch(text, /商品/u);
    assert.doesNotMatch(text, /包装/u);
    const remakeText = storyboard.map((shot) => String((shot as Record<string, unknown>).remakeSuggestion || '')).join('\n');
    assert.doesNotMatch(remakeText, /^(?:人物|角色|场景|产品|环境|环境布置|拍摄地点|空间层次|光线氛围|灯光|构图|机位|氛围|道具)\s*[A-Za-z\d一二三四五六七八九十]*\s*[：:]/mu);
    assert.doesNotMatch(remakeText, /适用时间|时间范围|口播线索|对应口播|语境线索|关键词/u);
  } finally {
    if (previousDisableLlm === undefined) {
      delete process.env.VIDEO_REMAKE_STORYBOARD_DISABLE_LLM;
    } else {
      process.env.VIDEO_REMAKE_STORYBOARD_DISABLE_LLM = previousDisableLlm;
    }
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('session snapshot strips stale product references from storyboard cards when no product is confirmed', async () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'video-remake-storyboard-snapshot-'));
  const dataDir = path.join(tempRoot, 'data');
  mkdirSync(dataDir, { recursive: true });

  try {
    process.env.DATA_DIR = dataDir;

    const [{ migrateDatabase }, { createVideoRemakeService }, { videoRemakeRepository }] = await Promise.all([
      import('../src/db/schema.js'),
      import('../src/modules/video-remake/video-remake.service.js'),
      import('../src/modules/video-remake/video-remake.repository.js'),
    ]);
    migrateDatabase();

    const service = createVideoRemakeService();
    const session = service.createSession({ userId: 'storyboard-snapshot-user', filename: 'fixture.mp4' });
    session.workflow.artifacts.productSetting = {
      noProduct: true,
      items: [],
    };

    await videoRemakeRepository.updateSession(session.id, {
      workflow: session.workflow,
      artifacts: session.artifacts,
    });
    await videoRemakeRepository.upsertCard(session.id, {
      id: 'snapshot-storyboard-card',
      type: 'card',
      role: 'assistant',
      cardId: 'snapshot-storyboard-card',
      cardType: 'storyboard_script',
      title: '分镜脚本',
      status: 'confirmed',
      data: [{
        shotId: 'shot_1',
        startTime: 0,
        endTime: 4,
        duration: 4,
        visualDescription: '中景讲解，同时展示对应商品的简化轮廓示意图',
        actionDescription: '人物指向产品16',
        narration: '不要固定水龙头，要抽拉水龙头',
        soundEffect: '',
        remakeSuggestion: '采用中景拍摄，产品16绿勾图清晰展示产品核心特征\n产品：产品16：类型：实物商品',
      }],
      createdAt: new Date().toISOString(),
    });

    const snapshot = service.getSession(session.id);
    const storyboardCard = snapshot.messages.find((message) => (
      message.type === 'card' && message.cardType === 'storyboard_script'
    ));
    assert.ok(storyboardCard && storyboardCard.type === 'card');
    const text = JSON.stringify(storyboardCard.data || {});
    assert.doesNotMatch(text, /产品\s*\d+/u);
    assert.doesNotMatch(text, /商品/u);
    assert.doesNotMatch(text, /包装/u);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('session snapshot repairs malformed visual expert json into renderable fields', async () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'video-remake-visual-snapshot-'));
  const dataDir = path.join(tempRoot, 'data');
  mkdirSync(dataDir, { recursive: true });

  try {
    process.env.DATA_DIR = dataDir;

    const [{ migrateDatabase }, { createVideoRemakeService }, { videoRemakeRepository }] = await Promise.all([
      import('../src/db/schema.js'),
      import('../src/modules/video-remake/video-remake.service.js'),
      import('../src/modules/video-remake/video-remake.repository.js'),
    ]);
    migrateDatabase();

    const service = createVideoRemakeService();
    const session = service.createSession({ userId: 'visual-snapshot-user', filename: 'fixture.mp4' });
    const rawContent = '{ "task1": { "视频内容": "情绪健康分享" }, "task2": { "场景1": { "场景描述": "室内，棕色休闲椅，白色窗帘，时间范围：0s-54s" }, "人物1": { "人物描述": "粉色上衣、白色裤子，手持麦克风；人物声线": "温柔且富有感染力，时间范围：0s-54s" } }, "task3": { "运镜方式": "固定", "景别变化": "中景" }, "task4": { "整体氛围": { "情绪基调": "温暖治愈" } }, "task5": {} }';
    await videoRemakeRepository.upsertCard(session.id, {
      id: 'visual-expert-card',
      type: 'card',
      role: 'assistant',
      cardId: 'visual-expert-card',
      cardType: 'expert_analysis',
      title: '视频理解专家',
      status: 'confirmed',
      data: {
        expertKey: 'visual',
        roleName: '视频理解专家',
        content: rawContent,
        summary: rawContent,
      },
      createdAt: new Date().toISOString(),
    });

    const snapshot = service.getSession(session.id);
    const visualCard = snapshot.messages.find((message) => (
      message.type === 'card' && message.cardType === 'expert_analysis'
    ));
    assert.ok(visualCard && visualCard.type === 'card');
    const data = visualCard.data as {
      content?: string;
      summary?: string;
      characters?: Array<{ characterPrompt?: string }>;
      scenes?: Array<{ description?: string }>;
    };
    assert.doesNotThrow(() => JSON.parse(data.content || ''));
    assert.doesNotMatch(data.summary || '', /视频理解结果不完整/u);
    assert.match(data.characters?.[0]?.characterPrompt || '', /粉色上衣/u);
    assert.match(data.scenes?.[0]?.description || '', /棕色休闲椅/u);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('storyboard narration cleanup removes repeated rolling transcript lines', async () => {
  const { sanitizeStoryboardNarrationDuplicatesForTest } = await import('../src/modules/video-remake/video-remake.node-adapters.js');
  const storyboard = [
    {
      shotId: 'shot_1',
      startTime: 0,
      endTime: 3.5,
      narration: '旁白：你再说一遍\n口播：在所有的养生方法里，最好的是少吃',
    },
    {
      shotId: 'shot_2',
      startTime: 3.5,
      endTime: 14.5,
      narration: [
        '旁白：你再说一遍',
        '在所有的养生方法里',
        '最好的是少吃',
        '在所有的补阳方法里',
        '最好的是晒太阳',
        '在所有的补气方法里',
        '最好的是睡觉',
      ].join('\n'),
    },
    {
      shotId: 'shot_3',
      startTime: 14.5,
      endTime: 25.3,
      narration: [
        '在所有的补气方法里',
        '最好的是睡觉',
        '在所有的祛湿方法里',
        '最好的是泡脚',
        '在所有的消食方法里',
        '最好的是走路',
      ].join('\n'),
    },
    {
      shotId: 'shot_4',
      startTime: 25.3,
      endTime: 30.2,
      narration: [
        '最好的是走路',
        '在所有的运动里',
        '最好的是踮脚尖',
        '在所有的饮品里',
        '最好的是温开水',
      ].join('\n'),
    },
  ];
  const spokenSegments = [
    { narration: '旁白：你再说一遍', startTime: 0, endTime: 1 },
    { narration: '口播：在所有的养生方法里，最好的是少吃', startTime: 1, endTime: 3.5 },
    { narration: '在所有的补阳方法里\n最好的是晒太阳\n在所有的补气方法里\n最好的是睡觉', startTime: 3.5, endTime: 14.5 },
    { narration: '在所有的祛湿方法里\n最好的是泡脚\n在所有的消食方法里\n最好的是走路', startTime: 14.5, endTime: 25.3 },
    { narration: '在所有的运动里\n最好的是踮脚尖\n在所有的饮品里\n最好的是温开水', startTime: 25.3, endTime: 30.2 },
  ];

  const cleaned = sanitizeStoryboardNarrationDuplicatesForTest(storyboard, spokenSegments);
  const narrationText = cleaned.map((shot) => String(shot.narration || '')).join('\n');

  assert.equal((narrationText.match(/你再说一遍/gu) || []).length, 1);
  assert.equal((narrationText.match(/在所有的养生方法里/gu) || []).length, 1);
  assert.equal((narrationText.match(/最好的是睡觉/gu) || []).length, 1);
  assert.equal((narrationText.match(/最好的是走路/gu) || []).length, 1);
  assert.equal((narrationText.match(/最好的是温开水/gu) || []).length, 1);
  assert.doesNotMatch(String(cleaned[1]?.narration || ''), /你再说一遍|养生方法/u);
  assert.doesNotMatch(String(cleaned[2]?.narration || ''), /最好的是睡觉/u);
  assert.doesNotMatch(String(cleaned[3]?.narration || ''), /最好的是走路/u);
});
