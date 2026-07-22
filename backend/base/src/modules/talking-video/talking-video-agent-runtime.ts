import { randomUUID } from 'node:crypto';
import { callConfiguredLlm } from '../content/configured-llm.client.js';
import {
  normalizeTalkingVideoPrompt,
  talkingVideoAnalysisSchemaForDuration,
  talkingVideoMaterialRoleRules,
  talkingVideoRoleLabels,
  validateTalkingVideoPrompt,
  type TalkingVideoAnalysis,
  type TalkingVideoPromptImage,
  type TalkingVideoPromptMedia,
} from './talking-video.prompt.js';
import {
  runTalkingVideoStructuredUnderstanding,
  type TalkingVideoRunMetrics,
} from './talking-video-understanding-runtime.js';

export type TalkingVideoAgentPhase =
  | 'uploading_assets'
  | 'understanding_video'
  | 'validating_analysis'
  | 'generating_prompt'
  | 'validating_prompt'
  | 'repairing_prompt'
  | 'completed'
  | 'failed'
  | 'stopped';

export function totalTalkingVideoModelCalls(metrics: TalkingVideoRunMetrics) {
  return metrics.understandingModelCalls + metrics.formatRepairCalls + metrics.promptRepairCalls;
}

function assertTalkingVideoCeilings(metrics: TalkingVideoRunMetrics) {
  if (metrics.understandingModelCalls > 2) {
    throw new Error('口播视频理解超过允许的完整理解次数上限');
  }
  if (metrics.understandingReplayCalls > 1) {
    throw new Error('口播视频理解超过允许的重放次数上限');
  }
  if (metrics.formatRepairCalls > 1) {
    throw new Error('口播视频理解超过允许的格式修复次数上限');
  }
  if (metrics.promptRepairCalls > 1) {
    throw new Error('口播提示词超过允许的修复次数上限');
  }
  if (totalTalkingVideoModelCalls(metrics) > 4) {
    throw new Error('口播视频理解超过允许的总模型调用上限');
  }
}

export function talkingVideoShotBoundaryRules() {
  return [
    '镜号边界以主画面的真实视觉切换为第一依据：硬切、转场、主体点位变化、机位变化或明确的新操作阶段才建立新镜号；台词语义只用于绑定和微调边界。不得因为字幕换行、关键词变色、标点停顿、句内短语或“对啊”“嗯”等语气词单独增加镜号。',
    '同一个主画面和同一个连续动作下的前提句、解释句、语气词应合并到同一镜号，完整保留连续台词；只有主画面同步发生真实变化时才拆开。',
    '严格区分“画面阶段/镜号数量”和“切换次数”：连续的 N 个镜号最多只有 N-1 处镜号边界，不得把“4 个画面阶段”写成“4 次硬切”。',
  ];
}

function finalPromptRules() {
  return [
    '15 秒以内或等于 15 秒只使用一个“分段A”，分段内保留全部可执行镜号。',
    '严格沿用结构化 shots 的镜号数量、顺序和起止时间，禁止在最终提示词阶段自行拆分、合并或改写时间轴。',
    '若 videoStructure.isContinuousTake=true，各镜号在“拍摄注意”中说明延续同一机位和一镜到底，不得描述切镜；同时为不同时间段设计自然连续的微表情、视线或轻微手势变化，避免所有镜号完全相同。',
    '开头写“画面不要生成字幕、字幕条、标题字、贴片文字、平台水印或其他可读文字。”原视频文字只作为台词识别证据，不得进入最终生成画面。',
    '随后建立“素材用途”区，每张素材单独一行写“@图片N：仅作为……参考”；每张素材只标记一次，镜头正文不再重复素材标签。素材用途行只能描述该图片角色本身，不得在同一行附带场景、人物、产品或其他角色信息。',
    '若未提供背景图，在素材用途区之后另起一行写“独立场景设计：……”，不得把独立设计的场景写成由某张模特图、产品图或细节图提供。',
    '严格继承 presentationLayout。若 type=picture_in_picture，最终提示词必须明确描述主画面内容、讲解者画中画的形状/位置和持续方式；模特图只替换画中画讲解者，不得把讲解者改成全屏人物、工作室主持人或主画面主体。每个镜号都要分别写清主画面动作和持续存在的讲解者叠加层。',
    'presentationLayout、picture_in_picture、full_screen_presenter、voice_over、mixed 都是结构化分析的内部字段或枚举，禁止原样出现在 finalPrompt；最终提示词必须改写为“画面布局”“画中画”“全屏讲解者”“旁白”“混合布局”等自然中文。',
    '若 type=voice_over，不能凭空增加出镜人物；若 type=full_screen_presenter，不能凭空改成画中画。',
    '不要机械照抄参考视频原模特的穿着、原背景细节、领夹麦样式或商品外观；没有背景图时，根据口播主题设计简洁、合理、可拍摄的新场景，而不是删除全部场景信息。',
    '每个镜号使用“镜号N｜景别｜起止秒数”，并完整包含“画面、台词、表演要点、拍摄注意”，禁止“同上”“同镜号1”“参数无变动”等省略表达。',
    '台词使用“台词：“……”（语气：……，语速：……）”格式；没有台词写“台词：无”。',
    '画面描述要根据 presentationLayout 具体、可执行地描述主画面主体、动作、光线、氛围和空间关系；有人物出镜或画中画时再补充人物身份、姿态和表情，不得强迫每个主画面都出现人物，也不得添加素材和参考视频均无依据的特殊光影效果。',
  ];
}

