import { createTraceId, logger } from '../../../shared/logger.js';
import type {
  VideoGenerationResult,
  VideoParseResult,
  ViralAnalysisDimension,
  ViralAnalysisDimensionKey,
  ViralReplicationPlan,
  ViralRoleType,
  ViralVideoAnalysis
} from '../content.types.js';
import { callConfiguredLlm, callConfiguredMultimodalLlm, extractJsonObject, isUnsupportedImageMessageError } from '../configured-llm.client.js';

import { errorLogContext } from './content-common.js';

export const viralDimensionMeta: Array<{ key: ViralAnalysisDimensionKey; label: string; priority: ViralAnalysisDimension['priority'] }> = [
  { key: 'basicInfo', label: '基本信息', priority: 'P3' },
  { key: 'formatQuality', label: '画幅 + 画质风格', priority: 'P2' },
  { key: 'role', label: '角色', priority: 'P1' },
  { key: 'scene', label: '场景', priority: 'P2' },
  { key: 'product', label: '产品', priority: 'P3' },
  { key: 'pip', label: 'PIP', priority: 'P3' },
  { key: 'narrative', label: '叙事流程', priority: 'P0' },
  { key: 'camera', label: '镜头运镜', priority: 'P2' },
  { key: 'colorLighting', label: '色调光影', priority: 'P2' },
  { key: 'audioMood', label: '氛围 + 音效', priority: 'P2' },
  { key: 'captionCopy', label: '字幕 + 文案', priority: 'P3' },
  { key: 'interaction', label: '互动元素', priority: 'P3' },
  { key: 'cover', label: '封面信息', priority: 'P1' },
  { key: 'sellingPoint', label: '核心卖点', priority: 'P0' },
  { key: 'negativePrompts', label: '负面禁止词', priority: 'P1' },
];

export type InspectedVideoMaterial = {
  ok: boolean;
  sourceUrl: string;
  videoInfo: {
    title: string;
    description: string;
    uploader: string;
    webpageUrl: string;
    tags: string[];
    duration: number;
    width: number;
    height: number;
    fileSize: number;
    mimeType: string;
    hasAudio: boolean;
    coverUrl?: string;
    subtitleUrl?: string;
    parser?: string;
  };
  frames: Array<{
    index: number;
    time: number;
    mimeType: string;
    dataUri: string;
  }>;
  transcription: {
    text: string;
    segments: Array<{ start: number; end: number; text: string }>;
    error?: string;
  };
  diagnostics: Record<string, unknown>;
};

export function aiWorkerUrl() {
  return (process.env.PYTHON_AI_WORKER_URL || 'http://127.0.0.1:7075').replace(/\/+$/, '');
}

