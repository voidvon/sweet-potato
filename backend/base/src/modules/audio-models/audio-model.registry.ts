import { mimoTtsVoicecloneProvider } from './providers/mimo-tts-voiceclone.js';
import { qwenVoiceEnrollmentProvider } from './providers/qwen-voice-enrollment.js';
import type { AudioModelProvider } from './audio-model-provider.types.js';

const providers: AudioModelProvider[] = [
  mimoTtsVoicecloneProvider,
  qwenVoiceEnrollmentProvider,
];

export function listAudioModelProviders() {
  return providers.map((provider) => ({
    id: provider.id,
    name: provider.name,
    description: provider.description,
    keyLabel: provider.keyLabel,
    keyPlaceholder: provider.keyPlaceholder,
    keyHelp: provider.keyHelp,
    baseUrlLabel: provider.baseUrlLabel,
    baseUrlPlaceholder: provider.baseUrlPlaceholder,
    baseUrlHelp: provider.baseUrlHelp,
    defaultBaseUrl: provider.defaultBaseUrl,
    defaultModel: provider.defaultModel,
  }));
}

export function getAudioModelProvider(id: string) {
  return providers.find((provider) => provider.id === id) || providers[0];
}
