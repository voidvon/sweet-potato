import { publishAppEvent } from '../app-events/app.events.js';
import type { BatchGenerationRunDetail } from './batch-generation.types.js';

export type BatchGenerationRunUpdatedEvent = {
  type: 'batch-generation-run-updated';
  userId: string;
  run: BatchGenerationRunDetail;
  at: string;
};

export function publishBatchGenerationRun(userId: string, run: BatchGenerationRunDetail) {
  publishAppEvent({
    type: 'batch-generation-run-updated',
    userId,
    run,
    at: new Date().toISOString(),
  });
}
