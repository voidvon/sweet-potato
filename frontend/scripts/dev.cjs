const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");

const preferredPort = Number(process.env.FRONTEND_PORT || 9527);
const rootDir = process.cwd();
const webDir = path.join(rootDir, "web");
const electronSourceDir = path.join(rootDir, "electron");
const electronPublicDir = path.join(rootDir, "public", "electron");
const viteCli = path.join(rootDir, "node_modules", "vite", "bin", "vite.js");
const userDataDir = path.join(
  rootDir,
  "..",
  ".codex-run",
  "electron-user-data-dev",
);

function resolveElectronExecutable() {
  try {
    const executable = require("electron");
    if (!executable || !fs.existsSync(executable)) {
      throw new Error(
        `Resolved Electron executable does not exist: ${executable}`,
      );
    }
    return executable;
  } catch (error) {
    throw new Error(`Unable to resolve Electron executable: ${error.message}`);
  }
}

const childProcesses = [];
let shuttingDown = false;
let electronChild = null;
let electronWatcher = null;
let electronRestartPending = false;
let electronRestartTimer = null;
let sharedEnv = null;

function log(message) {
  process.stdout.write(`${message}\n`);
}

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "127.0.0.1");
  });
}

async function findAvailablePort(startPort) {
  for (let port = startPort; port < startPort + 100; port += 1) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }

  throw new Error(
    `No available frontend port found from ${startPort} to ${startPort + 99}`,
  );
}

function waitForHttp(url, timeoutMs) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const request = http.get(url, (response) => {
        response.resume();
        resolve();
      });

      request.on("error", () => {
        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error(`Frontend did not become ready in time: ${url}`));
          return;
        }
        setTimeout(tryOnce, 500);
      });
    };

    tryOnce();
  });
}

function terminateProcess(child) {
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
    child.kill("SIGTERM");
  } catch {
    // Ignore cleanup failures during shutdown.
  }
}

function isElectronWatchTarget(filePath = "") {
  return /\.(js|json)$/i.test(filePath);
}

function clearElectronRestartTimer() {
  if (electronRestartTimer) {
    clearTimeout(electronRestartTimer);
    electronRestartTimer = null;
  }
}

function syncElectronSourceToPublic() {
  const targets = ["config", "controller", "preload", "service", "main.js"];

  fs.mkdirSync(electronPublicDir, { recursive: true });

  for (const target of targets) {
    const sourcePath = path.join(electronSourceDir, target);
    const destinationPath = path.join(electronPublicDir, target);

    if (!fs.existsSync(sourcePath)) {
      continue;
    }

    fs.cpSync(sourcePath, destinationPath, {
      force: true,
      recursive: true,
    });
  }
}

function startElectronShell(env) {
  syncElectronSourceToPublic();
  log("[dev] Starting Electron shell");
  fs.mkdirSync(userDataDir, { recursive: true });
  const electronExe = resolveElectronExecutable();

  if (!fs.existsSync(electronExe)) {
    throw new Error(
      `Electron executable not found: ${electronExe}. Run pnpm install in ${rootDir}.`,
    );
  }

  const child = spawn(
    electronExe,
    [
      ".",
      "--env=local",
      "--disable-gpu",
      "--disable-gpu-compositing",
      "--disable-software-rasterizer",
      "--in-process-gpu",
      "--use-angle=swiftshader",
      `--user-data-dir=${userDataDir}`,
    ],
    {
      cwd: rootDir,
      env,
      stdio: "inherit",
      windowsHide: false,
    },
  );

  electronChild = child;
  childProcesses.push(child);

  child.on("error", (error) => {
    if (shuttingDown) {
      return;
    }
    console.error(`[dev] failed to start Electron shell: ${error.message}`);
    cleanupAndExit(1);
  });

  child.on("exit", (code, signal) => {
    if (shuttingDown) {
      return;
    }

    const expectedRestart = electronRestartPending && child === electronChild;
    if (expectedRestart) {
      electronRestartPending = false;
      startElectronShell(sharedEnv);
      return;
    }

    if (signal) {
      cleanupAndExit(signal === "SIGINT" ? 130 : 143);
      return;
    }
    if (code && code !== 0) {
      console.error(`[dev] electron exited with code ${code}`);
      cleanupAndExit(code);
    }
  });
}

