import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
  BASELINE_SCOPE,
  THRESHOLDS,
  collectFileMetrics,
  countFileLines,
  evaluateFileSizeMetrics,
  isValidBaselinePath,
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

function writeBaseline(baselinePath, files, grandfatheredFiles = {}) {
  fs.writeFileSync(
    baselinePath,
    `${JSON.stringify(
      {
        generatedAt: '2026-07-27T00:00:00+08:00',
        scope: BASELINE_SCOPE,
        grandfatheredFiles,
        files,
      },
      null,
      2,
    )}\n`,
  )
}

test('countFileLines handles empty content and trailing newlines', () => {
  assert.equal(countFileLines(''), 0)
  assert.equal(countFileLines('alpha'), 1)
  assert.equal(countFileLines('alpha\nbeta\n'), 2)
  assert.equal(countFileLines('\n'), 1)
})

test('loadBaseline rejects invalid baseline shapes', () => {
  const { baselinePath } = createTempProject()
  fs.writeFileSync(
    baselinePath,
    `{"scope":"${BASELINE_SCOPE}","grandfatheredFiles":{},"files":[]}\n`,
  )

  assert.throws(() => loadBaseline(baselinePath), /expected a "files" object/)
})

test('loadBaseline accepts the canonical Admin/Web TSX/CSS/SCSS scope', () => {
  const { baselinePath } = createTempProject()
  writeBaseline(baselinePath, {})

  assert.equal(loadBaseline(baselinePath).scope, BASELINE_SCOPE)
})

test('loadBaseline rejects missing, non-string, and wrong scopes', () => {
  const cases = [
    ['missing scope', undefined],
    ['non-string scope', 42],
    ['wrong scope', 'frontend/web/src/**/*.{tsx,css,scss}'],
  ]

  for (const [, scope] of cases) {
    const { baselinePath } = createTempProject()
    const baseline = {
      generatedAt: '2026-07-27T00:00:00+08:00',
      grandfatheredFiles: {},
      files: {},
    }
    if (scope !== undefined) baseline.scope = scope
    fs.writeFileSync(baselinePath, `${JSON.stringify(baseline)}\n`)

    assert.throws(() => loadBaseline(baselinePath), (error) => {
      assert.match(error.message, /Invalid baseline scope/)
      assert.match(error.message, /expected exactly/)
      assert.match(error.message, /frontend\/\{admin,web\}\/src/)
      return true
    })
  }
})

test('loadBaseline rejects unsafe, non-normalized, and out-of-scope paths', () => {
  const cases = [
    ['frontend\\web\\src\\Panel.tsx', /Invalid baseline path/],
    ['frontend/web/src/../Panel.tsx', /Invalid baseline path/],
    ['../frontend/web/src/Panel.tsx', /Invalid baseline path/],
    ['frontend/other/src/Panel.tsx', /Invalid baseline path/],
    ['frontend/web/src/Panel.js', /Invalid baseline path/],
  ]

  for (const [relativePath, expectedError] of cases) {
    const { baselinePath } = createTempProject()
    writeBaseline(baselinePath, { [relativePath]: 1 })
    assert.throws(() => loadBaseline(baselinePath), expectedError)
    assert.equal(isValidBaselinePath(relativePath), false)
  }
})

test('loadBaseline validates explicit grandfather paths and caps', () => {
  const cases = [
    {
      files: { 'frontend/web/src/Panel.tsx': 501 },
      grandfatheredFiles: { '../frontend/web/src/Panel.tsx': 501 },
      expectedError: /Invalid grandfathered path/,
    },
    {
      files: { 'frontend/web/src/Panel.tsx': 701 },
      grandfatheredFiles: { 'frontend/web/src/Panel.tsx': 700 },
      expectedError: /ordinary baseline 701 exceeds cap 700/,
    },
    {
      files: {},
      grandfatheredFiles: { 'frontend/web/src/Panel.tsx': 501 },
      expectedError: /expected a matching ordinary baseline entry/,
    },
  ]

  for (const { expectedError, files, grandfatheredFiles } of cases) {
    const { baselinePath } = createTempProject()
    writeBaseline(baselinePath, files, grandfatheredFiles)
    assert.throws(() => loadBaseline(baselinePath), expectedError)
  }
})

