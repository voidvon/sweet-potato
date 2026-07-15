#!/usr/bin/env node

const fs = require('node:fs')
const path = require('node:path')

const rootDir = path.resolve(__dirname, '..')
const versionFile = path.join(rootDir, 'VERSION')
const manifestPaths = [
  'package.json',
  'frontend/package.json',
  'frontend/web/package.json',
  'frontend/admin/package.json',
  'backend/base/package.json',
]

const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]?\d)\.(0|[1-9]?\d)$/

function fail(message) {
  console.error(message)
  process.exit(1)
}

function parseVersion(value) {
  const version = String(value).trim()
  const match = version.match(versionPattern)

  if (!match) {
    fail(`Invalid version \"${version}\". Expected MAJOR.MINOR.PATCH with MINOR and PATCH between 0 and 99.`)
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    version,
  }
}

function readCurrentVersion() {
  if (!fs.existsSync(versionFile)) {
    fail(`Version file not found: ${versionFile}`)
  }

  return parseVersion(fs.readFileSync(versionFile, 'utf8')).version
}

function nextVersion(value) {
  const { major, minor, patch } = parseVersion(value)

  if (patch < 99) {
    return `${major}.${minor}.${patch + 1}`
  }

  if (minor < 99) {
    return `${major}.${minor + 1}.0`
  }

  return `${major + 1}.0.0`
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

function syncPackageLock(manifestPath, version) {
  const lockPath = path.join(path.dirname(manifestPath), 'package-lock.json')

  if (!fs.existsSync(lockPath)) {
    return
  }

  const lock = readJson(lockPath)
  lock.version = version

  if (lock.packages?.['']) {
    lock.packages[''].version = version
  }

  writeJson(lockPath, lock)
}

function setVersion(value) {
  const version = parseVersion(value).version

  fs.writeFileSync(versionFile, `${version}\n`)

  for (const relativePath of manifestPaths) {
    const manifestPath = path.join(rootDir, relativePath)
    const manifest = readJson(manifestPath)
    manifest.version = version
    writeJson(manifestPath, manifest)
    syncPackageLock(manifestPath, version)
  }

  return version
}

function checkVersion() {
  const version = readCurrentVersion()
  const mismatches = []

  for (const relativePath of manifestPaths) {
    const manifestPath = path.join(rootDir, relativePath)
    const manifestVersion = readJson(manifestPath).version

    if (manifestVersion !== version) {
      mismatches.push(`${relativePath}: ${manifestVersion ?? '(missing)'}`)
    }

    const lockPath = path.join(path.dirname(manifestPath), 'package-lock.json')
    if (fs.existsSync(lockPath)) {
      const lock = readJson(lockPath)
      if (lock.version !== version) {
        mismatches.push(`${path.relative(rootDir, lockPath)}: ${lock.version ?? '(missing)'}`)
      }
      if (lock.packages?.['']?.version !== version) {
        mismatches.push(`${path.relative(rootDir, lockPath)} packages[\"\"]: ${lock.packages?.['']?.version ?? '(missing)'}`)
      }
    }
  }

  if (mismatches.length > 0) {
    fail(`Version mismatch. Expected ${version}:\n${mismatches.map((item) => `- ${item}`).join('\n')}`)
  }

  return version
}

const [command = 'current', argument] = process.argv.slice(2)

switch (command) {
  case 'current':
    console.log(readCurrentVersion())
    break
  case 'next':
    console.log(nextVersion(argument ?? readCurrentVersion()))
    break
  case 'bump': {
    const version = setVersion(nextVersion(readCurrentVersion()))
    console.log(version)
    break
  }
  case 'set':
    if (!argument) {
      fail('Usage: node scripts/version.cjs set MAJOR.MINOR.PATCH')
    }
    console.log(setVersion(argument))
    break
  case 'sync':
    console.log(setVersion(readCurrentVersion()))
    break
  case 'check':
    console.log(checkVersion())
    break
  default:
    fail(`Unknown command: ${command}`)
}
