import { StructuredOutputParser } from '@langchain/core/output_parsers';
import { jsonrepair } from 'jsonrepair';
import { z } from 'zod';
import { streamVideoUnderstanding } from '../video-understanding/video-understanding.client.js';
import type { VideoUnderstandingContent } from '../video-understanding/video-understanding.types.js';
import type {
  ContentPlanningAnalysis,
  ContentPlanningAssetRef,
  ContentPlanningMaterialCaption,
  ContentPlanningProductInsights,
  ContentPlanningViralBreakdown,
} from './content-planning.types.js';

export type ContentPlanningAnalysisAsset = ContentPlanningAssetRef & {
  filePath: string;
};

export type ProductMaterialAnalysisInput = {
  productName: string;
  prompt: string;
  images: ContentPlanningAnalysisAsset[];
};

export type ReferenceMaterialAnalysisInput = {
  productName: string;
  prompt: string;
  productInsights: ContentPlanningProductInsights;
  video?: ContentPlanningAnalysisAsset | null;
};

export type ProductMaterialAnalysis = Pick<ContentPlanningAnalysis, 'materialCaptions' | 'productInsights'>;

export interface ContentPlanningAnalysisProvider {
  analyzeProduct(input: ProductMaterialAnalysisInput): Promise<ProductMaterialAnalysis>;
  analyzeReference(input: ReferenceMaterialAnalysisInput): Promise<ContentPlanningViralBreakdown>;
}

const productAnalysisSchema = z.object({
  materialCaptions: z.array(z.object({
    assetId: z.string().min(1),
    label: z.string().min(1),
    description: z.string().min(1),
  })).min(1),
  productInsights: z.object({
    productName: z.string(),
    productCategory: z.string(),
    productFeatures: z.array(z.string()),
    coreSellingPoints: z.array(z.string()),
    targetAudience: z.array(z.string()),
    useScenarios: z.array(z.string()),
  }),
});

const viralBreakdownSchema = z.object({
  tags: z.array(z.string()),
  structureFramework: z.string(),
  emotionCurve: z.string(),
  summary: z.string(),
  segments: z.array(z.object({
    timeRange: z.string(),
    title: z.string(),
    summary: z.string(),
  })),
  replaceableElements: z.array(z.string()),
  keepElements: z.array(z.string()),
  applicableCategories: z.array(z.string()),
  note: z.string().optional(),
});

function timestampTokenToSeconds(value: string) {
  const normalized = value.trim().replace(/(?:秒|s)$/iu, '');
  const parts = normalized.split(':').map((part) => Number(part));
  if (!parts.length || parts.some((part) => !Number.isFinite(part) || part < 0)) {
    return null;
  }
  if (parts.length === 1) {
    return parts[0];
  }
  if (parts.length === 2) {
    return (parts[0] * 60) + parts[1];
  }
  if (parts.length === 3) {
    return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
  }
  return null;
}

function formatSeconds(value: number) {
  return String(Number(value.toFixed(3)));
}

export function normalizeContentPlanningTimeRange(value: string) {
  const normalized = value
    .trim()
    .replace(/[：]/gu, ':')
    .replace(/[–—－~～]/gu, '-')
    .replace(/\s+/gu, ' ');
  const parts = normalized.split(/\s*(?:-|至)\s*/u);
  if (parts.length !== 2) {
    return normalized.replace(/s$/iu, '秒');
  }
  const start = timestampTokenToSeconds(parts[0]);
  const end = timestampTokenToSeconds(parts[1]);
  if (start === null || end === null) {
    return normalized.replace(/s$/iu, '秒');
  }
  return `${formatSeconds(start)}-${formatSeconds(end)}秒`;
}

function mediaSource(asset: ContentPlanningAnalysisAsset) {
  return {
    filePath: asset.filePath,
    mimeType: asset.mimeType,
    filename: asset.originalFileName || asset.name,
  };
}