test('loadBaseline keeps historical grandfather caps valid after threshold increases', () => {
  const { baselinePath } = createTempProject()
  writeBaseline(
    baselinePath,
    { 'frontend/web/src/Panel.scss': 141 },
    { 'frontend/web/src/Panel.scss': 141 },
  )

  const baseline = loadBaseline(baselinePath)
  assert.equal(baseline.grandfatheredFiles['frontend/web/src/Panel.scss'], 141)
})

test('loadBaseline reports a missing baseline file', () => {
  const { baselinePath } = createTempProject()

  assert.throws(() => loadBaseline(baselinePath), /Baseline file not found/)
})

test('evaluateFileSizeMetrics warns for grandfathered files without failing', () => {
  const relativePath = 'frontend/admin/src/pages/settings/ModelSettingsPage.tsx'
  const result = evaluateFileSizeMetrics(
    [
      {
        absolutePath: `/tmp/${path.basename(relativePath)}`,
        lineCount: THRESHOLDS.tsx.fail + 10,
        relativePath,
        threshold: THRESHOLDS.tsx,
      },
    ],
    { [relativePath]: THRESHOLDS.tsx.fail + 20 },
    { [relativePath]: THRESHOLDS.tsx.fail + 20 },
  )

  assert.equal(result.errors.length, 0)
  assert.equal(result.warnings.length, 1)
  assert.equal(result.results[0]?.status, 'grandfathered')
})

test('evaluateFileSizeMetrics fails when a grandfathered file grows', () => {
  const relativePath = 'frontend/admin/src/pages/settings/ModelSettingsPage.tsx'
  const result = evaluateFileSizeMetrics(
    [
      {
        absolutePath: `/tmp/${path.basename(relativePath)}`,
        lineCount: THRESHOLDS.tsx.fail + 25,
        relativePath,
        threshold: THRESHOLDS.tsx,
      },
    ],
    { [relativePath]: THRESHOLDS.tsx.fail + 20 },
    { [relativePath]: THRESHOLDS.tsx.fail + 20 },
  )

  assert.equal(result.errors.length, 1)
  assert.match(result.errors[0], /baseline/)
  assert.equal(result.results[0]?.status, 'error')
})

test('evaluateFileSizeMetrics fails when a baselined file grows below the fail threshold', () => {
  const relativePath = 'frontend/web/src/components/ExistingPanel.tsx'
  const result = evaluateFileSizeMetrics(
    [
      {
        absolutePath: `/tmp/${path.basename(relativePath)}`,
        lineCount: 101,
        relativePath,
        threshold: THRESHOLDS.tsx,
      },
    ],
    { [relativePath]: 100 },
  )

  assert.equal(result.errors.length, 1)
  assert.match(result.errors[0], /exceeds baseline 100/)
  assert.equal(result.results[0]?.status, 'error')
})

test('evaluateFileSizeMetrics allows baselined files to shrink', () => {
  const relativePath = 'frontend/web/src/components/ExistingPanel.tsx'
  const result = evaluateFileSizeMetrics(
    [
      {
        absolutePath: `/tmp/${path.basename(relativePath)}`,
        lineCount: 99,
        relativePath,
        threshold: THRESHOLDS.tsx,
      },
    ],
    { [relativePath]: 100 },
  )

  assert.equal(result.errors.length, 0)
  assert.equal(result.results[0]?.status, 'pass')
})

