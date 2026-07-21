import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeTalkingVideoPrompt,
  talkingVideoAnalysisSchema,
  talkingVideoAnalysisSchemaForDuration,
  talkingVideoMaterialRoleRules,
  validateTalkingVideoPrompt,
} from '../src/modules/talking-video/talking-video.prompt.js';
import {
  talkingVideoAnalysisInstruction,
  talkingVideoAnalysisSystemPrompt,
  createTalkingVideoReasoningReportExtractor,
  talkingVideoReasoningFlowRules,
  talkingVideoReasoningStyleRules,
  talkingVideoShotBoundaryRules,
} from '../src/modules/talking-video/talking-video-agent-runtime.js';

const detailedAnalysis = {
  durationSeconds: 15,
  summary: '连续口播',
  visualStyle: '写实',
  finalPrompt: '测试提示词',
  presentationLayout: {
    type: 'full_screen_presenter' as const,
    mainVisualRole: '讲解者连续口播',
    presenterPlacement: '主画面居中',
    persistence: '全程持续',
  },
  videoStructure: { isContinuousTake: true, shotBoundaryReason: '全程固定机位' },
  presenter: { identity: '讲解者', expressionStyle: '自然', performanceStyle: '稳定口播' },
  shots: [
    { startSecond: 0, endSecond: 1, shotSize: '近景', visual: '开场', sourceScreenText: '开场标题', dialogue: '', performance: '自然', shootingNotes: '固定机位' },
    { startSecond: 1, endSecond: 2, shotSize: '近景', visual: '讲解者开口', dialogue: '你再说一遍', performance: '自然', shootingNotes: '延续同一机位' },
    { startSecond: 2, endSecond: 4, shotSize: '近景', visual: '讲解者分享', dialogue: '在所有的养生方法里，最好的是少吃', performance: '自然', shootingNotes: '延续同一机位' },
    { startSecond: 4, endSecond: 7, shotSize: '近景', visual: '讲解者分享', dialogue: '在所有的补阳方法里，最好的是晒太阳', performance: '自然', shootingNotes: '延续同一机位' },
    { startSecond: 7, endSecond: 10, shotSize: '近景', visual: '讲解者分享', dialogue: '在所有的补气方法里，最好的是睡觉', performance: '自然', shootingNotes: '延续同一机位' },
    { startSecond: 10, endSecond: 15, shotSize: '近景', visual: '讲解者收尾', dialogue: '在所有的祛湿方法里，最好的是泡脚', performance: '自然', shootingNotes: '延续同一机位' },
  ],
  imageReferences: [],
};

test('talking video reasoning rules require natural expert narration with evidence-based correction', () => {
  const rules = talkingVideoReasoningStyleRules().join('\n');
  assert.match(rules, /专业但自然的导演审片口吻/u);
  assert.match(rules, /允许在分镜组织阶段展示有依据的自我纠错/u);
  assert.match(rules, /禁止无依据的疑问句、自问自答/u);
  assert.match(rules, /用户现在需要我/u);
  assert.match(rules, /对吧/u);
  assert.match(rules, /重新确认：原判断/u);
  assert.match(rules, /修正：原结论 → 新结论/u);
});

test('talking video reasoning flow follows the natural reference analysis order', () => {
  const rules = talkingVideoReasoningFlowRules().join('\n');
  assert.ok(rules.indexOf('视频内容分析：') < rules.indexOf('需要提取的关键信息：'));
  assert.ok(rules.indexOf('需要提取的关键信息：') < rules.indexOf('分镜组织分析：'));
  assert.ok(rules.indexOf('分镜组织分析：') < rules.indexOf('最终检查：'));
  assert.match(rules, /开头不写标题/u);
  assert.match(rules, /不得使用“一、二、三、四”/u);
  assert.match(rules, /N 个连续镜号之间只有 N-1 处边界/u);
});

