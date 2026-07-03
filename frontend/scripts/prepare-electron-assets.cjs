const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const sourceSchema = path.resolve(
  rootDir,
  '..',
  'backend',
  'base',
  'src',
  'shared',
  'xingtu-creator-filter-schema.json',
);
const targetSchema = path.join(
  rootDir,
  'public',
  'electron',
  'service',
  'browser-automation',
  'adapters',
  'xingtu',
  'xingtu-creator-filter-schema.json',
);
const sourcePythonDir = path.join(rootDir, 'electron', 'python');
const targetPythonDir = path.join(rootDir, 'public', 'electron', 'python');

function prepareElectronAssets() {
  if (!fs.existsSync(sourceSchema)) {
    throw new Error(`Missing xingtu schema: ${sourceSchema}`);
  }
  if (!fs.existsSync(sourcePythonDir)) {
    throw new Error(`Missing electron python directory: ${sourcePythonDir}`);
  }

  fs.mkdirSync(path.dirname(targetSchema), { recursive: true });
  fs.copyFileSync(sourceSchema, targetSchema);
  fs.mkdirSync(path.dirname(targetPythonDir), { recursive: true });
  fs.cpSync(sourcePythonDir, targetPythonDir, {
    force: true,
    recursive: true,
  });

  if (!fs.existsSync(targetSchema) || !fs.existsSync(targetPythonDir)) {
    throw new Error(`Failed to copy xingtu schema to: ${targetSchema}`);
  }
}

if (require.main === module) {
  prepareElectronAssets();
}

module.exports = {
  prepareElectronAssets,
};
