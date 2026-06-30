const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const https = require('node:https');
const { spawn, execFileSync } = require('node:child_process');

const rootDir = path.resolve(__dirname, '..');
const mode = process.argv[2] === 'electron' ? 'electron' : 'web';

const paths = {
  root: rootDir,
  codexRun: path.join(rootDir, '.codex-run'),
  pythonWorkerDir: path.join(rootDir, 'backend', 'ai-worker'),
  backendDir: path.join(rootDir, 'backend', 'base'),
  frontendDir: path.join(rootDir, 'frontend'),
  frontendWebDir: path.join(rootDir, 'frontend', 'web'),
  frontendAdminDir: path.join(rootDir, 'frontend', 'admin'),
};

const ports = {
  worker: Number(process.env.PYTHON_AI_WORKER_PORT || 7073),
  backend: Number(process.env.BACKEND_PORT || 7072),
  frontend: Number(process.env.FRONTEND_PORT || 9527),
  frontendAdmin: Number(process.env.FRONTEND_ADMIN_PORT || process.env.ADMIN_FRONTEND_PORT || 9528),
};

const childProcesses = [];
let shuttingDown = false;
const pendingGracefulStops = new WeakMap();
let frontendElectronProcess = null;
let pythonWorkerProcess = null;

function log(message) {
  process.stdout.write(`${message}\n`);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  cleanupAndExit(1);
}

function pathExists(target) {
  try {
    fs.accessSync(target);
    return true;
  } catch {
    return false;
  }
}

function resolvePython() {
  const candidates = [
    process.env.PYTHON,
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python311', 'python.exe'),
    path.join(process.env.ProgramFiles || '', 'Python311', 'python.exe'),
    'python',
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate === 'python') {
      try {
        execFileSync(candidate, ['--version'], { stdio: 'ignore' });
        return candidate;
      } catch {
        continue;
      }
    }

    if (pathExists(candidate)) {
      return candidate;
    }
  }

  fail('Python 3.11 is required. Install it or set the PYTHON environment variable.');
}

function ensureSupportedNode() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major !== 22) {
    fail(`Node.js 22 is required. Current version: ${process.version}`);
  }

  return process.execPath;
}

function ensureFile(filePath, label) {
  if (!pathExists(filePath)) {
    fail(`${label} not found: ${filePath}`);
  }
}

function getListeningPortInfo(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (error) => {
      if (error && error.code === 'EADDRINUSE') {
        resolve({ available: false });
        return;
      }
      resolve({ available: false, error });
    });
    server.once('listening', () => {
      server.close(() => resolve({ available: true }));
    });
    server.listen(port, '127.0.0.1');
  });
}

async function ensurePortFree(port, label) {
  const result = await getListeningPortInfo(port);
  if (!result.available) {
    fail(`${label} port ${port} is already in use. Stop the existing process first.`);
  }
}

function download(url, targetPath) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: { 'User-Agent': 'codex-dev-runner' },
    }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        download(response.headers.location, targetPath).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error(`Download failed with status ${response.statusCode}`));
        return;
      }

      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      const file = fs.createWriteStream(targetPath);
      response.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', reject);
    });

    request.on('error', reject);
  });
}

