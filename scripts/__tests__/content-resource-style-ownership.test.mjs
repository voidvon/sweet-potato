import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const sharedStylePath = path.join(
  rootDir,
  'frontend/web/src/pages/content/assets/AssetLibraryPages.scss',
)

const matchingOwnershipPairs = [
  [
    'frontend/web/src/pages/content/assets/WorksAssetCard.tsx',
    './WorksAssetCard.scss',
  ],
  [
    'frontend/web/src/pages/content/assets/content-resource-library/FinishedWorksLibrary.tsx',
    './FinishedWorksLibrary.scss',
  ],
  [
    'frontend/web/src/pages/content/assets/content-resource-library/PendingAssetGrid.tsx',
    './PendingAssetGrid.scss',
  ],
  [
    'frontend/web/src/pages/content/assets/content-resource-library/ResourceGroupModal.tsx',
    './ResourceGroupModal.scss',
  ],
  [
    'frontend/web/src/pages/content/assets/content-resource-library/ResourceLibraryView.tsx',
    './ResourceLibraryView.scss',
  ],
]

test('ContentResourceLibraryPage owns the single shared AssetLibraryPages import and stays small', () => {
  const pagePath = path.join(
    rootDir,
    'frontend/web/src/pages/content/ContentResourceLibraryPage.tsx',
  )
  const pageSource = fs.readFileSync(pagePath, 'utf8')
  const otherSources = [
    'frontend/web/src/pages/content/assets/content-resource-library/FinishedWorksLibrary.tsx',
    'frontend/web/src/pages/content/assets/content-resource-library/ResourceLibraryView.tsx',
  ].map((relativePath) => fs.readFileSync(path.join(rootDir, relativePath), 'utf8'))

  assert.match(pageSource, /import ['"]\.\/assets\/AssetLibraryPages\.scss['"]/)
  assert.ok(pageSource.split('\n').length <= 40, 'page shell should remain composed and small')

  for (const source of otherSources) {
    assert.doesNotMatch(source, /AssetLibraryPages\.scss/)
  }
})

test('Each content resource component imports its matching SCSS file directly', () => {
  for (const [tsxPath, styleImport] of matchingOwnershipPairs) {
    const absoluteTsxPath = path.join(rootDir, tsxPath)
    const source = fs.readFileSync(absoluteTsxPath, 'utf8')
    const absoluteScssPath = absoluteTsxPath.replace(/\.tsx$/, '.scss')

    assert.match(source, new RegExp(`import ['"]${styleImport.replace('.', '\\.')}['"]`))
    assert.equal(fs.existsSync(absoluteScssPath), true)
  }
})

test('Content resource SCSS files do not aggregate hidden styles through Sass load-css', () => {
  for (const [tsxPath] of matchingOwnershipPairs) {
    const absoluteScssPath = path.join(rootDir, tsxPath).replace(/\.tsx$/, '.scss')
    const source = fs.readFileSync(absoluteScssPath, 'utf8')

    assert.doesNotMatch(source, /meta\.load-css|@use ['"]sass:meta['"]/, absoluteScssPath)
  }
})

test('AssetLibraryPages excludes selectors now owned by content-resource components', () => {
  const source = fs.readFileSync(sharedStylePath, 'utf8')
  const migratedSelectors = [
    '.asset-library-themed-popconfirm',
    '.pending-file-icon',
    '.photo-upload-grid',
    '.product-cover-grid.count-1',
    '.scene-management-summary',
    '.single-library-asset-card',
    '.single-library-asset-grid',
    '.works-asset-card',
  ]

  for (const selector of migratedSelectors) {
    assert.doesNotMatch(source, new RegExp(selector.replaceAll('.', '\\.')))
  }
})
