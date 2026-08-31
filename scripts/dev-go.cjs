const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");

const backendDir = path.resolve(__dirname, "..", "backend");
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

function scheduleRestart(filename) {
  if (!isGoSource(filename) || stopping) {
    return;
  }
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    restartTimer = null;
    log(`Change detected: ${filename}`);
    void restartGoProcess();
  }, restartDelayMs);
}

async function shutdown(code) {
  if (stopping) {
    return;
  }
  stopping = true;
  clearTimeout(restartTimer);
  watcher.close();
  await stopGoProcess();
  process.exit(code);
}

const watcher = fs.watch(backendDir, { recursive: true }, (_eventType, filename) => {
  scheduleRestart(filename);
});

watcher.on("error", (error) => {
  console.error(`[go-dev] File watcher failed: ${error.message}`);
  void shutdown(1);
});

process.once("SIGINT", () => { void shutdown(130); });
process.once("SIGTERM", () => { void shutdown(143); });

startGoProcess();
