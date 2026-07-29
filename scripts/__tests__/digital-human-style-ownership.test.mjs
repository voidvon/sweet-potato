import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
)
const pagePath =
  'frontend/web/src/pages/content/assets/DigitalHumanAssetsPage/DigitalHumanAssetsPage.tsx'
const sharedStylePath =
  'frontend/web/src/pages/content/assets/AssetLibraryPages.scss'

const ownershipPairs = [
  [
    'frontend/web/src/pages/content/assets/DigitalHumanAssetsPage/components/DigitalHumanAssetGrid.tsx',
    './DigitalHumanAssetGrid.scss',
  ],
  [
    'frontend/web/src/pages/content/assets/DigitalHumanAssetsPage/components/DigitalHumanCreateModals.tsx',
    './DigitalHumanCreateModals.scss',
  ],
  [
    'frontend/web/src/pages/content/assets/DigitalHumanAssetsPage/components/DigitalHumanDetailModal.tsx',
    './DigitalHumanDetailModal.scss',
  ],
]

test('DigitalHumanAssetsPage is a small shell and owns the shared asset-library style import', () => {
  const pageSource = fs.readFileSync(path.join(rootDir, pagePath), 'utf8')

  assert.match(pageSource, /import ['"]\.\.\/AssetLibraryPages\.scss['"]/)
  assert.equal(pageSource.match(/AssetLibraryPages\.scss/g)?.length, 1)
  assert.ok(
    pageSource.split('\n').length <= 40,
    'page shell should remain composed and small',
  )

  for (const [tsxPath] of ownershipPairs) {
    const source = fs.readFileSync(path.join(rootDir, tsxPath), 'utf8')
    assert.doesNotMatch(source, /AssetLibraryPages\.scss/)
  }
})

test('Each styled DigitalHuman component imports its matching SCSS file directly', () => {
  for (const [tsxPath, styleImport] of ownershipPairs) {
    const absoluteTsxPath = path.join(rootDir, tsxPath)
    const source = fs.readFileSync(absoluteTsxPath, 'utf8')

    assert.match(
      source,
      new RegExp(`import ['"]${styleImport.replace('.', '\\.')}['"]`),
    )
    assert.equal(
      fs.existsSync(absoluteTsxPath.replace(/\.tsx$/, '.scss')),
      true,
    )
  }
})

test('DigitalHuman component SCSS does not hide aggregation through Sass load-css', () => {
  for (const [tsxPath] of ownershipPairs) {
    const absoluteScssPath = path
      .join(rootDir, tsxPath)
      .replace(/\.tsx$/, '.scss')
    const source = fs.readFileSync(absoluteScssPath, 'utf8')

    assert.doesNotMatch(
      source,
      /meta\.load-css|@use ['"]sass:meta['"]/,
      absoluteScssPath,
    )
  }
})

test('AssetLibraryPages no longer owns DigitalHuman selectors', () => {
  const source = fs.readFileSync(path.join(rootDir, sharedStylePath), 'utf8')

  assert.doesNotMatch(source, /\.digital-human-/)
  assert.doesNotMatch(source, /\.asset-detail-workspace/)
  assert.doesNotMatch(source, /\.asset-workflow-action/)
})