async function ensureBetterSqliteBinding() {
  const nodeAbi = process.versions.modules;
  const bindingPath = path.join(
    paths.backendDir,
    'node_modules',
    '.pnpm',
    'better-sqlite3@12.5.0',
    'node_modules',
    'better-sqlite3',
    'lib',
    'binding',
    `node-v${nodeAbi}-win32-x64`,
    'better_sqlite3.node',
  );

  if (pathExists(bindingPath)) {
    return;
  }

  const archiveName = `better-sqlite3-v12.5.0-node-v${nodeAbi}-win32-x64.tar.gz`;
  const archivePath = path.join(paths.codexRun, archiveName);
  const extractDir = path.join(paths.codexRun, `better-sqlite3-node-v${nodeAbi}`);
  const assetUrl = `https://github.com/WiseLibs/better-sqlite3/releases/download/v12.5.0/${archiveName}`;

  log(`Downloading better-sqlite3 prebuilt binary for Node ABI ${nodeAbi}...`);
  if (!pathExists(archivePath)) {
    await download(assetUrl, archivePath);
  }

  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.mkdirSync(extractDir, { recursive: true });
  execFileSync('tar.exe', ['-xzf', archivePath, '-C', extractDir], { stdio: 'inherit' });

  const sourceBinding = path.join(extractDir, 'build', 'Release', 'better_sqlite3.node');
  ensureFile(sourceBinding, 'better-sqlite3 prebuilt binding');

  fs.mkdirSync(path.dirname(bindingPath), { recursive: true });
  fs.copyFileSync(sourceBinding, bindingPath);
}

function createEnv() {
  return {
    ...process.env,
    FRONTEND_PORT: String(ports.frontend),
    FRONTEND_ADMIN_PORT: String(ports.frontendAdmin),
    ADMIN_FRONTEND_PORT: String(ports.frontendAdmin),
    BACKEND_PORT: String(ports.backend),
    PYTHON_AI_WORKER_PORT: String(ports.worker),
    PYTHON_AI_WORKER_URL: process.env.PYTHON_AI_WORKER_URL || `http://127.0.0.1:${ports.worker}`,
  };
}

function spawnService(name, command, args, cwd, extra = {}) {
  log(`Starting ${name}...`);

  const stdio = extra.ipc ? ['inherit', 'inherit', 'inherit', 'ipc'] : 'inherit';
  const child = spawn(command, args, {
    cwd,
    env: extra.env || process.env,
    stdio,
    windowsHide: false,
  });

  childProcesses.push(child);
  if (name === 'Python AI worker') {
    pythonWorkerProcess = child;
  }
  if (name === 'Frontend/Electron') {
    frontendElectronProcess = child;
  }

  child.on('exit', (code, signal) => {
    if (shuttingDown) {
      return;
    }
    if (signal) {
      process.stderr.write(`${name} exited with signal ${signal}\n`);
      cleanupAndExit(signal === 'SIGINT' ? 130 : 143);
      return;
    }
    if (code && code !== 0) {
      process.stderr.write(`${name} exited with code ${code}\n`);
      cleanupAndExit(code);
    }
  });

  return child;
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
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      pendingGracefulStops.delete(child);
      child.removeListener('exit', onExit);
      resolve();
    };
    const onExit = () => finish();
    const timer = setTimeout(finish, timeoutMs);
    child.once('exit', onExit);
  });

  pendingGracefulStops.set(child, promise);
  return promise;
}

function requestGracefulStop(child) {
  if (!child || child.killed || child.exitCode !== null) {
    return false;
  }

  try {
    if (child === frontendElectronProcess && typeof child.send === 'function') {
      child.send({ type: 'graceful-exit' });
      return true;
    }
    if (process.platform === 'win32') {
      child.kill();
    } else {
      child.kill('SIGTERM');
    }
    return true;
  } catch {
    return false;
  }
}

function forceTerminateProcess(child) {
  if (!child || child.killed || child.exitCode !== null) {
    return;
  }

  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } catch {
      // Ignore cleanup failures during shutdown.
    }
    return;
  }

  try {
    child.kill('SIGKILL');
  } catch {
    // Ignore cleanup failures during shutdown.
  }
}

async function terminateProcess(child, options = {}) {
  if (!child || child.killed || child.exitCode !== null) {
    return;
  }

  const gracefulTimeoutMs = Number(options.gracefulTimeoutMs || 0);
  const requested = requestGracefulStop(child);
  if (requested && gracefulTimeoutMs > 0) {
    await waitForChildExit(child, gracefulTimeoutMs);
  }

  if (child.exitCode === null) {
    forceTerminateProcess(child);
  }
}

