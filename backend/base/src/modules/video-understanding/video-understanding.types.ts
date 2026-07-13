export type VideoUnderstandingSource = {
  fileId?: string;
  url?: string;
  data?: string;
  filePath?: string;
  mimeType?: string;
  filename?: string;
  format?: string;
  fps?: number;
  detail?: 'low' | 'high' | 'xhigh';
};

export type VideoUnderstandingContent =
  | { type: 'text'; text: string }
  | { type: 'input_text'; text: string }
  | ({ type: 'video_url'; video_url: VideoUnderstandingSource & { fps?: number } })
  | ({ type: 'image_url'; image_url: VideoUnderstandingSource & { detail?: 'low' | 'high' | 'xhigh' } })
  | ({ type: 'input_audio'; input_audio: VideoUnderstandingSource } );

export type VideoUnderstandingMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string | VideoUnderstandingContent[];
};

export type VideoUnderstandingRequest = {
  requestId?: string;
  model?: string;
  prompt?: string;
  systemPrompt?: string;
  messages?: VideoUnderstandingMessage[];
  inputs?: VideoUnderstandingContent[];
  fps?: number;
  useFilesApi?: boolean;
  maxTokens?: number;
  thinking?: { type: 'enabled' | 'disabled' | 'auto' };
  signal?: AbortSignal;
};

export type VideoUnderstandingEvent =
  | { type: 'start'; requestId: string; model: string; useFilesApi: boolean; fps: number }
  | { type: 'delta'; requestId: string; delta: string }
  | { type: 'reasoning_delta'; requestId: string; delta: string }
  | { type: 'usage'; requestId: string; usage: Record<string, unknown> }
  | { type: 'done'; requestId: string; finishReason?: string }
  | { type: 'error'; requestId: string; message: string };