export function talkingVideoReasoningStyleRules() {
  return [
    '思考过程必须使用专业但自然的导演审片口吻，按观察、提取、组织、复核的过程展开，不写逐字段填写 JSON 的内部独白。',
    '允许在分镜组织阶段展示有依据的自我纠错，但必须写成“重新确认：原判断……；新证据……；因此调整为……”或“修正：原结论 → 新结论；依据：……”。',
    '禁止无依据的疑问句、自问自答和模拟对话。禁止使用“用户现在需要我”“首先一步步来”“哦”“对吧”“是不是”“不对”“等下”“没错”“完美”“现在来写”“这样就对了”等口语填充。',
    '同一结论只出现一次；不要逐字段预演 JSON 语法，不要用“然后整理字段”“现在输出 JSON”等过程性旁白占据篇幅。',
    '保持充分且可追踪：视频内容分析逐段列观察证据，关键信息集中提取，分镜组织阶段解释取舍与修正，最终检查只汇总结论。',
  ];
}

export function talkingVideoReasoningFlowRules() {
  return [
    '开头不写标题，先用一个自然段概括：这是一个关于什么的视频、主要讲解什么、权威时长是多少、根据15秒规则应使用几个分段。表达参考：“这个视频是一个关于装修设计的短视频，主要讲解了一些实用的装修细节。视频时长约14秒，根据规则，15秒以内不需要分段，所以只需要输出一个连续的分段。”',
    '随后输出标题“视频内容分析：”，按时间顺序逐段记录主画面、画中画或讲解者、可见动作、原屏幕文字、逐字台词、景别和镜头变化。此处只描述看到的内容，不提前决定最终镜号。',
    '随后输出标题“需要提取的关键信息：”，集中归纳主体、姿态/动作、表情、光线、氛围、艺术风格、主画面职责、讲解者布局以及需要保留的台词和节奏。',
    '随后输出标题“台词提取与时长检查：”，逐句列出台词、对应时间、汉字数量和每秒字数，检查口播是否适配时长；中文口播以每秒不超过9个汉字作为宽松上限。',
    '随后输出标题“分镜组织分析：”，解释为什么合并或拆分每个视觉阶段，区分内容模块、画面阶段、真实镜号与切换次数；在这里进行有依据的重新确认和自我纠错，再形成最终镜号时间轴。N 个连续镜号之间只有 N-1 处边界，不得混淆镜号数量和硬切次数。',
    '随后输出标题“素材替换与生成约束：”，说明每张图片的唯一作用、原人物/背景/产品如何替换、PIP布局如何保留、哪些屏幕文字必须移除，以及最终提示词如何组织。',
    '最后输出标题“最终检查：”，检查分段、镜号数量、时间连续性、台词完整性、素材角色、布局、无屏幕文字和最终格式，只给出检查结论，不展开JSON或复述完整提示词。',
    '不得使用“一、二、三、四”或“1、2、3、4”作为章节编号；只使用上述自然标题和段落。',
  ];
}