async function cleanupAndExit(code, options = {}) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  log('\nStopping dev services...');
  if (options.passiveWindowsWait && process.platform === 'win32') {
    for (const child of childProcesses.slice().reverse()) {
      await waitForChildExit(child, child === pythonWorkerProcess ? 5000 : 3000);
    }
    for (const child of childProcesses.slice().reverse()) {
      if (child && child.exitCode === null) {
        forceTerminateProcess(child);
      }
    }
    process.exit(code);
    return;
  }

  for (const child of childProcesses.slice().reverse()) {
    const gracefulTimeoutMs = child === pythonWorkerProcess ? 5000 : 3000;
    await terminateProcess(child, { gracefulTimeoutMs });
  }
  process.exit(code);
}

if (typeof process.on === 'function') {
  process.on('message', (message) => {
    if (!message || typeof message !== 'object') {
      return;
    }
    if (message.type !== 'graceful-exit') {
      return;
    }
    void cleanupAndExit(0);
  });
}

function registerCleanup() {
  process.once('SIGINT', () => { void cleanupAndExit(130, { passiveWindowsWait: true }); });
  process.once('SIGTERM', () => { void cleanupAndExit(143, { passiveWindowsWait: true }); });
  process.once('exit', () => {
    for (const child of childProcesses.slice().reverse()) {
      forceTerminateProcess(child);
    }
  });
}

function printSummary() {
  log('');
  log('Dev services are starting:');
  log(`  Python AI worker: http://127.0.0.1:${ports.worker}`);
  log(`  Node backend:     http://localhost:${ports.backend}`);
  log(`  Frontend:         http://localhost:${ports.frontend}/`);
  log(`  Automation entry: http://localhost:${ports.frontend}/app/automation`);
  if (mode === 'electron') {
    log(`  Admin:            http://localhost:${ports.frontendAdmin}/`);
  }
  log('');
  log('Press Ctrl+C to stop all services started by this script.');
}

async function main() {
  const pythonExe = resolvePython();
  const nodeExe = ensureSupportedNode();
  const env = createEnv();

  ensureFile(path.join(paths.backendDir, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'Backend tsx CLI');
  ensureFile(path.join(paths.frontendDir, 'node_modules', 'vite', 'bin', 'vite.js'), 'Frontend vite CLI');
  ensureFile(path.join(paths.frontendDir, 'node_modules', 'ee-bin', 'index.js'), 'Electron CLI');

  await ensureBetterSqliteBinding();

  await ensurePortFree(ports.worker, 'Python AI worker');
  await ensurePortFree(ports.backend, 'Node backend');
  await ensurePortFree(ports.frontend, 'Frontend');
  if (mode === 'electron') {
    await ensurePortFree(ports.frontendAdmin, 'Frontend admin');
  }

  registerCleanup();

  spawnService(
    'Python AI worker',
    pythonExe,
    ['dev_reload.py'],
    paths.pythonWorkerDir,
    { env },
  );

  spawnService(
    'Node backend',
    nodeExe,
    [path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'watch', 'src/index.ts'],
    paths.backendDir,
    { env },
  );

  if (mode === 'electron') {
    spawnService(
      'Frontend/Electron',
      nodeExe,
      [path.join('scripts', 'dev.cjs')],
      paths.frontendDir,
      { env, ipc: true },
    );

    spawnService(
      'Frontend admin',
      nodeExe,
      [
        path.join('..', 'node_modules', 'vite', 'bin', 'vite.js'),
        '--configLoader',
        'runner',
        '--host',
        '0.0.0.0',
        '--port',
        String(ports.frontendAdmin),
      ],
      paths.frontendAdminDir,
      { env },
    );
  } else {
    spawnService(
      'Frontend/Web',
      nodeExe,
      [path.join('..', 'node_modules', 'vite', 'bin', 'vite.js'), '--configLoader', 'runner', '--host', '0.0.0.0', '--port', String(ports.frontend)],
      paths.frontendWebDir,
      { env },
    );
  }

  printSummary();
}

main().catch((error) => {
  fail(error && error.stack ? error.stack : String(error));
});