test('talking video analysis system prompt blocks JSON rehearsal and self-dialogue', () => {
  const prompt = talkingVideoAnalysisSystemPrompt();
  assert.match(prompt, /导演审片记录/u);
  assert.match(prompt, /阶段门禁/u);
  assert.match(prompt, /禁止起草 finalPrompt/u);
  assert.match(prompt, /禁止逐项预演 durationSeconds/u);
  assert.match(prompt, /视频内容分析：/u);
  assert.match(prompt, /需要提取的关键信息：/u);
  assert.match(prompt, /允许在分镜组织阶段展示有依据的自我纠错/u);
  assert.equal((prompt.match(/一、视频事实提取/gu) || []).length, 0);
  assert.match(prompt, /<reasoning_report>/u);
});

test('talking video reasoning report extractor streams only the tagged report', () => {
  const deltas: string[] = [];
  const extractor = createTalkingVideoReasoningReportExtractor((delta) => deltas.push(delta));
  extractor.push('前置内容<reasoning_');
  extractor.push('report>这个视频是一个装修设计短视频。\n视频内容分析：\n0-2秒展示入户门。\n需要提取');
  extractor.push('的关键信息：\n主体为装修点位。</reasoning_');
  extractor.push('report>{"durationSeconds":15}');
  extractor.finish();
  assert.equal(deltas.join(''), '这个视频是一个装修设计短视频。\n视频内容分析：\n0-2秒展示入户门。\n需要提取的关键信息：\n主体为装修点位。');
});

test('talking video analysis instruction expands shared hard rules only once', () => {
  const instruction = talkingVideoAnalysisInstruction({
    images: [{
      filePath: '/tmp/model.png',
      filename: 'model.png',
      mimeType: 'image/png',
      role: 'model',
    }],
    video: {
      durationSeconds: 14,
      filePath: '/tmp/source.mp4',
      filename: 'source.mp4',
      mimeType: 'video/mp4',
    },
  });
  assert.equal((instruction.match(/图片素材必须严格按角色隔离使用/gu) || []).length, 1);
  assert.equal((instruction.match(/镜号边界以主画面的真实视觉切换为第一依据/gu) || []).length, 1);
  assert.equal((instruction.match(/一、视频事实提取/gu) || []).length, 0);
});

test('talking video material roles isolate a model image from its background', () => {
  const rules = talkingVideoMaterialRoleRules([{ role: 'model' }]).join('\n');
  assert.match(rules, /模特图只决定出镜人物的身份/u);
  assert.match(rules, /必须忽略图中的背景、空间、家具/u);
  assert.match(rules, /本次未提供背景图/u);
  assert.match(rules, /不得从模特图、产品图或细节图提取、沿用或推断背景/u);
});

test('talking video shot boundaries follow visual cuts instead of subtitle fragments', () => {
  const rules = talkingVideoShotBoundaryRules().join('\n');
  assert.match(rules, /主画面的真实视觉切换为第一依据/u);
  assert.match(rules, /不得因为字幕换行/u);
  assert.match(rules, /“对啊”“嗯”等语气词/u);
  assert.match(rules, /同一个主画面和同一个连续动作/u);
});

test('validateTalkingVideoPrompt rejects screen text and shorthand', () => {
  const issues = validateTalkingVideoPrompt([
    '画面不要生成字幕、字幕条、标题字、贴片文字、平台水印或其他可读文字。',
    '分段A',
    '镜号1｜近景｜0-5秒',
    '画面：人物正对镜头，显示标题文字',
    '镜号2｜近景｜5-10秒',
    '画面：同镜号1',
  ].join('\n'), {
    durationSeconds: 10,
    summary: '连续口播',
    visualStyle: '写实',
    finalPrompt: '测试提示词',
    presentationLayout: {
      type: 'full_screen_presenter',
      mainVisualRole: '讲解者连续口播',
      presenterPlacement: '主画面居中',
      persistence: '全程持续',
    },
    videoStructure: { isContinuousTake: true, shotBoundaryReason: '全程固定机位' },
    presenter: { identity: '讲解者', expressionStyle: '自然', performanceStyle: '稳定口播' },
    shots: [{
      startSecond: 0,
      endSecond: 10,
      shotSize: '近景',
      visual: '人物连续口播',
      dialogue: '完整台词',
      performance: '自然',
      shootingNotes: '固定机位',
    }],
    imageReferences: [],
  });
  assert.match(issues.join('\n'), /不能使用“同镜号/u);
  assert.match(issues.join('\n'), /禁止字幕、标题/u);
});

