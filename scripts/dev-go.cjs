const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");

const backendDir = path.resolve(__dirname, "..", "backend");
const projectRootDir = path.resolve(__dirname, "..");
const pluginDir = process.env.REMOTION_PLUGIN_DIR || path.join(projectRootDir, "plugins", "remotion-video");
const restartDelayMs = 250;

let goProcess = null;
let restartTimer = null;
let restartCount = 0;
let stopping = false;
let restarting = false;

function log(message) {
  process.stdout.write(`[go-dev] ${message}\n`);
}

function isGoSource(filename) {
  if (!filename) {
    return false;
  }
  const normalized = String(filename).replaceAll("\\", "/");
  return normalized.endsWith(".go")
    || normalized === "go.mod"
    || normalized === "go.sum";
}

function isRemotionSource(filename) {
  if (!filename) {
    return false;
  }
  const normalized = String(filename).replaceAll("\\", "/");
  if (normalized.startsWith("node_modules/") || normalized.startsWith("renders/")) {
    return false;
  }
  return normalized.endsWith(".ts")
    || normalized.endsWith(".tsx")
    || normalized === "package.json"
    || normalized === "remotion.config.ts";
}

function waitForExit(child, timeoutMs) {
  if (!child || child.exitCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

function killProcessTree(child, signal = "SIGTERM") {
  if (!child || child.exitCode !== null) {
    return;
  }
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill", ["/PID", String(child.pid), "/T", signal === "SIGKILL" ? "/F" : ""].filter(Boolean), {
        stdio: "ignore",
        windowsHide: true,
      });
    } catch {
      // The process may already have exited.
    }
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch {
    // The process group may already have exited.
  }
}

async function stopGoProcess() {
  const child = goProcess;
  goProcess = null;
  if (!child || child.exitCode !== null) {
    return;
  }
  killProcessTree(child, "SIGTERM");
  if (!await waitForExit(child, 1500)) {
    killProcessTree(child, "SIGKILL");
    await waitForExit(child, 500);
  }
}

function startGoProcess() {
  if (stopping) {
    return;
  }
  log(restartCount === 0 ? "Starting Go backend" : "Restarting Go backend");
  const child = spawn("go", ["run", "./cmd/sweetpotato"], {
    cwd: backendDir,
    env: process.env,
    stdio: "inherit",
    windowsHide: false,
    detached: process.platform !== "win32",
  });
  goProcess = child;
  child.on("error", (error) => {
    console.error(`[go-dev] Failed to start Go backend: ${error.message}`);
    if (restartCount === 0) {
      void shutdown(1);
    }
  });
  child.on("exit", (code, signal) => {
    if (goProcess === child) {
      goProcess = null;
    }
    if (stopping || restarting) {
      return;
    }
    if (restartCount === 0 && (code || signal)) {
      void shutdown(code || 1);
      return;
    }
    log("Go backend stopped; waiting for a source change to restart it");
  });
}

async function restartGoProcess() {
  if (stopping || restarting) {
    return;
  }
  restarting = true;
  restartCount += 1;
  await stopGoProcess();
  restarting = false;
  startGoProcess();
}

function scheduleRestart(filename, sourceType) {
  const watched = sourceType === "Remotion"
    ? isRemotionSource(filename)
    : isGoSource(filename);
  if (!watched || stopping) {
    return;
  }
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    restartTimer = null;
    log(`${sourceType} change detected: ${filename}`);
    void restartGoProcess();
  }, restartDelayMs);
}

async function shutdown(code) {
  if (stopping) {
    return;
  }
  stopping = true;
  clearTimeout(restartTimer);
  for (const watcher of watchers) {
    watcher.close();
  }
  await stopGoProcess();
  process.exit(code);
}

const watchers = [];

function watchSource(directory, sourceType) {
  if (!fs.existsSync(directory)) {
    return;
  }
  const watchOptions = fs.statSync(directory).isDirectory() ? { recursive: true } : {};
  const watcher = fs.watch(directory, watchOptions, (_eventType, filename) => {
    scheduleRestart(filename, sourceType);
  });
  watcher.on("error", (error) => {
    console.error(`[go-dev] ${sourceType} file watcher failed: ${error.message}`);
    void shutdown(1);
  });
  watchers.push(watcher);
}

watchSource(backendDir, "Go");
watchSource(path.join(pluginDir, "server"), "Remotion");
watchSource(path.join(pluginDir, "src"), "Remotion");
watchSource(path.join(pluginDir, "package.json"), "Remotion");
watchSource(path.join(pluginDir, "remotion.config.ts"), "Remotion");

process.once("SIGINT", () => { void shutdown(130); });
process.once("SIGTERM", () => { void shutdown(143); });

startGoProcess();
