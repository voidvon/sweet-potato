import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
  THRESHOLDS,
  collectFileMetrics,
  countFileLines,
  evaluateFileSizeMetrics,
  loadBaseline,
  runFileSizeCheck,
} = require('../check-file-size.cjs')

function createTempProject() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-file-size-'))
  const targetDirs = [
    path.join(rootDir, 'frontend', 'admin', 'src'),
    path.join(rootDir, 'frontend', 'web', 'src'),
  ]
  const baselinePath = path.join(rootDir, 'scripts', 'file-size-baseline.json')

  for (const targetDir of targetDirs) {
    fs.mkdirSync(targetDir, { recursive: true })
  }
  fs.mkdirSync(path.dirname(baselinePath), { recursive: true })

  return { baselinePath, rootDir, targetDirs }
}

function writeFile(rootDir, relativePath, content) {
  const absolutePath = path.join(rootDir, relativePath)
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true })
  fs.writeFileSync(absolutePath, content)
}

function writeBaseline(baselinePath, files) {
  fs.writeFileSync(baselinePath, `${JSON.stringify({
    generatedAt: '2026-07-27T00:00:00+08:00',
    scope: 'frontend/{admin,web}/src/**/*.{tsx,css,scss}',
    files,
  }, null, 2)}\n`)
}

test('countFileLines handles empty content and trailing newlines', () => {
  assert.equal(countFileLines(''), 0)
  assert.equal(countFileLines('alpha'), 1)
  assert.equal(countFileLines('alpha\nbeta\n'), 2)
  assert.equal(countFileLines('\n'), 1)
})

test('loadBaseline rejects invalid baseline shapes', () => {
  const { baselinePath } = createTempProject()
  fs.writeFileSync(baselinePath, '{"files":[]}\n')

  assert.throws(
    () => loadBaseline(baselinePath),
    /expected a "files" object/,
  )
})

test('loadBaseline reports a missing baseline file', () => {
  const { baselinePath } = createTempProject()

  assert.throws(
    () => loadBaseline(baselinePath),
    /Baseline file not found/,
  )
})

test('evaluateFileSizeMetrics warns for grandfathered files without failing', () => {
  const relativePath = 'frontend/admin/src/pages/settings/ModelSettingsPage.tsx'
  const result = evaluateFileSizeMetrics(
    [{
      absolutePath: `/tmp/${path.basename(relativePath)}`,
      lineCount: THRESHOLDS.tsx.fail + 10,
      relativePath,
      threshold: THRESHOLDS.tsx,
    }],
    { [relativePath]: THRESHOLDS.tsx.fail + 20 },
  )

  assert.equal(result.errors.length, 0)
  assert.equal(result.warnings.length, 1)
  assert.equal(result.results[0]?.status, 'grandfathered')
})

test('evaluateFileSizeMetrics fails when a grandfathered file grows', () => {
  const relativePath = 'frontend/admin/src/pages/settings/ModelSettingsPage.tsx'
  const result = evaluateFileSizeMetrics(
    [{
      absolutePath: `/tmp/${path.basename(relativePath)}`,
      lineCount: THRESHOLDS.tsx.fail + 25,
      relativePath,
      threshold: THRESHOLDS.tsx,
    }],
    { [relativePath]: THRESHOLDS.tsx.fail + 20 },
  )

  assert.equal(result.errors.length, 1)
  assert.match(result.errors[0], /baseline/)
  assert.equal(result.results[0]?.status, 'error')
})

test('evaluateFileSizeMetrics fails when a baselined file grows below the fail threshold', () => {
  const relativePath = 'frontend/web/src/components/ExistingPanel.tsx'
  const result = evaluateFileSizeMetrics(
    [{
      absolutePath: `/tmp/${path.basename(relativePath)}`,
      lineCount: 101,
      relativePath,
      threshold: THRESHOLDS.tsx,
    }],
    { [relativePath]: 100 },
  )

  assert.equal(result.errors.length, 1)
  assert.match(result.errors[0], /exceeds baseline 100/)
  assert.equal(result.results[0]?.status, 'error')
})

test('evaluateFileSizeMetrics allows baselined files to shrink', () => {
  const relativePath = 'frontend/web/src/components/ExistingPanel.tsx'
  const result = evaluateFileSizeMetrics(
    [{
      absolutePath: `/tmp/${path.basename(relativePath)}`,
      lineCount: 99,
      relativePath,
      threshold: THRESHOLDS.tsx,
    }],
    { [relativePath]: 100 },
  )

  assert.equal(result.errors.length, 0)
  assert.equal(result.results[0]?.status, 'pass')
})

test('evaluateFileSizeMetrics enforces CSS thresholds for new files', () => {
  const relativePath = 'frontend/web/src/components/NewPanel.css'
  const result = evaluateFileSizeMetrics(
    [{
      absolutePath: `/tmp/${path.basename(relativePath)}`,
      lineCount: THRESHOLDS.css.fail + 1,
      relativePath,
      threshold: THRESHOLDS.css,
    }],
    {},
  )

  assert.equal(result.errors.length, 1)
  assert.match(result.errors[0], /without baseline/)
})

test('runFileSizeCheck walks Admin and Web files and applies thresholds end to end', () => {
  const project = createTempProject()

  writeFile(project.rootDir, 'frontend/admin/src/pages/settings/SmallPage.tsx', 'export const SmallPage = () => null\n')
  writeFile(
    project.rootDir,
    'frontend/admin/src/pages/settings/LargePage.tsx',
    Array.from({ length: THRESHOLDS.tsx.fail + 5 }, (_, index) => `line-${index + 1}`).join('\n'),
  )
  writeFile(
    project.rootDir,
    'frontend/web/src/components/WarningPanel.css',
    Array.from({ length: THRESHOLDS.css.warn + 1 }, () => '.rule {}').join('\n'),
  )
  writeBaseline(project.baselinePath, {
    'frontend/admin/src/pages/settings/LargePage.tsx': THRESHOLDS.tsx.fail + 5,
    'frontend/admin/src/pages/settings/SmallPage.tsx': 1,
    'frontend/web/src/components/WarningPanel.css': THRESHOLDS.css.warn + 1,
  })

  const collected = project.targetDirs.flatMap(
    (targetDir) => collectFileMetrics(targetDir, { rootDir: project.rootDir }),
  )
  assert.deepEqual(
    collected.map((item) => item.relativePath),
    [
      'frontend/admin/src/pages/settings/LargePage.tsx',
      'frontend/admin/src/pages/settings/SmallPage.tsx',
      'frontend/web/src/components/WarningPanel.css',
    ],
  )

  const result = runFileSizeCheck({
    baselinePath: project.baselinePath,
    rootDir: project.rootDir,
    targetDirs: project.targetDirs,
  })

  assert.equal(result.errors.length, 0)
  assert.equal(result.warnings.length, 2)
  assert.equal(result.results.find((item) => item.relativePath.endsWith('LargePage.tsx'))?.status, 'grandfathered')
  assert.equal(result.results.find((item) => item.relativePath.endsWith('WarningPanel.css'))?.status, 'warn')
})