test('evaluateFileSizeMetrics enforces new-file thresholds for TSX, CSS, and SCSS', () => {
  const cases = [
    ['tsx', 'frontend/web/src/components/NewPanel.tsx'],
    ['css', 'frontend/web/src/components/NewPanel.css'],
    ['scss', 'frontend/web/src/components/NewPanel.scss'],
  ]

  for (const [extension, relativePath] of cases) {
    const result = evaluateFileSizeMetrics(
      [
        {
          absolutePath: `/tmp/${path.basename(relativePath)}`,
          lineCount: THRESHOLDS[extension].fail + 1,
          relativePath,
          threshold: THRESHOLDS[extension],
        },
      ],
      {},
    )

    assert.equal(result.errors.length, 1)
    assert.match(result.errors[0], /without historical grandfather allowance/)
  }
})

test('ordinary baseline entries cannot grandfather new oversized TSX, CSS, or SCSS files', () => {
  const cases = [
    ['tsx', 'frontend/web/src/components/NewPanel.tsx', THRESHOLDS.tsx.fail + 1],
    ['css', 'frontend/web/src/components/NewPanel.css', THRESHOLDS.css.fail + 1],
    ['scss', 'frontend/web/src/components/NewPanel.scss', THRESHOLDS.scss.fail + 1],
  ]

  for (const [extension, relativePath, lineCount] of cases) {
    const result = evaluateFileSizeMetrics(
      [
        {
          absolutePath: `/tmp/${path.basename(relativePath)}`,
          lineCount,
          relativePath,
          threshold: THRESHOLDS[extension],
        },
      ],
      { [relativePath]: lineCount },
    )

    assert.equal(result.errors.length, 1)
    assert.match(result.errors[0], /without historical grandfather allowance/)
    assert.equal(result.results[0]?.status, 'error')
  }
})

test('historical grandfather allowance is bounded by both baseline and explicit cap', () => {
  const relativePath = 'frontend/web/src/components/HistoricalPanel.tsx'
  const metric = (lineCount) => ({
    absolutePath: `/tmp/${path.basename(relativePath)}`,
    lineCount,
    relativePath,
    threshold: THRESHOLDS.tsx,
  })
  const baselineFiles = { [relativePath]: THRESHOLDS.tsx.fail + 20 }
  const grandfatheredFiles = { [relativePath]: THRESHOLDS.tsx.fail + 30 }

  assert.equal(
    evaluateFileSizeMetrics(
      [metric(THRESHOLDS.tsx.fail + 10)],
      baselineFiles,
      grandfatheredFiles,
    ).results[0]?.status,
    'grandfathered',
  )
  assert.match(
    evaluateFileSizeMetrics(
      [metric(THRESHOLDS.tsx.fail + 21)],
      baselineFiles,
      grandfatheredFiles,
    ).errors[0],
    new RegExp(`exceeds baseline ${THRESHOLDS.tsx.fail + 20}`),
  )
  assert.match(
    evaluateFileSizeMetrics(
      [metric(THRESHOLDS.tsx.fail + 31)],
      { [relativePath]: THRESHOLDS.tsx.fail + 31 },
      grandfatheredFiles,
    ).errors[0],
    /without historical grandfather allowance/,
  )
})

test('evaluateFileSizeMetrics honors exact warn and fail boundaries for every extension', () => {
  const cases = [
    ['tsx', THRESHOLDS.tsx],
    ['css', THRESHOLDS.css],
    ['scss', THRESHOLDS.scss],
  ]

  for (const [extension, threshold] of cases) {
    const relativePath = `frontend/web/src/components/Boundary.${extension}`
    const metric = (lineCount) => ({
      absolutePath: `/tmp/Boundary.${extension}`,
      lineCount,
      relativePath,
      threshold,
    })

    assert.equal(
      evaluateFileSizeMetrics([metric(threshold.warn)], {}).results[0]?.status,
      'pass',
    )
    assert.equal(
      evaluateFileSizeMetrics([metric(threshold.warn + 1)], {}).results[0]
        ?.status,
      'warn',
    )
    assert.equal(
      evaluateFileSizeMetrics([metric(threshold.fail)], {}).results[0]?.status,
      'warn',
    )
    assert.equal(
      evaluateFileSizeMetrics([metric(threshold.fail + 1)], {}).errors.length,
      1,
    )
  }
})

