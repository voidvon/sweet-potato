#!/usr/bin/env node

const fs = require('node:fs')
const path = require('node:path')

const ROOT_DIR = path.resolve(__dirname, '..')
const DEFAULT_TARGET_DIRS = Object.freeze([
  path.join(ROOT_DIR, 'frontend', 'admin', 'src'),
  path.join(ROOT_DIR, 'frontend', 'web', 'src'),
])
const DEFAULT_TARGET_DIR = DEFAULT_TARGET_DIRS[0]
const DEFAULT_BASELINE_PATH = path.join(__dirname, 'file-size-baseline.json')
const BASELINE_SCOPE = 'frontend/{admin,web}/src/**/*.{tsx,css,scss}'

const THRESHOLDS = Object.freeze({
  tsx: Object.freeze({ warn: 300, fail: 500 }),
  css: Object.freeze({ warn: 90, fail: 140 }),
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

  return fsImpl
    .readdirSync(directoryPath, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const absolutePath = path.join(directoryPath, entry.name)
      return entry.isDirectory()
        ? walkDirectory(absolutePath, fsImpl)
        : [absolutePath]
    })
}

function collectFileMetrics(targetDir = DEFAULT_TARGET_DIR, options = {}) {
  const { fsImpl = fs, rootDir = ROOT_DIR } = options
  const files = walkDirectory(targetDir, fsImpl).filter((absolutePath) =>
    getThresholdForFile(absolutePath),
  )

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
    throw new Error(
      `Invalid baseline format in ${baselinePath}: expected an object root`,
    )
  }

  if (value.scope !== BASELINE_SCOPE) {
    throw new Error(
      `Invalid baseline scope in ${baselinePath}: expected exactly "${BASELINE_SCOPE}"`,
    )
  }

  if (
    !value.files ||
    typeof value.files !== 'object' ||
    Array.isArray(value.files)
  ) {
    throw new Error(
      `Invalid baseline format in ${baselinePath}: expected a "files" object`,
    )
  }

  const files = Object.create(null)
  for (const [relativePath, lineCount] of Object.entries(value.files)) {
    if (!isValidBaselinePath(relativePath)) {
      throw new Error(
        `Invalid baseline path ${relativePath}: expected a normalized Admin/Web TSX/CSS/SCSS path under frontend/{admin,web}/src`,
      )
    }
    if (!Number.isInteger(lineCount) || lineCount < 0) {
      throw new Error(
        `Invalid baseline line count for ${relativePath}: expected a non-negative integer`,
      )
    }
    files[relativePath] = lineCount
  }

  if (
    !value.grandfatheredFiles ||
    typeof value.grandfatheredFiles !== 'object' ||
    Array.isArray(value.grandfatheredFiles)
  ) {
    throw new Error(
      `Invalid baseline format in ${baselinePath}: expected a "grandfatheredFiles" object`,
    )
  }

  const grandfatheredFiles = Object.create(null)
  for (const [relativePath, lineCap] of Object.entries(
    value.grandfatheredFiles,
  )) {
    if (!isValidBaselinePath(relativePath)) {
      throw new Error(
        `Invalid grandfathered path ${relativePath}: expected a normalized Admin/Web TSX/CSS/SCSS path under frontend/{admin,web}/src`,
      )
    }
    if (!Number.isInteger(lineCap) || lineCap < 0) {
      throw new Error(
        `Invalid grandfathered line cap for ${relativePath}: expected a non-negative integer`,
      )
    }

    const threshold = getThresholdForFile(relativePath)
    if (lineCap <= threshold.fail) {
      throw new Error(
        `Invalid grandfathered line cap for ${relativePath}: expected more than fail threshold ${threshold.fail}`,
      )
    }
    if (typeof files[relativePath] !== 'number') {
      throw new Error(
        `Invalid grandfathered path ${relativePath}: expected a matching ordinary baseline entry`,
      )
    }
    if (files[relativePath] > lineCap) {
      throw new Error(
        `Invalid grandfathered line cap for ${relativePath}: ordinary baseline ${files[relativePath]} exceeds cap ${lineCap}`,
      )
    }

    grandfatheredFiles[relativePath] = lineCap
  }

  return {
    files,
    grandfatheredFiles,
    generatedAt: typeof value.generatedAt === 'string' ? value.generatedAt : '',
    scope: typeof value.scope === 'string' ? value.scope : '',
  }
}

