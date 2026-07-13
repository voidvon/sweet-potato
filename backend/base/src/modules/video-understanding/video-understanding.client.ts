import { createReadStream } from 'node:fs';
import { readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { ArkRuntimeClient } from '@volcengine/ark-runtime';
import { arkVideoUnderstandingConfig } from '../../config/env.js';
import { logger } from '../../shared/logger.js';
import type {
  VideoUnderstandingContent,
  VideoUnderstandingEvent,
  VideoUnderstandingMessage,
  VideoUnderstandingRequest,
  VideoUnderstandingSource,
} from './video-understanding.types.js';

const minFps = 0.2;
const maxFps = 5;
const maxBase64Bytes = 50 * 1024 * 1024;
const maxAudioBytes = 25 * 1024 * 1024;
const maxFileBytes = 2 * 1024 * 1024 * 1024;
const defaultFps = 2;
const defaultUseFilesApi = true;

type PreparedRequest = {
  requestId: string;
  model: string;
  messages: VideoUnderstandingMessage[];
  useFilesApi: boolean;
  fps: number;
  maxTokens?: number;
  thinking?: { type: 'enabled' | 'disabled' | 'auto' };
  signal?: AbortSignal;
};

function client() {
  if (!arkVideoUnderstandingConfig.apiKey) {
    throw new Error('缺少 OPENAI_API_KEY，请在 base 环境中配置火山方舟 API Key');
  }
  return ArkRuntimeClient.withApiKey(arkVideoUnderstandingConfig.apiKey, {
    baseURL: arkVideoUnderstandingConfig.baseUrl,
    timeout: arkVideoUnderstandingConfig.timeoutMs,
  });
}

function fpsValue(value: unknown, fallback: number) {
  const valueNumber = Number(value ?? fallback);
  if (!Number.isFinite(valueNumber) || valueNumber < minFps || valueNumber > maxFps) {
    throw new Error(`视频 fps 必须在 ${minFps} 到 ${maxFps} 之间`);
  }
  return valueNumber;
}

function sourceValue(source: VideoUnderstandingSource) {
  const values = [source.fileId, source.url, source.data, source.filePath].filter((value) => typeof value === 'string' && value.trim());
  if (values.length !== 1) {
    throw new Error('媒体输入必须且只能提供 fileId、url、data 或 filePath 之一');
  }
  return values[0]!.trim();
}

function sourceFromValue(value: unknown): VideoUnderstandingSource {
  if (typeof value === 'string' && value.trim()) {
    return { url: value.trim() };
  }
  if (!value || typeof value !== 'object') {
    throw new Error('媒体输入必须是对象或 URL');
  }
  const raw = value as Record<string, unknown>;
  return {
    fileId: typeof raw.fileId === 'string' ? raw.fileId.trim() : typeof raw.file_id === 'string' ? raw.file_id.trim() : undefined,
    url: typeof raw.url === 'string' ? raw.url.trim() : undefined,
    data: typeof raw.data === 'string' ? raw.data.trim() : undefined,
    filePath: typeof raw.filePath === 'string' ? raw.filePath.trim() : typeof raw.file_path === 'string' ? raw.file_path.trim() : undefined,
    mimeType: typeof raw.mimeType === 'string' ? raw.mimeType.trim() : typeof raw.mime_type === 'string' ? raw.mime_type.trim() : undefined,
    filename: typeof raw.filename === 'string' ? raw.filename.trim() : typeof raw.fileName === 'string' ? raw.fileName.trim() : undefined,
    format: typeof raw.format === 'string' ? raw.format.trim() : undefined,
  };
}

function normalizeContent(content: string | VideoUnderstandingContent[], defaultFps: number): VideoUnderstandingContent[] {
  const parts = typeof content === 'string' ? [{ type: 'text', text: content } as const] : content;
  if (!parts.length) {
    throw new Error('消息 content 不能为空');
  }
  return parts.map((part) => {
    if (part.type === 'text' || part.type === 'input_text') {
      if (!part.text.trim()) {
        throw new Error('文本输入不能为空');
      }
      return { type: 'text', text: part.text };
    }
    if (part.type === 'video_url') {
      return {
        type: 'video_url',
        video_url: {
          ...sourceFromValue(part.video_url),
          fps: fpsValue(part.video_url.fps, defaultFps),
        },
      };
    }
    if (part.type === 'image_url') {
      return {
        type: 'image_url',
        image_url: {
          ...sourceFromValue(part.image_url),
          ...(part.image_url.detail ? { detail: part.image_url.detail } : {}),
        },
      };
    }
    return {
      type: 'input_audio',
      input_audio: sourceFromValue(part.input_audio),
    };
  });
}

export function normalizeVideoUnderstandingRequest(input: VideoUnderstandingRequest): PreparedRequest {
  const requestId = input.requestId || `video-understanding-${randomBytes(8).toString('hex')}`;
  const model = input.model?.trim() || arkVideoUnderstandingConfig.model;
  const fps = fpsValue(input.fps, defaultFps);
  const useFilesApi = input.useFilesApi ?? defaultUseFilesApi;
  let messages = input.messages;
  if (!messages) {
    const content: VideoUnderstandingContent[] = [];
    if (input.prompt?.trim()) {
      content.push({ type: 'text', text: input.prompt.trim() });
    }
    content.push(...(input.inputs || []));
    messages = [{
      role: 'user',
      content: normalizeContent(content, fps),
    }];
  } else {
    messages = messages.map((message) => ({
      ...message,
      content: normalizeContent(message.content, fps),
    }));
  }
  if (input.systemPrompt?.trim()) {
    messages = [{ role: 'system', content: input.systemPrompt.trim() }, ...messages];
  }
  if (!messages.length || !model) {
    throw new Error('视频理解请求缺少 messages 或 model');
  }
  return {
    requestId,
    model,
    messages,
    useFilesApi,
    fps,
    ...(Number.isFinite(input.maxTokens) ? { maxTokens: Math.floor(input.maxTokens!) } : {}),
    ...(input.thinking ? { thinking: input.thinking } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
  };
}

function dataUriParts(value: string) {
  const match = value.match(/^data:([^;,]+);base64,(.+)$/i);
  if (!match) {
    throw new Error('媒体 Base64 必须使用 data:<mime>;base64,<data> 格式');
  }
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length) {
    throw new Error('媒体 Base64 为空或无效');
  }
  return { buffer, mimeType: match[1] };
}

async function materializeSource(source: VideoUnderstandingSource, kind: 'video' | 'image' | 'audio', signal?: AbortSignal) {
  const value = sourceValue(source);
  if (source.filePath) {
    const info = await stat(source.filePath);
    if (info.size > maxFileBytes) {
      throw new Error('媒体文件超过 Files API 支持的最大大小');
    }
    return { filePath: source.filePath, cleanup: async () => undefined };
  }

  const temporaryPath = path.join(os.tmpdir(), `ark-${kind}-${randomBytes(8).toString('hex')}`);
  let buffer: Buffer;
  let mimeType = source.mimeType || 'application/octet-stream';
  if (source.data) {
    const data = source.data.startsWith('data:') ? dataUriParts(source.data) : dataUriParts(`data:${mimeType};base64,${source.data}`);
    buffer = data.buffer;
    mimeType = data.mimeType;
  } else if (source.url?.startsWith('data:')) {
    const data = dataUriParts(source.url);
    buffer = data.buffer;
    mimeType = data.mimeType;
  } else if (source.url) {
    const response = await fetch(source.url, { signal });
    if (!response.ok) {
      throw new Error(`下载媒体失败：HTTP ${response.status}`);
    }
    buffer = Buffer.from(await response.arrayBuffer());
    mimeType = response.headers.get('content-type')?.split(';')[0] || mimeType;
  } else {
    throw new Error('媒体输入缺少可上传内容');
  }
  const limit = kind === 'audio' ? maxAudioBytes : maxBase64Bytes;
  if (buffer.length > limit) {
    throw new Error(kind === 'audio' ? '音频文件不能超过 25 MB' : '媒体文件不能超过 50 MB');
  }
  await import('node:fs/promises').then(({ writeFile }) => writeFile(temporaryPath, buffer));
  return {
    filePath: temporaryPath,
    cleanup: () => rm(temporaryPath, { force: true }),
    mimeType,
  };
}

async function uploadMedia(
  ark: ArkRuntimeClient,
  source: VideoUnderstandingSource,
  kind: 'video' | 'image' | 'audio',
  request: PreparedRequest,
) {
  const materialized = await materializeSource(source, kind, request.signal);
  try {
    const uploaded = await ark.uploadFile({
      file: createReadStream(materialized.filePath) as unknown as ReadableStream,
      purpose: 'user_data',
      ...(kind === 'video' ? {
        preprocess_configs: {
          video: { fps: fpsValue(source.fps, request.fps) },
        },
      } : {}),
      expire_at: Math.floor(Date.now() / 1000) + 86400,
    });
    let file = uploaded;
    const deadline = Date.now() + arkVideoUnderstandingConfig.filePollTimeoutMs;
    while (file.status === 'processing' && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, arkVideoUnderstandingConfig.filePollIntervalMs));
      file = await ark.retrieveFile(file.id, { signal: request.signal });
    }
    if (file.status !== 'active') {
      throw new Error(file.error?.message || `Files API 文件处理失败：${file.status}`);
    }
    return file.id;
  } finally {
    await materialized.cleanup();
  }
}

