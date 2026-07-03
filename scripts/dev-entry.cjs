const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');

const mode = process.argv[2] === 'web' ? 'web' : 'electron';
const rootDir = path.resolve(__dirname, '..');
let childProcess = null;
let shuttingDown = false;
let pendingStop = null;

function fail(message) {
  process.stderr.write(`${message}\n`);
  cleanupAndExit(1);
}

function waitForChildExit(timeoutMs) {
  if (!childProcess || childProcess.exitCode !== null) {
    return Promise.resolve();
  }
  if (pendingStop) {
    return pendingStop;
  }

  pendingStop = new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      pendingStop = null;
      childProcess.removeListener('exit', onExit);
      resolve();
    };
    const onExit = () => finish();
    const timer = setTimeout(finish, timeoutMs);
    childProcess.once('exit', onExit);
  });

  return pendingStop;
}

function requestGracefulStop() {
  if (!childProcess || childProcess.killed || childProcess.exitCode !== null) {
    return false;
  }

  try {
    if (typeof childProcess.send === 'function') {
      childProcess.send({ type: 'graceful-exit' });
      return true;
    }
    if (process.platform === 'win32') {
      childProcess.kill();
    } else {
      childProcess.kill('SIGTERM');
    }
    return true;
  } catch {
    return false;
  }
}

function forceTerminateChild() {
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
    childProcess.kill('SIGKILL');
  } catch {
    // Ignore cleanup failures during shutdown.
  }
}

async function terminateChild() {
  const requested = requestGracefulStop();
  if (requested) {
    await waitForChildExit(5000);
  }
  if (childProcess && childProcess.exitCode === null) {
    forceTerminateChild();
  }
}

async function cleanupAndExit(code, options = {}) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  if (options.passiveWindowsWait && process.platform === 'win32') {
    await waitForChildExit(5000);
    if (childProcess && childProcess.exitCode === null) {
      forceTerminateChild();
    }
  } else {
    await terminateChild();
  }
  process.exit(code);
}

function registerCleanup() {
  process.once('SIGINT', () => { void cleanupAndExit(130, { passiveWindowsWait: true }); });
  process.once('SIGTERM', () => { void cleanupAndExit(143, { passiveWindowsWait: true }); });
  process.once('exit', () => {
    forceTerminateChild();
  });
}

function run(command, args) {
  childProcess = spawn(command, args, {
    cwd: rootDir,
    stdio: process.platform === 'win32' ? ['inherit', 'inherit', 'inherit', 'ipc'] : 'inherit',
    windowsHide: false,
  });

  childProcess.on('exit', (code, signal) => {
    if (shuttingDown) {
      return;
    }
    if (signal) {
      void cleanupAndExit(signal === 'SIGINT' ? 130 : 143);
      return;
    }
    void cleanupAndExit(code || 0);
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
