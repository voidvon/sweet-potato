import test from 'node:test';
import assert from 'node:assert/strict';

test('video remake visual details repair embedded Chinese field label json', async () => {
  const { visualDetailsFromContent } = await import('../src/modules/video-remake/video-remake.node-adapters.js');
  const raw = '{ "task1": { "视频内容": "一位女士分享情绪与健康的关联，阐述情绪良好对身体的益处、情绪低落的危害，给出养好情绪、管理情绪的建议，传递重视情绪管理、珍视自我价值的理念" }, "task2": { "场景1": { "场景描述": "拍摄地点为室内，环境布置包含棕色休闲椅、带白色窗帘的窗户、一幅装饰画，空间层次简洁，光线氛围柔和，时间范围：0s-54s" }, "人物1": { "人物描述": "身着粉色上衣、白色裤子，动作有坐着、手持麦克风、辅以手势增强表达，表情专注且富有感染力，气质亲和专业；人物声线": "温柔且富有感染力，时间范围：0s-54s" } }, "task3": { "运镜方式": "固定", "景别变化": "中景", "转场方式": "无", "镜头节奏": "节奏平稳，剪辑频率低" }, "task4": { "声音特效": { "BGM风格": "无", "音效类型": "无", "音量变化": "无" }, "画面特效": { "滤镜": "无", "调色": "自然光感，色调柔和", "动画": "无", "贴纸": "无" }, "整体氛围": { "情绪基调": "温暖治愈", "风格定位": "生活分享类，传递积极向上的情绪管理理念" } }, "task5": {} }';

  assert.throws(() => JSON.parse(raw));

  const details = visualDetailsFromContent(raw);
  assert.doesNotThrow(() => JSON.parse(details.content));
  assert.match(details.title, /一位女士分享情绪与健康的关联/);
  assert.equal(details.characters.length, 1);
  assert.match(details.characters[0]?.characterPrompt || '', /粉色上衣/);
  assert.doesNotMatch(details.characters[0]?.characterPrompt || '', /人物声线|温柔且富有感染力/);
  assert.equal(details.scenes.length, 1);
  assert.match(details.scenes[0]?.description || '', /棕色休闲椅/);
  assert.equal(details.product.noProduct, true);
});

test('video remake json repair handles unknown embedded field labels', async () => {
  const { repairVideoRemakeJsonPayload } = await import('../src/modules/video-remake/video-remake.node-adapters.js');
  const raw = '{ "task2": { "人物1": { "人物描述": "坐在窗边讲解；语音风格": "平静自然" } } }';

  assert.throws(() => JSON.parse(raw));

  const repaired = repairVideoRemakeJsonPayload(raw);
  const parsed = JSON.parse(repaired);
  assert.equal(parsed.task2['人物1']['人物描述'], '坐在窗边讲解');
  assert.equal(parsed.task2['人物1']['语音风格'], '平静自然');
});

test('director scene normalization preserves Chinese scene description without serializing control fields', async () => {
  const { normalizeDirectorSceneItems } = await import('../src/modules/content/internals/content-viral-director.js');
  const rawDescription = '场景1：场景描述：时间范围：0s-17s，拍摄地点为入户门周边墙面，环境布置有入户门正上方墙面插座（用于安装监控，展示摄像头安装过程）、进门墙面总控开关、入户门侧边墙面插座（用于智能锁充电，展示充电线连接智能锁）；空间层次为室内墙面区域；光线氛围为日常室内光线，展示入户门区域3处提升便捷性的装修细节';

  const scenes = normalizeDirectorSceneItems({
    items: [{
      label: '场景1',
      场景描述: rawDescription,
      required: true,
      referenceMode: 'prompt',
    }],
  });

  assert.equal(scenes.length, 1);
  assert.equal(scenes[0]?.description, rawDescription);
  assert.match(scenes[0]?.description || '', /摄像头安装过程/u);
  assert.match(scenes[0]?.description || '', /智能锁充电/u);
  assert.doesNotMatch(scenes[0]?.description || '', /required：true|referenceMode：prompt/u);
});

