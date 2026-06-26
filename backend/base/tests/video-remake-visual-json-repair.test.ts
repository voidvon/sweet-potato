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
  assert.match(details.characters[0]?.characterPrompt || '', /人物声线：温柔且富有感染力/);
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
