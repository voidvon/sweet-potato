import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const baseDir = path.resolve(__dirname, '..');
const taskId = process.argv[2] || '';
const outputRoot = process.argv[3]
  ? path.resolve(process.argv[3])
  : path.join(baseDir, 'data', 'seedance-prompt-dumps');

if (!taskId) {
  throw new Error('Usage: node scripts/export-seedance-segment-prompts.mjs <taskId> [outputDir]');
}

function sqliteValue(sql) {
  return execFileSync('sqlite3', [path.join(baseDir, 'data', 'app.sqlite'), sql], {
    cwd: baseDir,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 20,
  }).trim();
}

function isRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function renderPromptTemplate(template, values) {
  return template
    .replace(/\{\{([A-Z0-9_]+)\}\}/g, (_match, key) => String(values[key] ?? ''))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeMessages(value) {
  return Array.isArray(value)
    ? value.filter(isRecord).map((item) => ({
      source: String(item.source || ''),
      content: String(item.content || ''),
    }))
    : [];
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function directorCharacterItems(director) {
  const character = isRecord(director.character) ? director.character : {};
  return Array.isArray(character.items) && character.items.length
    ? character.items.filter(isRecord)
    : [character];
}

function directorSceneItems(director) {
  const scene = isRecord(director.scene) ? director.scene : {};
  return Array.isArray(scene.items) && scene.items.length
    ? scene.items.filter(isRecord)
    : [scene];
}

function directorAudioItems(director) {
  const audio = isRecord(director.audio) ? director.audio : {};
  return Array.isArray(audio.items) && audio.items.length
    ? audio.items.filter(isRecord)
    : [audio];
}

function formatLabels(labels) {
  return labels.map((label) => `参考${label}`).join('、');
}

function buildGlobalPrompt(director, references) {
  const requiredCharacters = directorCharacterItems(director).filter((item) => item.required !== false);
  const requiredScenes = directorSceneItems(director).filter((item) => item.required !== false);
  const characterPrompt = requiredCharacters.map((item, index) => {
    const label = item.label || `人物 ${index + 1}`;
    const prompt = item.characterPrompt || item.appearance || '沿用原视频分析中的人物特征';
    if ((item.referenceMode || (item.assetId ? 'asset' : 'prompt')) !== 'asset') {
      return `${label}：\n人物描述提示词：${prompt}`;
    }
    const labels = unique([references.imageLabels.get(item.assetId), references.videoLabels.get(item.assetId)]);
    return `${label}：\n${labels.length ? `人物形象以${formatLabels(labels)}中的人物为主要参考。` : '人物形象以对应参考图片/视频中的人物为主要参考。'}${prompt ? `\n人物描述提示词：${prompt}` : ''}`;
  }).join('\n\n') || '不需要固定人物设定。';
  const scenePrompt = requiredScenes.map((item, index) => {
    const label = item.label || `场景 ${index + 1}`;
    if ((item.referenceMode || (item.assetId || item.groupId ? 'asset' : 'prompt')) !== 'asset') {
      return `${label}：\n场景描述：${item.description || '沿用原视频拆解中的场景氛围，包含光线氛围与视觉风格'}`;
    }
    const labels = unique([references.imageLabels.get(item.assetId), references.videoLabels.get(item.assetId), references.imageGroupLabels.get(item.groupId)]);
    return `${label}：\n${labels.length ? `场景环境只以${formatLabels(labels)}中的场景为准，不使用场景提示词；如果镜头脚本里出现与参考场景不一致的旧场景描述，必须忽略旧场景描述。` : '场景环境只以对应参考图片/视频中的场景为准，不使用场景提示词；如果镜头脚本里出现与参考场景不一致的旧场景描述，必须忽略旧场景描述。'}`;
  }).join('\n\n') || '不需要固定场景设定。';
  const product = isRecord(director.product) ? director.product : {};
  const hasProductPrompt = Boolean(product.description || product.presentation || product.assetId || product.groupId);
  const productPrompt = product.noProduct || !hasProductPrompt
    ? '不需要产品展示，不要强行加入商品、包装或产品特写。'
    : `产品描述：${product.description || '根据原视频产品信息组织画面'}\n展示方式：${product.presentation || '通过近景、手部动作和对比镜头展示重点卖点'}`;
  const audio = isRecord(director.audio) ? director.audio : {};
  const audioPrompt = directorAudioItems(director).map((item, index) => {
    const label = item.characterLabel || item.label || `声音 ${index + 1}`;
    return `${label}：${item.voice || audio.voice || '原声'}；${item.voiceStyle || audio.voiceStyle || '自然清晰，中等语速，不抢拍、不加速'}`;
  }).join('\n') || `声音策略：${audio.voice || '原声'}`;
  return renderPromptTemplate(`
请生成一支可复刻爆款结构的短视频，标题为「{{TITLE}}」。
画幅比例：{{ASPECT_RATIO}}；目标清晰度：{{RESOLUTION}}。

# 画面文字规则（最高优先级）
生成纯画面视频。画面必须保持干净，不添加任何可读文字、文字浮层、标识、来源标记或界面元素。
人声只走音轨，不进入画面。允许的新增画面文字：无。

# 人物
{{CHARACTER_PROMPT}}

# 场景
{{SCENE_PROMPT}}

# 产品
{{PRODUCT_PROMPT}}

# 音频
{{AUDIO_PROMPT}}
语速硬性要求：中等自然语速，咬字清晰，不要为了适配时长而加速；每秒中文约 4 个字以内。
人声硬性要求：只能朗读已确认的音频白名单内容；严禁新增拜拜、再见、下期见、关注我、点赞关注、记得收藏等结束语或行动号召。
BGM：{{BGM_PROMPT}}
音效：{{SOUND_EFFECTS_PROMPT}}
`, {
    TITLE: director.basic?.title || '未命名视频',
    ASPECT_RATIO: director.basic?.aspectRatio || '9:16',
    RESOLUTION: director.basic?.resolution || '720p',
    CHARACTER_PROMPT: characterPrompt,
    SCENE_PROMPT: scenePrompt,
    PRODUCT_PROMPT: productPrompt,
    AUDIO_PROMPT: audioPrompt,
    BGM_PROMPT: audio.bgm || '轻快但不压过人声',
    SOUND_EFFECTS_PROMPT: audio.soundEffects || '根据镜头动作补充轻微环境音和转场音效',
  });
}

function normalizeHeading(line) {
  return line
    .replace(/^#{1,6}\s*/, '')
    .replace(/^[-*]\s*/, '')
    .replace(/^\*+/, '')
    .replace(/\*+$/g, '')
    .replace(/^\*\*/, '')
    .replace(/\*\*$/g, '')
    .trim();
}

function normalizeVisualLine(line) {
  return line
    .replace(/说到“[^”]+”时/g, '关键表达时')
    .replace(/念到“[^”]+”时/g, '关键表达时')
    .replace(/表达“[^”]+”/g, '表达对应情绪')
    .replace(/仿佛在列举“[^”]+”/g, '做列举动作')
    .replace(/“[^”]+”/g, '对应内容')
    .replace(/台词/g, '人声')
    .replace(/旁白/g, '人声')
    .replace(/口播/g, '人声');
}

function parseStoryboardBlockContent(block, shotLabel, start, end) {
  let section = '';
  const visualLines = [`${shotLabel}｜${start}-${end}秒`];
  const speechLines = [];
  const pushVisual = (line) => {
    const normalized = normalizeVisualLine(line.replace(/^[-*]\s*/, '').trim());
    if (normalized) visualLines.push(normalized);
  };
  for (const raw of block.split('\n')) {
    const line = raw.trim();
    const heading = normalizeHeading(line);
    if (!line || /^```/.test(line)) continue;
    if (/^镜头\s*\d+/.test(heading)) continue;
    if (/^画面\s*[：:]?$/.test(heading)) {
      section = 'visual';
      visualLines.push('画面：');
      continue;
    }
    if (/^(?:人物\/动作|人物动作|动作)\s*[：:]?$/.test(heading)) {
      section = 'action';
      visualLines.push('人物/动作：');
      continue;
    }
    if (/^音效\s*[：:]?$/.test(heading)) {
      section = 'sound';
      visualLines.push('音效：');
      continue;
    }
    const inlineSpeech = heading.match(/^(?:台词\/旁白|台词|旁白|口播|人声|人声内容)(?:\/人声)?\s*[：:]\s*(.+)$/);
    if (inlineSpeech) {
      section = 'speech';
      speechLines.push(inlineSpeech[1].trim());
      continue;
    }
    if (/^(?:台词\/旁白|台词|旁白|口播|人声|人声内容)(?:\/人声)?\s*[：:]?$/.test(heading)) {
      section = 'speech';
      continue;
    }
    if (/^(?:复刻建议|字幕|字幕样式|文案)\s*[：:]?$/.test(heading)) {
      section = 'blocked';
      continue;
    }
    if (section === 'visual' || section === 'action' || section === 'sound') {
      pushVisual(line);
    } else if (section === 'speech') {
      speechLines.push(line.replace(/^[-*]\s*/, ''));
    }
  }
  return {
    visualText: visualLines.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
    speechText: speechLines.join('\n').trim(),
  };
}

function hydrateSegmentPlan(segmentPlan) {
  return segmentPlan.map((group) => ({
    ...group,
    ranges: (group.ranges || []).map((range) => {
      if (range.visualText !== undefined && range.speechText !== undefined) {
        return range;
      }
      const parsed = parseStoryboardBlockContent(range.text || '', range.shotLabel, range.start, range.end);
      return {
        start: range.start,
        end: range.end,
        shotLabel: range.shotLabel,
        visualText: parsed.visualText,
        speechText: parsed.speechText,
      };
    }),
  }));
}

function formatRangesVisual(ranges) {
  return ranges.map((range) => range.visualText).filter(Boolean).join('\n');
}

function formatRangesSpeech(ranges) {
  return ranges.map((range) => range.speechText).filter(Boolean).join('\n');
}

function formatRangesSummary(ranges) {
  return ranges.map((range) => `${range.shotLabel}（${range.start}-${range.end} 秒）`).join('、');
}

function clamp(text, maxChars) {
  const normalized = text.replace(/\n{3,}/g, '\n\n').trim();
  if (!normalized || normalized.length <= maxChars) return normalized;
  const sliced = normalized.slice(0, maxChars);
  const lastBreak = sliced.lastIndexOf('\n');
  const safe = lastBreak > Math.floor(maxChars * 0.6) ? sliced.slice(0, lastBreak) : sliced;
  return `${safe.trim()}\n（其余细节按同一镜头节奏自然延续，不新增画面文字。）`;
}

function speechSeconds(text) {
  const normalized = text.replace(/\s+/g, '').replace(/[，,。.!！?？；;：:“”"‘’'、（）()[\]{}<>《》]/g, '');
  return normalized ? Math.ceil(normalized.length / 4) : 0;
}

function buildSegmentPrompt(input) {
  const plan = input.segmentPlan[input.segmentIndex - 1];
  const previous = input.segmentPlan[input.segmentIndex - 2];
  const next = input.segmentPlan[input.segmentIndex];
  const fixedSpeech = formatRangesSpeech(plan.ranges);
  const speechBudget = speechSeconds(fixedSpeech);
  const overBudgetSpeechLine = speechBudget > plan.seconds
    ? '音频内容长于本段时长时，宁可自然截短或留到后续段，不要加速，不要把未读内容转成画面元素。'
    : '按自然语速朗读，不加速、不续写。';
  const audioContract = fixedSpeech
    ? `${fixedSpeech}\n估算自然语速约 ${speechBudget} 秒；本段约 ${plan.seconds} 秒。${overBudgetSpeechLine}`
    : '无固定人声；只保留环境音、动作音或转场音，不临时补人声。';
  const shots = formatRangesSummary(plan.ranges);
  const currentSection = [
    '# 本段生成合同',
    `画面任务：第 ${input.segmentIndex}/${input.segments.length} 段，${plan.start}-${plan.end} 秒，只生成${shots}。`,
    clamp(formatRangesVisual(plan.ranges), 900) || '本段按已确认场景与人物生成自然动作，画面无新增可读文字。',
    '',
    '音频白名单：',
    audioContract,
    '',
    '边界：',
    previous ? `上一段已完成，不回放：${formatRangesSummary(previous.ranges)}` : '无上一段。',
    next ? `下一段稍后生成，不提前：${formatRangesSummary(next.ranges)}` : '无下一段。',
    '',
    '画面要求：保持真实拍摄感，画面内无新增可读文字、标识、来源标记或界面元素；禁止朗读白名单外内容或新增结尾口号。',
  ].join('\n');
  return renderPromptTemplate(`
{{GLOBAL_PROMPT}}

{{CURRENT_STORYBOARD_SECTION}}

# 分段边界
这是第 {{SEGMENT_INDEX}}/{{SEGMENT_COUNT}} 个分镜分段。本段只生成 {{SHOTS}}，时长约 {{SECONDS}} 秒。
分段依据：严格只按分镜脚本镜头边界切分；短镜头可以按顺序合并成同一段，但不得拆普通镜头、不得跳镜头、不得按固定时间尺重新切片。
只生成本段内容；不要生成 {{SEGMENT_START}} 秒之前或 {{SEGMENT_END}} 秒之后的任何镜头、动作或声音内容。
不要从头重拍整条视频，不复述上一段，不提前生成下一段。
{{OPENING_RULE}}
{{ENDING_RULE}}
每段生成后会按顺序直接拼接，请保证边界连续、动作递进、内容不重叠。
`, {
    GLOBAL_PROMPT: input.basePrompt,
    CURRENT_STORYBOARD_SECTION: currentSection,
    SEGMENT_INDEX: input.segmentIndex,
    SEGMENT_COUNT: input.segments.length,
    SHOTS: shots,
    SECONDS: plan.seconds,
    SEGMENT_START: plan.start,
    SEGMENT_END: plan.end,
    OPENING_RULE: input.segmentIndex === 1
      ? '第 1 段负责自然开场，但不要在结尾做全片收束。'
      : '本段开头必须直接承接上一段之后的新动作/新镜头，不要出现重新举杯、重新展示、重新进入场景、重新开场等回放式画面。',
    ENDING_RULE: input.segmentIndex === input.segments.length
      ? '最后一段只允许按音频白名单自然结束；如果白名单里没有拜拜、再见、关注、下期见等结束语，严禁自行补结束语。'
      : '本段结尾保持动作向下一段自然延续，不要定格成最终尾帧，不要重复下一段将要发生的动作。',
  });
}

const row = sqliteValue(`SELECT json_object('id', id, 'userId', user_id, 'title', title, 'expertContext', expert_context) FROM video_generation_tasks WHERE id='${taskId.replaceAll("'", "''")}';`);
if (!row) {
  throw new Error(`Video task not found: ${taskId}`);
}
const task = JSON.parse(row);
const expertContext = JSON.parse(task.expertContext || '{}');
const understanding = expertContext.viralUnderstanding || {};
const director = understanding.directorConfirmed || understanding.directorDraft;
const messages = normalizeMessages(understanding.conversationMessages);
const storyboard = messages.find((item) => item.source === 'storyboard_final')?.content || '';
const state = expertContext.videoGenerationSegments;
if (!isRecord(director) || !isRecord(state) || !Array.isArray(state.segments) || !Array.isArray(state.segmentPlan)) {
  throw new Error(`Task ${taskId} does not have director data and segmented generation state`);
}
state.segmentPlan = hydrateSegmentPlan(state.segmentPlan);
const references = {
  imageLabels: new Map(),
  videoLabels: new Map(),
  imageGroupLabels: new Map(),
};
const basePrompt = buildGlobalPrompt(director, references);
const outputDir = path.join(outputRoot, taskId);
await mkdir(outputDir, { recursive: true });
const negativePrompts = [
  ...(state.request?.negativePrompts || []),
  '口播字幕',
  '自动字幕',
  '歌词字幕',
  '人物字幕',
  '对白字幕',
  '旁白字幕',
  '台词字幕',
  '中文字幕',
  '英文字幕',
  'caption',
  'captions',
  'subtitle',
  'subtitles',
  'closed captions',
  'burned-in captions',
  'hardcoded subtitles',
  'transcript overlay',
  'speech-to-text overlay',
  '屏幕文字',
  '屏幕大字',
  '标题条',
  '贴纸文字',
  '角标说明',
  'UI 文案',
  '文字浮层',
  '台词文字浮层',
  '逐字稿',
  '对白文字',
  '旁白文字',
  '弹幕',
  '水印',
  '无关 Logo',
  '新增 Logo',
  '拜拜',
  '再见',
  '下期见',
  '关注我',
  '点赞关注',
  '分段开头重复上一段结尾',
  '分段内容重叠',
];
const files = [];
for (let index = 0; index < state.segments.length; index += 1) {
  const segmentIndex = index + 1;
  const prompt = buildSegmentPrompt({
    basePrompt,
    segments: state.segments,
    segmentPlan: state.segmentPlan,
    segmentIndex,
  });
  const plan = state.segmentPlan[index];
  const payload = {
    taskId,
    sourceVideo: expertContext.uploadedVideo,
    title: `${director.basic?.title || task.title}-片段${segmentIndex}`,
    segmentIndex,
    segmentCount: state.segments.length,
    duration: `${Math.round(state.segments[index])}秒`,
    seconds: state.segments[index],
    ratio: state.request?.ratio,
    providerId: state.request?.providerId,
    modelId: state.request?.modelId,
    timeRange: { start: plan.start, end: plan.end },
    shots: plan.ranges?.map((range) => range.shotLabel) || [],
    prompt,
    negativePrompts,
    promptChars: prompt.length,
    negativePromptCount: negativePrompts.length,
  };
  const fileName = `segment-${String(segmentIndex).padStart(2, '0')}.json`;
  await writeFile(path.join(outputDir, fileName), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  files.push(fileName);
}
await writeFile(path.join(outputDir, 'manifest.json'), `${JSON.stringify({
  taskId,
  title: director.basic?.title || task.title,
  sourceVideo: expertContext.uploadedVideo?.filePath,
  storyboardChars: storyboard.length,
  basePromptChars: basePrompt.length,
  outputDir,
  segmentCount: state.segments.length,
  files,
  generatedAt: new Date().toISOString(),
}, null, 2)}\n`, 'utf8');
console.log(outputDir);
