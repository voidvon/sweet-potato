import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const overlaysPath = path.join(
  rootDir,
  'frontend/web/src/pages/content/VideoTaskClonePage/styles/overlays.scss',
)

const ownershipPairs = [
  [
    'frontend/web/src/pages/content/VideoTaskClonePage/components/PromptPlanningModal.tsx',
    "./PromptPlanningModal.scss",
  ],
  [
    'frontend/web/src/pages/content/VideoTaskClonePage/components/prompt-planning/PromptPlanningFooter.tsx',
    "./PromptPlanningFooter.scss",
  ],
  [
    'frontend/web/src/pages/content/VideoTaskClonePage/components/prompt-planning/PromptPlanningPresentational.tsx',
    "./PromptPlanningPresentational.scss",
  ],
  [
    'frontend/web/src/pages/content/VideoTaskClonePage/components/prompt-planning/PromptPlanningStepAnalysis.tsx',
    "./PromptPlanningStepAnalysis.scss",
  ],
  [
    'frontend/web/src/pages/content/VideoTaskClonePage/components/prompt-planning/PromptPlanningStepCandidates.tsx',
    "./PromptPlanningStepCandidates.scss",
  ],
  [
    'frontend/web/src/pages/content/VideoTaskClonePage/components/prompt-planning/PromptPlanningStepMaterials.tsx',
    "./PromptPlanningStepMaterials.scss",
  ],
  [
    'frontend/web/src/pages/content/VideoTaskClonePage/components/prompt-planning/PromptPlanningStepSettings.tsx',
    "./PromptPlanningStepSettings.scss",
  ],
  [
    'frontend/web/src/pages/content/VideoTaskClonePage/components/ReferenceVideoCard.tsx',
    "./ReferenceVideoCard.scss",
  ],
]

test('Prompt planning styles are no longer centrally loaded from overlays.scss', () => {
  const source = fs.readFileSync(overlaysPath, 'utf8')

  assert.doesNotMatch(source, /prompt-planning\//)
  assert.doesNotMatch(source, /load-css\("\.\/prompt-planning\//)
})

test('Prompt planning component styles do not hide aggregation behind Sass load-css', () => {
  const componentRoot = path.join(
    rootDir,
    'frontend/web/src/pages/content/VideoTaskClonePage/components',
  )
  const stylePaths = [
    ...fs.readdirSync(componentRoot).filter((entry) => entry.endsWith('.scss')),
    ...fs.readdirSync(path.join(componentRoot, 'prompt-planning'))
      .filter((entry) => entry.endsWith('.scss'))
      .map((entry) => path.join('prompt-planning', entry)),
  ]

  for (const relativePath of stylePaths) {
    const source = fs.readFileSync(path.join(componentRoot, relativePath), 'utf8')
    assert.doesNotMatch(source, /meta\.load-css|@use ['"]sass:meta['"]/, relativePath)
  }
})

test('Each prompt-planning component imports its matching SCSS file directly', () => {
  for (const [tsxPath, styleImport] of ownershipPairs) {
    const absoluteTsxPath = path.join(rootDir, tsxPath)
    const source = fs.readFileSync(absoluteTsxPath, 'utf8')
    const absoluteScssPath = absoluteTsxPath.replace(/\.tsx$/, '.scss')

    assert.match(source, new RegExp(`import ['"]${styleImport.replace('.', '\\.')}['"]`))
    assert.equal(fs.existsSync(absoluteScssPath), true)
  }
})
