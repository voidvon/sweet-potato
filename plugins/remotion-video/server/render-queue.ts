import {randomUUID} from "node:crypto";
import path from "node:path";
import {rm} from "node:fs/promises";
import {
  makeCancelSignal,
  renderMedia,
  selectComposition,
} from "@remotion/renderer";
import type {RenderRequest} from "./schema";

type JobStatus =
  | "queued"
  | "in-progress"
  | "completed"
  | "failed"
  | "cancelled";

export type RenderJob = {
  id: string;
  status: JobStatus;
  progress: number;
  data: RenderRequest;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  videoUrl?: string;
  error?: string;
};

type InternalJob = RenderJob & {cancel?: () => void};

export const makeRenderQueue = ({
  serveUrl,
  rendersDir,
  maxConcurrentRenders,
  renderConcurrency,
}: {
  serveUrl: string;
  rendersDir: string;
  maxConcurrentRenders: number;
  renderConcurrency: number | string | null;
}) => {
  const jobs = new Map<string, InternalJob>();
  const pending: string[] = [];
  let activeRenders = 0;

  const getJob = (jobId: string): RenderJob | undefined => {
    const job = jobs.get(jobId);
    if (!job) return undefined;
    const publicJob: InternalJob = {...job};
    delete publicJob.cancel;
    return publicJob;
  };

  const processRender = async (jobId: string) => {
    const job = jobs.get(jobId);
    if (!job || job.status !== "queued") return;

    const {cancel, cancelSignal} = makeCancelSignal();
    job.status = "in-progress";
    job.startedAt = new Date().toISOString();
    job.cancel = cancel;
    const isCancelled = () => jobs.get(jobId)?.status === "cancelled";
    const outputLocation = path.join(rendersDir, `${jobId}.mp4`);
    const chromiumOptions = {gl: "angle" as const};

    try {
      const composition = await selectComposition({
        serveUrl,
        id: job.data.compositionId,
        inputProps: job.data.inputProps,
        chromiumOptions,
      });

      await renderMedia({
        cancelSignal,
        serveUrl,
        composition,
        inputProps: job.data.inputProps,
        codec: "h264",
        chromiumOptions,
        concurrency: renderConcurrency,
        onProgress: ({progress}) => {
          if (job.status === "in-progress") job.progress = progress;
        },
        outputLocation,
      });

      if (!isCancelled()) {
        job.status = "completed";
        job.progress = 1;
        job.completedAt = new Date().toISOString();
        job.videoUrl = `/renders/${jobId}/video`;
        delete job.cancel;
      } else {
        await rm(outputLocation, {force: true});
      }
    } catch (error) {
      await rm(outputLocation, {force: true});
      if (!isCancelled()) {
        job.status = "failed";
        job.completedAt = new Date().toISOString();
        job.error = error instanceof Error ? error.message : String(error);
        delete job.cancel;
      }
    }
  };

  const drainQueue = () => {
    while (activeRenders < maxConcurrentRenders) {
      const jobId = pending.shift();
      if (!jobId) return;
      const job = jobs.get(jobId);
      if (!job || job.status !== "queued") continue;

      activeRenders++;
      void processRender(jobId).finally(() => {
        activeRenders--;
        drainQueue();
      });
    }
  };

  const createJob = (data: RenderRequest) => {
    const id = randomUUID();
    jobs.set(id, {
      id,
      status: "queued",
      progress: 0,
      data,
      createdAt: new Date().toISOString(),
    });
    pending.push(id);
    drainQueue();
    return id;
  };

  const cancelJob = async (jobId: string) => {
    const job = jobs.get(jobId);
    if (!job) return "not-found" as const;
    if (job.status !== "queued" && job.status !== "in-progress") {
      await rm(path.join(rendersDir, `${jobId}.mp4`), {force: true});
      jobs.delete(jobId);
      return "deleted" as const;
    }

    job.status = "cancelled";
    job.completedAt = new Date().toISOString();
    job.cancel?.();
    delete job.cancel;
    return "cancelled" as const;
  };

  return {cancelJob, createJob, getJob};
};
