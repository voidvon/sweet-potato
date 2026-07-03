import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildVideoRemakeSeedanceAudioBindingLines,
  videoRemakeDirectorNormalizeSystemPrompt,
  videoRemakeStoryboardSystemPrompt,
  videoRemakeStoryboardSpeakerLimitSystemPrompt,
  videoRemakeStoryboardSpeakerLimitUserPrompt,
} from '../src/modules/video-remake/video-remake.prompts.js';

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

test('storyboard card normalization splits long monologue shots and removes empty short tails', async () => {
  const { normalizeStoryboardForCardForTest } = await import('../src/modules/video-remake/video-remake.node-adapters.js');
  const narration = '口播：最近我忽然发现 原来只要情绪好 你的身体就会好 古人说心宽一寸病退一丈 身体愉悦就是大补 比任何老母鸡都管用 情绪低落是大伤 所有的情绪都伤肝伤胃伤肺 负面情绪太多的女人最终会影响她的身体会给她带来痛苦影响健康很多人的不舒服其实是从心病开始的所以只有养好自己的情绪我们的身体愉悦了气血才通畅你要明白啊心平能御三千疾心静可通百事灵好情绪才是治愈自己的良药所以没事不要乱发脾气不要跟自己过不去当你遇到那个渣男他伤害你的时候直接跟他拜拜不要再去挽留也不要去内耗没有任何一个人配得上你的美好';
  const storyboard = [
    {
      shotId: 'shot_1',
      label: '镜头 1',
      startTime: 0,
      endTime: 49,
      duration: 49,
      visualDescription: '室内中景，人物坐在休闲椅上讲述',
      actionDescription: '人物手持麦克风，伴随轻柔手势讲述',
      narration,
      soundEffect: '人物柔和清晰的讲述原声',
      remakeSuggestion: '中景固定拍摄，人物手势幅度适中',
    },
    { shotId: 'shot_2', label: '镜头 2', startTime: 49, endTime: 50.7, duration: 1.7, visualDescription: '室内中景', actionDescription: '微微皱眉', narration: '', soundEffect: '人物柔和清晰的讲述原声' },
    { shotId: 'shot_3', label: '镜头 3', startTime: 50.7, endTime: 52.4, duration: 1.7, visualDescription: '室内中景', actionDescription: '抬手强调', narration: '', soundEffect: '人物柔和清晰的讲述原声' },
    { shotId: 'shot_4', label: '镜头 4', startTime: 52.4, endTime: 54, duration: 1.6, visualDescription: '室内中景', actionDescription: '摆手否定', narration: '', soundEffect: '人物柔和清晰的讲述原声' },
  ];

  const normalized = normalizeStoryboardForCardForTest(storyboard, 54);

  assert.ok(normalized.length >= 4);
  assert.equal(normalized[0]?.startTime, 0);
  assert.equal(normalized[normalized.length - 1]?.endTime, 54);
  assert.equal(normalized.every((shot) => Number.isInteger(Number(shot.startTime)) && Number.isInteger(Number(shot.endTime)) && Number.isInteger(Number(shot.duration))), true);
  assert.equal(normalized.some((shot) => !String(shot.narration || '').trim()), false);
  assert.equal(normalized.some((shot) => Number(shot.duration || 0) > 15.1), false);
  assert.equal(normalized.every((shot) => /^口播：/u.test(String(shot.narration || ''))), true);
  assert.match(String(normalized[0]?.narration || ''), /最近我忽然发现/u);
  assert.match(String(normalized[normalized.length - 1]?.narration || ''), /没有任何一个人配得上你的美好/u);
});