export function talkingVideoAnalysisSystemPrompt(includeReasoningReport = true) {
  return [
    '你是专业的口播短视频导演审片员。请把素材观察与执行决策整理成清晰、可复核的导演审片记录，不要输出内部自言自语。',
    ...talkingVideoReasoningStyleRules(),
    'reasoning 必须严格遵循以下自然审片流程：',
    ...talkingVideoReasoningFlowRules(),
    '阶段门禁：完成视频内容分析、关键信息提取、台词时长检查和分镜组织分析之前，禁止起草 finalPrompt，禁止逐项预演 durationSeconds、summary、visualStyle、presentationLayout、videoStructure、presenter、shots、imageReferences 等 JSON 字段值。',
    includeReasoningReport
      ? '最终 answer 必须先输出 <reasoning_report> 与 </reasoning_report> 包裹的自然导演审片记录，随后紧接一个严格合法的 JSON 对象。标签外除 JSON 外不要输出其他文字，不要 Markdown 或代码围栏。'
      : '最终 answer 只能返回用户消息要求的 JSON 对象，不要 Markdown、解释、前后缀或代码围栏。',
  ].join('\n');
}

export function talkingVideoAnalysisInstruction(
  input: { images: TalkingVideoPromptImage[]; video: TalkingVideoPromptMedia },
  includeReasoningReport = false,
) {
  const manifest = input.images.map((image, index) => ({
    imageIndex: index + 1,
    role: image.role,
    roleLabel: talkingVideoRoleLabels[image.role],
    filename: image.filename,
  }));
  return [
    '你是口播短视频的视频拆解师。完整分析随后提供的参考视频以及角色图片。',
    input.video.durationSeconds
      ? `媒体元数据确认视频总时长为 ${input.video.durationSeconds} 秒。这是唯一时长真值，durationSeconds 必须精确等于该值，最后一个 shot 必须结束于该值，禁止根据帧编号或主观感受重新估算。`
      : '必须依据视频本身确认总时长，不得把字幕时间或采样帧编号误当成视频时长。',
    `图片素材清单：${JSON.stringify(manifest)}`,
    '图片角色使用边界：',
    ...talkingVideoMaterialRoleRules(input.images),
    '镜号边界硬规则：',
    ...talkingVideoShotBoundaryRules(),
    '补充结构化要求：',
    '若全程一镜到底，在 videoStructure 标记 isContinuousTake=true；各时间段的 shootingNotes 要明确延续同一机位和连续表演，不能误写成真实切镜。',
    '必须填写 presentationLayout：type 只能是 full_screen_presenter、picture_in_picture、voice_over、mixed；mainVisualRole 描述承担主要信息的画面，presenterPlacement 描述讲解者的位置和形状，persistence 描述该布局持续范围。',
    '台词必须尽量逐字提取，不要遗漏或改写。镜头时间轴必须从 0 秒连续覆盖到视频结尾。',
    '原视频中的字幕、标题、平台水印可以写入 sourceScreenText 作为拆解证据，但不得写入 visual、performance、shootingNotes 或 finalPrompt 的生成画面。',
    'visualStyle 只描述参考视频实际可见的拍摄风格，不得混入上传图片的肤色、光影或艺术效果。',
    '图片分析只确认 imageIndex、role、素材清晰度和可用性，不要在 usableTraits 中复述人物外貌、服装、肤色、背景或图片光影。',
    '在完成 shots 后继续起草 finalPrompt，并按以下输出契约自我修正后写入 JSON 的 finalPrompt 字段：',
    ...finalPromptRules(),
    '镜号边界示例：主画面连续展示“入户门上方预留插座”，台词先说位置再说用途，即使中间字幕换行或出现语气词，也应保留为同一视觉镜号；切换到监控安装效果时再建立新镜号。',
    includeReasoningReport
      ? '输出时先给出 <reasoning_report>自然导演审片记录</reasoning_report>，再返回 JSON 对象；审片记录中不得出现 JSON、字段预演或最终提示词全文。'
      : '只返回一个 JSON 对象，不要 Markdown、解释或注释。',
    '输出结构：{"durationSeconds":15,"summary":"","visualStyle":"","finalPrompt":"完整最终视频提示词","presentationLayout":{"type":"picture_in_picture","mainVisualRole":"装修点位实拍","presenterPlacement":"左上角圆形头像框","persistence":"全程持续"},"videoStructure":{"isContinuousTake":false,"shotBoundaryReason":"按主画面真实切换划分镜号"},"presenter":{"identity":"","expressionStyle":"","performanceStyle":""},"shots":[{"startSecond":0,"endSecond":2,"shotSize":"近景","visual":"主画面展示点位测量，左上角保留圆形讲解者画中画","sourceScreenText":"原字幕证据","dialogue":"完整连续台词","performance":"画中画讲解者自然讲解","shootingNotes":"固定主画面并保留叠加层"}],"imageReferences":[{"imageIndex":1,"role":"model","usableTraits":"素材清晰可用"}]}',
  ].join('\n');
}

