import { openaiImagesProvider } from './providers/openai-images.js';
import { volcengineSeedreamProvider } from './providers/volcengine-seedream.js';
import type { ImageModelProvider } from './image-model-provider.types.js';

const providers: ImageModelProvider[] = [volcengineSeedreamProvider, openaiImagesProvider];

export function listImageModelProviders() {
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
