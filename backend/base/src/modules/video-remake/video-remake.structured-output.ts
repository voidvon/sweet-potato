import { StructuredOutputParser } from '@langchain/core/output_parsers';
import { jsonrepair } from 'jsonrepair';
import { z } from 'zod';

export const zUnknownRecord = z.record(z.string(), z.unknown());

const zCoercedNumber = z.coerce.number().refine((value) => Number.isFinite(value), {
  message: 'Expected a finite number',
});

const zLooseSettingItem = z.object({
  label: z.string().optional(),
  description: z.string().optional(),
  appearance: z.string().optional(),
  characterPrompt: z.string().optional(),
  gesture: z.string().optional(),
  expression: z.string().optional(),
  environment: z.string().optional(),
  props: z.string().optional(),
  lighting: z.string().optional(),
  composition: z.string().optional(),
  camera: z.string().optional(),
  atmosphere: z.string().optional(),
  startSecond: zCoercedNumber.optional(),
  endSecond: zCoercedNumber.optional(),
  spokenCue: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  required: z.boolean().optional(),
  referenceMode: z.string().optional(),
}).catchall(z.unknown());

export const zDirectorNormalizeSchema = z.object({
  basicInfo: zUnknownRecord.optional(),
  expertAnalysis: zUnknownRecord.optional(),
  characterSetting: z.object({
    items: z.array(zLooseSettingItem).optional(),
  }).catchall(z.unknown()).optional(),
  sceneSetting: z.object({
    items: z.array(zLooseSettingItem).optional(),
  }).catchall(z.unknown()).optional(),
  productSetting: zUnknownRecord.optional(),
  pipSetting: z.object({
    summary: z.string().optional(),
    appeared: z.boolean().optional(),
    items: z.array(zUnknownRecord).optional(),
  }).catchall(z.unknown()).optional(),
  voiceAudioSetting: z.object({
    voice: z.string().optional(),
    voiceStyle: z.string().optional(),
    bgm: z.string().optional(),
    soundEffects: z.string().optional(),
    items: z.array(zUnknownRecord).optional(),
  }).catchall(z.unknown()).optional(),
  scriptContent: z.object({
    content: z.string().optional(),
    source: z.string().optional(),
  }).catchall(z.unknown()).optional(),
}).catchall(z.unknown());

export const zStoryboardShotSchema = z.object({
  index: zCoercedNumber.optional(),
  label: z.string().optional(),
  startTime: zCoercedNumber.optional(),
  endTime: zCoercedNumber.optional(),
  startSecond: zCoercedNumber.optional(),
  endSecond: zCoercedNumber.optional(),
  visualDescription: z.string().optional(),
  visual: z.string().optional(),
  description: z.string().optional(),
  actionDescription: z.string().optional(),
  action: z.string().optional(),
  characterAction: z.string().optional(),
  narration: z.string().optional(),
  script: z.string().optional(),
  dialogue: z.string().optional(),
  soundEffect: z.string().optional(),
  audio: z.string().optional(),
  remakeSuggestion: z.string().optional(),
  suggestion: z.string().optional(),
  reproductionSuggestion: z.string().optional(),
  seedancePromptHints: z.object({
    characterBaseState: z.string().optional(),
    keyActionChange: z.string().optional(),
    keyActionChanges: z.array(z.string()).optional(),
    shootingTip: z.string().optional(),
    shootingTips: z.array(z.string()).optional(),
    visualSummary: z.string().optional(),
  }).catchall(z.unknown()).optional(),
}).catchall(z.unknown());

export const zStoryboardSchema = z.object({
  shots: z.array(zStoryboardShotSchema).optional(),
  items: z.array(zStoryboardShotSchema).optional(),
  storyboard: z.array(zStoryboardShotSchema).optional(),
}).catchall(z.unknown());

export type VideoRemakeDirectorStructuredOutput = z.infer<typeof zDirectorNormalizeSchema>;
export type VideoRemakeStoryboardStructuredShot = z.infer<typeof zStoryboardShotSchema>;

function usefulText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function finiteRoundedSecond(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : fallback;
}

function parseStructuredOutput<T extends z.ZodTypeAny>(schema: T, content: string) {
  const parser = StructuredOutputParser.fromZodSchema(schema);
  return parser.parse(content);
}

function parseJsonLike(value: string) {
  const normalized = value.trim().replace(/^```(?:json)?/iu, '').replace(/```$/u, '').trim();
  const arrayMatch = normalized.match(/\[[\s\S]*\]/u);
  const objectMatch = normalized.match(/\{[\s\S]*\}/u);
  const match = normalized.startsWith('[') ? arrayMatch || objectMatch : objectMatch || arrayMatch;
  if (!match) {
    throw new Error('大模型未返回 JSON');
  }
  try {
    return JSON.parse(match[0]) as unknown;
  } catch {
    return JSON.parse(jsonrepair(match[0])) as unknown;
  }
}

