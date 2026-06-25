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
};

const ports = {
  worker: Number(process.env.PYTHON_AI_WORKER_PORT || 7073),
  backend: Number(process.env.BACKEND_PORT || 7072),
  frontend: Number(process.env.FRONTEND_PORT || 9527),
};

const childProcesses = [];
let shuttingDown = false;

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
    BACKEND_PORT: String(ports.backend),
    PYTHON_AI_WORKER_PORT: String(ports.worker),
    PYTHON_AI_WORKER_URL: process.env.PYTHON_AI_WORKER_URL || `http://127.0.0.1:${ports.worker}`,
  };
}

function spawnService(name, command, args, cwd, extra = {}) {
  log(`Starting ${name}...`);

  const child = spawn(command, args, {
    cwd,
    env: extra.env || process.env,
    stdio: 'inherit',
    windowsHide: false,
  });

  childProcesses.push(child);

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

function terminateProcess(child) {
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
    child.kill('SIGTERM');
  } catch {
    // Ignore cleanup failures during shutdown.
  }
}

function cleanupAndExit(code) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  log('\nStopping dev services...');
  for (const child of childProcesses.slice().reverse()) {
    terminateProcess(child);
  }
  process.exit(code);
}

function registerCleanup() {
  process.once('SIGINT', () => cleanupAndExit(130));
  process.once('SIGTERM', () => cleanupAndExit(143));
  process.once('exit', () => {
    for (const child of childProcesses.slice().reverse()) {
      terminateProcess(child);
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