test('normalizeTalkingVideoPrompt supplies global text restriction and the single segment marker', () => {
  const prompt = normalizeTalkingVideoPrompt('镜号1｜近景｜0-2秒\n画面：人物看向镜头');
  assert.match(prompt, /^画面不要生成字幕/u);
  assert.match(prompt, /分段A\n\n镜号1/u);
});

test('talkingVideoAnalysisSchema rejects a long shot containing multiple parallel claims', () => {
  const parsed = talkingVideoAnalysisSchema.safeParse({
    ...detailedAnalysis,
    shots: [
      detailedAnalysis.shots[0],
      {
        startSecond: 1,
        endSecond: 15,
        shotSize: '近景',
        visual: '讲解者连续分享',
        dialogue: '在所有的养生方法里，最好的是少吃。在所有的补阳方法里，最好的是晒太阳。',
        performance: '自然',
        shootingNotes: '延续同一机位',
      },
    ],
  });
  assert.equal(parsed.success, false);
  assert.match(parsed.error?.issues.map((issue) => issue.message).join('\n') || '', /一个镜号只能承载一个完整观点/u);
});

test('talkingVideoAnalysisSchemaForDuration rejects model-estimated duration', () => {
  const parsed = talkingVideoAnalysisSchemaForDuration(14).safeParse({
    ...detailedAnalysis,
    durationSeconds: 16,
    shots: detailedAnalysis.shots.map((shot, index, shots) => index === shots.length - 1
      ? { ...shot, endSecond: 16 }
      : shot),
  });
  assert.equal(parsed.success, false);
  assert.match(parsed.error?.issues.map((issue) => issue.message).join('\n') || '', /媒体元数据给出的 14 秒/u);
});

test('validateTalkingVideoPrompt rejects merged or changed final shot timelines', () => {
  const analysis = talkingVideoAnalysisSchema.parse(detailedAnalysis);
  const prompt = [
    '画面不要生成字幕、字幕条、标题字、贴片文字、平台水印或其他可读文字。',
    '分段A',
    '镜号1｜近景｜0-2秒',
    '画面：讲解者开场。',
    '镜号2｜近景｜2-15秒',
    '画面：讲解者连续分享。',
  ].join('\n');
  const issues = validateTalkingVideoPrompt(prompt, analysis);
  assert.match(issues.join('\n'), /必须保留拆解得到的 6 个镜号/u);
});

test('validateTalkingVideoPrompt requires complete fields, centralized image refs and exact dialogue', () => {
  const analysis = talkingVideoAnalysisSchema.parse({
    ...detailedAnalysis,
    imageReferences: [{ imageIndex: 1, role: 'model', usableTraits: '素材清晰可用' }],
  });
  const prompt = [
    '画面不要生成字幕、字幕条、标题字、贴片文字、平台水印或其他可读文字。',
    '@图片1作为模特参考。',
    '分段A',
    ...analysis.shots.flatMap((shot, index) => [
      `镜号${index + 1}｜${shot.shotSize}｜${shot.startSecond}-${shot.endSecond}秒`,
      `画面：${shot.visual}`,
      `台词：${index === 2 ? '遗漏了原台词' : shot.dialogue || '无'}`,
      `表演要点：${shot.performance}`,
      `拍摄注意：${shot.shootingNotes}`,
    ]),
  ].join('\n');
  const issues = validateTalkingVideoPrompt(prompt, analysis);
  assert.equal(issues.filter((issue) => issue.includes('逐字保留')).length, 1);
  assert.equal(issues.some((issue) => issue.includes('@图片1 必须')), false);
  assert.equal(issues.some((issue) => issue.includes('每个镜号都必须独立')), false);
});