function fieldFromStoryboardBlock(block: string, label: string) {
  const fieldLabels = '时间段|画面|人物/动作|人物动作|动作|台词/旁白|台词|旁白|口播|人声|音效|复刻建议';
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const pattern = new RegExp(`(?:^|\\n)\\s*(?:(?:[-*]\\s*)?${escapedLabel}\\s*[:：]|#{1,6}\\s*${escapedLabel}\\s*)\\s*\\n?([\\s\\S]*?)(?=\\n\\s*(?:(?:[-*]\\s*)?(?:${fieldLabels})\\s*[:：]|#{1,6}\\s*(?:${fieldLabels})\\s*(?:\\n|$))|$)`, 'u');
  return block.match(pattern)?.[1]?.trim() || '';
}

function stripNestedStoryboardFields(value: string, options?: { keepSpeechLabels?: boolean }) {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => {
      if (options?.keepSpeechLabels && /^(?:[-*]\s*)?(?:口播|台词|旁白(?:\s*\d+)?|人物\s*[A-Za-z\d一二三四五六七八九十]+|角色\s*[A-Za-z\d一二三四五六七八九十]+|男声|女声|主持人|采访者|被访者)\s*[：:]/u.test(line)) {
        return true;
      }
      return !/^(?:[-*]\s*)?(?:画面|人物\/动作|人物动作|动作|台词\/旁白|台词|旁白|口播|人声|音效|复刻建议)\s*[：:]/u.test(line);
    })
    .join('\n')
    .trim();
}

export function stripStoryboardEntityDetailBlocks(value: string) {
  const lines = value.split('\n');
  const result: string[] = [];
  let skippingEntityBlock = false;
  const isEntityHeading = (line: string) => /^(?:人物|角色|场景|产品|画中画)\s*[A-Za-z\d一二三四五六七八九十]*\s*[：:]/u.test(line.trim());
  const isEntityDetailLine = (line: string) => /^(?:人物描述|场景描述|产品描述|外观|动作|表情|气质|声线|环境|环境布置|拍摄地点|空间层次|光线氛围|灯光|构图|机位|氛围|道具|适用时间|时间范围|口播线索|对应口播|语境线索|关键词)\s*[：:]/u.test(line.trim());
  for (const line of lines) {
    const trimmed = line.trim();
    if (isEntityDetailLine(trimmed)) {
      continue;
    }
    if (isEntityHeading(trimmed)) {
      skippingEntityBlock = true;
      continue;
    }
    if (skippingEntityBlock) {
      if (isEntityDetailLine(trimmed)) {
        continue;
      }
      skippingEntityBlock = false;
    }
    result.push(line);
  }
  return result.join('\n').trim();
}

export function sanitizeStoryboardRemakeSuggestion(value: string) {
  return stripStoryboardEntityDetailBlocks(stripNestedStoryboardFields(value))
    .split(/\n|[。；;]/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^(?:人物|角色|场景|产品|画中画|环境|环境布置|拍摄地点|空间层次|光线氛围|灯光|构图|机位|氛围|道具|外观|动作|表情|气质|声线|人物描述|场景描述|产品描述)\s*[A-Za-z\d一二三四五六七八九十]*\s*[：:]/u.test(line))
    .filter((line) => !/(?:适用时间|时间范围|口播线索|对应口播|语境线索|关键词)\s*[：:]/u.test(line))
    .filter((line) => !/上一(?:镜头|段|个镜头)|上一个镜头|前一(?:镜头|段)/u.test(line))
    .filter((line) => !/保持(?:机位|光线参数|拍摄参数|参数|镜头参数|画面参数)(?:统一|一致|不变)?/u.test(line))
    .filter((line) => !/不要切换景别|不(?:要|需)切换景别|避免人物?出现大幅度?位移|人物不要出现大幅度?位移/u.test(line))
    .join('\n');
}

