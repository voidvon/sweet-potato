import { volcengineSeedanceProvider } from './providers/volcengine-seedance.js';
import type { VideoModelProvider } from './video-model-provider.types.js';

const providers: VideoModelProvider[] = [
  volcengineSeedanceProvider,
];

export function listVideoModelProviders() {
  return providers.map((provider) => ({
    id: provider.id,
    name: provider.name,
    description: provider.description,
    keyLabel: provider.keyLabel,
    keyPlaceholder: provider.keyPlaceholder,
    keyHelp: provider.keyHelp,
    defaultBaseUrl: provider.defaultBaseUrl,
    defaultModel: provider.defaultModel,
    models: provider.models,
  }));
}

export function getVideoModelProvider(id: string) {
  return providers.find((provider) => provider.id === id) || providers[0];
}
