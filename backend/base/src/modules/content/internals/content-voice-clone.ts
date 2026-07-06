import { existsSync } from 'node:fs';
import { readFile,rm,writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
contentPublicBaseUrl
} from '../../../config/env.js';
import { getAudioModelProvider } from '../../audio-models/audio-model.registry.js';
import { recordSpeechSynthesisUsage, recordVoiceCloneUsage } from '../../billing/billing.service.js';
import { modelConfigRepository } from '../../model-configs/model-config.repository.js';
import { contentRepository } from '../content.repository.js';
import type {
ContentAsset
} from '../content.types.js';

import { assertUserId,contentFilesDir,execFileAsync,mimoVoiceCloneProviderId } from './content-common.js';
import { deleteContentAssetFile } from './content-image-assets.js';

export const defaultVoiceClonePreviewText = '你好，我是你的专属声音助手，很高兴为你服务。今天天气真不错，适合出门走走。';

export function fileUrlFor(storedFileName: string) {
  return `/files/${encodeURIComponent(storedFileName)}`;
}

export function absolutizeMaterialUrl(value: unknown) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }
  if (!contentPublicBaseUrl) {
    return '';
  }
  return raw.startsWith('/')
    ? `${contentPublicBaseUrl}${raw}`
    : `${contentPublicBaseUrl}/${raw.replace(/^\/+/, '')}`;
}

export function resolveDefaultAudioModel() {
  const config = modelConfigRepository.list('audio').find((item) => Boolean(item.isDefault))
    || modelConfigRepository.list('audio')[0];
  if (!config?.apiKey) {
    throw new Error('请先配置音频模型');
  }
  return config;
}

