import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import type { AudioModelProvider, VoiceCloneInput } from '../audio-model-provider.types.js';

const targetModel = 'qwen3-tts-vc-realtime-2025-11-27';
const cloneEndpoint = 'https://dashscope.aliyuncs.com/api/v1/services/audio/tts/customization';
const realtimeEndpoint = `wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=${targetModel}`;
const ttsSampleRate = 24000;

function sanitizePreferredName(value: string) {
  const suffix = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 8);
  const randomPart = Math.random().toString(36).slice(2, 8);
  const candidate = suffix ? `v_${suffix}_${randomPart}` : `v_${randomPart}`;
  return candidate.replace(/_+/g, '_').slice(0, 16);
}

function dataUriFor(input: VoiceCloneInput) {
  const mimeType = input.audioMimeType || 'audio/mpeg';
  return `data:${mimeType};base64,${input.audioBuffer.toString('base64')}`;
}

function extractVoiceId(data: unknown) {
  if (!data || typeof data !== 'object') {
    return '';
  }
  const record = data as Record<string, unknown>;
  const output = record.output && typeof record.output === 'object'
    ? record.output as Record<string, unknown>
    : {};
  return typeof output.voice === 'string' ? output.voice.trim() : '';
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
  return String(record.message || record.code || fallback);
}

function createWavBuffer(pcm: Buffer, sampleRate = ttsSampleRate) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function synthesizeRealtimeSpeech(input: { apiKey: string; text: string; voiceId: string; speed?: number }) {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let finished = false;
    const timeout = setTimeout(() => {
      finish(new Error('千问实时语音合成超时'));
    }, 60_000);
    const ws = new WebSocket(realtimeEndpoint, {
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
      },
    });

    function finish(error?: Error) {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timeout);
      ws.close();
      if (error) {
        reject(error);
        return;
      }
      if (!chunks.length) {
        reject(new Error('千问实时语音合成未返回音频数据'));
        return;
      }
      resolve(createWavBuffer(Buffer.concat(chunks)));
    }

    function send(type: string, payload: Record<string, unknown> = {}) {
      ws.send(JSON.stringify({
        event_id: randomUUID(),
        type,
        ...payload,
      }));
    }

    ws.on('open', () => {
      send('session.update', {
        session: {
          voice: input.voiceId,
          mode: 'commit',
          language_type: 'Chinese',
          response_format: 'pcm',
          sample_rate: ttsSampleRate,
          speed: input.speed || 1,
        },
      });
      send('input_text_buffer.append', { text: input.text });
      send('input_text_buffer.commit');
    });

    ws.on('message', (messageData) => {
      let raw: string;
      if (typeof messageData === 'string') {
        raw = messageData;
      } else if (Array.isArray(messageData)) {
        raw = Buffer.concat(messageData).toString('utf8');
      } else if (messageData instanceof ArrayBuffer) {
        raw = Buffer.from(new Uint8Array(messageData)).toString('utf8');
      } else {
        raw = Buffer.from(messageData).toString('utf8');
      }
      const event = parseJson(raw) as Record<string, unknown>;
      if (event.type === 'response.audio.delta' && typeof event.delta === 'string') {
        chunks.push(Buffer.from(event.delta, 'base64'));
        return;
      }
      if (event.type === 'response.done') {
        send('session.finish');
        return;
      }
      if (event.type === 'session.finished') {
        finish();
        return;
      }
      if (event.type === 'error') {
        const errorPayload = event.error && typeof event.error === 'object' ? event.error as Record<string, unknown> : {};
        finish(new Error(String(errorPayload.message || event.message || '千问实时语音合成失败')));
      }
    });

    ws.on('error', (error) => {
      finish(new Error(error.message || '千问实时语音合成连接失败'));
    });

    ws.on('close', () => {
      if (!finished && chunks.length) {
        finish();
      }
    });
  });
}

export const qwenVoiceEnrollmentProvider: AudioModelProvider = {
  id: 'qwen-voice-enrollment',
  name: '阿里云百炼 - 千问 Voice Enrollment',
  description: '使用 qwen-voice-enrollment 创建可复用音色，Key 来自 DASHSCOPE_API_KEY。',
  keyLabel: 'DashScope API Key',
  keyPlaceholder: '请输入 DASHSCOPE_API_KEY',
  keyHelp: '用于阿里云百炼 Voice Enrollment 和实时 TTS 调用。',
  baseUrlLabel: 'DashScope Base URL',
  baseUrlPlaceholder: '当前适配器使用内置百炼音频接口，可留空',
  baseUrlHelp: '千问 Voice Enrollment 目前走服务端内置 DashScope 音频端点，通常不需要填写 Base URL。',
  defaultModel: 'qwen-voice-enrollment',

  async cloneVoice(input, config) {
    const response = await fetch(cloneEndpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'qwen-voice-enrollment',
        input: {
          action: 'create',
          target_model: targetModel,
          preferred_name: sanitizePreferredName(input.preferredName),
          audio: {
            data: dataUriFor(input),
          },
        },
      }),
    });

    const text = await response.text();
    const data = parseJson(text);

    if (!response.ok) {
      throw new Error(errorMessageFrom(data, `千问音色注册失败：${response.status}`));
    }

    const providerVoiceId = extractVoiceId(data);
    if (!providerVoiceId) {
      throw new Error('千问音色注册成功但未返回 voice');
    }

    return {
      providerVoiceId,
      rawResponse: data && typeof data === 'object' ? data as Record<string, unknown> : {},
    };
  },

  async synthesizeSpeech(input, config) {
    if (!input.voiceId) {
      throw new Error('缺少千问克隆音色 ID');
    }
    return {
      buffer: await synthesizeRealtimeSpeech({
        apiKey: config.apiKey,
        text: input.text,
        voiceId: input.voiceId,
        speed: input.speed,
      }),
      mimeType: 'audio/wav',
    };
  },
};
