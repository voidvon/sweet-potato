import Database from 'better-sqlite3';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRootDir = path.resolve(__dirname, '..', '..', '..', '..');
const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(repoRootDir, 'data');
const dbPath = path.join(dataDir, 'app.sqlite');
const legacyBackendBaseDataDir = path.resolve(__dirname, '..', '..', 'data');

mkdirSync(dataDir, { recursive: true });

function copyDataDirIfAvailable(sourceDir: string, label: string) {
  if (!sourceDir || existsSync(dbPath) || !existsSync(path.join(sourceDir, 'app.sqlite'))) {
    return false;
  }

  cpSync(sourceDir, dataDir, { recursive: true, force: false });
  console.info(`[database] initialized data dir from ${label}`, { sourceDir, dataDir });
  return true;
}

function removeBuiltInLegacyDataDirIfMigrated() {
  if (process.env.DATA_DIR || !existsSync(dbPath) || !existsSync(legacyBackendBaseDataDir)) {
    return;
  }
  if (path.resolve(legacyBackendBaseDataDir) === path.resolve(dataDir)) {
    return;
  }
  rmSync(legacyBackendBaseDataDir, { recursive: true, force: true });
  console.info('[database] removed migrated legacy data dir', { legacyDir: legacyBackendBaseDataDir, dataDir });
}

function initializeDataDirFromLegacy() {
  const configuredLegacyDirs = (process.env.LEGACY_DATA_DIRS || '')
    .split(path.delimiter)
    .map((dir) => dir.trim())
    .filter(Boolean)
    .map((dir) => path.resolve(dir));
  const legacyDirs = process.env.DATA_DIR
    ? configuredLegacyDirs
    : [legacyBackendBaseDataDir, ...configuredLegacyDirs];

  for (const legacyDir of legacyDirs) {
    if (copyDataDirIfAvailable(legacyDir, 'legacy data dir')) {
      return true;
    }
  }

  return false;
}

function initializeDataDirFromSeed() {
  const seedDir = process.env.SEED_DATA_DIR ? path.resolve(process.env.SEED_DATA_DIR) : '';
  return copyDataDirIfAvailable(seedDir, 'seed data dir');
}

if (!initializeDataDirFromLegacy()) {
  initializeDataDirFromSeed();
}
removeBuiltInLegacyDataDirIfMigrated();

export { dataDir };
export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