test('validateTalkingVideoPrompt rejects scene information mixed into a model image declaration', () => {
  const analysis = talkingVideoAnalysisSchema.parse({
    ...detailedAnalysis,
    imageReferences: [{ imageIndex: 1, role: 'model', usableTraits: '素材清晰可用' }],
  });
  const prompt = [
    '画面不要生成字幕、字幕条、标题字、贴片文字、平台水印或其他可读文字。',
    '@图片1：作为出镜模特，并沿用图片中的居家客厅背景与柔和光线。',
    '分段A',
    ...analysis.shots.flatMap((shot, index) => [
      `镜号${index + 1}｜${shot.shotSize}｜${shot.startSecond}-${shot.endSecond}秒`,
      `画面：${shot.visual}`,
      `台词：${shot.dialogue || '无'}`,
      `表演要点：${shot.performance}`,
      `拍摄注意：${shot.shootingNotes}`,
    ]),
  ].join('\n');
  const issues = validateTalkingVideoPrompt(prompt, analysis);
  assert.match(issues.join('\n'), /素材用途声明混入了其他角色的信息/u);
});

test('validateTalkingVideoPrompt allows an independently designed scene outside the model usage line', () => {
  const analysis = talkingVideoAnalysisSchema.parse({
    ...detailedAnalysis,
    imageReferences: [{ imageIndex: 1, role: 'model', usableTraits: '素材清晰可用' }],
  });
  const prompt = [
    '画面不要生成字幕、字幕条、标题字、贴片文字、平台水印或其他可读文字。',
    '@图片1：仅作为出镜模特的人物身份与稳定外观参考。',
    '独立场景设计：未上传背景图，按养生主题设计简洁、可拍摄的室内空间。',
    '分段A',
    ...analysis.shots.flatMap((shot, index) => [
      `镜号${index + 1}｜${shot.shotSize}｜${shot.startSecond}-${shot.endSecond}秒`,
      `画面：${shot.visual}`,
      `台词：${shot.dialogue || '无'}`,
      `表演要点：${shot.performance}`,
      `拍摄注意：${shot.shootingNotes}`,
    ]),
  ].join('\n');
  const issues = validateTalkingVideoPrompt(prompt, analysis);
  assert.equal(issues.some((issue) => issue.includes('素材用途声明混入了其他角色的信息')), false);
});

test('validateTalkingVideoPrompt requires picture-in-picture layout to survive final prompting', () => {
  const analysis = talkingVideoAnalysisSchema.parse({
    ...detailedAnalysis,
    presentationLayout: {
      type: 'picture_in_picture',
      mainVisualRole: '装修点位实拍',
      presenterPlacement: '左上角圆形头像框',
      persistence: '全程持续',
    },
  });
  const prompt = [
    '画面不要生成字幕、字幕条、标题字、贴片文字、平台水印或其他可读文字。',
    '分段A',
    ...analysis.shots.flatMap((shot, index) => [
      `镜号${index + 1}｜${shot.shotSize}｜${shot.startSecond}-${shot.endSecond}秒`,
      `画面：${shot.visual}`,
      `台词：${shot.dialogue || '无'}`,
      `表演要点：${shot.performance}`,
      `拍摄注意：${shot.shootingNotes}`,
    ]),
  ].join('\n');
  const issues = validateTalkingVideoPrompt(prompt, analysis);
  assert.match(issues.join('\n'), /每个镜号都必须保留讲解者叠加层/u);
});