test('storyboard card normalization splits text-heavy short shots by narration length', async () => {
  const { normalizeStoryboardForCardForTest } = await import('../src/modules/video-remake/video-remake.node-adapters.js');
  const longTail = '口播：负面情绪太多的女人最终会影响她的身体会给她带来痛苦影响健康很多人的不舒服其实是从心病开始的所以只有养好自己的情绪我们的身体愉悦了气血才通畅你要明白啊心平能御三千疾心静可通百事灵好情绪才是治愈自己的良药所以没事不要乱发脾气不要跟自己过不去当你遇到那个渣男他伤害你的时候直接跟他拜拜不要再去挽留也不要去内耗没有任何一个人配得上你的美好';
  const normalized = normalizeStoryboardForCardForTest([
    { shotId: 'shot_1', startTime: 0, endTime: 11.9, duration: 11.9, narration: '口播：最近我忽然发现 原来只要情绪好 你的身体就会好 古人说心宽一寸病退一丈 身体愉悦就是大补 比任何老母鸡都管用' },
    { shotId: 'shot_2', startTime: 11.9, endTime: 23.8, duration: 11.9, narration: '口播：情绪低落是大伤' },
    { shotId: 'shot_3', startTime: 23.8, endTime: 35.6, duration: 11.8, narration: '口播：所有的情绪都伤肝伤胃伤肺' },
    { shotId: 'shot_4', startTime: 35.6, endTime: 47.5, duration: 11.9, narration: longTail },
    { shotId: 'shot_5', startTime: 47.5, endTime: 49.1, duration: 1.6, narration: '' },
    { shotId: 'shot_6', startTime: 49.1, endTime: 50.7, duration: 1.6, narration: '' },
    { shotId: 'shot_7', startTime: 50.7, endTime: 52.3, duration: 1.6, narration: '' },
    { shotId: 'shot_8', startTime: 52.3, endTime: 54, duration: 1.7, narration: '' },
  ], 54);

  assert.equal(normalized[0]?.startTime, 0);
  assert.equal(normalized[normalized.length - 1]?.endTime, 54);
  assert.equal(normalized.every((shot) => Number.isInteger(Number(shot.startTime)) && Number.isInteger(Number(shot.endTime)) && Number.isInteger(Number(shot.duration))), true);
  assert.equal(normalized.some((shot) => !String(shot.narration || '').trim()), false);
  assert.equal(normalized.some((shot) => Number(shot.duration || 0) > 15.1), false);
  assert.ok(normalized.length > 4);
  assert.ok(Number(normalized[1]?.duration || 0) <= 3);
  assert.ok(Number(normalized[2]?.duration || 0) <= 4);
  assert.match(String(normalized[normalized.length - 1]?.narration || ''), /没有任何一个人配得上你的美好/u);
});

test('storyboard normalization keeps semantic phrases and expands relative scene visuals', async () => {
  const { normalizeStoryboardForCardForTest } = await import('../src/modules/video-remake/video-remake.node-adapters.js');
  const normalized = normalizeStoryboardForCardForTest([
    {
      shotId: 'shot_1',
      startTime: 0,
      endTime: 22.6,
      duration: 22.6,
      visualDescription: '室内居家温馨场景，固定中景，可见部分棕色椅子与白色窗帘',
      actionDescription: '人物1表情稍显严肃，语气稍加重',
      narration: '口播：情绪低落是大伤，口播：所有的情绪都伤肝伤胃伤肺，口播：负面情绪太多的女人，口播：最终会影响她的身体，口播：会给她带来痛苦，口播：影响健康',
      soundEffect: '无特殊音效',
      remakeSuggestion: '语气带适度警示感',
    },
    {
      shotId: 'shot_2',
      startTime: 22.6,
      endTime: 30,
      duration: 7.4,
      visualDescription: '同场景固定中景',
      actionDescription: '人物1继续讲述',
      narration: '口播：很多人的不舒服，其实是从心病开始的',
    },
  ], 30);

  const narrationText = normalized.map((shot) => String(shot.narration || '')).join('\n');
  assert.doesNotMatch(narrationText, /负面情绪太多\s*$/mu);
  assert.doesNotMatch(narrationText, /^口播：的女人/mu);
  assert.match(narrationText, /负面情绪太多的女人/u);
  assert.match(String(normalized[normalized.length - 1]?.visualDescription || ''), /室内居家温馨场景/u);
  assert.match(String(normalized[normalized.length - 1]?.visualDescription || ''), /同场景固定中景/u);
});

