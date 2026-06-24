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

function prepareElectronAssets() {
  if (!fs.existsSync(sourceSchema)) {
    throw new Error(`Missing xingtu schema: ${sourceSchema}`);
  }

  fs.mkdirSync(path.dirname(targetSchema), { recursive: true });
  fs.copyFileSync(sourceSchema, targetSchema);

  if (!fs.existsSync(targetSchema)) {
    throw new Error(`Failed to copy xingtu schema to: ${targetSchema}`);
  }
}

if (require.main === module) {
  prepareElectronAssets();
}

module.exports = {
  prepareElectronAssets,
};
