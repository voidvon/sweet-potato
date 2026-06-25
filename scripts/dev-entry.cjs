const path = require('node:path');
const { spawn } = require('node:child_process');

const mode = process.argv[2] === 'web' ? 'web' : 'electron';
const rootDir = path.resolve(__dirname, '..');

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function run(command, args) {
  const child = spawn(command, args, {
    cwd: rootDir,
    stdio: 'inherit',
    windowsHide: false,
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code || 0);
  });

  child.on('error', (error) => {
    fail(error && error.message ? error.message : String(error));
  });
}

if (process.platform === 'win32') {
  run(process.execPath, [path.join('scripts', 'dev-runner.cjs'), mode]);
} else {
  const script = mode === 'web' ? './scripts/dev-web.sh' : './scripts/dev.sh';
  run('bash', [script]);
}