test('validateTalkingVideoPrompt rejects adding a presenter to voice_over layouts', () => {
  const analysis = talkingVideoAnalysisSchema.parse({
    ...detailedAnalysis,
    presentationLayout: {
      type: 'voice_over',
      mainVisualRole: '产品演示主画面',
      presenterPlacement: '',
      persistence: '全程持续',
    },
    shots: [{
      startSecond: 0,
      endSecond: 15,
      shotSize: '近景',
      visual: '产品演示主画面',
      dialogue: '这是产品说明台词',
      performance: '按产品节奏推进',
      shootingNotes: '无人物出镜，仅保留主画面',
    }],
  });
  const prompt = [
    '画面不要生成字幕、字幕条、标题字、贴片文字、平台水印或其他可读文字。',
    '分段A',
    '镜号1｜近景｜0-15秒',
    '画面：左上角画中画讲解者同步口播，主画面展示产品。',
    '台词：“这是产品说明台词。”（语气：自然，语速：中速）',
    '表演要点：讲解者面对镜头讲解',
    '拍摄注意：保留圆形头像框叠加窗口',
  ].join('\n');
  const issues = validateTalkingVideoPrompt(prompt, analysis);
  assert.match(issues.join('\n'), /不能新增画中画讲解者/u);
  assert.match(issues.join('\n'), /不能凭空增加出镜讲解人物/u);
});

test('validateTalkingVideoPrompt rejects moving full_screen_presenter into pip or voice over', () => {
  const analysis = talkingVideoAnalysisSchema.parse({
    ...detailedAnalysis,
    shots: [{
      startSecond: 0,
      endSecond: 15,
      shotSize: '近景',
      visual: '讲解者全屏面对镜头口播',
      dialogue: '这是主持人口播台词',
      performance: '讲解者自然讲解',
      shootingNotes: '固定机位保持讲解者全程出镜',
    }],
  });
  const prompt = [
    '画面不要生成字幕、字幕条、标题字、贴片文字、平台水印或其他可读文字。',
    '分段A',
    '镜号1｜近景｜0-15秒',
    '画面：主画面展示产品细节，左上角保留圆形头像框画中画。',
    '台词：“这是主持人口播台词。”（语气：自然，语速：中速）',
    '表演要点：旁白讲解产品卖点',
    '拍摄注意：无人物出镜，仅展示产品',
  ].join('\n');
  const issues = validateTalkingVideoPrompt(prompt, analysis);
  assert.match(issues.join('\n'), /不能改成画中画/u);
  assert.match(issues.join('\n'), /不能退化成纯旁白或纯产品镜头/u);
});

test('validateTalkingVideoPrompt ignores non-executable full-screen layout warning text', () => {
  const analysis = talkingVideoAnalysisSchema.parse({
    ...detailedAnalysis,
    imageReferences: [{ imageIndex: 1, role: 'model', usableTraits: '素材清晰可用' }],
    shots: [{
      startSecond: 0,
      endSecond: 15,
      shotSize: '近景',
      visual: '讲解者全屏面对镜头讲解装修细节',
      dialogue: '这是主持人口播台词',
      performance: '讲解者自然讲解',
      shootingNotes: '固定机位保持讲解者全程出镜',
    }],
  });
  const prompt = [
    '画面不要生成字幕、字幕条、标题字、贴片文字、平台水印或其他可读文字。',
    '@图片1：仅作为出镜模特的人物身份与稳定外观参考。',
    '约束复核：参考视频为全屏讲解者，最终提示词不能改成画中画或叠加讲解者布局。',
    '分段A',
    '镜号1｜近景｜0-15秒',
    '画面：讲解者全屏面对镜头讲解装修细节。',
    '台词：“这是主持人口播台词。”（语气：自然，语速：中速）',
    '表演要点：讲解者自然讲解',
    '拍摄注意：不要改成画中画或叠加讲解者布局，固定机位保持讲解者全程出镜',
  ].join('\n');
  const issues = validateTalkingVideoPrompt(prompt, analysis);
  assert.equal(issues.some((issue) => issue.includes('不能改成画中画')), false);
  assert.equal(issues.some((issue) => issue.includes('必须明确保留出镜讲解者')), false);
});