test('storyboard card normalization merges over-fragmented same-scene short narration shots', async () => {
  const { normalizeStoryboardForCardForTest } = await import('../src/modules/video-remake/video-remake.node-adapters.js');
  const normalized = normalizeStoryboardForCardForTest([
    { shotId: 'shot_1', startTime: 0, endTime: 1.3, duration: 1.3, visualDescription: '户外开阔绿植环绕空间，自然明亮光线，中景固定构图', actionDescription: '人物1面向镜头，侧头带疑惑表情', narration: '口播：你再说一遍' },
    { shotId: 'shot_2', startTime: 1.3, endTime: 3.6, duration: 2.3, visualDescription: '同场景中景', actionDescription: '人物1面向镜头，表情转为认真，抬手轻示意', narration: '口播：在所有的养生方法里' },
    { shotId: 'shot_3', startTime: 3.6, endTime: 5.1, duration: 1.5, visualDescription: '同场景中景', actionDescription: '人物1点头强调', narration: '口播：最好的是少吃' },
    { shotId: 'shot_4', startTime: 5.1, endTime: 7.4, duration: 2.3, visualDescription: '同场景中景', actionDescription: '人物1面向镜头，语速平稳', narration: '口播：在所有的补阳方法里' },
    { shotId: 'shot_5', startTime: 7.4, endTime: 9.2, duration: 1.8, visualDescription: '同场景中景', actionDescription: '人物1抬手比太阳手势', narration: '口播：最好的是晒太阳' },
    { shotId: 'shot_6', startTime: 9.2, endTime: 11.5, duration: 2.3, visualDescription: '同场景中景', actionDescription: '人物1收回手势，站姿放松', narration: '口播：在所有的补气方法里' },
    { shotId: 'shot_7', startTime: 11.5, endTime: 13, duration: 1.5, visualDescription: '同场景中景', actionDescription: '人物1比睡觉的手势', narration: '口播：最好的是睡觉' },
    { shotId: 'shot_8', startTime: 13, endTime: 15.3, duration: 2.3, visualDescription: '同场景中景', actionDescription: '人物1收回手势，面向镜头', narration: '口播：在所有的祛湿方法里' },
    { shotId: 'shot_9', startTime: 15.3, endTime: 16.8, duration: 1.5, visualDescription: '同场景中景', actionDescription: '人物1轻微点头强调', narration: '口播：最好的是泡脚' },
  ], 16.8);

  assert.ok(normalized.length < 9);
  assert.ok(normalized.every((shot) => Number(shot.duration || 0) >= 4 || normalized.length === 1));
  assert.ok(normalized.every((shot) => Number(shot.duration || 0) <= 10.1));
  const narrationText = normalized.map((shot) => String(shot.narration || '')).join('\n');
  assert.match(narrationText, /你再说一遍[\s\S]*在所有的养生方法里[\s\S]*最好的是少吃/u);
  assert.match(narrationText, /在所有的补阳方法里[\s\S]*最好的是晒太阳/u);
  assert.match(narrationText, /在所有的补气方法里[\s\S]*最好的是睡觉/u);
});

