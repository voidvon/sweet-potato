import { registerImageCreativeCapabilityExecutors } from './image-generation.executor.js';
import { registerVideoCreativeCapabilityExecutors } from './video-generation.executor.js';

let initialized = false;

export function initializeCreativeCapabilityExecutors() {
  if (initialized) return;
  registerImageCreativeCapabilityExecutors();
  registerVideoCreativeCapabilityExecutors();
  initialized = true;
}