export function inspectedFrameImageRefs(video: InspectedVideoMaterial) {
  return video.frames
    .map((frame) => frame.dataUri)
    .filter((value) => /^data:image\//i.test(value) || /^https?:\/\//i.test(value))
    .slice(0, 9);
}

export async function inspectVideoUrlWithWorker(url: string): Promise<InspectedVideoMaterial> {
  const traceId = createTraceId('video-inspect');
  logger.info('video inspect request started', { traceId, url, workerUrl: aiWorkerUrl() });
  let response: Response;
  try {
    response = await fetch(`${aiWorkerUrl()}/video/inspect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Trace-Id': traceId },
      body: JSON.stringify({ url }),
    });
  } catch (error) {
    logger.error('video inspect worker connection failed', { traceId, url, error: error instanceof Error ? error.message : String(error) });
    throw new Error(`无法解析：Python AI Worker 未启动或不可访问（${error instanceof Error ? error.message : '连接失败'}）`);
  }
  const text = await response.text();
  logger.debug('video inspect worker response received', {
    traceId,
    status: response.status,
    bodyPreview: text.slice(0, 1000),
  });
  let data: { ok?: boolean; message?: string } & Partial<InspectedVideoMaterial> = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error('无法解析：Python AI Worker 返回了无法解析的响应');
  }
  if (!response.ok || data.ok === false) {
    logger.warn('video inspect worker returned failure', { traceId, status: response.status, message: data.message });
    throw new Error(data.message || `无法解析：Python AI Worker 处理失败（${response.status}）`);
  }
  if (!data.videoInfo || !Array.isArray(data.frames) || !data.frames.length) {
    logger.warn('video inspect worker returned incomplete material', { traceId, hasVideoInfo: Boolean(data.videoInfo), frames: data.frames?.length || 0 });
    throw new Error('无法解析：Python AI Worker 未返回视频元信息或关键帧');
  }
  logger.info('video inspect request completed', {
    traceId,
    title: data.videoInfo.title,
    duration: data.videoInfo.duration,
    frames: data.frames.length,
    transcriptionChars: data.transcription?.text?.length || 0,
    diagnostics: data.diagnostics,
  });
  return data as InspectedVideoMaterial;
}

export function flattenNegativePrompts(analysis: ViralVideoAnalysis) {
  const details = analysis.negativePrompts.details;
  return [
    ...details.people,
    ...details.scene,
    ...details.props,
    ...details.quality,
    ...details.copyCompliance,
  ];
}

export function buildImmediateVideoProductionParseResult(input: {
  prompt: string;
  quality: string;
  ratio: string;
  duration: string;
  generationResult?: VideoGenerationResult;
}) {
  const parseResult = normalizeParseResult({
    person: '',
    scene: input.prompt,
    voice: '',
    shotLanguage: `画质：${input.quality}；比例：${input.ratio}；时长：${input.duration}。`,
    product: input.prompt,
    pip: '',
    spokenContent: input.prompt,
    extraDetails: '视频制作任务已提交，后端会在视频模型返回任务号或成片后回写生成结果。',
    analysisProcess: [
      {
        key: 'style',
        label: '视频制作需求',
        items: [
          { label: '提示词', value: input.prompt },
          { label: '画质', value: input.quality },
          { label: '比例', value: input.ratio },
          { label: '时长', value: input.duration },
        ],
        conclusion: '已按用户输入创建视频制作任务，等待视频模型异步生成。',
      },
    ],
    videoGenerationResult: input.generationResult,
  });
  parseResult.viralAnalysis = buildFallbackViralAnalysis(parseResult, 'prompt', input.prompt);
  return parseResult;
}

export function assertUrl(url: string) {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error();
    }
  } catch {
    throw new Error('请输入合法的视频 URL');
  }
}

export function extractFirstHttpUrl(value: string) {
  const text = value.trim();
  const matched = text.match(/https?:\/\/[^\s"'<>，。]+/i);
  return matched?.[0] || text;
}

function llmSourceId(value: string, source: 'url' | 'prompt') {
  const normalized = source === 'url' ? extractFirstHttpUrl(value) : value.trim();
  return normalized.slice(0, 240) || `${source}-input`;
}

export async function generateParseResultWithLlm(input: {
  userId: string;
  source: 'url' | 'prompt';
  value: string;
  selectedSkills?: Array<{ id: string; command: string; name: string; category: string; scenario: string }>;
  inspectedVideo?: InspectedVideoMaterial;
  logContext?: Record<string, unknown>;
}) {
  const skillContext = input.selectedSkills?.length
    ? input.selectedSkills.map((skill) => `${skill.name}(${skill.command}): ${skill.scenario || skill.category}`).join('\n')
    : '无';
  const systemPrompt = `你是视频助手短视频生成工作流里的爆款复刻解析专家。根据用户输入生成可编辑的视频任务解析结果，并严格按照 9 项标准维度解析视频。
只返回 JSON，不要 markdown，不要解释。字段必须完整。
专用指令：请严格按照以下 9 项标准流程解析这条抖音视频，逐条精细化拆解，不遗漏任何一项：1.视频标题解析 2.人物解析 3.场景解析 4.人物声音解析 5.镜头语言解析 6.产品/核心内容解析 7.PIP画中画解析 8.口播字幕文本解析 9.整体风格网感总结。若视频无法访问、非公开、加载失败，直接回复「无法解析」，不做额外推测、不添加无关内容。
analysisProcess 必须严格按以下顺序返回 9 个 section，key 必须分别为 title/person/scene/voice/camera/product/pip/script/style：
1. 视频标题解析：完整标题文本（含表情、符号、关键词）、标题核心卖点、标题引流逻辑（悬念/提问/干货/热点）、标题与内容的关联性、标题中关键词布局（适配抖音搜索）、标题风格（口语化/干货式/悬念式/情感式）。
2. 人物解析：出镜人数、主次角色、身份人设、穿搭妆容、神态表情、肢体动作、互动方式、镜头表现力。
3. 场景解析：实景/布景、室内/户外、环境陈设、灯光色调、背景氛围、是否刻意布置、有无杂物写实感。
4. 人物声音解析：原声/配音/AI音、音色、语速、语气情绪、背景噪音、BGM音量、人声清晰度、方言/普通话。
5. 镜头语言解析：画幅比例、景别（远景/中景/近景/特写）、机位、运镜方式、剪辑节奏、构图、滤镜画质、镜头切换逻辑。
6. 产品/核心内容解析：核心产品/主题、品类、外观、展示方式、卖点露出、功能演示、植入方式、画面占比位置。
7. PIP画中画解析：是否有PIP、PIP内容、出现时间、位置、大小、作用、是否遮挡主画面、补充信息价值。
8. 口播&字幕文本解析：完整口播逐字文案、字幕样式（字体/颜色/大小/高亮）、字幕节奏、话术结构、开场-过渡-收尾逻辑。
9. 整体风格与网感总结：视频整体定位、内容逻辑、剪辑思维、爆款要素、氛围感、可复刻要点，标题与整体内容的适配度。
analysisProcess.items 的 value 不允许使用示例、占位、模板话术，必须来自本次输入的真实素材；如果素材不足，写“无法从当前素材判断”并说明缺口，不允许编造。
JSON 结构：
{
  "person": "出镜人设建议",
  "scene": "场景/背景建议",
  "voice": "音色和播报情绪建议",
  "shotLanguage": "镜头语言、节奏、字幕和画中画建议",
  "product": "产品/服务/主题提炼",
  "pip": "画中画或辅助素材建议",
  "spokenContent": "可直接进入确认的口播脚本，120-220字",
  "extraDetails": "风险词、标题钩子、补充说明",
  "analysisProcess": [
    {
      "key": "title/person/scene/voice/camera/product/pip/script/style 之一",
      "label": "维度中文名",
      "items": [
        {"label": "分析项名称", "value": "本次输入对应的真实分析结论"}
      ],
      "conclusion": "该维度分析完成后的真实结论"
    }
  ],
  "viralAnalysis": {
    "version": 1,
    "sourceType": "${input.source}",
    "sourceValue": "用户输入原文",
    "deterministicSeed": "",
    "dimensions": {
      "basicInfo": {"key":"basicInfo","label":"基本信息","priority":"P3","appeared":true,"summary":"","evidence":[],"details":{}},
      "formatQuality": {"key":"formatQuality","label":"画幅 + 画质风格","priority":"P2","appeared":true,"summary":"","evidence":[],"details":{"ratio":"9:16","quality":"","style":""}},
      "role": {"key":"role","label":"角色","priority":"P1","appeared":true,"summary":"","skipReason":"","evidence":[],"details":{"roleType":"human"}},
      "scene": {"key":"scene","label":"场景","priority":"P2","appeared":true,"summary":"","evidence":[],"details":{}},
      "product": {"key":"product","label":"产品","priority":"P3","appeared":true,"summary":"","skipReason":"","evidence":[],"details":{}},
      "pip": {"key":"pip","label":"PIP","priority":"P3","appeared":false,"summary":"","skipReason":"未出现 PIP/画中画/对比素材","evidence":[],"details":{}},
      "narrative": {"key":"narrative","label":"叙事流程","priority":"P0","appeared":true,"summary":"","evidence":[],"details":{"hookFirst3Seconds":"","timeline":[{"timeRange":"0-3s","beat":"","purpose":""}],"climaxTurn":"","ending":""}},
      "camera": {"key":"camera","label":"镜头运镜","priority":"P2","appeared":true,"summary":"","evidence":[],"details":{}},
      "colorLighting": {"key":"colorLighting","label":"色调光影","priority":"P2","appeared":true,"summary":"","evidence":[],"details":{}},
      "audioMood": {"key":"audioMood","label":"氛围 + 音效","priority":"P2","appeared":true,"summary":"","evidence":[],"details":{}},
      "captionCopy": {"key":"captionCopy","label":"字幕 + 文案","priority":"P3","appeared":true,"summary":"","evidence":[],"details":{}},
      "interaction": {"key":"interaction","label":"互动元素","priority":"P3","appeared":false,"summary":"","skipReason":"未出现互动设计","evidence":[],"details":{}},
      "cover": {"key":"cover","label":"封面信息","priority":"P1","appeared":true,"summary":"","evidence":[],"details":{}},
      "sellingPoint": {"key":"sellingPoint","label":"核心卖点","priority":"P0","appeared":true,"summary":"","evidence":[],"details":{"coreValue":"","proofPoints":[],"retentionLevers":[]}},
      "negativePrompts": {"key":"negativePrompts","label":"负面禁止词","priority":"P1","appeared":true,"summary":"","evidence":[],"details":{"people":[],"scene":[],"props":[],"quality":[],"copyCompliance":[]}}
    },
    "role": "与 dimensions.role 完全相同的对象；details.roleType 只能使用 human/animal/virtual_avatar/anthropomorphic_object/none，不允许返回中文或解释文本",
    "narrative": "与 dimensions.narrative 完全相同的对象",
    "sellingPoint": "与 dimensions.sellingPoint 完全相同的对象",
    "negativePrompts": "与 dimensions.negativePrompts 完全相同的对象",
    "createdAt": "ISO 时间"
  }
}`;
  const userPayload = input.inspectedVideo
    ? {
      inputType: 'downloaded_video_material',
      value: input.value,
      selectedSkills: skillContext,
      videoInfo: input.inspectedVideo.videoInfo,
      transcription: input.inspectedVideo.transcription,
      keyframes: input.inspectedVideo.frames.map((frame) => ({ index: frame.index, time: frame.time, mimeType: frame.mimeType })),
      diagnostics: input.inspectedVideo.diagnostics,
      materialRules: [
        '必须基于 videoInfo、transcription 和随消息附带的封面/关键帧图片解析',
        '没有 ASR 文本时，口播&字幕文本解析只能基于画面字幕和可见内容，不能补写不存在的逐字稿',
        '如果关键帧无法证明某项内容，写无法从当前素材判断',
        input.inspectedVideo.videoInfo.parser === 'douyin_lightweight'
          ? '本次为抖音轻量解析：没有下载完整视频，只有官方详情接口返回的标题、封面、关键帧 URL、字幕文本和 audioTrack 音频轨元数据；audioTrack 可用于判断原声/BGM/配音线索，但不能当作逐字口播稿'
          : '本次为媒体文件解析：已提取关键帧和音频转写',
      ],
    }
    : {
      inputType: input.source === 'url' ? 'video_url' : 'natural_language_prompt',
      value: input.value,
      selectedSkills: skillContext,
    };
  let content: string;
  if (input.inspectedVideo) {
    try {
      content = await callConfiguredMultimodalLlm({
        userId: input.userId,
        temperature: 0.35,
        sourceType: 'viral_parse_multimodal',
        system: systemPrompt,
        sourceId: llmSourceId(input.value, input.source),
        text: JSON.stringify(userPayload, null, 2),
        imageDataUris: inspectedFrameImageRefs(input.inspectedVideo),
      });
    } catch (error) {
      if (!isUnsupportedImageMessageError(error)) {
        logger.error('multimodal llm parse failed', {
          source: input.source,
          value: input.value,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
      logger.warn('multimodal llm unsupported, falling back to text-only parse', {
        source: input.source,
        value: input.value,
        error: error instanceof Error ? error.message : String(error),
      });
      content = await callConfiguredLlm({
        userId: input.userId,
        temperature: 0.35,
        sourceType: 'viral_parse_fallback',
        system: systemPrompt,
        sourceId: llmSourceId(input.value, input.source),
        user: JSON.stringify({
          ...userPayload,
          inputType: 'downloaded_video_material_text_only',
          visualFallbackReason: '当前大模型接口不支持 image_url 多模态消息，本次仅使用真实视频元信息、音频转写、关键帧时间点和诊断信息解析。人物、场景、镜头、PIP、字幕样式等视觉维度如果无法从文本素材判断，必须写“无法从当前素材判断”，不得编造。',
        }, null, 2),
      });
    }
  } else {
    content = await callConfiguredLlm({
      userId: input.userId,
      temperature: 0.4,
      sourceType: 'viral_parse',
      system: systemPrompt,
      sourceId: llmSourceId(input.value, input.source),
      user: JSON.stringify(userPayload, null, 2),
    });
  }
  if (/^["“']?无法解析[。.!！"”']?$/.test(content.trim())) {
    logger.warn('llm returned unable-to-parse marker', {
      ...input.logContext,
      source: input.source,
      value: input.value,
      rawContent: content,
    });
    throw new Error('无法解析');
  }
  let parsedJson: Partial<VideoParseResult>;
  try {
    parsedJson = extractJsonObject<Partial<VideoParseResult>>(content);
  } catch (error) {
    logger.error('llm parse result json extraction failed', {
      ...input.logContext,
      source: input.source,
      value: input.value,
      rawContent: content,
      error: errorLogContext(error),
    });
    throw error;
  }
  const parsed = normalizeParseResult(parsedJson);
  const fallbackViralAnalysis = buildFallbackViralAnalysis(parsed, input.source, input.value);
  const modelViralAnalysis: Record<string, unknown> = isRecord(parsed.viralAnalysis) ? parsed.viralAnalysis : {};
  const viralAnalysisSource = {
    ...fallbackViralAnalysis,
    ...modelViralAnalysis,
    dimensions: {
      ...fallbackViralAnalysis.dimensions,
      ...(isRecord(modelViralAnalysis.dimensions) ? modelViralAnalysis.dimensions : {}),
    },
  };
  parsed.viralAnalysis = normalizeViralAnalysis(viralAnalysisSource, input.source, input.value);
  logger.info('llm parse result normalized', {
    source: input.source,
    value: input.value,
    analysisProcessCount: parsed.analysisProcess?.length || 0,
    hasViralAnalysis: Boolean(parsed.viralAnalysis),
    spokenContentChars: parsed.spokenContent.length,
  });
  return parsed;
}

export function normalizeParseResult(value: Partial<VideoParseResult> | undefined): VideoParseResult {
  return {
    person: String(value?.person || ''),
    scene: String(value?.scene || ''),
    voice: String(value?.voice || ''),
    shotLanguage: String(value?.shotLanguage || ''),
    product: String(value?.product || ''),
    pip: String(value?.pip || ''),
    spokenContent: String(value?.spokenContent || ''),
    extraDetails: String(value?.extraDetails || ''),
    analysisProcess: Array.isArray(value?.analysisProcess)
      ? value.analysisProcess
        .map((item) => ({
          key: String(item?.key || ''),
          label: String(item?.label || ''),
          items: Array.isArray(item?.items)
            ? item.items
              .map((entry) => ({ label: String(entry?.label || ''), value: String(entry?.value || '') }))
              .filter((entry) => entry.label || entry.value)
            : [],
          conclusion: String(item?.conclusion || ''),
        }))
        .filter((item) => item.key || item.label || item.items.length || item.conclusion)
      : [],
    viralAnalysis: value?.viralAnalysis,
    replicationPlan: value?.replicationPlan,
    videoGenerationResult: value?.videoGenerationResult,
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function requireString(value: unknown, fieldName: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`大模型返回结构化 JSON 不完整：缺少 ${fieldName}`);
  }
  return value;
}

export function normalizeDimension(value: unknown, key: ViralAnalysisDimensionKey): ViralAnalysisDimension {
  if (!isRecord(value)) {
    throw new Error(`大模型返回结构化 JSON 不完整：缺少维度 ${key}`);
  }
  const meta = viralDimensionMeta.find((item) => item.key === key);
  if (!meta) {
    throw new Error(`未知爆款解析维度：${key}`);
  }
  return {
    key,
    label: String(value.label || meta.label),
    priority: (['P0', 'P1', 'P2', 'P3'].includes(String(value.priority)) ? value.priority : meta.priority) as ViralAnalysisDimension['priority'],
    appeared: typeof value.appeared === 'boolean' ? value.appeared : true,
    summary: typeof value.summary === 'string'
      ? value.summary
      : typeof value.skipReason === 'string'
        ? value.skipReason
        : '',
    skipReason: typeof value.skipReason === 'string' ? value.skipReason : undefined,
    evidence: Array.isArray(value.evidence) ? value.evidence.map((item) => String(item)).filter(Boolean) : [],
    details: isRecord(value.details) ? value.details : {},
  };
}

export function analysisProcessSummary(value: Partial<VideoParseResult>, key: string) {
  const section = value.analysisProcess?.find((item) => item.key === key);
  if (!section) {
    return '';
  }
  return [
    section.conclusion,
    ...section.items.map((item) => [item.label, item.value].filter(Boolean).join('：')),
  ].filter(Boolean).join('；');
}

export function inferDimensionAppeared(summary: string, fallback = true) {
  if (!summary.trim()) {
    return fallback;
  }
  return !/(未出现|没有|无PIP|无画中画|无法从当前素材判断)/i.test(summary);
}

export function createFallbackDimension(
  key: ViralAnalysisDimensionKey,
  summary: string,
  details: Record<string, unknown> = {},
  appeared = inferDimensionAppeared(summary),
): ViralAnalysisDimension {
  const meta = viralDimensionMeta.find((item) => item.key === key);
  if (!meta) {
    throw new Error(`未知爆款解析维度：${key}`);
  }
  const normalizedSummary = summary.trim() || '模型未返回该维度，已根据可用解析结果补齐结构';
  return {
    key,
    label: meta.label,
    priority: meta.priority,
    appeared,
    summary: normalizedSummary,
    skipReason: appeared ? undefined : normalizedSummary,
    evidence: summary.trim() ? [summary.trim()] : [],
    details,
  };
}

export function buildFallbackViralAnalysis(value: Partial<VideoParseResult>, sourceType: 'url' | 'prompt', sourceValue: string): ViralVideoAnalysis {
  const titleSummary = analysisProcessSummary(value, 'title');
  const personSummary = value.person || analysisProcessSummary(value, 'person');
  const sceneSummary = value.scene || analysisProcessSummary(value, 'scene');
  const voiceSummary = value.voice || analysisProcessSummary(value, 'voice');
  const cameraSummary = value.shotLanguage || analysisProcessSummary(value, 'camera');
  const productSummary = value.product || analysisProcessSummary(value, 'product');
  const pipSummary = value.pip || analysisProcessSummary(value, 'pip');
  const scriptSummary = value.spokenContent || analysisProcessSummary(value, 'script');
  const styleSummary = analysisProcessSummary(value, 'style') || value.extraDetails || '';
  const dimensions = {
    basicInfo: createFallbackDimension('basicInfo', titleSummary || sourceValue),
    formatQuality: createFallbackDimension('formatQuality', cameraSummary, { ratio: '9:16', quality: cameraSummary, style: styleSummary }),
    role: createFallbackDimension('role', personSummary, { roleType: personSummary ? 'human' : 'none' }),
    scene: createFallbackDimension('scene', sceneSummary),
    product: createFallbackDimension('product', productSummary),
    pip: createFallbackDimension('pip', pipSummary, {}, inferDimensionAppeared(pipSummary, false)),
    narrative: createFallbackDimension('narrative', scriptSummary, {
      hookFirst3Seconds: scriptSummary.slice(0, 80),
      timeline: scriptSummary ? [{ timeRange: '0-15s', beat: scriptSummary, purpose: '承接口播脚本节奏' }] : [],
      climaxTurn: '',
      ending: scriptSummary.slice(-80),
    }),
    camera: createFallbackDimension('camera', cameraSummary),
    colorLighting: createFallbackDimension('colorLighting', styleSummary || cameraSummary),
    audioMood: createFallbackDimension('audioMood', voiceSummary),
    captionCopy: createFallbackDimension('captionCopy', scriptSummary),
    interaction: createFallbackDimension('interaction', '模型未返回互动元素，当前解析结果未识别到明确互动设计', {}, false),
    cover: createFallbackDimension('cover', titleSummary || value.extraDetails || sourceValue),
    sellingPoint: createFallbackDimension('sellingPoint', productSummary || value.extraDetails || '', {
      coreValue: productSummary || value.extraDetails || '',
      proofPoints: [],
      retentionLevers: [],
    }),
    negativePrompts: createFallbackDimension('negativePrompts', value.extraDetails || '模型未返回负面禁止词，默认不追加额外禁止词', {
      people: [],
      scene: [],
      props: [],
      quality: [],
      copyCompliance: [],
    }),
  } satisfies Record<ViralAnalysisDimensionKey, ViralAnalysisDimension>;
  return {
    version: 1,
    sourceType,
    sourceValue,
    deterministicSeed: '',
    dimensions,
    role: dimensions.role as ViralVideoAnalysis['role'],
    narrative: dimensions.narrative as ViralVideoAnalysis['narrative'],
    sellingPoint: dimensions.sellingPoint as ViralVideoAnalysis['sellingPoint'],
    negativePrompts: dimensions.negativePrompts as ViralVideoAnalysis['negativePrompts'],
    createdAt: new Date().toISOString(),
  };
}

export const oneClickCloneReversePrompt = `解析这个视频，解析固定9大标准维度（强制按此顺序、逐条拆解）
1. 视频标题解析
完整标题文本（含表情、符号、关键词）、标题核心卖点、标题引流逻辑（悬念/提问/干货/热点）、标题与内容的关联性、标题中关键词布局（适配抖音搜索）、标题风格（口语化/干货式/悬念式/情感式）。
2. 人物解析
出镜人数、主次角色、身份人设、穿搭妆容、神态表情、肢体动作、互动方式、镜头表现力。
3. 场景解析
实景/布景、室内/户外、环境陈设、灯光色调、背景氛围、是否刻意布置、有无杂物写实感。
4. 人物声音解析
原声/配音/AI音、音色、语速、语气情绪、背景噪音、BGM音量、人声清晰度、方言/普通话。
5. 镜头语言解析
画幅比例、景别（远景/中景/近景/特写）、机位、运镜方式、剪辑节奏、构图、滤镜画质、镜头切换逻辑。
6. 产品/核心内容解析
核心产品/主题、品类、外观、展示方式、卖点露出、功能演示、植入方式、画面占比位置。
7. PIP画中画解析
是否有PIP、PIP内容、出现时间、位置、大小、作用、是否遮挡主画面、补充信息价值。
8. 口播&字幕文本解析
完整口播逐字文案、字幕样式（字体/颜色/大小/高亮）、字幕节奏、话术结构、开场-过渡-收尾逻辑。
9. 整体风格与网感总结
视频整体定位、内容逻辑、剪辑思维、爆款要素、氛围感、可复刻要点，标题与整体内容的适配度。

专用指令提示词：
请严格按照以下9项标准流程解析这条抖音视频，逐条精细化拆解，不遗漏任何一项：1.视频标题解析 2.人物解析 3.场景解析 4.人物声音解析 5.镜头语言解析 6.产品/核心内容解析 7.PIP画中画解析 8.口播字幕文本解析 9.整体风格网感总结。若视频无法访问、非公开、加载失败，直接回复「无法解析」，不做额外推测、不添加无关内容。`;

export async function generateOneClickCloneParseResultWithLlm(input: {
  userId: string;
  url: string;
  selectedSkills?: Array<{ id: string; command: string; name: string; category: string; scenario: string }>;
}) {
  const skillContext = input.selectedSkills?.length
    ? input.selectedSkills.map((skill) => `${skill.name}(${skill.command}): ${skill.scenario || skill.category}`).join('\n')
    : '无';
  const systemPrompt = [
    '你是视频助手短视频爆款复刻里的“一键复刻解析专家”。用户会给你一个短视频分享链接，你需要用本地大模型能力反推可用于同款视频生成的提示词。',
    '只返回 JSON，不要 markdown，不要解释。字段必须完整。',
    '如果无法读取链接里的真实视频内容，也不要声称已经看过视频；请基于链接文本、标题线索和用户要求给出可编辑的复刻初稿，并在 extraDetails 写明“当前为链接文本反推初稿，需用户确认细节”。仅当链接明显无效、非公开或无法形成任何有效线索时，才返回“无法解析”。',
    'spokenContent 必须整理成人物台词/口播内容；如果链接没有台词线索，写一版可修改的同款口播初稿。',
  ].join('\n');
  const content = await callConfiguredLlm({
    userId: input.userId,
    temperature: 0.4,
    sourceType: 'one_click_clone_parse',
    system: systemPrompt,
    sourceId: input.url,
    user: [
      `视频链接：${input.url}`,
      '',
      oneClickCloneReversePrompt,
      '',
      '# 已选技能',
      skillContext,
      '',
      '# 输出 JSON 结构',
      JSON.stringify({
        person: '人物设定：身份、人设、外貌、动作、面部表情细节',
        scene: '场景设定：空间、光线、氛围、道具',
        voice: '人物说话语气语态：音色、语速、情绪、口吻',
        shotLanguage: '运镜方式与手法、镜头景别、转场、场景切换与特效',
        product: '产品/主题/核心内容',
        pip: '画中画或辅助素材，没有则写无',
        spokenContent: '人物台词/口播文案',
        extraDetails: '复刻提示词、风险提示、需要用户确认的信息',
        analysisProcess: [
          { key: 'reverse_prompt', label: '反推提示词', items: [{ label: '场景', value: '' }], conclusion: '' },
        ],
      }, null, 2),
    ].join('\n'),
  });
  let parsedJson: Partial<VideoParseResult>;
  try {
    parsedJson = extractJsonObject<Partial<VideoParseResult>>(content);
  } catch (error) {
    logger.error('one click clone json extraction failed', {
      url: input.url,
      rawContent: content,
      error: errorLogContext(error),
    });
    throw error;
  }
  const parsed = normalizeParseResult(parsedJson);
  if (!parsed.analysisProcess?.length) {
    parsed.analysisProcess = [
      {
        key: 'reverse_prompt',
        label: '反推提示词',
        items: [
          { label: '场景', value: parsed.scene },
          { label: '人物动作与表情', value: parsed.person },
          { label: '语气语态', value: parsed.voice },
          { label: '运镜与特效', value: parsed.shotLanguage },
          { label: '人物台词', value: parsed.spokenContent },
        ].filter((item) => item.value),
        conclusion: parsed.extraDetails || '已生成可供视频生成导演继续整理的复刻初稿。',
      },
    ];
  }
  parsed.viralAnalysis = normalizeViralAnalysis(
    isRecord(parsed.viralAnalysis) ? parsed.viralAnalysis : buildFallbackViralAnalysis(parsed, 'url', input.url),
    'url',
    input.url,
  );
  return parsed;
}

export function parseResultToMarkdown(parseResult: VideoParseResult) {
  return [
    '### 反推提示词初稿',
    parseResult.extraDetails,
    '',
    `- 场景：${parseResult.scene || '待确认'}`,
    `- 人物动作与表情：${parseResult.person || '待确认'}`,
    `- 语气语态：${parseResult.voice || '待确认'}`,
    `- 运镜与特效：${parseResult.shotLanguage || '待确认'}`,
    `- 产品/主题：${parseResult.product || '待确认'}`,
    `- 画中画：${parseResult.pip || '无'}`,
    '',
    '### 人物台词',
    parseResult.spokenContent || '待补充人物台词。',
  ].filter(Boolean).join('\n');
}

export function buildOneClickCloneOutputs(parseResult: VideoParseResult) {
  const videoContent = [
    `视频标题：${parseResult.product || parseResult.extraDetails || '一键复刻视频'}`,
    `人物：${parseResult.person || '待用户确认人物细节'}`,
    `场景：${parseResult.scene || '待用户确认场景细节'}`,
    `镜头语言：${parseResult.shotLanguage || '待用户确认运镜与转场'}`,
    `产品/主题：${parseResult.product || '待用户确认核心内容'}`,
    `PIP/辅助素材：${parseResult.pip || '无'}`,
    `补充说明：${parseResult.extraDetails || '当前为链接文本反推初稿，需用户确认细节'}`,
  ].join('\n');
  const audioContent = [
    `说话语气语态：${parseResult.voice || '自然口播，语速中等，情绪贴近原视频氛围'}`,
    '口播：',
    parseResult.spokenContent || '请根据原视频风格补充人物台词。',
  ].join('\n');
  const storyboard = parseResult.analysisProcess?.length
    ? parseResult.analysisProcess.map((section) => [
      `## ${section.label || section.key}`,
      ...section.items.map((item) => `- ${item.label}：${item.value}`),
      section.conclusion,
    ].filter(Boolean).join('\n')).join('\n\n')
    : parseResultToMarkdown(parseResult);
  return {
    outputs: {
      audio_expert: {
        roleName: '音频理解专家',
        content: audioContent,
      },
      video_expert: {
        roleName: '视频理解专家',
        content: videoContent,
      },
    },
    storyboard,
  };
}

export function normalizeRoleType(value: unknown): ViralRoleType {
  const raw = String(value || '').trim().toLowerCase();
  const compact = raw.replace(/[\s_-]+/g, '');
  if (['human', 'person', 'people', '真人', '人物', '人类', '人', '女性', '男性', '女生', '男生', '主播', '达人'].includes(raw)
    || ['realperson', '真人出镜', '真人口播'].includes(compact)) {
    return 'human';
  }
  if (['animal', '动物', '宠物'].includes(raw)) {
    return 'animal';
  }
  if (['virtual_avatar', 'avatar', 'virtualavatar', '虚拟形象', '虚拟人', '数字人', '虚拟数字人', '虚拟主播'].includes(raw)
    || ['virtualavatar', 'digitalhuman'].includes(compact)) {
    return 'virtual_avatar';
  }
  if (['anthropomorphic_object', 'anthropomorphicobject', '物品拟人化', '拟人化物品', '拟人物品'].includes(raw)
    || ['anthropomorphicobject'].includes(compact)) {
    return 'anthropomorphic_object';
  }
  if (['none', 'no_role', 'norole', '无', '无角色', '没有角色', '未出现角色', '无人物', '未识别', '未检测到', '无法判断', '未从输入中识别到', '未从输入识别到', '未从内容中识别到'].includes(raw)
    || ['norole', 'notdetected', 'unknown', 'unrecognized', '未从输入中识别到', '未从输入识别到', '未检测到角色', '无法识别角色', '未识别到角色'].includes(compact)) {
    return 'none';
  }
  return 'none';
}

export function normalizeViralAnalysis(value: unknown, sourceType: 'url' | 'prompt', sourceValue: string): ViralVideoAnalysis {
  if (!isRecord(value)) {
    throw new Error('大模型返回结构化 JSON 不完整：缺少 viralAnalysis');
  }
  const rawDimensions = isRecord(value.dimensions) ? value.dimensions : {};
  const dimensions = Object.fromEntries(
    viralDimensionMeta.map((meta) => [meta.key, normalizeDimension(rawDimensions[meta.key], meta.key)]),
  ) as Record<ViralAnalysisDimensionKey, ViralAnalysisDimension>;
  const roleBase = dimensions.role as ViralVideoAnalysis['role'];
  const role = {
    ...roleBase,
    details: {
      ...roleBase.details,
      roleType: normalizeRoleType(roleBase.details.roleType),
    },
  } as ViralVideoAnalysis['role'];
  dimensions.role = role;
  const narrativeBase = dimensions.narrative as ViralVideoAnalysis['narrative'];
  const narrative = {
    ...narrativeBase,
    details: {
      ...narrativeBase.details,
      hookFirst3Seconds: String(narrativeBase.details.hookFirst3Seconds || narrativeBase.summary || ''),
      timeline: Array.isArray(narrativeBase.details.timeline) ? narrativeBase.details.timeline : [],
      climaxTurn: String(narrativeBase.details.climaxTurn || ''),
      ending: String(narrativeBase.details.ending || ''),
    },
  } as ViralVideoAnalysis['narrative'];
  dimensions.narrative = narrative;
  const sellingPointBase = dimensions.sellingPoint as ViralVideoAnalysis['sellingPoint'];
  const sellingPoint = {
    ...sellingPointBase,
    details: {
      ...sellingPointBase.details,
      coreValue: String(sellingPointBase.details.coreValue || sellingPointBase.summary || ''),
      proofPoints: Array.isArray(sellingPointBase.details.proofPoints) ? sellingPointBase.details.proofPoints : [],
      retentionLevers: Array.isArray(sellingPointBase.details.retentionLevers) ? sellingPointBase.details.retentionLevers : [],
    },
  } as ViralVideoAnalysis['sellingPoint'];
  dimensions.sellingPoint = sellingPoint;
  const negativePromptsBase = dimensions.negativePrompts as ViralVideoAnalysis['negativePrompts'];
  const negativePrompts = {
    ...negativePromptsBase,
    details: {
      ...negativePromptsBase.details,
      people: Array.isArray(negativePromptsBase.details.people) ? negativePromptsBase.details.people : [],
      scene: Array.isArray(negativePromptsBase.details.scene) ? negativePromptsBase.details.scene : [],
      props: Array.isArray(negativePromptsBase.details.props) ? negativePromptsBase.details.props : [],
      quality: Array.isArray(negativePromptsBase.details.quality) ? negativePromptsBase.details.quality : [],
      copyCompliance: Array.isArray(negativePromptsBase.details.copyCompliance) ? negativePromptsBase.details.copyCompliance : [],
    },
  } as ViralVideoAnalysis['negativePrompts'];
  dimensions.negativePrompts = negativePrompts;
  return {
    version: 1,
    sourceType,
    sourceValue,
    deterministicSeed: typeof value.deterministicSeed === 'string' ? value.deterministicSeed : '',
    dimensions,
    role,
    narrative,
    sellingPoint,
    negativePrompts,
    createdAt: typeof value.createdAt === 'string' && value.createdAt ? value.createdAt : new Date().toISOString(),
  };
}

export function normalizeStringArray(value: unknown, fieldName: string) {
  if (!Array.isArray(value)) {
    throw new Error(`大模型返回结构化 JSON 不完整：${fieldName} 必须是数组`);
  }
  return value.map((item) => String(item)).filter(Boolean);
}

export function normalizeReplicationPlan(value: unknown, input: {
  taskId: string;
  analysis: ViralVideoAnalysis;
  userBrandOrProduct?: string;
  targetPlatform?: string;
  replacementBrief?: string;
}): ViralReplicationPlan {
  if (!isRecord(value)) {
    throw new Error('大模型返回结构化 JSON 不完整：缺少 replicationPlan');
  }
  if (!Array.isArray(value.replacementItems) || !value.replacementItems.length) {
    throw new Error('大模型返回结构化 JSON 不完整：replacementItems 必须是非空数组');
  }
  if (!Array.isArray(value.voiceoverScript) || !value.voiceoverScript.length) {
    throw new Error('大模型返回结构化 JSON 不完整：voiceoverScript 必须是非空数组');
  }
  return {
    version: 1,
    taskId: input.taskId,
    targetPlatform: String(value.targetPlatform || input.targetPlatform || '未指定平台'),
    userBrandOrProduct: String(value.userBrandOrProduct || input.userBrandOrProduct || '未指定品牌/产品'),
    replacementBrief: String(value.replacementBrief || input.replacementBrief || ''),
    replacementItems: value.replacementItems.map((item, index) => {
      if (!isRecord(item)) {
        throw new Error(`大模型返回结构化 JSON 不完整：replacementItems[${index}] 必须是对象`);
      }
      const dimension = String(item.dimension) as ViralAnalysisDimensionKey;
      if (!viralDimensionMeta.some((meta) => meta.key === dimension)) {
        throw new Error(`大模型返回结构化 JSON 不完整：replacementItems[${index}].dimension 无效`);
      }
      return {
        dimension,
        label: requireString(item.label, `replacementItems[${index}].label`),
        sourceSummary: requireString(item.sourceSummary, `replacementItems[${index}].sourceSummary`),
        replacementSuggestion: requireString(item.replacementSuggestion, `replacementItems[${index}].replacementSuggestion`),
        mustKeep: requireString(item.mustKeep, `replacementItems[${index}].mustKeep`),
      };
    }),
    voiceoverScript: value.voiceoverScript.map((item, index) => {
      if (!isRecord(item)) {
        throw new Error(`大模型返回结构化 JSON 不完整：voiceoverScript[${index}] 必须是对象`);
      }
      return {
        timeRange: requireString(item.timeRange, `voiceoverScript[${index}].timeRange`),
        text: requireString(item.text, `voiceoverScript[${index}].text`),
        rhythm: requireString(item.rhythm, `voiceoverScript[${index}].rhythm`),
      };
    }),
    visualPrompt: requireString(value.visualPrompt, 'visualPrompt'),
    negativePrompts: normalizeStringArray(value.negativePrompts, 'negativePrompts'),
    keepRules: normalizeStringArray(value.keepRules, 'keepRules'),
    generatedAt: typeof value.generatedAt === 'string' && value.generatedAt ? value.generatedAt : new Date().toISOString(),
  };
}

export async function generateReplicationPlanWithLlm(input: {
  userId: string;
  taskId: string;
  analysis: ViralVideoAnalysis;
  userBrandOrProduct?: string;
  targetPlatform?: string;
  replacementBrief?: string;
}) {
  const content = await callConfiguredLlm({
    userId: input.userId,
    temperature: 0.45,
    sourceType: 'replication_plan',
    system: `你是视频助手爆款复刻替换计划专家。基于 9 项标准解析过程和结构化爆款解析结果，为用户品牌/产品生成原创复刻计划。
只返回 JSON，不要 markdown，不要解释。字段必须完整：
{
  "version": 1,
  "taskId": "${input.taskId}",
  "targetPlatform": "目标平台",
  "userBrandOrProduct": "用户品牌或产品",
  "replacementBrief": "替换目标摘要",
  "replacementItems": [
    {"dimension":"role","label":"角色","sourceSummary":"原解析摘要","replacementSuggestion":"替换建议","mustKeep":"必须保留的爆款机制"}
  ],
  "voiceoverScript": [
    {"timeRange":"0-3s","text":"原创口播","rhythm":"节奏建议"}
  ],
  "visualPrompt": "可交给视频模型的完整视觉提示词",
  "negativePrompts": ["人物异常","场景异常","道具异常","画质异常","合规风险"],
  "keepRules": ["保留前 3 秒钩子","保留关键时间节点","不照搬具体素材"],
  "generatedAt": "ISO 时间"
}
replacementItems 至少覆盖角色、场景、产品、PIP、字幕/文案、封面、音乐音效、口播文案；如果某维度无内容，需要写明跳过或可选策略。`,
    sourceId: input.taskId,
    user: JSON.stringify({
      taskId: input.taskId,
      viralAnalysis: input.analysis,
      userBrandOrProduct: input.userBrandOrProduct || '',
      targetPlatform: input.targetPlatform || '',
      replacementBrief: input.replacementBrief || '',
    }, null, 2),
  });
  return normalizeReplicationPlan(extractJsonObject<unknown>(content), input);
}
