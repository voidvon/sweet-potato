import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeVideoRemakeStructuredStoryboardShots,
  parseVideoRemakeDirectorStructuredOutput,
  parseVideoRemakeStoryboardOutput,
} from '../src/modules/video-remake/video-remake.structured-output.js';

test('storyboard structured parser accepts JSON shots and normalizes existing storyboard shape', async () => {
  const parsed = await parseVideoRemakeStoryboardOutput([
    '```json',
    JSON.stringify({
      shots: [
        {
          index: 1,
          startTime: 0,
          endTime: 3.5,
          visualDescription: '人物1在厨房台面前展示龙头结构',
          actionDescription: '人物1抬手指向抽拉水龙头并对比旧款',
          narration: '口播：不要固定水龙头，要抽拉水龙头',
          soundEffect: '轻微开关水声',
          remakeSuggestion: '保持中景稳定推进，突出手部演示细节',
          seedancePromptHints: {
            characterBaseState: '人物1站在厨房台面前',
            keyActionChanges: ['抬手指向抽拉水龙头'],
            shootingTips: ['突出手部演示细节'],
          },
        },
      ],
    }),
    '```',
  ].join('\n'));

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]?.shotId, 'shot_1');
  assert.equal(parsed[0]?.source, 'llm_storyboard');
  assert.equal(parsed[0]?.duration, 3.5);
  assert.match(String(parsed[0]?.visualDescription || ''), /厨房台面/u);
  assert.match(String(parsed[0]?.narration || ''), /口播：不要固定水龙头，要抽拉水龙头/u);
  assert.deepEqual((parsed[0]?.seedancePromptHints as Record<string, unknown>)?.keyActionChanges, ['抬手指向抽拉水龙头']);
});

test('storyboard structured parser coerces string timestamp fields from JSON shots', async () => {
  const parsed = await parseVideoRemakeStoryboardOutput([
    '```json',
    JSON.stringify({
      shots: [
        {
          index: '2',
          startTime: '0',
          endTime: '4.5',
          visualDescription: '人物1坐在室内椅子上讲述',
          actionDescription: '人物1手持麦克风，轻轻点头',
          narration: '口播：情绪低落是大伤',
          soundEffect: '轻柔背景音',
          remakeSuggestion: '保持中景稳定',
        },
      ],
    }),
    '```',
  ].join('\n'));

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]?.index, 2);
  assert.equal(parsed[0]?.startTime, 0);
  assert.equal(parsed[0]?.endTime, 4.5);
  assert.equal(parsed[0]?.duration, 4.5);
  assert.match(String(parsed[0]?.narration || ''), /情绪低落是大伤/u);
});

test('storyboard structured parser falls back to markdown parsing when JSON schema parse fails', async () => {
  const parsed = await parseVideoRemakeStoryboardOutput([
    '## 镜头 1｜0-4秒',
    '画面：人物1坐在桌前讲解台盆选择',
    '人物/动作：人物1抬手比划单槽和双槽差异',
    '台词/旁白：口播：不要小双槽，要大单槽',
    '音效：室内环境底噪',
    '复刻建议：保持中景，突出手部动作和表情变化',
  ].join('\n'));

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]?.shotId, 'shot_1');
  assert.match(String(parsed[0]?.actionDescription || ''), /人物1抬手比划/u);
  assert.match(String(parsed[0]?.narration || ''), /口播：不要小双槽，要大单槽/u);
});

test('storyboard structured parser accepts common JSON wrapper and field aliases', async () => {
  const parsed = await parseVideoRemakeStoryboardOutput(JSON.stringify({
    items: [
      {
        index: '1',
        startSecond: '0',
        endSecond: '5',
        visual: '室内中景，人物坐在椅子上',
        action: '人物1手持麦克风，轻抬右手',
        script: '口播：最近我忽然发现',
        audio: '轻柔背景音',
        suggestion: '保持中景稳定',
      },
    ],
  }));

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]?.startTime, 0);
  assert.equal(parsed[0]?.endTime, 5);
  assert.match(String(parsed[0]?.visualDescription || ''), /室内中景/u);
  assert.match(String(parsed[0]?.actionDescription || ''), /轻抬右手/u);
  assert.match(String(parsed[0]?.narration || ''), /口播：最近我忽然发现/u);
});

test('storyboard structured parser accepts top-level JSON shot array', async () => {
  const parsed = await parseVideoRemakeStoryboardOutput(JSON.stringify([
    {
      index: 1,
      startTime: 0,
      endTime: 4,
      visualDescription: '厨房台面中景',
      characterAction: '人物1指向水槽',
      dialogue: '口播：不要小双槽',
      reproductionSuggestion: '突出手部动作',
    },
  ]));

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]?.duration, 4);
  assert.match(String(parsed[0]?.actionDescription || ''), /人物1指向水槽/u);
  assert.match(String(parsed[0]?.narration || ''), /口播：不要小双槽/u);
});

test('director normalize structured parser accepts JSON payload', async () => {
  const parsed = await parseVideoRemakeDirectorStructuredOutput([
    '```json',
    JSON.stringify({
      basicInfo: { title: '测试视频', resolution: '1080x1920', aspectRatio: '9:16', sourceUrl: '/files/content/source.mp4' },
      expertAnalysis: { audio: {}, visual: {}, pip: {} },
      characterSetting: {
        items: [
          {
            label: '人物 1',
            description: '短发讲解者',
            characterPrompt: '短发，浅色上衣，坐在厨房台面前讲解',
            required: true,
            referenceMode: 'prompt',
          },
        ],
      },
      sceneSetting: {
        items: [
          {
            label: '场景 1',
            description: '厨房台面前的室内讲解场景',
            required: true,
            referenceMode: 'prompt',
          },
        ],
      },
      productSetting: { noProduct: true, items: [] },
      pipSetting: { summary: '', appeared: false, items: [] },
      voiceAudioSetting: {
        voice: '原声参考',
        items: [
          {
            label: '人物 1 声音',
            characterLabel: '人物 1',
            characterIndex: 0,
            voice: '原声参考',
            voiceStyle: '自然讲解，语速稳定',
          },
        ],
      },
      scriptContent: { content: '口播：欢迎来到厨房改造分享', source: 'director_normalize_llm' },
    }),
    '```',
  ].join('\n'));

  assert.equal(parsed.characterSetting?.items?.length, 1);
  assert.equal(parsed.sceneSetting?.items?.length, 1);
  assert.match(String(parsed.characterSetting?.items?.[0]?.characterPrompt || ''), /浅色上衣/u);
  assert.match(String(parsed.sceneSetting?.items?.[0]?.description || ''), /厨房台面前/u);
});

test('storyboard structured shot normalization strips invalid remake meta while keeping speech labels', () => {
  const normalized = normalizeVideoRemakeStructuredStoryboardShots([
    {
      index: 1,
      startTime: 0,
      endTime: 4,
      visualDescription: '人物1在桌前展示水槽方案',
      actionDescription: '人物1：动作：抬手示意',
      narration: '口播：不要固定水龙头，要抽拉水龙头',
      soundEffect: '轻微环境声',
      remakeSuggestion: '时间范围：0-4秒；保持机位和上一镜头一致；突出手部动作',
    },
  ]);

  assert.equal(normalized.length, 1);
  assert.match(String(normalized[0]?.narration || ''), /口播：不要固定水龙头，要抽拉水龙头/u);
  assert.doesNotMatch(String(normalized[0]?.remakeSuggestion || ''), /时间范围|上一镜头/u);
});