test('fallback storyboard and seedance prompts preserve dialogue speaker labels without time text', async () => {
  const previousDisableLlm = process.env.VIDEO_REMAKE_STORYBOARD_DISABLE_LLM;
  try {
    process.env.VIDEO_REMAKE_STORYBOARD_DISABLE_LLM = '1';
    const { defaultVideoRemakeNodeAdapters } = await import('../src/modules/video-remake/video-remake.node-adapters.js');
    const content = [
      '口播：你说你要在入户门上方留一个插座，时间：0s-3s。',
      '口播：就是为了方便后期安装监控，时间：3s-5s。',
      '旁白：对啊',
      '口播：你说你要在进门位置留一个总控制开关，时间：5s-8s。',
      '口播：就是为了方便出门的时候一键断电，时间：8s-10s。',
      '旁白：对啊，时间：10s-11s。',
    ].join('\n');
    const workflow = {
      mode: 'test',
      currentNode: 'generate_storyboard',
      artifacts: {
        scriptContent: { content },
        characterSetting: { items: [{ label: '人物1', characterPrompt: '女性装修专家', required: true, referenceMode: 'prompt' }] },
        sceneSetting: { items: [{ label: '场景1', description: '入户门区域', required: true, referenceMode: 'prompt' }] },
        voiceAudioSetting: { voice: '原声参考' },
        productSetting: { noProduct: true, items: [] },
      },
      invalidArtifacts: [],
      source: { kind: 'upload', title: 'fixture.mp4', sourceUrl: '' },
      runtime: {},
      updatedAt: new Date().toISOString(),
    };

    const storyboard = await defaultVideoRemakeNodeAdapters.generateStoryboard({
      sessionId: 'storyboard-dialogue-labels',
      userId: 'storyboard-dialogue-user',
      workflow,
      emit: () => undefined,
    });
    workflow.artifacts.storyboardScript = storyboard;
    const prompts = await defaultVideoRemakeNodeAdapters.generateSeedancePrompts({
      sessionId: 'storyboard-dialogue-labels',
      userId: 'storyboard-dialogue-user',
      workflow,
      emit: () => undefined,
    });
    const promptText = prompts.map((item) => String((item.prompt as Record<string, unknown>).mainPrompt || '')).join('\n');

    assert.match(promptText, /口播：你说你要在入户门上方留一个插座/u);
    assert.match(promptText, /口播：就是为了方便后期安装监控/u);
    assert.match(promptText, /旁白：对啊/u);
    assert.match(promptText, /口播：你说你要在进门位置留一个总控制开关/u);
    assert.doesNotMatch(promptText, /时间：\d+s-\d+s/u);
  } finally {
    if (previousDisableLlm === undefined) {
      delete process.env.VIDEO_REMAKE_STORYBOARD_DISABLE_LLM;
    } else {
      process.env.VIDEO_REMAKE_STORYBOARD_DISABLE_LLM = previousDisableLlm;
    }
  }
});

test('seedance prompt keeps repeated short replies inside the same segment', async () => {
  const { defaultVideoRemakeNodeAdapters } = await import('../src/modules/video-remake/video-remake.node-adapters.js');
  const workflow = {
    mode: 'test',
    currentNode: 'generate_seedance_prompts',
    artifacts: {
      characterSetting: { items: [{ label: '人物1', characterPrompt: '女性装修专家', required: true, referenceMode: 'prompt' }] },
      sceneSetting: { items: [{ label: '场景1', description: '室内装修点位', required: true, referenceMode: 'prompt' }] },
      voiceAudioSetting: { voice: '原声参考' },
      productSetting: { noProduct: true, items: [] },
      storyboardScript: [{
        shotId: 'shot_1',
        startTime: 0,
        endTime: 4,
        duration: 4,
        visualDescription: '墙面点位近景',
        actionDescription: '女性装修专家指向墙面',
        narration: [
          '口播：你说你要在燃气表上方加个插座',
          '口播：就是为了方便后期安装报警器',
          '旁白：对啊',
          '口播：你说你要在床头柜上方装一个四孔插座',
          '口播：就是为了可以多设备同时供电',
          '旁白：对啊',
        ].join('\n'),
        remakeSuggestion: '固定机位拍摄',
      }],
    },
    invalidArtifacts: [],
    source: { kind: 'upload', title: 'fixture.mp4', sourceUrl: '' },
    runtime: {},
    updatedAt: new Date().toISOString(),
  };

  const prompts = await defaultVideoRemakeNodeAdapters.generateSeedancePrompts({
    sessionId: 'seedance-repeated-replies',
    userId: 'seedance-repeated-user',
    workflow,
    emit: () => undefined,
  });
  const mainPrompt = String((prompts[0]?.prompt as Record<string, unknown>).mainPrompt || '');

  assert.equal((mainPrompt.match(/旁白：对啊/gu) || []).length, 2);
});

