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
  const targetDir = path.join(rootDir, 'frontend', 'admin', 'src')
  const baselinePath = path.join(rootDir, 'scripts', 'file-size-baseline.json')

  fs.mkdirSync(targetDir, { recursive: true })
  fs.mkdirSync(path.dirname(baselinePath), { recursive: true })

  return { baselinePath, rootDir, targetDir }
}

function writeFile(rootDir, relativePath, content) {
  const absolutePath = path.join(rootDir, relativePath)
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true })
  fs.writeFileSync(absolutePath, content)
}

function writeBaseline(baselinePath, files) {
  fs.writeFileSync(baselinePath, `${JSON.stringify({
    generatedAt: '2026-07-27T00:00:00+08:00',
    scope: 'frontend/admin/src/**/*.{tsx,scss}',
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

test('runFileSizeCheck walks files and applies thresholds end to end', () => {
  const project = createTempProject()

  writeFile(project.rootDir, 'frontend/admin/src/pages/settings/SmallPage.tsx', 'export const SmallPage = () => null\n')
  writeFile(
    project.rootDir,
    'frontend/admin/src/pages/settings/LargePage.tsx',
    Array.from({ length: THRESHOLDS.tsx.fail + 5 }, (_, index) => `line-${index + 1}`).join('\n'),
  )
  writeBaseline(project.baselinePath, {
    'frontend/admin/src/pages/settings/LargePage.tsx': THRESHOLDS.tsx.fail + 5,
    'frontend/admin/src/pages/settings/SmallPage.tsx': 1,
  })

  const collected = collectFileMetrics(project.targetDir, { rootDir: project.rootDir })
  assert.deepEqual(
    collected.map((item) => item.relativePath),
    [
      'frontend/admin/src/pages/settings/LargePage.tsx',
      'frontend/admin/src/pages/settings/SmallPage.tsx',
    ],
  )

  const result = runFileSizeCheck({
    baselinePath: project.baselinePath,
    rootDir: project.rootDir,
    targetDir: project.targetDir,
  })

  assert.equal(result.errors.length, 0)
  assert.equal(result.warnings.length, 1)
  assert.equal(result.results.find((item) => item.relativePath.endsWith('LargePage.tsx'))?.status, 'grandfathered')
})