test('video remake director fallback keeps visual character prompt separate from voice style', async () => {
  const { defaultVideoRemakeNodeAdapters, visualDetailsFromContent } = await import('../src/modules/video-remake/video-remake.node-adapters.js');
  const raw = '{ "task1": { "视频内容": "用户称赞片段" }, "task2": { "场景1": { "场景描述": "室内近景，柔和日常光线，时间范围：47s-48s" }, "人物1": { "人物描述": "时间范围：47s-48s，外观为女性，动作是称赞用户，表情肯定、亲切，气质温暖认可；人物声线": "声线温柔、肯定，语气带有赞赏的情感" } }, "task5": {} }';
  const visual = visualDetailsFromContent(raw);
  const previousDisable = process.env.VIDEO_REMAKE_DIRECTOR_DISABLE_LLM;

  try {
    process.env.VIDEO_REMAKE_DIRECTOR_DISABLE_LLM = '1';
    const normalized = await defaultVideoRemakeNodeAdapters.directorNormalize({
      sessionId: 'director-fallback-voice-style',
      userId: 'director-fallback-user',
      workflow: {
        mode: 'test',
        currentNode: 'director_normalize',
        artifacts: {},
        invalidArtifacts: [],
        source: {
          kind: 'upload',
          title: 'fixture.mp4',
          sourceUrl: '',
        },
        runtime: {
          analyses: {
            audio: {
              roleName: '音频理解专家',
              content: '',
              voice: '原声参考',
              voiceStyle: '',
              spokenContent: '',
            },
            visual,
            pip: {
              roleName: '画中画理解专家',
              content: '',
              appeared: false,
              items: [],
            },
          },
        },
        updatedAt: new Date().toISOString(),
      },
      emit: () => undefined,
    });

    const characterItems = (normalized.characterSetting as { items?: Array<{ characterPrompt?: string }> }).items || [];
    const sceneItems = (normalized.sceneSetting as { items?: Array<{ description?: string }> }).items || [];
    const voiceItems = (normalized.voiceAudioSetting as { items?: Array<{ voiceStyle?: string }> }).items || [];
    assert.match(characterItems[0]?.characterPrompt || '', /外观为女性/u);
    assert.match(characterItems[0]?.characterPrompt || '', /称赞用户/u);
    assert.doesNotMatch(characterItems[0]?.characterPrompt || '', /人物声线|声线温柔|赞赏的情感/u);
    assert.match(voiceItems[0]?.voiceStyle || '', /声线温柔、肯定/u);
    assert.match(sceneItems[0]?.description || '', /室内近景/u);
  } finally {
    if (previousDisable === undefined) {
      delete process.env.VIDEO_REMAKE_DIRECTOR_DISABLE_LLM;
    } else {
      process.env.VIDEO_REMAKE_DIRECTOR_DISABLE_LLM = previousDisable;
    }
  }
});

