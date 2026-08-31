const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");

const preferredPort = Number(process.env.FRONTEND_PORT || 9527);
const preferredBackendPort = Number(process.env.BACKEND_PORT || process.env.PORT || 7072);
const rootDir = path.resolve(__dirname, "..");
const projectRootDir = path.resolve(rootDir, "..");
const goDevScript = path.join(projectRootDir, "scripts", "dev-go.cjs");
const webDir = rootDir;
const viteCli = path.join(rootDir, "node_modules", "vite", "bin", "vite.js");

const childProcesses = [];
const pendingGracefulStops = new WeakMap();
let shuttingDown = false;

function log(message) {
  process.stdout.write(`${message}\n`);
}

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "0.0.0.0");
  });
}

async function findAvailablePort(startPort) {
  for (let port = startPort; port < startPort + 100; port += 1) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available frontend port found from ${startPort} to ${startPort + 99}`);
}

function isHttpReady(url, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const request = http.get(url, (response) => {
      response.resume();
      resolve(response.statusCode >= 200 && response.statusCode < 300);
    });
    request.setTimeout(timeoutMs, () => request.destroy());
    request.on("error", () => resolve(false));
  });
}

function waitForHttp(url, timeoutMs, child) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const request = http.get(url, (response) => {
        response.resume();
        resolve();
      });
      request.on("error", () => {
        if (child && child.exitCode !== null) {
          reject(new Error(`Go backend exited before becoming ready (code ${child.exitCode})`));
          return;
        }
        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error(`Service did not become ready in time: ${url}`));
          return;
        }
        setTimeout(tryOnce, 500);
      });
    };
    tryOnce();
  });
}

function waitForChildExit(child, timeoutMs) {
  if (!child || child.exitCode !== null) {
    return Promise.resolve();
  }
  const existing = pendingGracefulStops.get(child);
  if (existing) {
    return existing;
  }
  const promise = new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  pendingGracefulStops.set(child, promise);
  return promise;
}

function forceTerminateProcess(child) {
  if (!child || child.killed || child.exitCode !== null) {
    return;
  }
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
    } catch {
      // Ignore cleanup failures during shutdown.
    }
    return;
  }
  try {
    child.kill("SIGKILL");
  } catch {
    // Ignore cleanup failures during shutdown.
  }
}

async function terminateProcess(child) {
  if (!child || child.killed || child.exitCode !== null) {
    return;
  }
  try {
    child.kill("SIGTERM");
  } catch {
    return;
  }
  await waitForChildExit(child, 1200);
  if (child.exitCode === null) {
    forceTerminateProcess(child);
  }
}

async function cleanupAndExit(code) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  for (const child of childProcesses.slice().reverse()) {
    await terminateProcess(child);
  }
  process.exit(code);
}

function registerCleanup() {
  process.once("SIGINT", () => { void cleanupAndExit(130); });
  process.once("SIGTERM", () => { void cleanupAndExit(143); });
  process.once("exit", () => {
    for (const child of childProcesses.slice().reverse()) {
      forceTerminateProcess(child);
    }
  });
}

function spawnTracked(name, command, args, cwd, env) {
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: "inherit",
    windowsHide: false,
  });
  childProcesses.push(child);
  child.on("error", (error) => {
    if (!shuttingDown) {
      console.error(`[dev] failed to start ${name}: ${error.message}`);
      void cleanupAndExit(1);
    }
  });
  child.on("exit", (code, signal) => {
    if (shuttingDown) {
      return;
    }
    if (signal) {
      void cleanupAndExit(signal === "SIGINT" ? 130 : 143);
    } else if (code && code !== 0) {
      console.error(`[dev] ${name} exited with code ${code}`);
      void cleanupAndExit(code);
    }
  });
  return child;
}

async function main() {
  const port = await findAvailablePort(preferredPort);
  if (port !== preferredPort) {
    log(`[dev] Port ${preferredPort} is in use, using ${port} for Vite.`);
  }
  registerCleanup();

  const backendBaseUrl = process.env.VITE_API_BASE_URL
    || `http://127.0.0.1:${preferredBackendPort}`;
  const backendHealthUrl = `${backendBaseUrl.replace(/\/$/, "")}/api/health`;
  const env = {
    ...process.env,
    DATA_DIR: process.env.DATA_DIR || path.join(projectRootDir, "data"),
    FRONTEND_PORT: String(port),
    GO_SERVER_ADDR: process.env.GO_SERVER_ADDR || `127.0.0.1:${preferredBackendPort}`,
    BACKEND_PROXY_TARGET: backendBaseUrl,
    REMOTION_PLUGIN_DIR: process.env.REMOTION_PLUGIN_DIR || path.join(projectRootDir, "plugins", "remotion-video"),
  };

  if (await isHttpReady(backendHealthUrl)) {
    log(`[dev] Reusing Go backend at ${backendBaseUrl} (automatic Go reload is disabled for reused processes)`);
  } else {
    if (!await isPortAvailable(preferredBackendPort)) {
      throw new Error(`Backend port ${preferredBackendPort} is in use, but ${backendHealthUrl} is not healthy.`);
    }
    log(`[dev] Starting Go backend with hot reload at ${backendBaseUrl}`);
    const backendProcess = spawnTracked(
      "Go backend watcher",
      process.execPath,
      [goDevScript],
      projectRootDir,
      { ...env, GOTOOLCHAIN: process.env.GOTOOLCHAIN || "auto" },
    );
    await waitForHttp(backendHealthUrl, 120000, backendProcess);
  }

  log("[dev] Starting Vite dev server");
  spawnTracked(
    "vite",
    process.execPath,
    [viteCli, "--configLoader", "runner", "--host", "0.0.0.0", "--port", String(port)],
    webDir,
    env,
  );
  await waitForHttp(`http://127.0.0.1:${port}/`, 30000);
  log(`[dev] Web ready at http://127.0.0.1:${port}/`);
  log(`[dev] Admin ready at http://127.0.0.1:${port}/admin/`);
}

main().catch((error) => {
  console.error(`[dev] ${error.message}`);
  void cleanupAndExit(1);
});
