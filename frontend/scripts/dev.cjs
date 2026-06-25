const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const preferredPort = Number(process.env.FRONTEND_PORT || 9527);
const rootDir = process.cwd();
const webDir = path.join(rootDir, 'web');
const viteCli = path.join(rootDir, 'node_modules', 'vite', 'bin', 'vite.js');
const userDataDir = path.join(rootDir, '..', '.codex-run', 'electron-user-data-dev');
const electronExe = process.platform === 'win32'
  ? path.join(rootDir, 'node_modules', 'electron', 'dist', 'electron.exe')
  : path.join(rootDir, 'node_modules', 'electron', 'dist', 'electron');

const childProcesses = [];
let shuttingDown = false;

function log(message) {
  process.stdout.write(`${message}\n`);
}

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
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

function waitForHttp(url, timeoutMs) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const request = http.get(url, (response) => {
        response.resume();
        resolve();
      });

      request.on('error', () => {
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

  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    return;
  }

  child.kill('SIGTERM');
}

function registerCleanup() {
  const cleanup = () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    for (const child of childProcesses) {
      terminateProcess(child);
    }
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  process.on('exit', cleanup);
}

function spawnTracked(name, command, args, cwd, env) {
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: 'inherit',
    windowsHide: false,
  });

  childProcesses.push(child);

  child.on('exit', (code, signal) => {
    if (shuttingDown) {
      return;
    }
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    if (code && code !== 0) {
      console.error(`[dev] ${name} exited with code ${code}`);
      process.exit(code);
    }
  });

  return child;
}

async function main() {
  const port = await findAvailablePort(preferredPort);
  if (port !== preferredPort) {
    log(`[dev] Port ${preferredPort} is in use, using ${port} for both Vite and Electron.`);
  }

  registerCleanup();

  const env = {
    ...process.env,
    ELECTRON_USER_DATA_DIR: userDataDir,
    FRONTEND_PORT: String(port),
  };

  log('[dev] Starting Vite dev server');
  spawnTracked(
    'vite',
    process.execPath,
    [viteCli, '--configLoader', 'runner', '--host', '0.0.0.0', '--port', String(port)],
    webDir,
    env,
  );

  await waitForHttp(`http://127.0.0.1:${port}/`, 30000);

  log('[dev] Starting Electron shell');
  fs.mkdirSync(userDataDir, { recursive: true });
  spawnTracked(
    'electron',
    electronExe,
    [
      '.',
      '--env=local',
      '--disable-gpu',
      '--disable-gpu-compositing',
      '--disable-software-rasterizer',
      '--in-process-gpu',
      '--use-angle=swiftshader',
      `--user-data-dir=${userDataDir}`,
    ],
    rootDir,
    env,
  );
}

main().catch((error) => {
  console.error(`[dev] ${error.message}`);
  process.exit(1);
});
