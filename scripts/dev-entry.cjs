const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');

const mode = process.argv[2] === 'web' ? 'web' : 'electron';
const rootDir = path.resolve(__dirname, '..');
let childProcess = null;
let shuttingDown = false;

function fail(message) {
  process.stderr.write(`${message}\n`);
  cleanupAndExit(1);
}

function terminateChild() {
  if (!childProcess || childProcess.killed || childProcess.exitCode !== null) {
    return;
  }

  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/PID', String(childProcess.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } catch {
      // Ignore cleanup failures during shutdown.
    }
    return;
  }

  try {
    childProcess.kill('SIGTERM');
  } catch {
    // Ignore cleanup failures during shutdown.
  }
}

function cleanupAndExit(code) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  terminateChild();
  process.exit(code);
}

function registerCleanup() {
  process.once('SIGINT', () => cleanupAndExit(130));
  process.once('SIGTERM', () => cleanupAndExit(143));
  process.once('exit', () => {
    terminateChild();
  });
}

function run(command, args) {
  childProcess = spawn(command, args, {
    cwd: rootDir,
    stdio: 'inherit',
    windowsHide: false,
  });

  childProcess.on('exit', (code, signal) => {
    if (shuttingDown) {
      return;
    }
    if (signal) {
      cleanupAndExit(signal === 'SIGINT' ? 130 : 143);
      return;
    }
    cleanupAndExit(code || 0);
  });

  childProcess.on('error', (error) => {
    fail(error && error.message ? error.message : String(error));
  });
}

registerCleanup();

if (process.platform === 'win32') {
  run(process.execPath, [path.join('scripts', 'dev-runner.cjs'), mode]);
} else {
  const script = mode === 'web' ? './scripts/dev-web.sh' : './scripts/dev.sh';
  run('bash', [script]);
}
