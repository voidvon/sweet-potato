import path from "node:path";
import { mkdir } from "node:fs/promises";
import { bundle } from "@remotion/bundler";
import { ensureBrowser } from "@remotion/renderer";
import { makeRenderQueue } from "./render-queue";
import { createRenderSchema } from "./schema";
import { CURRENT_JSON_VIDEO_VERSION } from "../src/JsonVideo/schema";
import { remotionVideoCapabilities } from "./capabilities";

const packageMetadata = (await Bun.file(path.resolve("package.json")).json()) as {
  version?: string;
};

const port = parsePositiveInteger(Bun.env.PORT, 3000, "PORT");
const hostname = Bun.env.HOST?.trim() || "127.0.0.1";
const maxConcurrentRenders = parsePositiveInteger(
  Bun.env.MAX_CONCURRENT_RENDERS,
  1,
  "MAX_CONCURRENT_RENDERS",
);
const maxRequestBytes = parsePositiveInteger(
  Bun.env.MAX_RENDER_REQUEST_BYTES,
  10 * 1024 * 1024,
  "MAX_RENDER_REQUEST_BYTES",
);
const renderConcurrency = parseRenderConcurrency(Bun.env.REMOTION_CONCURRENCY);
const rendersDir = path.resolve(Bun.env.RENDERS_DIR ?? "renders");

function parsePositiveInteger(
  raw: string | undefined,
  fallback: number,
  name: string,
) {
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function parseRenderConcurrency(
  raw: string | undefined,
): number | string | null {
  if (raw === undefined || raw === "") return null;
  if (/^\d+%$/.test(raw)) return raw;
  return parsePositiveInteger(raw, 1, "REMOTION_CONCURRENCY");
}

const json = (body: unknown, status = 200) => Response.json(body, { status });

await mkdir(rendersDir, { recursive: true });
await ensureBrowser();

const configuredServeUrl = Bun.env.REMOTION_SERVE_URL;
const serveUrl = configuredServeUrl
  ? /^https?:\/\//.test(configuredServeUrl)
    ? configuredServeUrl
    : path.resolve(configuredServeUrl)
  : await bundle({
      entryPoint: path.resolve("src/index.ts"),
      onProgress: (progress) => {
        console.info(`Bundling Remotion project: ${progress}%`);
      },
      webpackOverride: (config) => config,
    });

const queue = makeRenderQueue({
  serveUrl,
  rendersDir,
  maxConcurrentRenders,
  renderConcurrency,
});

const server = Bun.serve({
  hostname,
  port,
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return json({
        status: "ok",
        service: "agent-tool-remotion-video",
        version: packageMetadata.version || "unknown",
        schemaVersion: CURRENT_JSON_VIDEO_VERSION,
      });
    }

    if (request.method === "GET" && url.pathname === "/capabilities") {
      return json(remotionVideoCapabilities);
    }

    if (request.method === "POST" && url.pathname === "/validate") {
      const contentLength = Number(request.headers.get("content-length") || 0);
      if (contentLength > maxRequestBytes) {
        return json({ valid: false, message: "Validation request is too large" }, 413);
      }

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json({ valid: false, message: "Request body must be valid JSON" }, 400);
      }

      const parsed = createRenderSchema.safeParse(body);
      if (!parsed.success) {
        return json(
          {
            valid: false,
            message: "Invalid JsonVideo document",
            issues: parsed.error.issues,
          },
          400,
        );
      }
      return json({
        valid: true,
        compositionId: parsed.data.compositionId,
        schemaVersion: parsed.data.inputProps.version,
      });
    }

    if (request.method === "POST" && url.pathname === "/renders") {
      const contentLength = Number(request.headers.get("content-length") || 0);
      if (contentLength > maxRequestBytes) {
        return json({ message: "Render request is too large" }, 413);
      }

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json({ message: "Request body must be valid JSON" }, 400);
      }

      const parsed = createRenderSchema.safeParse(body);
      if (!parsed.success) {
        return json(
          { message: "Invalid render request", issues: parsed.error.issues },
          400,
        );
      }

      const jobId = queue.createJob(parsed.data);
      return json({ jobId, statusUrl: `/renders/${jobId}` }, 202);
    }

    const statusMatch = url.pathname.match(/^\/renders\/([^/]+)$/);
    if (request.method === "GET" && statusMatch) {
      const job = queue.getJob(statusMatch[1]);
      return job ? json(job) : json({ message: "Job not found" }, 404);
    }

    if (request.method === "DELETE" && statusMatch) {
      const result = await queue.cancelJob(statusMatch[1]);
      if (result === "not-found") {
        return json({ message: "Job not found" }, 404);
      }
      return json({ message: result === "deleted" ? "Job deleted" : "Job cancelled" });
    }

    const videoMatch = url.pathname.match(/^\/renders\/([^/]+)\/video$/);
    if (request.method === "GET" && videoMatch) {
      const job = queue.getJob(videoMatch[1]);
      if (!job || job.status !== "completed") {
        return json({ message: "Video not found" }, 404);
      }
      const file = Bun.file(path.join(rendersDir, `${job.id}.mp4`));
      if (!(await file.exists())) {
        return json({ message: "Video file not found" }, 404);
      }
      return new Response(file, { headers: { "Content-Type": "video/mp4" } });
    }

    return json({ message: "Not found" }, 404);
  },
});

console.info(`Managed Remotion render server running at ${server.url}`);
console.info(
  `Render capacity: ${maxConcurrentRenders} job(s), frame concurrency: ${renderConcurrency ?? "auto"}`,
);
