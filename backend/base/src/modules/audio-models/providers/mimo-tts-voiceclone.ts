import type { AudioModelProvider, VoiceCloneInput } from '../audio-model-provider.types.js';

const model = 'mimo-v2.5-tts-voiceclone';
const defaultBaseUrl = 'https://api.xiaomimimo.com/v1';
const tokenPlanCnBaseUrl = 'https://token-plan-cn.xiaomimimo.com/v1';
const maxBase64Length = 10 * 1024 * 1024;

function normalizeMimeType(value: string) {
  const mimeType = value.toLowerCase().split(';')[0].trim();
  if (mimeType === 'audio/mpeg' || mimeType === 'audio/mp3') {
    return mimeType;
  }
  if (mimeType === 'audio/wav' || mimeType === 'audio/wave' || mimeType === 'audio/x-wav') {
    return 'audio/wav';
  }
  throw new Error('小米音色克隆当前仅支持 mp3 或 wav 音频样本');
}

function dataUriFor(input: VoiceCloneInput) {
  const base64Audio = input.audioBuffer.toString('base64');
  if (base64Audio.length > maxBase64Length) {
    throw new Error('小米音色克隆样本 Base64 后不能超过 10 MB');
  }
  return `data:${normalizeMimeType(input.audioMimeType)};base64,${base64Audio}`;
}

function parseJson(text: string) {
  try {
    return text ? JSON.parse(text) as unknown : {};
  } catch {
    return { message: text };
  }
}

function errorMessageFrom(data: unknown, fallback: string) {
  if (!data || typeof data !== 'object') {
    return fallback;
  }
  const record = data as Record<string, unknown>;
  const error = record.error && typeof record.error === 'object'
    ? record.error as Record<string, unknown>
    : {};
  return String(error.message || record.message || error.code || record.code || fallback);
}

function requestErrorMessage(data: unknown, fallback: string) {
  const message = errorMessageFrom(data, fallback);
  if (/invalid api key/i.test(message)) {
    return `${message}。如果使用 tp- 开头的 Token Plan Key，请确认 Base URL 使用订阅页提供的 Token Plan 地址。`;
  }
  return message;
}

function extractAudioData(data: unknown) {
  if (!data || typeof data !== 'object') {
    return '';
  }
  const record = data as Record<string, unknown>;
  const choices = Array.isArray(record.choices) ? record.choices : [];
  const firstChoice = choices[0] && typeof choices[0] === 'object'
    ? choices[0] as Record<string, unknown>
    : {};
  const message = firstChoice.message && typeof firstChoice.message === 'object'
    ? firstChoice.message as Record<string, unknown>
    : {};
  const audio = message.audio && typeof message.audio === 'object'
    ? message.audio as Record<string, unknown>
    : {};
  return typeof audio.data === 'string' ? audio.data.trim() : '';
}

function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, '');
}

function baseUrlFor(config: { apiKey: string; baseUrl?: string }) {
  if (config.baseUrl?.trim()) {
    return normalizeBaseUrl(config.baseUrl);
  }
  if (config.apiKey.trim().startsWith('tp-c')) {
    return tokenPlanCnBaseUrl;
  }
  return defaultBaseUrl;
}

function chatCompletionsUrl(config: { apiKey: string; baseUrl?: string }) {
  const baseUrl = baseUrlFor(config);
  return baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`;
}

export const mimoTtsVoicecloneProvider: AudioModelProvider = {
  id: model,
  name: '小米 MiMo-V2.5-TTS-VoiceClone',
  description: '使用 mimo-v2.5-tts-voiceclone 通过 mp3/wav 样本复刻音色，并调用同模型生成试听语音。',
  keyLabel: 'MiMo API Key / Token Plan Key',
  keyPlaceholder: 'MIMO_API_KEY 或 tp-c 开头的 Token Plan Key',
  keyHelp: '普通 MiMo Key 使用默认官方地址；tp-c Key 需要搭配订阅页提供的 Token Plan 地址。',
  baseUrlLabel: 'MiMo Base URL',
  baseUrlPlaceholder: '普通 Key：https://api.xiaomimimo.com/v1；tp-c Key：填写 Token Plan 地址',
  baseUrlHelp: `使用 tp-c 开头的 Token Plan Key 时，请把 Base URL 改为订阅页提供的 Token Plan 地址，例如 ${tokenPlanCnBaseUrl}。`,
  defaultBaseUrl,
  defaultModel: model,

  async cloneVoice(input) {
    return {
      providerVoiceId: dataUriFor(input),
      rawResponse: {
        model,
        sampleBytes: input.audioBuffer.byteLength,
        mimeType: normalizeMimeType(input.audioMimeType),
      },
    };
  },

  async synthesizeSpeech(input, config) {
    if (!input.voiceId) {
      throw new Error('缺少小米音色克隆样本');
    }

    const response = await fetch(chatCompletionsUrl(config), {
      method: 'POST',
      headers: {
        'api-key': config.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: '',
          },
          {
            role: 'assistant',
            content: input.text,
          },
        ],
        audio: {
          format: 'wav',
          voice: input.voiceId,
        },
      }),
      signal: AbortSignal.timeout(90_000),
    });

    const text = await response.text();
    const data = parseJson(text);
    if (!response.ok) {
      throw new Error(requestErrorMessage(data, `小米语音合成失败：${response.status}`));
    }

    const audioData = extractAudioData(data);
    if (!audioData) {
      throw new Error('小米语音合成成功但未返回音频数据');
    }

    return {
      buffer: Buffer.from(audioData, 'base64'),
      mimeType: 'audio/wav',
    };
  },
};