function restartElectronShell(reason) {
  if (shuttingDown || !sharedEnv) {
    return;
  }

  clearElectronRestartTimer();
  syncElectronSourceToPublic();

  if (!electronChild || electronChild.exitCode !== null) {
    log(`[dev] Electron source changed (${reason}), starting Electron shell`);
    startElectronShell(sharedEnv);
    return;
  }

  log(`[dev] Electron source changed (${reason}), restarting Electron shell`);
  electronRestartPending = true;
  terminateProcess(electronChild);
}

function scheduleElectronRestart(reason) {
  if (shuttingDown) {
    return;
  }

  clearElectronRestartTimer();
  electronRestartTimer = setTimeout(() => {
    restartElectronShell(reason);
  }, 200);
}

function watchElectronSource() {
  if (process.platform !== "win32") {
    return;
  }

  if (electronWatcher) {
    return;
  }

  electronWatcher = fs.watch(
    electronSourceDir,
    { recursive: true },
    (_eventType, fileName) => {
      const relativePath = typeof fileName === "string" ? fileName : "";
      if (!isElectronWatchTarget(relativePath)) {
        return;
      }
      scheduleElectronRestart(relativePath);
    },
  );

  electronWatcher.on("error", (error) => {
    if (shuttingDown) {
      return;
    }
    console.error(`[dev] Electron watcher failed: ${error.message}`);
  });
}

function cleanupAndExit(code) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  clearElectronRestartTimer();
  if (electronWatcher) {
    try {
      electronWatcher.close();
    } catch {
      // Ignore cleanup failures during shutdown.
    }
  }
  for (const child of childProcesses.slice().reverse()) {
    terminateProcess(child);
  }
  process.exit(code);
}

function registerCleanup() {
  process.once("SIGINT", () => cleanupAndExit(130));
  process.once("SIGTERM", () => cleanupAndExit(143));
  process.once("exit", () => {
    for (const child of childProcesses.slice().reverse()) {
      terminateProcess(child);
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
    if (shuttingDown) {
      return;
    }
    console.error(`[dev] failed to start ${name}: ${error.message}`);
    cleanupAndExit(1);
  });

  child.on("exit", (code, signal) => {
    if (shuttingDown) {
      return;
    }
    if (signal) {
      cleanupAndExit(signal === "SIGINT" ? 130 : 143);
      return;
    }
    if (code && code !== 0) {
      console.error(`[dev] ${name} exited with code ${code}`);
      cleanupAndExit(code);
    }
  });

  return child;
}

async function main() {
  const port = await findAvailablePort(preferredPort);
  if (port !== preferredPort) {
    log(
      `[dev] Port ${preferredPort} is in use, using ${port} for both Vite and Electron.`,
    );
  }

  registerCleanup();

  const env = {
    ...process.env,
    ELECTRON_USER_DATA_DIR: userDataDir,
    FRONTEND_PORT: String(port),
  };
  sharedEnv = env;

  log("[dev] Starting Vite dev server");
  spawnTracked(
    "vite",
    process.execPath,
    [
      viteCli,
      "--configLoader",
      "runner",
      "--host",
      "0.0.0.0",
      "--port",
      String(port),
    ],
    webDir,
    env,
  );

  await waitForHttp(`http://127.0.0.1:${port}/`, 30000);

  watchElectronSource();
  startElectronShell(env);
}

main().catch((error) => {
  console.error(`[dev] ${error.message}`);
  process.exit(1);
});
