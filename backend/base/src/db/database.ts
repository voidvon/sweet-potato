import Database from 'better-sqlite3';
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(__dirname, '..', '..', 'data');
const dbPath = path.join(dataDir, 'app.sqlite');

mkdirSync(dataDir, { recursive: true });

function copyDataDirIfAvailable(sourceDir: string, label: string) {
  if (!sourceDir || existsSync(dbPath) || !existsSync(path.join(sourceDir, 'app.sqlite'))) {
    return false;
  }

  cpSync(sourceDir, dataDir, { recursive: true, force: false });
  console.info(`[database] initialized data dir from ${label}`, { sourceDir, dataDir });
  return true;
}

function initializeDataDirFromLegacy() {
  const legacyDirs = (process.env.LEGACY_DATA_DIRS || '')
    .split(path.delimiter)
    .map((dir) => dir.trim())
    .filter(Boolean)
    .map((dir) => path.resolve(dir));

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

export { dataDir };
export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