async function directMediaSource(source: VideoUnderstandingSource, kind: 'video' | 'image' | 'audio') {
  if (source.filePath) {
    const buffer = await readFile(source.filePath);
    if (buffer.length > (kind === 'audio' ? maxAudioBytes : maxBase64Bytes)) {
      throw new Error(kind === 'audio' ? '音频文件不能超过 25 MB' : '媒体文件不能超过 50 MB');
    }
    const mimeType = source.mimeType || 'application/octet-stream';
    if (kind === 'audio') {
      return { data: buffer.toString('base64'), format: source.format || mimeType };
    }
    return { url: `data:${mimeType};base64,${buffer.toString('base64')}` };
  }
  if (source.data) {
    if (kind === 'audio') {
      if (source.data.startsWith('data:')) {
        const data = dataUriParts(source.data);
        return { data: data.buffer.toString('base64'), format: source.format || data.mimeType };
      }
      return { data: source.data, ...(source.format ? { format: source.format } : {}) };
    }
    return { url: source.data.startsWith('data:') ? source.data : `data:${source.mimeType || 'application/octet-stream'};base64,${source.data}` };
  }
  if (source.url) {
    if (kind === 'audio') {
      return { url: source.url, ...(source.format ? { format: source.format } : {}) };
    }
    return { url: source.url };
  }
  throw new Error('媒体输入缺少可直传内容');
}