export function normalizeVideoRemakeStructuredStoryboardShots(shots: VideoRemakeStoryboardStructuredShot[]) {
  return shots.map((shot, index) => {
    const shotIndex = Number(shot.index) || index + 1;
    const startTime = finiteRoundedSecond(shot.startTime ?? shot.startSecond);
    const endTime = Math.max(startTime + 1, finiteRoundedSecond(shot.endTime ?? shot.endSecond, startTime + 1));
    return {
      shotId: `shot_${shotIndex}`,
      index: shotIndex,
      label: shot.label?.trim() || `镜头 ${shotIndex}`,
      startTime,
      endTime,
      duration: Math.max(1, endTime - startTime),
      visualDescription: stripStoryboardEntityDetailBlocks(stripNestedStoryboardFields(usefulText(shot.visualDescription) || usefulText(shot.visual) || usefulText(shot.description))),
      actionDescription: stripStoryboardEntityDetailBlocks(stripNestedStoryboardFields(usefulText(shot.actionDescription) || usefulText(shot.action) || usefulText(shot.characterAction))),
      narration: stripNestedStoryboardFields(usefulText(shot.narration) || usefulText(shot.script) || usefulText(shot.dialogue), { keepSpeechLabels: true }),
      soundEffect: stripNestedStoryboardFields(usefulText(shot.soundEffect) || usefulText(shot.audio)),
      remakeSuggestion: sanitizeStoryboardRemakeSuggestion(usefulText(shot.remakeSuggestion) || usefulText(shot.suggestion) || usefulText(shot.reproductionSuggestion)),
      seedancePromptHints: shot.seedancePromptHints,
      seedanceReady: true,
      source: 'llm_storyboard',
    };
  }).filter((shot) => (
    Number.isFinite(shot.startTime)
    && Number.isFinite(shot.endTime)
    && shot.endTime > shot.startTime
    && (shot.visualDescription || shot.narration || shot.remakeSuggestion)
  ));
}

export function parseVideoRemakeStoryboardMarkdown(content: string) {
  const normalized = content.replace(/[－—–~～至到]/gu, '-').trim();
  if (!normalized) {
    return [];
  }
  const headingPattern = /(?:^|\n)\s*#{1,4}\s*镜头\s*(\d+)[^\n]*?(\d+(?:\.\d+)?)\s*(?:秒|s)?\s*[-|｜]\s*(\d+(?:\.\d+)?)\s*(?:秒|s)?[^\n]*/giu;
  const matches = Array.from(normalized.matchAll(headingPattern));
  if (!matches.length) {
    return [];
  }

  return matches.map((match, index) => {
    const startOffset = match.index || 0;
    const endOffset = matches[index + 1]?.index ?? normalized.length;
    const block = normalized.slice(startOffset, endOffset).trim();
    const startTime = finiteRoundedSecond(match[2]);
    const endTime = Math.max(startTime + 1, finiteRoundedSecond(match[3], startTime + 1));
    const shotIndex = Number(match[1]) || index + 1;
    const visualDescription = stripStoryboardEntityDetailBlocks(stripNestedStoryboardFields(fieldFromStoryboardBlock(block, '画面')));
    const actionDescription = stripStoryboardEntityDetailBlocks(stripNestedStoryboardFields(fieldFromStoryboardBlock(block, '人物/动作')
      || fieldFromStoryboardBlock(block, '人物动作')
      || fieldFromStoryboardBlock(block, '动作')));
    const narration = stripNestedStoryboardFields(fieldFromStoryboardBlock(block, '台词/旁白')
      || fieldFromStoryboardBlock(block, '台词')
      || fieldFromStoryboardBlock(block, '旁白'), { keepSpeechLabels: true });
    const soundEffect = stripNestedStoryboardFields(fieldFromStoryboardBlock(block, '音效'));
    const remakeSuggestion = sanitizeStoryboardRemakeSuggestion(fieldFromStoryboardBlock(block, '复刻建议'));
    return {
      shotId: `shot_${shotIndex}`,
      index: shotIndex,
      label: `镜头 ${shotIndex}`,
      startTime,
      endTime,
      duration: Math.max(1, endTime - startTime),
      visualDescription,
      actionDescription,
      narration,
      soundEffect,
      remakeSuggestion,
      seedanceReady: true,
      source: 'llm_storyboard',
    };
  }).filter((shot) => (
    Number.isFinite(shot.startTime)
    && Number.isFinite(shot.endTime)
    && shot.endTime > shot.startTime
    && (shot.visualDescription || shot.narration || shot.remakeSuggestion)
  ));
}

export async function parseVideoRemakeDirectorStructuredOutput(content: string) {
  return parseStructuredOutput(zDirectorNormalizeSchema, content);
}

export async function parseVideoRemakeStoryboardOutput(content: string) {
  try {
    const parsed = await parseStructuredOutput(zStoryboardSchema, content);
    return normalizeVideoRemakeStructuredStoryboardShots(parsed.shots || parsed.items || parsed.storyboard || []);
  } catch {
    try {
      const parsed = parseJsonLike(content);
      const candidate = Array.isArray(parsed)
        ? parsed
        : typeof parsed === 'object' && parsed !== null
          ? (parsed as { shots?: unknown; items?: unknown; storyboard?: unknown }).shots
            || (parsed as { items?: unknown }).items
            || (parsed as { storyboard?: unknown }).storyboard
          : [];
      const shots = z.array(zStoryboardShotSchema).parse(candidate);
      const normalized = normalizeVideoRemakeStructuredStoryboardShots(shots);
      if (normalized.length) {
        return normalized;
      }
    } catch {
      // Fall through to legacy markdown parser.
    }
    return parseVideoRemakeStoryboardMarkdown(content);
  }
}
