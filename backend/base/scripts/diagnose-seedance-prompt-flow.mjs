import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const baseDir = path.resolve(__dirname, '..');
const taskId = process.argv[2] || '';
const shouldRegenerate = process.argv.includes('--regenerate');
const outputRootArg = process.argv.find((arg) => arg.startsWith('--out='));
const outputRoot = outputRootArg
  ? path.resolve(outputRootArg.slice('--out='.length))
  : path.join(baseDir, 'data', 'seedance-prompt-diagnostics');

if (!taskId) {
  throw new Error('Usage: node scripts/diagnose-seedance-prompt-flow.mjs <taskId> [--regenerate] [--out=<dir>]');
}

const [
  { contentRepository },
  videoGeneration,
  viralDirector,
] = await Promise.all([
  import('../dist/modules/content/content.repository.js'),
  import('../dist/modules/content/internals/content-video-generation.js'),
  import('../dist/modules/content/internals/content-viral-director.js'),
]);

function isRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeMessages(value) {
  return viralDirector.normalizeViralConversationMessages(value);
}

function subtitleRiskTerms() {
  return [
    '字幕',
    '口播文字',
    '台词文字',
    '逐字稿',
    '标题条',
    '文字浮层',
    '屏幕文字',
    'caption',
    'subtitle',
    'transcript',
  ];
}

function promptRiskReport(prompt) {
  const terms = subtitleRiskTerms();
  const lines = prompt.split('\n');
  return terms.flatMap((term) => lines
    .map((line, index) => ({ line, lineNumber: index + 1 }))
    .filter((item) => item.line.toLowerCase().includes(term.toLowerCase()))
    .map((item) => ({
      term,
      lineNumber: item.lineNumber,
      line: item.line,
      allowed: /不要|禁止|不添加|无新增|只作为音轨|画面内不要|保持干净/.test(item.line),
    })));
}

function danglingContrastItems(text) {
  const normalized = text.trim();
  if (!normalized) {
    return [];
  }
  const units = normalized
    .split(/[\n，,、。！？!?；;]+/u)
    .map((item) => item.trim())
    .filter(Boolean);
  return units.filter((unit) => /^不要/.test(unit) && !/，?要.+/.test(unit));
}

function sentenceEndOk(text) {
  return danglingContrastItems(text).length === 0;
}

function segmentSpeechReport(segmentGroups) {
  return segmentGroups.map((group) => {
    const speech = group.ranges.map((range) => range.speechText || '').filter(Boolean).join('\n').trim();
    return {
      segmentIndex: group.segmentIndex,
      range: `${group.start}-${group.end}`,
      seconds: group.seconds,
      shots: group.ranges.map((range) => range.shotLabel),
      speechChars: speech.length,
      speechSeconds: videoGeneration.estimatedChineseSpeechSeconds(speech),
      sentenceEndOk: sentenceEndOk(speech),
      danglingContrastItems: danglingContrastItems(speech),
      speechPreview: speech.slice(0, 160),
    };
  });
}

const task = contentRepository.findVideoTask(taskId);
if (!task) {
  throw new Error(`Video task not found: ${taskId}`);
}

const understanding = isRecord(task.expertContext?.viralUnderstanding) ? task.expertContext.viralUnderstanding : {};
const outputs = viralDirector.normalizeUnderstandingOutputs(understanding.outputs);
const director = viralDirector.normalizeViralDirectorData(understanding.directorConfirmed || understanding.directorDraft, task, outputs);
const existingStoryboard = normalizeMessages(understanding.conversationMessages)
  .find((item) => item.source === 'storyboard_final')?.content || '';

const storyboard = shouldRegenerate
  ? await viralDirector.buildTimedStoryboardForDirector({
    task,
    director,
    outputs,
    targetSeconds: viralDirector.resolveDirectorRequestedDurationSeconds({
      task,
      director,
      outputs,
      storyboard: existingStoryboard,
    }),
  })
  : existingStoryboard;

if (!storyboard.trim()) {
  throw new Error(`Task ${taskId} has no storyboard_final message`);
}

const references = viralDirector.directorAssetReferences({ userId: task.userId, director });
const hasCharacterAsset = viralDirector.directorCharacterItems(director)
  .some((item) => item.required !== false && (item.referenceMode || (item.assetId ? 'asset' : 'prompt')) === 'asset' && Boolean(item.assetId));
const hasSceneAsset = viralDirector.directorSceneItems(director)
  .some((item) => item.required !== false && (item.referenceMode || (item.assetId || item.groupId ? 'asset' : 'prompt')) === 'asset' && Boolean(item.assetId || item.groupId));