async function prepareMessages(ark: ArkRuntimeClient, request: PreparedRequest) {
  const uploaded = new Map<string, string>();
  const result: VideoUnderstandingMessage[] = [];
  for (const message of request.messages) {
    const content = typeof message.content === 'string'
      ? [{ type: 'text', text: message.content } as const]
      : message.content;
    const prepared: unknown[] = [];
    for (const part of content) {
      if (part.type === 'text' || part.type === 'input_text') {
        prepared.push({ type: 'text', text: part.text });
        continue;
      }
      const field = part.type === 'video_url' ? 'video_url' : part.type === 'image_url' ? 'image_url' : 'input_audio';
      const source = part.type === 'video_url' ? part.video_url : part.type === 'image_url' ? part.image_url : part.input_audio;
      const key = `${field}:${sourceValue(source)}`;
      let fileId = source.fileId;
      if (request.useFilesApi && !fileId) {
        fileId = uploaded.get(key) || await uploadMedia(ark, source, field === 'video_url' ? 'video' : field === 'image_url' ? 'image' : 'audio', request);
        uploaded.set(key, fileId);
      }
      const direct = fileId ? source : await directMediaSource(source, field === 'video_url' ? 'video' : field === 'image_url' ? 'image' : 'audio');
      const directUrl = 'url' in direct ? direct.url : undefined;
      if (field === 'video_url') {
        prepared.push({ type: field, video_url: fileId ? { file_id: fileId, fps: fpsValue(source.fps, request.fps) } : { url: directUrl, fps: fpsValue(source.fps, request.fps) } });
      } else if (field === 'image_url') {
        prepared.push({ type: field, image_url: fileId ? { file_id: fileId, ...(source.detail ? { detail: source.detail } : {}) } : { url: directUrl, ...(source.detail ? { detail: source.detail } : {}) } });
      } else {
        prepared.push({ type: field, input_audio: fileId ? { file_id: fileId } : direct });
      }
    }
    result.push({ role: message.role, content: prepared as VideoUnderstandingContent[] });
  }
  return result;
}

export async function* streamVideoUnderstanding(input: VideoUnderstandingRequest): AsyncGenerator<VideoUnderstandingEvent> {
  const request = normalizeVideoUnderstandingRequest(input);
  const requestClient = client();
  yield { type: 'start', requestId: request.requestId, model: request.model, useFilesApi: request.useFilesApi, fps: request.fps };
  try {
    const messages = await prepareMessages(requestClient, request);
    const stream = await requestClient.createChatCompletionStream({
      model: request.model,
      messages: messages as never,
      stream_options: { include_usage: true },
      ...(request.maxTokens ? { max_tokens: request.maxTokens } : {}),
      ...(request.thinking ? { thinking: request.thinking } : {}),
    }, { signal: input.signal });
    for await (const chunk of stream) {
      const choice = chunk.choices?.[0];
      const delta = choice?.delta;
      if (delta?.content) {
        yield { type: 'delta', requestId: request.requestId, delta: delta.content };
      }
      if (delta?.reasoning_content) {
        yield { type: 'reasoning_delta', requestId: request.requestId, delta: delta.reasoning_content };
      }
      if (chunk.usage) {
        yield { type: 'usage', requestId: request.requestId, usage: chunk.usage as unknown as Record<string, unknown> };
      }
    }
    yield { type: 'done', requestId: request.requestId, finishReason: 'stop' };
  } catch (error) {
    logger.error('ark video understanding failed', {
      requestId: request.requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    yield { type: 'error', requestId: request.requestId, message: error instanceof Error ? error.message : '视频理解请求失败' };
  }
}
