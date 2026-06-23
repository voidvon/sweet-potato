export type AudioModelProviderConfig = {
  apiKey: string;
  baseUrl?: string;
};

export type VoiceCloneInput = {
  preferredName: string;
  audioBuffer: Buffer;
  audioMimeType: string;
};

export type VoiceCloneResult = {
  providerVoiceId: string;
  rawResponse: Record<string, unknown>;
};

export type SpeechSynthesisInput = {
  text: string;
  voiceId?: string;
  speed?: number;
};

export type SpeechSynthesisResult = {
  buffer: Buffer;
  mimeType: string;
};

export type AudioModelProvider = {
  id: string;
  name: string;
  description: string;
  keyLabel: string;
  keyPlaceholder: string;
  keyHelp?: string;
  baseUrlLabel?: string;
  baseUrlPlaceholder?: string;
  baseUrlHelp?: string;
  defaultBaseUrl?: string;
  defaultModel: string;
  cloneVoice(input: VoiceCloneInput, config: AudioModelProviderConfig): Promise<VoiceCloneResult>;
  synthesizeSpeech?(input: SpeechSynthesisInput, config: AudioModelProviderConfig): Promise<SpeechSynthesisResult>;
};