test('collectFileMetrics uses a valid Admin default target', () => {
  const metrics = collectFileMetrics()

  assert.ok(metrics.length > 0)
  assert.ok(
    metrics.every((metric) =>
      metric.relativePath.startsWith('frontend/admin/src/'),
    ),
  )
})

test('runFileSizeCheck allows new files at the fail threshold but rejects oversized new files and growth', () => {
  const project = createTempProject()

  writeFile(
    project.rootDir,
    'frontend/admin/src/pages/settings/ExistingPage.tsx',
    Array.from({ length: 2 }, (_, index) => `line-${index + 1}`).join('\n'),
  )
  writeFile(
    project.rootDir,
    'frontend/web/src/components/NewPanel.tsx',
    Array.from(
      { length: THRESHOLDS.tsx.fail },
      (_, index) => `line-${index + 1}`,
    ).join('\n'),
  )
  writeFile(
    project.rootDir,
    'frontend/web/src/components/TooLargePanel.css',
    Array.from({ length: THRESHOLDS.css.fail + 1 }, () => '.rule {}').join(
      '\n',
    ),
  )
  writeBaseline(project.baselinePath, {
    'frontend/admin/src/pages/settings/ExistingPage.tsx': 1,
  })

  const result = runFileSizeCheck({
    baselinePath: project.baselinePath,
    rootDir: project.rootDir,
    targetDirs: project.targetDirs,
  })

  assert.equal(result.errors.length, 2)
  assert.equal(result.warnings.length, 1)
  assert.equal(
    result.results.find((item) =>
      item.relativePath.endsWith('ExistingPage.tsx'),
    )?.status,
    'error',
  )
  assert.equal(
    result.results.find((item) => item.relativePath.endsWith('NewPanel.tsx'))
      ?.status,
    'warn',
  )
  assert.equal(
    result.results.find((item) =>
      item.relativePath.endsWith('TooLargePanel.css'),
    )?.status,
    'error',
  )
})

test('runFileSizeCheck walks Admin and Web files and applies thresholds end to end', () => {
  const project = createTempProject()

  writeFile(
    project.rootDir,
    'frontend/admin/src/pages/settings/SmallPage.tsx',
    'export const SmallPage = () => null\n',
  )
  writeFile(
    project.rootDir,
    'frontend/admin/src/pages/settings/LargePage.tsx',
    Array.from(
      { length: THRESHOLDS.tsx.fail + 5 },
      (_, index) => `line-${index + 1}`,
    ).join('\n'),
  )
  writeFile(
    project.rootDir,
    'frontend/web/src/components/WarningPanel.css',
    Array.from({ length: THRESHOLDS.css.warn + 1 }, () => '.rule {}').join(
      '\n',
    ),
  )
  writeBaseline(
    project.baselinePath,
    {
      'frontend/admin/src/pages/settings/LargePage.tsx':
        THRESHOLDS.tsx.fail + 5,
      'frontend/admin/src/pages/settings/SmallPage.tsx': 1,
      'frontend/web/src/components/WarningPanel.css': THRESHOLDS.css.warn + 1,
    },
    {
      'frontend/admin/src/pages/settings/LargePage.tsx':
        THRESHOLDS.tsx.fail + 5,
    },
  )

  const collected = project.targetDirs.flatMap((targetDir) =>
    collectFileMetrics(targetDir, { rootDir: project.rootDir }),
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
  assert.equal(
    result.results.find((item) => item.relativePath.endsWith('LargePage.tsx'))
      ?.status,
    'grandfathered',
  )
  assert.equal(
    result.results.find((item) =>
      item.relativePath.endsWith('WarningPanel.css'),
    )?.status,
    'warn',
  )
})