export function isRecordValue(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function stringFromRecord(value: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  return '';
}

export function isMimoSupportedAudioMimeType(mimeType: string) {
  const normalized = mimeType.toLowerCase().split(';')[0].trim();
  return ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/wave', 'audio/x-wav'].includes(normalized);
}

export async function transcodeAudioSampleToMp3(sample: ContentAsset) {
  const outputPath = path.join(contentFilesDir, `voice-clone-sample-${sample.id}-${Date.now()}.mp3`);
  try {
    await execFileAsync('ffmpeg', [
      '-y',
      '-i',
      sample.filePath,
      '-vn',
      '-ac',
      '1',
      '-ar',
      '24000',
      '-codec:a',
      'libmp3lame',
      '-b:a',
      '128k',
      outputPath,
    ], { timeout: 120_000 });
    return await readFile(outputPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('当前环境缺少 ffmpeg，无法将该音频格式转换为 mp3');
    }
    const message = error instanceof Error ? error.message : '未知错误';
    throw new Error(`音频格式转换失败，请换用 mp3 或 wav 后重试：${message}`);
  } finally {
    await rm(outputPath, { force: true });
  }
}

export async function prepareVoiceCloneSample(sample: ContentAsset, providerId: string) {
  if (providerId !== mimoVoiceCloneProviderId || isMimoSupportedAudioMimeType(sample.mimeType)) {
    return {
      audioBuffer: await readFile(sample.filePath),
      audioMimeType: sample.mimeType,
    };
  }

  return {
    audioBuffer: await transcodeAudioSampleToMp3(sample),
    audioMimeType: 'audio/mpeg',
  };
}

export async function cloneVoiceLibrary(groupId: string, input: { userId: string; sampleAssetId?: string }) {
  assertUserId(input.userId);
  const group = contentRepository.findGroup(groupId);
  if (!group || group.userId !== input.userId || group.resourceType !== 'voice') {
    throw new Error('音库不存在');
  }
  const samples = contentRepository.listAssets({ userId: input.userId, groupId, resourceType: 'voice' })
    .filter((asset) => asset.mimeType.startsWith('audio/')
      && asset.metadata.kind !== 'voice_clone_preview'
      && asset.metadata.kind !== 'confirmed_audio'
      && existsSync(asset.filePath));
  const sample = input.sampleAssetId
    ? samples.find((asset) => asset.id === input.sampleAssetId)
    : samples[0];
  if (!sample) {
    throw new Error('请先上传音频样本');
  }

  const config = resolveDefaultAudioModel();
  const provider = getAudioModelProvider(config.provider);
  const metadataBase = {
    ...group.metadata,
    voiceClone: {
      status: 'training',
      sampleAssetId: sample.id,
      provider: provider.id,
      updatedAt: new Date().toISOString(),
    },
  };
  contentRepository.updateGroup(groupId, { metadata: metadataBase });

  try {
    const preparedSample = await prepareVoiceCloneSample(sample, provider.id);
    const result = await provider.cloneVoice({
      preferredName: group.name,
      audioBuffer: preparedSample.audioBuffer,
      audioMimeType: preparedSample.audioMimeType,
    }, {
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
    });
    recordVoiceCloneUsage({
      userId: input.userId,
      modelConfig: config,
      sourceType: 'voice_clone_training',
      sourceId: groupId,
      groupId,
      requestSnapshot: {
        sampleAssetId: sample.id,
        sampleMimeType: preparedSample.audioMimeType,
        sampleBytes: preparedSample.audioBuffer.byteLength,
      },
      responseSnapshot: {
        provider: provider.id,
        model: provider.defaultModel,
        providerVoiceId: result.providerVoiceId,
      },
    });
    let previewAssetId = '';
    let previewAudioUrl = '';
    if (provider.synthesizeSpeech) {
      const previewResult = await provider.synthesizeSpeech({
        text: defaultVoiceClonePreviewText,
        voiceId: result.providerVoiceId,
        speed: 1,
      }, {
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
      });
      recordSpeechSynthesisUsage({
        userId: input.userId,
        modelConfig: config,
        sourceType: 'voice_clone_preview',
        sourceId: groupId,
        groupId,
        charCount: defaultVoiceClonePreviewText.length,
        requestSnapshot: {
          previewText: defaultVoiceClonePreviewText,
          providerVoiceId: result.providerVoiceId,
        },
        responseSnapshot: {
          provider: provider.id,
          model: provider.defaultModel,
          mimeType: previewResult.mimeType,
          byteLength: previewResult.buffer.byteLength,
        },
      });
      const extension = /wav/i.test(previewResult.mimeType) ? 'wav' : /ogg/i.test(previewResult.mimeType) ? 'ogg' : 'mp3';
      const storedFileName = `voice-clone-preview-${groupId}-${Date.now()}.${extension}`;
      const filePath = path.join(contentFilesDir, storedFileName);
      await writeFile(filePath, previewResult.buffer);
      await Promise.all(contentRepository.listAssets({ userId: input.userId, groupId, resourceType: 'voice' })
        .filter((asset) => asset.metadata.kind === 'voice_clone_preview')
        .map((asset) => deleteContentAssetFile(asset)));
      const previewAsset = contentRepository.createAsset({
        userId: input.userId,
        groupId,
        resourceType: 'voice',
        name: `${group.name}-克隆试听`,
        description: '声音克隆完成后使用默认文案生成的试听音频',
        originalFileName: `voice-clone-preview.${extension}`,
        storedFileName,
        mimeType: previewResult.mimeType,
        fileSize: previewResult.buffer.byteLength,
        filePath,
        fileUrl: fileUrlFor(storedFileName),
        metadata: {
          generatedBy: 'audio_model',
          provider: provider.id,
          model: provider.defaultModel,
          kind: 'voice_clone_preview',
          sampleAssetId: sample.id,
          previewText: defaultVoiceClonePreviewText,
        },
      });
      previewAssetId = previewAsset?.id || '';
      previewAudioUrl = previewAsset?.fileUrl || '';
    }
    const updated = contentRepository.updateGroup(groupId, {
      metadata: {
        ...group.metadata,
        voiceClone: {
          status: 'success',
          provider: provider.id,
          providerVoiceId: result.providerVoiceId,
          sampleAssetId: sample.id,
          previewAssetId,
          previewAudioUrl,
          previewText: defaultVoiceClonePreviewText,
          response: result.rawResponse,
          updatedAt: new Date().toISOString(),
        },
      },
    });
    if (!updated) {
      throw new Error('音库状态保存失败');
    }
    return updated;
  } catch (error) {
    const failureReason = error instanceof Error ? error.message : '声音克隆失败';
    const failed = contentRepository.updateGroup(groupId, {
      metadata: {
        ...group.metadata,
        voiceClone: {
          status: 'failed',
          provider: provider.id,
          sampleAssetId: sample.id,
          failureReason,
          updatedAt: new Date().toISOString(),
        },
      },
    });
    if (failed) {
      return failed;
    }
    throw error;
  }
}

export function resolveProviderVoiceId(userId: string, voiceId?: string) {
  if (!voiceId) {
    return undefined;
  }
  const group = contentRepository.findGroup(voiceId);
  if (!group || group.userId !== userId || group.resourceType !== 'voice') {
    return voiceId;
  }
  const clone = isRecordValue(group.metadata.voiceClone) ? group.metadata.voiceClone : {};
  return stringFromRecord(clone, ['providerVoiceId', 'voiceType', 'voice_type', 'speakerId', 'speaker_id']) || voiceId;
}
