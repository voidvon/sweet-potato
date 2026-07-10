import { chatRepository } from '../chat/chat.repository.js';
import type { ChatImageGenerationFailure, ChatMessage } from '../chat/chat.types.js';
import { logger } from '../../shared/logger.js';
import { generationRepository } from './generation.repository.js';

export const interruptedImageGenerationMessage = '生成期间服务发生重启，本次任务已中断，请重新生成。';

export function interruptedImageGenerationContent(completedCount: number) {
  return completedCount > 0
    ? `已生成 ${completedCount} 张图片；其余图片因服务重启中断，请重新生成。`
    : `图片生成失败：${interruptedImageGenerationMessage}`;
}

function mergeFailures(
  message: ChatMessage,
  interruptedSlots: number[],
): ChatImageGenerationFailure[] {
  const failuresBySlot = new Map(
    (message.imageGenerationFailures || []).map((failure) => [failure.slotIndex, failure]),
  );
  interruptedSlots.forEach((slotIndex) => {
    failuresBySlot.set(slotIndex, {
      slotIndex,
      message: interruptedImageGenerationMessage,
    });
  });
  return [...failuresBySlot.values()].sort((left, right) => left.slotIndex - right.slotIndex);
}

export function recoverInterruptedImageGenerations() {
  const jobs = generationRepository.listIncompleteImageJobs();
  jobs.forEach((job) => {
    const items = generationRepository.listItems(job.id);
    const interruptedItems = items.filter((item) => item.status === 'queued' || item.status === 'running');
    interruptedItems.forEach((item) => {
      generationRepository.updateItem({
        jobId: job.id,
        slotIndex: item.slotIndex,
        status: 'failed',
        error: interruptedImageGenerationMessage,
      });
    });

    const recoveredJob = generationRepository.finalizeJob({
      jobId: job.id,
      error: interruptedItems.length ? interruptedImageGenerationMessage : null,
    });
    const assistantMessage = job.assistantMessageId
      ? chatRepository.findMessage(job.assistantMessageId)
      : undefined;
    if (assistantMessage) {
      chatRepository.replaceMessageContent({
        id: assistantMessage.id,
        content: interruptedItems.length
          ? interruptedImageGenerationContent(recoveredJob?.completedCount || 0)
          : assistantMessage.content,
        attachments: assistantMessage.attachments,
        capabilityContext: assistantMessage.capabilityContext,
        imageModelConfigId: assistantMessage.imageModelConfigId,
        generationJobId: job.id,
        imageGenerationExpectedCount: assistantMessage.imageGenerationExpectedCount || job.expectedCount,
        imageGenerationFailures: interruptedItems.length
          ? mergeFailures(
              assistantMessage,
              interruptedItems.map((item) => item.slotIndex),
            )
          : assistantMessage.imageGenerationFailures,
        updatedReasoningContent: assistantMessage.reasoningContent,
        isCompleted: true,
        creditCost: assistantMessage.creditCost,
      });
    }

    logger.warn('interrupted image generation marked as failed after server restart', {
      jobId: job.id,
      completedCount: recoveredJob?.completedCount || 0,
      interruptedCount: interruptedItems.length,
    });
  });
  return jobs.length;
}
