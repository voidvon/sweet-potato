#!/usr/bin/env node

const fs = require('node:fs')
const path = require('node:path')

const ROOT_DIR = path.resolve(__dirname, '..')
const DEFAULT_TARGET_DIR = path.join(ROOT_DIR, 'frontend', 'admin', 'src')
const DEFAULT_BASELINE_PATH = path.join(__dirname, 'file-size-baseline.json')

const THRESHOLDS = Object.freeze({
  tsx: Object.freeze({ warn: 300, fail: 500 }),
  scss: Object.freeze({ warn: 90, fail: 140 }),
})

function toPosixPath(value) {
  return value.split(path.sep).join('/')
}

function countFileLines(content) {
  if (!content) return 0

  const normalized = content.replace(/\r\n/g, '\n')
  return normalized.split('\n').length - (normalized.endsWith('\n') ? 1 : 0)
}

function getThresholdForFile(relativePath) {
  const extension = path.extname(relativePath).slice(1)
  return THRESHOLDS[extension] || null
}

function walkDirectory(directoryPath, fsImpl = fs) {
  if (!fsImpl.existsSync(directoryPath)) {
    throw new Error(`Target directory not found: ${directoryPath}`)
  }

  return fsImpl.readdirSync(directoryPath, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const absolutePath = path.join(directoryPath, entry.name)
      return entry.isDirectory() ? walkDirectory(absolutePath, fsImpl) : [absolutePath]
    })
}

function collectFileMetrics(
  targetDir = DEFAULT_TARGET_DIR,
  options = {},
) {
  const { fsImpl = fs, rootDir = ROOT_DIR } = options
  const files = walkDirectory(targetDir, fsImpl)
    .filter((absolutePath) => getThresholdForFile(absolutePath))

  return files.map((absolutePath) => {
    const relativePath = toPosixPath(path.relative(rootDir, absolutePath))
    const threshold = getThresholdForFile(relativePath)

    return {
      absolutePath,
      lineCount: countFileLines(fsImpl.readFileSync(absolutePath, 'utf8')),
      relativePath,
      threshold,
    }
  })
}

function validateBaselineContent(baselinePath, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid baseline format in ${baselinePath}: expected an object root`)
  }

  if (!value.files || typeof value.files !== 'object' || Array.isArray(value.files)) {
    throw new Error(`Invalid baseline format in ${baselinePath}: expected a "files" object`)
  }

  const files = {}
  for (const [relativePath, lineCount] of Object.entries(value.files)) {
    if (!Number.isInteger(lineCount) || lineCount < 0) {
      throw new Error(`Invalid baseline line count for ${relativePath}: expected a non-negative integer`)
    }
    files[relativePath] = lineCount
  }

  return {
    files,
    generatedAt: typeof value.generatedAt === 'string' ? value.generatedAt : '',
    scope: typeof value.scope === 'string' ? value.scope : '',
  }
}

function loadBaseline(baselinePath = DEFAULT_BASELINE_PATH, fsImpl = fs) {
  if (!fsImpl.existsSync(baselinePath)) {
    throw new Error(`Baseline file not found: ${baselinePath}`)
  }

  let parsed
  try {
    parsed = JSON.parse(fsImpl.readFileSync(baselinePath, 'utf8'))
  } catch (error) {
    throw new Error(`Unable to parse baseline JSON at ${baselinePath}: ${error instanceof Error ? error.message : String(error)}`)
  }

  return validateBaselineContent(baselinePath, parsed)
}

function evaluateFileSizeMetrics(fileMetrics, baselineFiles) {
  const errors = []
  const warnings = []
  const results = []

  for (const metric of fileMetrics) {
    const { fail, warn } = metric.threshold
    const baselineLineCount = baselineFiles[metric.relativePath]

    if (metric.lineCount > fail) {
      if (typeof baselineLineCount === 'number' && metric.lineCount <= baselineLineCount) {
        warnings.push(
          `${metric.relativePath}: ${metric.lineCount} lines exceeds fail threshold ${fail} but is grandfathered at baseline ${baselineLineCount}`,
        )
        results.push({ ...metric, baselineLineCount, status: 'grandfathered' })
        continue
      }

      if (typeof baselineLineCount === 'number') {
        errors.push(
          `${metric.relativePath}: ${metric.lineCount} lines exceeds fail threshold ${fail} and baseline ${baselineLineCount}`,
        )
      } else {
        errors.push(`${metric.relativePath}: ${metric.lineCount} lines exceeds fail threshold ${fail} without baseline`)
      }
      results.push({ ...metric, baselineLineCount, status: 'error' })
      continue
    }

    if (metric.lineCount > warn) {
      warnings.push(`${metric.relativePath}: ${metric.lineCount} lines exceeds warn threshold ${warn}`)
      results.push({ ...metric, baselineLineCount, status: 'warn' })
      continue
    }

    results.push({ ...metric, baselineLineCount, status: 'pass' })
  }

  return { errors, results, warnings }
}

function runFileSizeCheck(options = {}) {
  const fsImpl = options.fsImpl || fs
  const rootDir = options.rootDir || ROOT_DIR
  const targetDir = options.targetDir || DEFAULT_TARGET_DIR
  const baselinePath = options.baselinePath || DEFAULT_BASELINE_PATH
  const baseline = loadBaseline(baselinePath, fsImpl)
  const fileMetrics = collectFileMetrics(targetDir, { fsImpl, rootDir })
  const evaluation = evaluateFileSizeMetrics(fileMetrics, baseline.files)

  return {
    baseline,
    ...evaluation,
    fileMetrics,
  }
}

function printReport(result) {
  if (result.warnings.length > 0) {
    console.warn('File size warnings:')
    for (const warning of result.warnings) {
      console.warn(`- ${warning}`)
    }
  }

  if (result.errors.length > 0) {
    console.error('File size check failed:')
    for (const error of result.errors) {
      console.error(`- ${error}`)
    }
    return false
  }

  const oversizedCount = result.results.filter((item) => item.status === 'grandfathered').length
  console.log(
    `Checked ${result.fileMetrics.length} admin TSX/SCSS files`
    + `${oversizedCount > 0 ? ` (${oversizedCount} grandfathered)` : ''}`,
  )
  return true
}

function main() {
  try {
    const result = runFileSizeCheck()
    process.exitCode = printReport(result) ? 0 : 1
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

module.exports = {
  THRESHOLDS,
  collectFileMetrics,
  countFileLines,
  evaluateFileSizeMetrics,
  getThresholdForFile,
  loadBaseline,
  runFileSizeCheck,
}

if (require.main === module) {
  main()
}