export function createTalkingVideoReasoningReportExtractor(onDelta: (delta: string) => void) {
  const openTag = '<reasoning_report>';
  const closeTag = '</reasoning_report>';
  let buffer = '';
  let opened = false;
  let closed = false;

  const emitAvailable = () => {
    if (closed) return;
    if (!opened) {
      const openIndex = buffer.indexOf(openTag);
      if (openIndex < 0) {
        buffer = buffer.slice(-Math.max(0, openTag.length - 1));
        return;
      }
      buffer = buffer.slice(openIndex + openTag.length);
      opened = true;
    }
    const closeIndex = buffer.indexOf(closeTag);
    if (closeIndex >= 0) {
      if (closeIndex > 0) onDelta(buffer.slice(0, closeIndex));
      buffer = '';
      closed = true;
      return;
    }
    const safeLength = Math.max(0, buffer.length - closeTag.length + 1);
    if (safeLength > 0) {
      onDelta(buffer.slice(0, safeLength));
      buffer = buffer.slice(safeLength);
    }
  };

  return {
    finish() {
      if (opened && !closed && buffer) onDelta(buffer);
      buffer = '';
    },
    push(delta: string) {
      if (!delta || closed) return;
      buffer += delta;
      emitAvailable();
    },
  };
}

function finalPromptSystem(images: Array<Pick<TalkingVideoPromptImage, 'role'>>) {
  return [
    '你是一名专业的口播短视频导演和视频生成提示词工程师。',
    '根据已完成的视频拆解和图片素材映射，编写可直接交给视频生成模型执行的中文提示词。',
    '形成最终答案前依次完成：读取已提取事实、核对硬约束、起草全部镜号、检查台词时长和素材引用、检查无屏幕文字与禁止照抄项、修正问题并复核。',
    ...talkingVideoReasoningStyleRules(),
    '修复阶段的思考过程按“问题N：原因；修正；复核”记录，只写确定结论，不重复整段视频拆解。',
    ...talkingVideoShotBoundaryRules(),
    ...talkingVideoMaterialRoleRules(images),
    ...finalPromptRules(),
    '只输出最终提示词，不要 Markdown 代码块、分析过程、检查说明或其他元话语。',
  ].join('\n');
}

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  const error = new Error('口播提示词生成已停止');
  error.name = 'AbortError';
  throw error;
}

