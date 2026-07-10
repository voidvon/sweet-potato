import { readFile } from 'node:fs/promises';
import { recordImageGenerationUsage } from '../../billing/billing.service.js';
import {
  generateImageWithConfiguredModel,
  editImageWithConfiguredModel,
  editImageWithJsonReferences,
  imageEditsUrl,
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
  outputAspectRatio?: string;
  outputCount: number;
  outputCompression?: number;
  outputFormat?: string;
  outputResolution?: string;
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
  if (
    modelConfig.provider === 'volcengine-seedream'
    && (!adapter || adapter === 'compatible')
  ) {
    return 'volcengine-seedream';
  }
  if (typeof adapter === 'string' && adapter.trim()) {
    return adapter.trim();
  }
  if (modelConfig.provider === 'google-gemini-images') {
    return 'gemini';
  }
  return modelConfig.provider === 'openai-images' ? 'image2' : 'compatible';
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

function imageGenerationsUrl(baseUrl: string) {
  return `${baseUrl.replace(/\/+$/, '')}/images/generations`;
}

async function seedreamReferenceImages(referenceAssets: ImageGenerationReferenceAsset[]) {
  const images = await Promise.all(referenceAssets.map(async (asset) => {
    const bytes = await readFile(asset.filePath);
    const mimeType = asset.mimeType || 'image/png';
    return `data:${mimeType};base64,${bytes.toString('base64')}`;
  }));
  if (!images.length) {
    return undefined;
  }
  return images.length === 1 ? images[0] : images;
}

function isSeedream5ProModel(model: string) {
  return /^doubao-seedream-5-0-pro-/i.test(model.trim());
}

async function parseSeedreamGeneratedImagesResponse(
  response: Response,
  config: { model: string },
): Promise<ImageGenerationProviderResult[]> {
  const contentType = response.headers.get('content-type') || '';
  if (response.ok && contentType.toLowerCase().startsWith('image/')) {
    return [{
      buffer: Buffer.from(await response.arrayBuffer()),
      mimeType: contentType,
      source: 'binary',
      model: config.model,
    }];
  }

  const text = await response.text();
  const compactText = text.replace(/\s+/g, ' ').trim();
  const preview = compactText.slice(0, 500);
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    if (!response.ok) {
      throw new Error(preview || `Seedream 图片模型请求失败：${response.status}`);
    }
    throw new Error(preview ? `Seedream 图片模型返回了无法解析的响应：${preview}` : 'Seedream 图片模型返回了无法解析的响应');
  }

  if (!response.ok) {
    const message = (data as { error?: { message?: string }; message?: string })?.error?.message
      || (data as { message?: string })?.message
      || preview
      || `Seedream 图片模型请求失败：${response.status}`;
    throw new Error(message);
  }

  const items = Array.isArray((data as { data?: unknown[] }).data)
    ? (data as { data: Array<{ b64_json?: string; url?: string }> }).data
    : [];
  const results: ImageGenerationProviderResult[] = [];

  for (const item of items) {
    if (item?.b64_json) {
      results.push({
        buffer: Buffer.from(item.b64_json, 'base64'),
        mimeType: 'image/png',
        source: 'b64_json',
        model: config.model,
      });
      continue;
    }
    if (item?.url) {
      const imageResponse = await fetch(item.url);
      if (!imageResponse.ok) {
        throw new Error(`Seedream 图片模型返回的图片下载失败：${imageResponse.status}`);
      }
      results.push({
        buffer: Buffer.from(await imageResponse.arrayBuffer()),
        mimeType: imageResponse.headers.get('content-type') || 'image/png',
        source: item.url,
        model: config.model,
      });
    }
  }

  if (!results.length) {
    throw new Error('Seedream 图片模型未返回图片数据');
  }

  return results;
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

async function generateWithVolcengineSeedreamApi(input: ImageGenerationProviderRequest) {
  const canUseSequentialGeneration = input.outputCount > 1 && !isSeedream5ProModel(input.modelConfig.model);
  if (canUseSequentialGeneration) {
    if (input.referenceAssets.length + input.outputCount > 15) {
      throw new Error('Seedream 5.0 Lite 组图模式要求参考图数量与输出图数量之和不超过 15');
    }

    const seedreamImages = await seedreamReferenceImages(input.referenceAssets);
    const body: Record<string, unknown> = {
      model: input.modelConfig.model,
      prompt: input.prompt,
      size: input.outputSize || '2K',
      sequential_image_generation: 'auto',
      sequential_image_generation_options: {
        max_images: input.outputCount,
      },
      stream: false,
      output_format: input.outputFormat || 'png',
      response_format: 'b64_json',
      watermark: false,
    };
    if (seedreamImages !== undefined) {
      body.image = seedreamImages;
    }
    if (input.background) {
      body.background = input.background;
    }
    if (input.outputCompression !== undefined) {
      body.output_compression = input.outputCompression;
    }

    const results = await withSpecificImageModelTimeout(input.modelConfig, async ({ config, signal }) => {
      const response = await fetch(imageGenerationsUrl(config.baseUrl), {
        method: 'POST',
        signal,
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      return parseSeedreamGeneratedImagesResponse(response, config);
    });

    results.forEach((generated, index) => {
      recordImageGenerationUsage({
        userId: input.userId,
        modelConfig: input.modelConfig,
        sourceType: 'chat_image_generation',
        sourceId: `${input.sourceIdPrefix}-${index + 1}`,
        requestSnapshot: {
          adapter: 'volcengine-seedream',
          modeKey: input.modeKey,
          promptLength: input.prompt.length,
          referenceAssetCount: input.referenceAssets.length,
          requestMode: 'seedream_sequential_generations',
          referenceDecision: input.referenceDecision,
          size: input.outputSize || '2K',
          background: input.background,
          outputFormat: input.outputFormat || 'png',
          outputCompression: input.outputCompression,
          outputCount: input.outputCount,
        },
        responseSnapshot: {
          mimeType: generated.mimeType,
          source: generated.source,
          model: generated.model,
          byteLength: generated.buffer.byteLength,
        },
      });
    });

    return results;
  }

  return Promise.all(Array.from({ length: input.outputCount }, async (_, index) => (
    input.referenceAssets.length
      ? editImageWithJsonReferences({
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

const volcengineSeedreamProviderAdapter: ImageGenerationProviderAdapter = {
  generate: generateWithVolcengineSeedreamApi,
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

function geminiGenerateContentUrl(baseUrl: string, model: string) {
  const normalizedModel = model.replace(/^models\//, '');
  return `${baseUrl.replace(/\/+$/, '')}/models/${encodeURIComponent(normalizedModel)}:generateContent`;
}

function geminiErrorMessage(status: number, data: unknown, preview: string) {
  if (isRecord(data)) {
    const error = isRecord(data.error) ? data.error : undefined;
    const message = typeof error?.message === 'string'
      ? error.message
      : typeof data.message === 'string'
        ? data.message
        : '';
    if (message.trim()) {
      return message.trim();
    }
  }
  return preview || `Gemini 图片模型请求失败：${status}`;
}

export function resolveGeminiImageConfig(model: string, resolution?: string, aspectRatio?: string) {
  const normalizedModel = model.replace(/^models\//, '').trim();
  const isFlash = normalizedModel === 'gemini-3.1-flash-image';
  const isFlashLite = normalizedModel === 'gemini-3.1-flash-lite-image';
  if (!isFlash && !isFlashLite) {
    return undefined;
  }
  const imageSize = isFlashLite
    ? '1K'
    : resolution === '4K' ? '4K' : resolution === '1K' ? '1K' : '2K';
  return {
    ...(aspectRatio && aspectRatio !== 'auto' ? { aspectRatio } : {}),
    imageSize,
  };
}

async function parseGeminiGeneratedImageResponse(response: Response, config: { model: string }): Promise<ImageGenerationProviderResult> {
  const text = await response.text();
  const compactText = text.replace(/\s+/g, ' ').trim();
  const preview = compactText.slice(0, 500);
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    if (!response.ok) {
      throw new Error(preview ? `Gemini 图片模型请求失败：${response.status} ${preview}` : `Gemini 图片模型请求失败：${response.status}`);
    }
    throw new Error(preview ? `Gemini 图片模型返回了无法解析的响应：${preview}` : 'Gemini 图片模型返回了无法解析的响应');
  }
  if (!response.ok) {
    throw new Error(geminiErrorMessage(response.status, data, preview));
  }

  const candidates = isRecord(data) && Array.isArray(data.candidates) ? data.candidates : [];
  for (const candidate of candidates) {
    if (!isRecord(candidate)) {
      continue;
    }
    const content = isRecord(candidate.content) ? candidate.content : undefined;
    const parts = content && Array.isArray(content.parts) ? content.parts : [];
    for (const part of parts) {
      if (!isRecord(part)) {
        continue;
      }
      const inlineData = isRecord(part.inlineData)
        ? part.inlineData
        : isRecord(part.inline_data)
          ? part.inline_data
          : undefined;
      const dataValue = inlineData && typeof inlineData.data === 'string' ? inlineData.data : '';
      if (dataValue) {
        return {
          buffer: Buffer.from(dataValue, 'base64'),
          mimeType: typeof inlineData?.mimeType === 'string' ? inlineData.mimeType : 'image/png',
          source: 'gemini_inline_data',
          model: config.model,
        };
      }
    }
  }
  throw new Error('Gemini 图片模型未返回图片数据');
}

const geminiProviderAdapter: ImageGenerationProviderAdapter = {
  async generate(input) {
    return Promise.all(Array.from({ length: input.outputCount }, async (_, index) => {
      const sourceId = `${input.sourceIdPrefix}-${index + 1}`;
      const generated = await withSpecificImageModelTimeout(input.modelConfig, async ({ config, signal }) => {
        const imageConfig = resolveGeminiImageConfig(
          config.model,
          input.outputResolution,
          input.outputAspectRatio,
        );
        const referenceParts = await Promise.all(input.referenceAssets.map(async (asset) => {
          const bytes = await readFile(asset.filePath);
          return {
            inlineData: {
              mimeType: asset.mimeType || 'image/png',
              data: bytes.toString('base64'),
            },
          };
        }));
        const response = await fetch(geminiGenerateContentUrl(config.baseUrl, config.model), {
          method: 'POST',
          signal,
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json',
            'x-goog-api-key': config.apiKey,
          },
          body: JSON.stringify({
            contents: [{
              role: 'user',
              parts: [
                { text: input.prompt },
                ...referenceParts,
              ],
            }],
            generationConfig: {
              responseModalities: ['TEXT', 'IMAGE'],
              ...(imageConfig ? { imageConfig } : {}),
            },
          }),
        });
        return parseGeminiGeneratedImageResponse(response, config);
      });

      recordImageGenerationUsage({
        userId: input.userId,
        modelConfig: input.modelConfig,
        sourceType: 'chat_image_generation',
        sourceId,
        requestSnapshot: {
          adapter: 'gemini',
          modeKey: input.modeKey,
          promptLength: input.prompt.length,
          referenceAssetCount: input.referenceAssets.length,
          requestMode: input.referenceAssets.length ? 'gemini_generate_content_with_references' : 'gemini_generate_content',
          referenceDecision: input.referenceDecision,
          aspectRatio: input.outputAspectRatio,
          resolution: input.outputResolution,
          size: input.outputSize,
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
  gemini: geminiProviderAdapter,
  image2: image2ProviderAdapter,
  'volcengine-seedream': volcengineSeedreamProviderAdapter,
};

export function resolveImageGenerationProviderAdapter(modelConfig: AiModelConfig): ImageGenerationProviderAdapter {
  return imageGenerationProviderAdapters[imageGenerationAdapterKey(modelConfig)] || compatibleImageProviderAdapter;
}