test('validateTalkingVideoPrompt allows voice_over material declarations without visible presenter', () => {
  const analysis = talkingVideoAnalysisSchema.parse({
    ...detailedAnalysis,
    presentationLayout: {
      type: 'voice_over',
      mainVisualRole: '产品演示主画面',
      presenterPlacement: '',
      persistence: '全程持续',
    },
    imageReferences: [
      { imageIndex: 1, role: 'model', usableTraits: '素材清晰可用' },
      { imageIndex: 2, role: 'product', usableTraits: '产品外观清晰可用' },
      { imageIndex: 3, role: 'background', usableTraits: '环境可用' },
      { imageIndex: 4, role: 'detail', usableTraits: '局部纹理可用' },
    ],
    shots: [{
      startSecond: 0,
      endSecond: 15,
      shotSize: '近景',
      visual: '主画面展示产品使用细节与环境',
      dialogue: '这是产品说明台词',
      performance: '按产品节奏推进',
      shootingNotes: '无人物出镜，仅保留主画面',
    }],
  });
  const prompt = [
    '画面不要生成字幕、字幕条、标题字、贴片文字、平台水印或其他可读文字。',
    '@图片1：仅作为模特身份参考，不直接出镜。',
    '@图片2：仅作为产品外观参考。',
    '@图片3：仅作为环境空间参考。',
    '@图片4：仅作为产品局部纹理参考。',
    '分段A',
    '镜号1｜近景｜0-15秒',
    '画面：主画面展示产品使用细节与环境。',
    '台词：“这是产品说明台词。”（语气：自然，语速：中速）',
    '表演要点：按产品节奏推进',
    '拍摄注意：无人物出镜，仅保留主画面',
  ].join('\n');
  const issues = validateTalkingVideoPrompt(prompt, analysis);
  assert.equal(issues.some((issue) => issue.includes('不能新增画中画讲解者')), false);
  assert.equal(issues.some((issue) => issue.includes('不能凭空增加出镜讲解人物')), false);
});

test('validateTalkingVideoPrompt rejects picture-in-picture prompts that drop the overlay in later shots', () => {
  const analysis = talkingVideoAnalysisSchema.parse({
    ...detailedAnalysis,
    presentationLayout: {
      type: 'picture_in_picture',
      mainVisualRole: '装修点位实拍',
      presenterPlacement: '左上角圆形头像框',
      persistence: '全程持续',
    },
    shots: [
      {
        startSecond: 0,
        endSecond: 7,
        shotSize: '近景',
        visual: '主画面展示装修点位，左上角保留圆形讲解者画中画',
        dialogue: '前半段讲解',
        performance: '讲解者自然讲解',
        shootingNotes: '固定主画面并保留叠加层',
      },
      {
        startSecond: 7,
        endSecond: 15,
        shotSize: '近景',
        visual: '主画面继续展示装修点位',
        dialogue: '后半段讲解',
        performance: '讲解者自然讲解',
        shootingNotes: '固定主画面',
      },
    ],
  });
  const prompt = [
    '画面不要生成字幕、字幕条、标题字、贴片文字、平台水印或其他可读文字。',
    '分段A',
    '镜号1｜近景｜0-7秒',
    '画面：主画面展示装修点位，左上角保留圆形头像框画中画。',
    '台词：“前半段讲解。”（语气：自然，语速：中速）',
    '表演要点：画中画讲解者自然讲解',
    '拍摄注意：固定主画面并保留叠加层',
    '镜号2｜近景｜7-15秒',
    '画面：主画面继续展示装修点位。',
    '台词：“后半段讲解。”（语气：自然，语速：中速）',
    '表演要点：按主画面节奏继续推进',
    '拍摄注意：固定主画面，不要出现字幕',
  ].join('\n');
  const issues = validateTalkingVideoPrompt(prompt, analysis);
  assert.match(issues.join('\n'), /每个镜号都必须保留讲解者叠加层/u);
});