export async function runTalkingVideoPromptAgent(input: {
  userId: string;
  images: TalkingVideoPromptImage[];
  video: TalkingVideoPromptMedia;
  deepThink: boolean;
  signal?: AbortSignal;
  onReasoningDelta?: (delta: string) => void;
  onAnswerDelta?: (delta: string) => void;
  onPhaseChange?: (phase: TalkingVideoAgentPhase, metrics: TalkingVideoRunMetrics) => void;
  runStructuredUnderstanding?: typeof runTalkingVideoStructuredUnderstanding;
  repairPrompt?: typeof callConfiguredLlm;
}) {
  const metrics: TalkingVideoRunMetrics = {
    arkUploadCount: 0,
    arkUploadPollMs: 0,
    understandingModelCalls: 0,
    understandingReplayCalls: 0,
    formatRepairCalls: 0,
    promptRepairCalls: 0,
    reuseCacheHitCount: 0,
  };
  const emitPhase = (phase: TalkingVideoAgentPhase) => input.onPhaseChange?.(phase, { ...metrics });
  let reasoning = '';
  const onReasoningDelta = input.deepThink ? (delta: string) => {
    reasoning += delta;
    input.onReasoningDelta?.(delta);
  } : undefined;
  const reasoningReportExtractor = onReasoningDelta
    ? createTalkingVideoReasoningReportExtractor(onReasoningDelta)
    : null;
  const runStructuredUnderstanding = input.runStructuredUnderstanding || runTalkingVideoStructuredUnderstanding;
  const repairPrompt = input.repairPrompt || callConfiguredLlm;
  const understandingResult = await runStructuredUnderstanding({
    userId: input.userId,
    video: input.video,
    images: input.images,
    schema: talkingVideoAnalysisSchemaForDuration(input.video.durationSeconds),
    instructionText: talkingVideoAnalysisInstruction(input, input.deepThink),
    systemPrompt: talkingVideoAnalysisSystemPrompt(input.deepThink),
    thinking: false,
    signal: input.signal,
    maxTokens: input.deepThink ? 12_000 : 6_000,
    metrics,
    onAnswerDelta: reasoningReportExtractor?.push,
    onReasoningDelta,
    onPhase: (phase, phaseMetrics) => {
      Object.assign(metrics, phaseMetrics);
      emitPhase(phase);
    },
    suppressNativeReasoning: input.deepThink,
  });
  Object.assign(metrics, understandingResult.metrics);
  const parsedAnalysis = understandingResult.parsed;
  reasoningReportExtractor?.finish();
  throwIfAborted(input.signal);

  const analysis: TalkingVideoAnalysis = {
    ...parsedAnalysis,
    imageReferences: input.images.map((image, index) => ({
      imageIndex: index + 1,
      role: image.role,
      usableTraits: parsedAnalysis.imageReferences.find((reference) => reference.imageIndex === index + 1)?.usableTraits
        || '素材清晰可用',
    })),
  };

  emitPhase('generating_prompt');
  let prompt = normalizeTalkingVideoPrompt(analysis.finalPrompt);
  emitPhase('validating_prompt');
  const promptIssues = validateTalkingVideoPrompt(prompt, analysis);
  if (promptIssues.length) {
    onReasoningDelta?.(`\n检测到初稿存在 ${promptIssues.length} 项约束问题，开始重新检查并修正。\n`);
    metrics.promptRepairCalls += 1;
    emitPhase('repairing_prompt');
    const repairedPrompt = await repairPrompt({
      userId: input.userId,
      system: [
        finalPromptSystem(input.images),
        '你是最终提示词修复器。按问题编号直接记录原因、修复动作和复核结论，再修复列出的问题，同时保留正确的台词、时间轴和素材用途。',
        '最终答案只输出修复后的完整提示词，不要解释修复过程。',
      ].join('\n'),
      user: [
        '必须修复的问题：',
        ...promptIssues.map((issue, index) => `${index + 1}. ${issue}`),
        '视频结构化拆解：',
        JSON.stringify(analysis),
        '素材角色：',
        ...input.images.map((image, index) => `@图片${index + 1}：${talkingVideoRoleLabels[image.role]}`),
        '素材角色使用边界：',
        ...talkingVideoMaterialRoleRules(input.images),
        '待修复提示词：',
        prompt,
      ].join('\n'),
      temperature: 0.2,
      timeoutMs: 240_000,
      sourceType: 'talking_video_prompt_repair',
      sourceId: randomUUID(),
      billingMode: 'external_fixed',
    });
    throwIfAborted(input.signal);
    prompt = normalizeTalkingVideoPrompt(repairedPrompt);
    const remainingIssues = validateTalkingVideoPrompt(prompt, analysis);
    if (remainingIssues.length) {
      throw new Error(`口播提示词修复后仍未通过约束校验：${remainingIssues.join('；')}`);
    }
  }
  assertTalkingVideoCeilings(metrics);
  emitPhase('completed');
  return { analysis, prompt, reasoning, metrics };
}