function isValidBaselinePath(relativePath) {
  if (typeof relativePath !== 'string' || relativePath.length === 0)
    return false
  if (relativePath.includes('\\')) return false
  if (path.posix.isAbsolute(relativePath)) return false
  if (path.posix.normalize(relativePath) !== relativePath) return false

  const segments = relativePath.split('/')
  if (
    segments.length < 4 ||
    segments[0] !== 'frontend' ||
    !['admin', 'web'].includes(segments[1]) ||
    segments[2] !== 'src'
  ) {
    return false
  }

  return Boolean(getThresholdForFile(relativePath))
}

function loadBaseline(baselinePath = DEFAULT_BASELINE_PATH, fsImpl = fs) {
  if (!fsImpl.existsSync(baselinePath)) {
    throw new Error(`Baseline file not found: ${baselinePath}`)
  }

  let parsed
  try {
    parsed = JSON.parse(fsImpl.readFileSync(baselinePath, 'utf8'))
  } catch (error) {
    throw new Error(
      `Unable to parse baseline JSON at ${baselinePath}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  return validateBaselineContent(baselinePath, parsed)
}

function evaluateFileSizeMetrics(
  fileMetrics,
  baselineFiles,
  grandfatheredFiles = {},
) {
  const errors = []
  const warnings = []
  const results = []

  for (const metric of fileMetrics) {
    const { fail, warn } = metric.threshold
    const baselineLineCount = baselineFiles[metric.relativePath]
    const grandfatheredLineCap = grandfatheredFiles[metric.relativePath]

    if (
      typeof baselineLineCount === 'number' &&
      metric.lineCount > baselineLineCount
    ) {
      errors.push(
        `${metric.relativePath}: ${metric.lineCount} lines exceeds baseline ${baselineLineCount}`,
      )
      results.push({ ...metric, baselineLineCount, status: 'error' })
      continue
    }

    if (metric.lineCount > fail) {
      if (
        typeof grandfatheredLineCap === 'number' &&
        metric.lineCount <= grandfatheredLineCap
      ) {
        warnings.push(
          `${metric.relativePath}: ${metric.lineCount} lines exceeds fail threshold ${fail} but is grandfathered up to historical cap ${grandfatheredLineCap}`,
        )
        results.push({
          ...metric,
          baselineLineCount,
          grandfatheredLineCap,
          status: 'grandfathered',
        })
        continue
      }
      errors.push(
        `${metric.relativePath}: ${metric.lineCount} lines exceeds fail threshold ${fail} without historical grandfather allowance`,
      )
      results.push({
        ...metric,
        baselineLineCount,
        grandfatheredLineCap,
        status: 'error',
      })
      continue
    }

    if (metric.lineCount > warn) {
      warnings.push(
        `${metric.relativePath}: ${metric.lineCount} lines exceeds warn threshold ${warn}`,
      )
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
  const targetDirs =
    options.targetDirs ||
    (options.targetDir ? [options.targetDir] : DEFAULT_TARGET_DIRS)
  const baselinePath = options.baselinePath || DEFAULT_BASELINE_PATH
  const baseline = loadBaseline(baselinePath, fsImpl)
  const fileMetrics = targetDirs
    .flatMap((targetDir) => collectFileMetrics(targetDir, { fsImpl, rootDir }))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath))
  const evaluation = evaluateFileSizeMetrics(
    fileMetrics,
    baseline.files,
    baseline.grandfatheredFiles,
  )

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

  const oversizedCount = result.results.filter(
    (item) => item.status === 'grandfathered',
  ).length
  console.log(
    `Checked ${result.fileMetrics.length} Admin/Web TSX/CSS/SCSS files` +
      `${oversizedCount > 0 ? ` (${oversizedCount} grandfathered)` : ''}`,
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
  BASELINE_SCOPE,
  THRESHOLDS,
  collectFileMetrics,
  countFileLines,
  evaluateFileSizeMetrics,
  getThresholdForFile,
  isValidBaselinePath,
  loadBaseline,
  runFileSizeCheck,
}

if (require.main === module) {
  main()
}