export async function parseContentPlanningAnalysisResponse<T>(raw: string, schema: z.ZodType<T>): Promise<T> {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const source = (fenced || raw).trim();
  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new Error('素材理解模型未返回有效 JSON');
  }
  const jsonSource = source.slice(start, end + 1);
  const parser = StructuredOutputParser.fromZodSchema(schema);
  try {
    return await parser.parse(jsonSource);
  } catch {
    try {
      return schema.parse(JSON.parse(jsonrepair(jsonSource)));
    } catch (error) {
      throw new Error(`素材理解结果不符合约定格式：${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function collectUnderstanding(content: VideoUnderstandingContent[]) {
  let output = '';
  for await (const event of streamVideoUnderstanding({
    messages: [{ role: 'user', content }],
    useFilesApi: true,
    fps: 2,
    maxTokens: 5000,
    thinking: { type: 'disabled' },
  })) {
    if (event.type === 'delta') {
      output += event.delta;
    }
    if (event.type === 'error') {
      throw new Error(event.message);
    }
  }
  if (!output.trim()) {
    throw new Error('素材理解模型返回内容为空');
  }
  return output;
}

class ArkContentPlanningAnalysisProvider implements ContentPlanningAnalysisProvider {
  async analyzeProduct(input: ProductMaterialAnalysisInput): Promise<ProductMaterialAnalysis> {
    const assetManifest = input.images.map((image, index) => ({
      order: index + 1,
      assetId: image.assetId,
      name: image.name,
    }));
    const content: VideoUnderstandingContent[] = [
      {
        type: 'input_text',
        text: [
          '你是电商视频策划的商品视觉分析师。分析随后按顺序提供的全部商品图片。',
          `用户填写的商品名称：${input.productName || '未填写'}`,
          `用户补充要求：${input.prompt || '无'}`,
          `素材清单：${JSON.stringify(assetManifest)}`,
          '只返回一个 JSON 对象，不要 Markdown。materialCaptions 必须逐张覆盖素材清单，并原样返回对应 assetId。',
          '输出结构：{"materialCaptions":[{"assetId":"","label":"","description":""}],"productInsights":{"productName":"","productCategory":"","productFeatures":[],"coreSellingPoints":[],"targetAudience":[],"useScenarios":[]}}',
          'description 要描述可见主体、外观、颜色、构图和可用于视频的卖点证据；不要编造图片中不可见的信息。',
        ].join('\n'),
      },
      ...input.images.map((image) => ({
        type: 'image_url' as const,
        image_url: { ...mediaSource(image), detail: 'high' as const },
      })),
    ];
    const parsed = await parseContentPlanningAnalysisResponse(await collectUnderstanding(content), productAnalysisSchema);
    const captionsByAssetId = new Map(parsed.materialCaptions.map((caption) => [caption.assetId, caption]));
    const materialCaptions: ContentPlanningMaterialCaption[] = input.images.map((image, index) => {
      const caption = captionsByAssetId.get(image.assetId) || parsed.materialCaptions[index];
      if (!caption) {
        throw new Error(`素材理解结果缺少第 ${index + 1} 张商品图`);
      }
      return {
        id: `caption-${image.assetId}`,
        assetId: image.assetId,
        label: caption.label,
        previewUrl: image.fileUrl,
        description: caption.description,
      };
    });
    return {
      materialCaptions,
      productInsights: {
        ...parsed.productInsights,
        productName: parsed.productInsights.productName || input.productName,
      },
    };
  }

  async analyzeReference(input: ReferenceMaterialAnalysisInput): Promise<ContentPlanningViralBreakdown> {
    const content: VideoUnderstandingContent[] = [
      {
        type: 'input_text',
        text: [
          '你是短视频爆款结构分析师。拆解随后提供的参考视频，并给出可迁移到新商品脚本的节奏、镜头、结构和口播风格。',
          `目标商品：${input.productName || input.productInsights.productName || '未填写'}`,
          `商品洞察：${JSON.stringify(input.productInsights)}`,
          `用户要求：${input.prompt || '无'}`,
          '只返回一个 JSON 对象，不要 Markdown。所有时间段必须来自输入媒体，不要虚构无法确认的事实。',
          'timeRange 必须直接使用秒数范围，格式为“0-2秒”“2-3.5秒”，禁止使用 HH:mm、mm:ss 或 00:00-00:02 格式。',
          '输出结构：{"tags":[],"structureFramework":"","emotionCurve":"","summary":"","segments":[{"timeRange":"0-2秒","title":"","summary":""}],"replaceableElements":[],"keepElements":[],"applicableCategories":[],"note":""}',
        ].join('\n'),
      },
      ...(input.video ? [{ type: 'video_url' as const, video_url: { ...mediaSource(input.video), fps: 2 } }] : []),
    ];
    const parsed = await parseContentPlanningAnalysisResponse(await collectUnderstanding(content), viralBreakdownSchema);
    return {
      ...parsed,
      segments: parsed.segments.map((segment) => ({
        ...segment,
        timeRange: normalizeContentPlanningTimeRange(segment.timeRange),
      })),
    };
  }
}

export class DeterministicContentPlanningAnalysisProvider implements ContentPlanningAnalysisProvider {
  async analyzeProduct(input: ProductMaterialAnalysisInput): Promise<ProductMaterialAnalysis> {
    return {
      materialCaptions: input.images.map((image, index) => ({
        id: `caption-${image.assetId}`,
        assetId: image.assetId,
        label: `Image ${index + 1}`,
        previewUrl: image.fileUrl,
        description: `Uploaded product image ${index + 1}; keep its product identity and proportions stable.`,
      })),
      productInsights: {
        productName: input.productName,
        productCategory: '',
        productFeatures: [],
        coreSellingPoints: [],
        targetAudience: [],
        useScenarios: [],
      },
    };
  }

  async analyzeReference(): Promise<ContentPlanningViralBreakdown> {
    return {
      tags: ['clear hook', 'product proof', 'direct call to action'],
      structureFramework: 'hook -> proof -> conversion',
      emotionCurve: 'curiosity -> confidence -> action',
      summary: 'Deterministic reference breakdown for tests.',
      segments: [
        { timeRange: '0-2秒', title: 'Hook', summary: 'Make the product promise visible immediately.' },
        { timeRange: '2-6秒', title: 'Proof', summary: 'Show one concrete product benefit.' },
        { timeRange: '6-10秒', title: 'Conversion', summary: 'End with a simple next step.' },
      ],
      replaceableElements: ['subject', 'spoken copy', 'product visuals'],
      keepElements: ['fast opening', 'single benefit focus'],
      applicableCategories: ['ecommerce', 'local_service', 'education'],
      note: 'Test provider',
    };
  }
}

export function createContentPlanningAnalysisProvider(): ContentPlanningAnalysisProvider {
  return new ArkContentPlanningAnalysisProvider();
}
