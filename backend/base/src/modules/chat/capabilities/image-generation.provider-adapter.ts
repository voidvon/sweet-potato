import { readFile } from 'node:fs/promises';
import { recordImageGenerationUsage } from '../../billing/billing.service.js';
import {
  generateImageWithConfiguredModel,
  editImageWithConfiguredModel,
  imageEditsUrl,
  imageGenerationsUrl,
  parseGeneratedImageResponse,
  withSpecificImageModelTimeout,
} from '../../content/internals/content-image-assets.js';
import type { AiModelConfig } from '../../model-configs/model-config.types.js';

export type ImageGenerationReferenceAsset = {
  filePath: string;
  mimeType: string;
  originalFileName: string;
};

export type ImageGenerationProviderRequest = {
  background?: string;
  modelConfig: AiModelConfig;
  modeKey?: string;
  outputCount: number;
  outputCompression?: number;
  outputFormat?: string;
  outputSize?: string;
  prompt: string;
  referenceAssets: ImageGenerationReferenceAsset[];
  referenceDecision?: string;
  sourceIdPrefix: string;
  userId: string;
};

export type ImageGenerationProviderResult = {
  buffer: Buffer;
  mimeType: string;
  source: string;
  model: string;
};

type ImageGenerationProviderAdapter = {
  generate: (input: ImageGenerationProviderRequest) => Promise<ImageGenerationProviderResult[]>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function imageGenerationAdapterKey(modelConfig: AiModelConfig) {
  const settings = isRecord(modelConfig.settings) ? modelConfig.settings : {};
  const imageGeneration = isRecord(settings.imageGeneration) ? settings.imageGeneration : {};
  const adapter = imageGeneration.adapter || imageGeneration.providerAdapter || settings.imageGenerationAdapter;
  return typeof adapter === 'string' ? adapter.trim() : '';
}

function imageGenerationSettings(modelConfig: AiModelConfig) {
  const settings = isRecord(modelConfig.settings) ? modelConfig.settings : {};
  return isRecord(settings.imageGeneration) ? settings.imageGeneration : {};
}

function optionalString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function optionalNumber(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

async function generateWithCompatibleImageApi(input: ImageGenerationProviderRequest) {
  return Promise.all(Array.from({ length: input.outputCount }, async (_, index) => (
    input.referenceAssets.length
      ? editImageWithConfiguredModel({
        prompt: input.prompt,
        background: input.background,
        modelConfig: input.modelConfig,
        outputCompression: input.outputCompression,
        outputFormat: input.outputFormat,
        referenceAssets: input.referenceAssets,
        size: input.outputSize,
        billingContext: {
          userId: input.userId,
          sourceType: 'chat_image_generation',
          sourceId: `${input.sourceIdPrefix}-${index + 1}`,
        },
      })
      : generateImageWithConfiguredModel({
        prompt: input.prompt,
        background: input.background,
        modelConfig: input.modelConfig,
        outputCompression: input.outputCompression,
        outputFormat: input.outputFormat,
        size: input.outputSize,
        billingContext: {
          userId: input.userId,
          sourceType: 'chat_image_generation',
          sourceId: `${input.sourceIdPrefix}-${index + 1}`,
        },
      })
  )));
}

const compatibleImageProviderAdapter: ImageGenerationProviderAdapter = {
  generate: generateWithCompatibleImageApi,
};

const image2ProviderAdapter: ImageGenerationProviderAdapter = {
  async generate(input) {
    return Promise.all(Array.from({ length: input.outputCount }, async (_, index) => {
      const settings = imageGenerationSettings(input.modelConfig);
      const quality = optionalString(settings.quality);
      const background = optionalString(input.background);
      const outputFormat = optionalString(input.outputFormat);
      const outputCompression = optionalNumber(input.outputCompression);
      const sourceId = `${input.sourceIdPrefix}-${index + 1}`;
      const generated = await withSpecificImageModelTimeout(input.modelConfig, async ({ config, signal }) => {
        if (input.referenceAssets.length) {
          const form = new FormData();
          form.set('model', config.model);
          form.set('prompt', input.prompt);
          if (input.outputSize) {
            form.set('size', input.outputSize);
          }
          if (quality) {
            form.set('quality', quality);
          }
          if (background) {
            form.set('background', background);
          }
          if (outputFormat) {
            form.set('output_format', outputFormat);
          }
          if (outputCompression !== undefined) {
            form.set('output_compression', String(outputCompression));
          }
          for (const asset of input.referenceAssets) {
            const bytes = await readFile(asset.filePath);
            const blob = new Blob([bytes], { type: asset.mimeType || 'image/png' });
            form.append('image[]', blob, asset.originalFileName || 'reference.png');
          }
          const response = await fetch(imageEditsUrl(config.baseUrl), {
            method: 'POST',
            signal,
            headers: {
              Authorization: `Bearer ${config.apiKey}`,
            },
            body: form,
          });
          return parseGeneratedImageResponse(response, config);
        }

        const body: Record<string, unknown> = {
          model: config.model,
          prompt: input.prompt,
          n: 1,
        };
        if (input.outputSize) {
          body.size = input.outputSize;
        }
        if (quality) {
          body.quality = quality;
        }
        if (background) {
          body.background = background;
        }
        if (outputFormat) {
          body.output_format = outputFormat;
        }
        if (outputCompression !== undefined) {
          body.output_compression = outputCompression;
        }
        const response = await fetch(imageGenerationsUrl(config.baseUrl), {
          method: 'POST',
          signal,
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });
        return parseGeneratedImageResponse(response, config);
      });

      recordImageGenerationUsage({
        userId: input.userId,
        modelConfig: input.modelConfig,
        sourceType: 'chat_image_generation',
        sourceId,
        requestSnapshot: {
          adapter: 'image2',
          modeKey: input.modeKey,
          promptLength: input.prompt.length,
          referenceAssetCount: input.referenceAssets.length,
          requestMode: input.referenceAssets.length ? 'image2_multipart_edits' : 'image2_generations',
          referenceDecision: input.referenceDecision,
          size: input.outputSize,
          quality,
          background,
          outputFormat,
        },
        responseSnapshot: {
          mimeType: generated.mimeType,
          source: generated.source,
          model: generated.model,
          byteLength: generated.buffer.byteLength,
        },
      });

      return generated;
    }));
  },
};

const imageGenerationProviderAdapters: Record<string, ImageGenerationProviderAdapter> = {
  compatible: compatibleImageProviderAdapter,
  image2: image2ProviderAdapter,
};

export function resolveImageGenerationProviderAdapter(modelConfig: AiModelConfig): ImageGenerationProviderAdapter {
  return imageGenerationProviderAdapters[imageGenerationAdapterKey(modelConfig)] || compatibleImageProviderAdapter;
}