test('video remake director fallback does not merge fallback visual fields into existing character prompt', async () => {
  const { defaultVideoRemakeNodeAdapters } = await import('../src/modules/video-remake/video-remake.node-adapters.js');
  const previousDisable = process.env.VIDEO_REMAKE_DIRECTOR_DISABLE_LLM;

  try {
    process.env.VIDEO_REMAKE_DIRECTOR_DISABLE_LLM = '1';
    const normalized = await defaultVideoRemakeNodeAdapters.directorNormalize({
      sessionId: 'director-dedupe-character-prompt',
      userId: 'director-dedupe-user',
      workflow: {
        mode: 'test',
        currentNode: 'director_normalize',
        artifacts: {},
        invalidArtifacts: [],
        source: {
          kind: 'upload',
          title: 'fixture.mp4',
          sourceUrl: '',
        },
        runtime: {
          analyses: {
            audio: {
              roleName: '音频理解专家',
              content: '',
              voice: '原声参考',
              voiceStyle: '',
              spokenContent: '',
            },
            visual: {
              roleName: '视频理解专家',
              content: '',
              characters: [{
                label: '人物1',
                appearance: '女性，装修设计专家形象',
                gesture: '用伸缩杆指向墙面，专注展示装修细节、讲解装修设计建议',
                expression: '专注专业',
                characterPrompt: '女性，装修设计专家形象；动作：用伸缩杆指向墙面，专注展示装修细节、讲解装修设计建议；表情：专注专业；气质：专业可靠',
                required: true,
                referenceMode: 'prompt',
              }],
              scenes: [{
                label: '场景1',
                description: '入户门周边墙面，日常室内光线',
                required: true,
                referenceMode: 'prompt',
              }],
              product: { noProduct: true, items: [] },
            },
            pip: {
              roleName: '画中画理解专家',
              content: '',
              appeared: false,
              items: [],
            },
          },
        },
        updatedAt: new Date().toISOString(),
      },
      emit: () => undefined,
    });

    const characterItems = (normalized.characterSetting as { items?: Array<{ characterPrompt?: string }> }).items || [];
    const prompt = characterItems[0]?.characterPrompt || '';
    assert.equal(prompt, '女性，装修设计专家形象；动作：用伸缩杆指向墙面，专注展示装修细节、讲解装修设计建议；表情：专注专业；气质：专业可靠');
  } finally {
    if (previousDisable === undefined) {
      delete process.env.VIDEO_REMAKE_DIRECTOR_DISABLE_LLM;
    } else {
      process.env.VIDEO_REMAKE_DIRECTOR_DISABLE_LLM = previousDisable;
    }
  }
});

test('video remake director fallback fills voice style from plain text visual character voice line', async () => {
  const { defaultVideoRemakeNodeAdapters, visualDetailsFromContent } = await import('../src/modules/video-remake/video-remake.node-adapters.js');
  const raw = [
    '人物1：人物描述：外观：女性，装修设计专家形象；动作：用伸缩杆指向墙面，专注展示装修细节、讲解装修设计建议；表情：专注专业；气质：专业可靠；时间范围：0s-48s',
    '人物声线：清晰流畅，专业讲解风格，传递实用装修建议的语调',
  ].join('\n');
  const visual = visualDetailsFromContent(raw);
  const previousDisable = process.env.VIDEO_REMAKE_DIRECTOR_DISABLE_LLM;

  try {
    process.env.VIDEO_REMAKE_DIRECTOR_DISABLE_LLM = '1';
    const normalized = await defaultVideoRemakeNodeAdapters.directorNormalize({
      sessionId: 'director-plain-text-character-voice',
      userId: 'director-plain-text-user',
      workflow: {
        mode: 'test',
        currentNode: 'director_normalize',
        artifacts: {},
        invalidArtifacts: [],
        source: {
          kind: 'upload',
          title: 'fixture.mp4',
          sourceUrl: '',
        },
        runtime: {
          analyses: {
            audio: {
              roleName: '音频理解专家',
              content: '',
              voice: '原声参考',
              voiceStyle: '',
              spokenContent: '',
            },
            visual,
            pip: {
              roleName: '画中画理解专家',
              content: '',
              appeared: false,
              items: [],
            },
          },
        },
        updatedAt: new Date().toISOString(),
      },
      emit: () => undefined,
    });

    const characterItems = (normalized.characterSetting as { items?: Array<{ characterPrompt?: string }> }).items || [];
    const voiceItems = (normalized.voiceAudioSetting as { items?: Array<{ voiceStyle?: string }> }).items || [];
    assert.match(characterItems[0]?.characterPrompt || '', /装修设计专家形象/u);
    assert.doesNotMatch(characterItems[0]?.characterPrompt || '', /清晰流畅|专业讲解风格/u);
    assert.match(voiceItems[0]?.voiceStyle || '', /清晰流畅，专业讲解风格/u);
  } finally {
    if (previousDisable === undefined) {
      delete process.env.VIDEO_REMAKE_DIRECTOR_DISABLE_LLM;
    } else {
      process.env.VIDEO_REMAKE_DIRECTOR_DISABLE_LLM = previousDisable;
    }
  }
});
