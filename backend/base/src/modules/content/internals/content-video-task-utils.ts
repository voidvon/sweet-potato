import type { VideoGenerationResult, VideoParseResult } from '../content.types.js';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function stringValue(value: unknown) {
  return typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value);
}

export function normalizeParseResult(value: Partial<VideoParseResult> | undefined): VideoParseResult {
  return {
    person: stringValue(value?.person),
    scene: stringValue(value?.scene),
    voice: stringValue(value?.voice),
    shotLanguage: stringValue(value?.shotLanguage),
    product: stringValue(value?.product),
    pip: stringValue(value?.pip),
    pictureInPicture: value?.pictureInPicture,
    spokenContent: stringValue(value?.spokenContent),
    extraDetails: stringValue(value?.extraDetails),
    analysisProcess: Array.isArray(value?.analysisProcess)
      ? value.analysisProcess
        .map((item) => ({
          key: stringValue(item?.key),
          label: stringValue(item?.label),
          items: Array.isArray(item?.items)
            ? item.items
              .map((entry) => ({ label: stringValue(entry?.label), value: stringValue(entry?.value) }))
              .filter((entry) => entry.label || entry.value)
            : [],
          conclusion: stringValue(item?.conclusion),
        }))
        .filter((item) => item.key || item.label || item.items.length || item.conclusion)
      : [],
    videoGenerationResult: value?.videoGenerationResult as VideoGenerationResult | undefined,
  };
}

export function buildImmediateVideoProductionParseResult(input: {
  prompt: string;
  quality: string;
  ratio: string;
  duration: string;
  generationResult?: VideoGenerationResult;
}) {
  return normalizeParseResult({
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
}