test('seedance prompt keeps storyboard shots as the editable prompt content', async () => {
  const { defaultVideoRemakeNodeAdapters } = await import('../src/modules/video-remake/video-remake.node-adapters.js');
  const workflow = {
    mode: 'test',
    currentNode: 'generate_seedance_prompts',
    artifacts: {
      characterSetting: { items: [{ label: '人物1', characterPrompt: '女性讲述者，粉色上衣、白色裤子', required: true, referenceMode: 'prompt' }] },
      sceneSetting: { items: [{ label: '场景1', description: '居家室内中景，透光窗帘、装饰画背景', required: true, referenceMode: 'prompt' }] },
      voiceAudioSetting: { voice: '原声参考' },
      productSetting: { noProduct: true, items: [] },
      storyboardScript: [
        {
          shotId: 'shot_1',
          startTime: 0,
          endTime: 6.5,
          duration: 6.5,
          visualDescription: '居家室内中景，透光窗帘、装饰画作为背景',
          actionDescription: '人物1坐于棕色休闲椅上，手持麦克风，轻抬右手做开场手势',
          narration: '口播：最近我忽然发现\n口播：原来只要情绪好',
          soundEffect: '轻柔舒缓的纯音乐背景音',
          remakeSuggestion: '人物表情温和自然',
        },
        {
          shotId: 'shot_2',
          startTime: 6.5,
          endTime: 13,
          duration: 6.5,
          visualDescription: '同前中景，背景无变化',
          actionDescription: '人物1坐于棕色休闲椅上，手持麦克风，手掌向下压做示意动作',
          narration: '口播：你的身体就会好\n口播：情绪低落是大伤',
          soundEffect: '轻柔舒缓的纯音乐背景音',
          remakeSuggestion: '语速稍放缓，突出句子分量感',
        },
      ],
    },
    invalidArtifacts: [],
    source: { kind: 'upload', title: 'fixture.mp4', sourceUrl: '' },
    runtime: {},
    updatedAt: new Date().toISOString(),
  };

  const prompts = await defaultVideoRemakeNodeAdapters.generateSeedancePrompts({
    sessionId: 'seedance-sequential-actions',
    userId: 'seedance-sequential-user',
    workflow,
    emit: () => undefined,
  });
  const mainPrompt = String((prompts[0]?.prompt as Record<string, unknown>).mainPrompt || '');

  assert.match(mainPrompt, /# 生成规则/u);
  assert.match(mainPrompt, /# 当前分镜/u);
  assert.match(mainPrompt, /镜头 1/u);
  assert.match(mainPrompt, /镜头 2/u);
  assert.match(mainPrompt, /台词\/旁白：口播：最近我忽然发现/u);
  assert.match(mainPrompt, /口播：你的身体就会好/u);
  assert.match(mainPrompt, /人物\/动作：人物1坐于棕色休闲椅上，手持麦克风，轻抬右手做开场手势/u);
  assert.match(mainPrompt, /人物\/动作：人物1坐于棕色休闲椅上，手持麦克风，手掌向下压做示意动作/u);
  assert.doesNotMatch(mainPrompt, /口播与参考音视频边界/u);
  assert.doesNotMatch(mainPrompt, /口播优先级：本段只允许朗读/u);
  assert.doesNotMatch(mainPrompt, /参考视频的音轨、口型、原始台词/u);
  assert.doesNotMatch(mainPrompt, /开头必须直接、清晰朗读本段第一句/u);
  assert.doesNotMatch(mainPrompt, /# 人物\s*\n/u);
  assert.doesNotMatch(mainPrompt, /# 场景\s*\n/u);
  assert.doesNotMatch(mainPrompt, /# 音频\s*\n/u);
  assert.doesNotMatch(mainPrompt, /# 已确认设定\s*\n/u);
  assert.doesNotMatch(mainPrompt, /# 本段口播\s*\n/u);
  assert.doesNotMatch(mainPrompt, /不要同时叠加/u);
  assert.doesNotMatch(mainPrompt, /必须保留各自对应关系/u);
  assert.doesNotMatch(mainPrompt, /不要理解为多个人物/u);

  workflow.artifacts.seedancePrompts = prompts;
  const videoSegments = await defaultVideoRemakeNodeAdapters.generateVideoSegments({
    sessionId: 'seedance-sequential-actions',
    userId: 'seedance-sequential-user',
    workflow,
    emit: () => undefined,
  });
  const finalPrompt = String(videoSegments[0]?.seedancePrompt || '');
  assert.equal(finalPrompt, mainPrompt);
});

test('seedance prompt preserves repetitive storyboard steps without hidden compaction', async () => {
  const { defaultVideoRemakeNodeAdapters } = await import('../src/modules/video-remake/video-remake.node-adapters.js');
  const actions = [
    '人物1身着粉色上衣、白色裤子，手持麦克风，表情温和，开口说话，头部微微前倾',
    '人物1身着粉色上衣、白色裤子，手持麦克风，保持坐姿，抬手轻抬强调观点',
    '人物1身着粉色上衣、白色裤子，手持麦克风，保持坐姿，语气肯定',
    '人物1身着粉色上衣、白色裤子，手持麦克风，保持坐姿，表情平和',
    '人物1身着粉色上衣、白色裤子，手持麦克风，保持坐姿，微微点头',
    '人物1身着粉色上衣、白色裤子，手持麦克风，保持坐姿，双手轻轻合十',
    '人物1身着粉色上衣、白色裤子，手持麦克风，保持坐姿，语气轻松',
    '人物1身着粉色上衣、白色裤子，手持麦克风，保持坐姿，表情稍显严肃',
  ];
  const suggestions = [
    '保持画面稳定，人物面部光线充足',
    '手势动作自然，不要过于夸张',
    '口播语气清晰有力',
    '语速放缓，贴合古语语境',
    '点头动作自然轻微',
    '合十动作幅度小，贴合温和气质',
    '语气带轻微笑意，增强亲和力',
    '表情转变自然，不要过于刻意',
  ];
  const storyboardScript = actions.map((actionDescription, index) => ({
    shotId: `shot_${index + 1}`,
    startTime: index,
    endTime: index + 1,
    duration: 1,
    visualDescription: index === 0 ? '室内固定中景' : '同前序中景固定画面',
    actionDescription,
    narration: `口播：测试台词${index + 1}`,
    remakeSuggestion: suggestions[index],
  }));
  const workflow = {
    mode: 'test',
    currentNode: 'generate_seedance_prompts',
    artifacts: {
      characterSetting: { items: [{ label: '人物1', characterPrompt: '女性讲述者，粉色上衣、白色裤子', required: true, referenceMode: 'prompt' }] },
      sceneSetting: { items: [{ label: '场景1', description: '室内固定中景', required: true, referenceMode: 'prompt' }] },
      voiceAudioSetting: { voice: '原声参考' },
      productSetting: { noProduct: true, items: [] },
      storyboardScript,
    },
    invalidArtifacts: [],
    source: { kind: 'upload', title: 'fixture.mp4', sourceUrl: '' },
    runtime: {},
    updatedAt: new Date().toISOString(),
  };

  const prompts = await defaultVideoRemakeNodeAdapters.generateSeedancePrompts({
    sessionId: 'seedance-compact-repetitive-actions',
    userId: 'seedance-compact-user',
    workflow,
    emit: () => undefined,
  });
  const mainPrompt = String((prompts[0]?.prompt as Record<string, unknown>).mainPrompt || '');

  assert.match(mainPrompt, /镜头 1/u);
  assert.match(mainPrompt, /镜头 8/u);
  assert.match(mainPrompt, /人物\/动作：人物1身着粉色上衣、白色裤子，手持麦克风，保持坐姿，双手轻轻合十/u);
  assert.match(mainPrompt, /复刻建议：保持画面稳定，人物面部光线充足/u);
  assert.doesNotMatch(mainPrompt, /人物基准状态：/u);
  assert.doesNotMatch(mainPrompt, /动作变化：/u);
  assert.doesNotMatch(mainPrompt, /拍摄建议变化：/u);
});

test('seedance prompt ignores hidden storyboard seedance hints in editable content', async () => {
  const { defaultVideoRemakeNodeAdapters } = await import('../src/modules/video-remake/video-remake.node-adapters.js');
  const workflow = {
    mode: 'test',
    currentNode: 'generate_seedance_prompts',
    artifacts: {
      characterSetting: { items: [{ label: '人物1', characterPrompt: '女性讲述者，粉色上衣、白色裤子', required: true, referenceMode: 'prompt' }] },
      sceneSetting: { items: [{ label: '场景1', description: '室内固定中景', required: true, referenceMode: 'prompt' }] },
      voiceAudioSetting: { voice: '原声参考' },
      productSetting: { noProduct: true, items: [] },
      storyboardScript: [
        {
          shotId: 'shot_1',
          startTime: 0,
          endTime: 4,
          duration: 4,
          visualDescription: '室内固定中景，人物坐棕色休闲椅，背景为带窗帘的窗户与装饰画',
          actionDescription: '人物1身着粉色上衣、白色裤子，手持麦克风，表情温和，开口说话，头部微微前倾',
          narration: '口播：最近我忽然发现',
          remakeSuggestion: '保持画面稳定，人物面部光线充足',
          seedancePromptHints: {
            characterBaseState: '人物1身着粉色上衣、白色裤子，坐在棕色休闲椅上手持麦克风',
            visualSummary: '室内固定中景，温馨居家背景',
            keyActionChanges: ['头部微微前倾开口讲述'],
            shootingTips: ['中景固定，语速平缓'],
          },
        },
        {
          shotId: 'shot_2',
          startTime: 4,
          endTime: 8,
          duration: 4,
          visualDescription: '同前序中景固定画面',
          actionDescription: '人物1身着粉色上衣、白色裤子，手持麦克风，保持坐姿，双手轻轻合十',
          narration: '口播：原来只要情绪好',
          remakeSuggestion: '合十动作幅度小，贴合温和气质',
          seedancePromptHints: {
            characterBaseState: '人物1身着粉色上衣、白色裤子，坐在棕色休闲椅上手持麦克风',
            keyActionChanges: ['双手轻轻合十表达赞许'],
            shootingTips: ['合十动作幅度小'],
          },
        },
      ],
    },
    invalidArtifacts: [],
    source: { kind: 'upload', title: 'fixture.mp4', sourceUrl: '' },
    runtime: {},
    updatedAt: new Date().toISOString(),
  };

  const prompts = await defaultVideoRemakeNodeAdapters.generateSeedancePrompts({
    sessionId: 'seedance-hidden-hints',
    userId: 'seedance-hidden-user',
    workflow,
    emit: () => undefined,
  });
  const mainPrompt = String((prompts[0]?.prompt as Record<string, unknown>).mainPrompt || '');

  assert.match(mainPrompt, /画面：室内固定中景，人物坐棕色休闲椅/u);
  assert.match(mainPrompt, /人物\/动作：人物1身着粉色上衣、白色裤子，手持麦克风，表情温和，开口说话/u);
  assert.match(mainPrompt, /人物\/动作：人物1身着粉色上衣、白色裤子，手持麦克风，保持坐姿，双手轻轻合十/u);
  assert.match(mainPrompt, /复刻建议：保持画面稳定，人物面部光线充足/u);
  assert.doesNotMatch(mainPrompt, /室内固定中景，温馨居家背景/u);
  assert.doesNotMatch(mainPrompt, /关键动作变化：/u);
  assert.doesNotMatch(mainPrompt, /关键拍摄建议：/u);
});

test('seedance audio binding prompt includes explicit role-to-audio bindings when audio references are present', () => {
  const guide = buildVideoRemakeSeedanceAudioBindingLines({
    voice: '原声参考',
    voiceStyle: '整体自然清晰',
    items: [
      { label: '人物1 声音', characterLabel: '人物1', voice: '原声参考', voiceStyle: '沉稳克制' },
      { label: '人物2 声音', characterLabel: '人物2', voice: '原声参考', voiceStyle: '明亮利落' },
    ],
  }, ['audio-1', 'audio-2']).join('\n');

  assert.match(guide, /人物1 只能绑定 参考音频1/u);
  assert.match(guide, /人物2 只能绑定 参考音频2/u);
  assert.match(guide, /只复用音色和节奏，不复用参考音频原始台词/u);
});

test('seedance audio binding prompt omits reference-audio reuse constraints without audio references', () => {
  const guide = buildVideoRemakeSeedanceAudioBindingLines({
    items: [
      { label: '人物1 声音', characterLabel: '人物1', voiceStyle: '柔和清晰的女声，语速适中' },
    ],
  }, []).join('\n');

  assert.match(guide, /人物1；柔和清晰的女声，语速适中/u);
  assert.doesNotMatch(guide, /参考音频/u);
  assert.doesNotMatch(guide, /只复用音色和节奏/u);
  assert.doesNotMatch(guide, /不复用参考音频原始台词/u);
});

test('storyboard prompt contract includes max-three-speaker rule', () => {
  assert.match(videoRemakeStoryboardSpeakerLimitSystemPrompt, /每个镜头台词\/旁白里最多只允许 3 个说话主体/u);
  assert.match(videoRemakeStoryboardSpeakerLimitUserPrompt, /确保任一镜头台词\/旁白最多只有 3 个说话主体/u);
});

test('storyboard prompt contract preserves dialogue order without requiring timestamps', () => {
  assert.match(videoRemakeStoryboardSystemPrompt, /原文出现顺序向前消费/u);
  assert.match(videoRemakeStoryboardSystemPrompt, /有时间轴时参考时间范围，没有时间轴时按前后文本顺序/u);
  assert.match(videoRemakeStoryboardSystemPrompt, /禁止重排、提前、延后或丢弃短句旁白/u);
  assert.match(videoRemakeStoryboardSystemPrompt, /口播：.*旁白：.*人物X：/u);
  assert.match(videoRemakeStoryboardSystemPrompt, /去掉“时间：0s-3s”等时间标注/u);
  assert.match(videoRemakeStoryboardSystemPrompt, /长口播不能全部塞进第一个镜头/u);
  assert.match(videoRemakeStoryboardSystemPrompt, /不得超过 15 秒/u);
  assert.match(videoRemakeStoryboardSystemPrompt, /没有台词\/旁白的尾镜头/u);
  assert.match(videoRemakeStoryboardSystemPrompt, /不要一句话切一个分镜/u);
  assert.match(videoRemakeStoryboardSystemPrompt, /连续排比句、问答短句或同一观点展开/u);
  assert.match(videoRemakeStoryboardSystemPrompt, /语义组块合并/u);
  assert.match(videoRemakeStoryboardSystemPrompt, /完整词语、短语/u);
  assert.match(videoRemakeStoryboardSystemPrompt, /单个镜头建议 4-14 秒/u);
  assert.match(videoRemakeStoryboardSystemPrompt, /分镜字段要浓缩/u);
});

test('director normalize prompt routes character voice lines to voice audio items', () => {
  assert.match(videoRemakeDirectorNormalizeSystemPrompt, /人物声线、声线、音色、语速、语气、语音风格、声音描述/u);
  assert.match(videoRemakeDirectorNormalizeSystemPrompt, /voiceAudioSetting\.items\[\]\.voiceStyle/u);
  assert.match(videoRemakeDirectorNormalizeSystemPrompt, /严禁写入 characterSetting\.items\[\]\.characterPrompt/u);
  assert.match(videoRemakeDirectorNormalizeSystemPrompt, /characterLabel 等于对应 characterSetting\.items\[\]\.label/u);
});