const hasProductAsset = Boolean((director.product.assetId || director.product.groupId) && !director.product.noProduct && (director.product.referenceMode || (director.product.assetId || director.product.groupId ? 'asset' : 'prompt')) === 'asset');
const hasAudioAsset = viralDirector.directorAudioItems(director).some((item) => Boolean(item.assetId || item.groupId) && item.voice !== '不生成');
const globalPrompt = viralDirector.buildViralSeedanceGlobalPrompt({
  userId: task.userId,
  director,
  storyboard,
  references,
  hasCharacterAsset,
  hasSceneAsset,
  hasProductAsset,
  hasAudioAsset,
});
const fullPrompt = viralDirector.buildViralSeedancePrompt({
  userId: task.userId,
  director,
  storyboard,
  references,
  hasCharacterAsset,
  hasSceneAsset,
  hasProductAsset,
  hasAudioAsset,
});

const durationSeconds = viralDirector.resolveDirectorRequestedDurationSeconds({ task, director, outputs, storyboard });
const duration = videoGeneration.formatDurationLabel(durationSeconds);
const providerId = 'volcengine-seedance';
const modelId = 'doubao-seedance-2-0-260128';
const durationLimit = videoGeneration.seedanceGenerationDurationLimit({ providerId, modelId, duration });
const segmentGroups = await videoGeneration.buildStrictStoryboardSegmentGroups({
  taskId,
  traceId: `diagnose-${Date.now()}`,
  totalSeconds: durationLimit.requestedSeconds,
  maxSegmentSeconds: durationLimit.maxSeconds,
  storyboard,
});
const segments = segmentGroups.map((group) => group.seconds);
const outputDir = path.join(outputRoot, taskId, new Date().toISOString().replace(/[:.]/g, '-'));
await mkdir(outputDir, { recursive: true });

const segmentReports = [];
for (let index = 0; index < segments.length; index += 1) {
  const segmentIndex = index + 1;
  const prompt = videoGeneration.buildSegmentedSeedancePrompt({
    basePrompt: globalPrompt,
    totalSeconds: durationLimit.requestedSeconds,
    segments,
    segmentIndex,
    maxSegmentSeconds: durationLimit.maxSeconds,
    segmentPlan: segmentGroups,
    storyboard,
  });
  const risk = promptRiskReport(prompt);
  const group = segmentGroups[index];
  const speech = group.ranges.map((range) => range.speechText || '').filter(Boolean).join('\n').trim();
  const payload = {
    taskId,
    segmentIndex,
    segmentCount: segments.length,
    range: { start: group.start, end: group.end },
    seconds: group.seconds,
    shots: group.ranges.map((range) => range.shotLabel),
    speech,
    speechSentenceEndOk: sentenceEndOk(speech),
    danglingContrastItems: danglingContrastItems(speech),
    prompt,
    risk,
  };
  await writeFile(path.join(outputDir, `segment-${String(segmentIndex).padStart(2, '0')}.json`), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  segmentReports.push({
    segmentIndex,
    seconds: group.seconds,
    range: payload.range,
    shots: payload.shots,
    speechChars: speech.length,
    speechSentenceEndOk: payload.speechSentenceEndOk,
    danglingContrastItems: payload.danglingContrastItems,
    riskCount: risk.length,
    riskyPositiveLines: risk.filter((item) => !item.allowed),
  });
}

const manifest = {
  taskId,
  regeneratedStoryboard: shouldRegenerate,
  title: director.basic.title || task.title,
  durationSeconds,
  requestedSeconds: durationLimit.requestedSeconds,
  maxSegmentSeconds: durationLimit.maxSeconds,
  ratio: director.basic.aspectRatio || '9:16',
  resolution: director.basic.resolution || '720p',
  storyboardChars: storyboard.length,
  globalPromptChars: globalPrompt.length,
  fullPromptChars: fullPrompt.length,
  globalPromptRisk: promptRiskReport(globalPrompt),
  fullPromptRisk: promptRiskReport(fullPrompt),
  segmentSpeech: segmentSpeechReport(segmentGroups),
  segments: segmentReports,
  outputDir,
  generatedAt: new Date().toISOString(),
};

await Promise.all([
  writeFile(path.join(outputDir, 'storyboard.md'), storyboard, 'utf8'),
  writeFile(path.join(outputDir, 'global-prompt.txt'), globalPrompt, 'utf8'),
  writeFile(path.join(outputDir, 'full-prompt.txt'), fullPrompt, 'utf8'),
  writeFile(path.join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
]);

viralDirector.logVideoGenerationFlow('info', 'seedance prompt flow diagnosis completed', {
  taskId,
  outputDir,
  regeneratedStoryboard: shouldRegenerate,
  segmentCount: segments.length,
  riskyPositiveSegmentLines: segmentReports.reduce((sum, item) => sum + item.riskyPositiveLines.length, 0),
  incompleteSpeechSegments: manifest.segmentSpeech.filter((item) => !item.sentenceEndOk).map((item) => item.segmentIndex),
});

console.log(outputDir);
