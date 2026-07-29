import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

const ownershipPairs = [
  [
    'frontend/web/src/pages/creator-ops/DouyinCreatorSearchPage.tsx',
    './DouyinCreatorSearchPage.scss',
  ],
  [
    'frontend/web/src/pages/creator-ops/douyin/DouyinAccountPicker.tsx',
    './DouyinAccountPicker.scss',
  ],
  [
    'frontend/web/src/pages/creator-ops/douyin/DouyinHeaderActions.tsx',
    './DouyinHeaderActions.scss',
  ],
  [
    'frontend/web/src/pages/creator-ops/douyin/DouyinSearchResults.tsx',
    './DouyinSearchResults.scss',
  ],
  [
    'frontend/web/src/pages/creator-ops/douyin/useDouyinResultColumns.tsx',
    './useDouyinResultColumns.scss',
  ],
]

test('Each Douyin page component imports its matching SCSS file directly', () => {
  for (const [tsxPath, styleImport] of ownershipPairs) {
    const absoluteTsxPath = path.join(rootDir, tsxPath)
    const source = fs.readFileSync(absoluteTsxPath, 'utf8')
    const absoluteScssPath = absoluteTsxPath.replace(/\.tsx$/, '.scss')

    assert.match(source, new RegExp(`import ['"]${styleImport.replace('.', '\\.')}['"]`))
    assert.equal(fs.existsSync(absoluteScssPath), true)
  }
})

test('Douyin component styles do not hide aggregation behind Sass load-css', () => {
  for (const [tsxPath] of ownershipPairs) {
    const absoluteScssPath = path.join(rootDir, tsxPath).replace(/\.tsx$/, '.scss')
    const source = fs.readFileSync(absoluteScssPath, 'utf8')

    assert.doesNotMatch(source, /meta\.load-css|@use ['"]sass:meta['"]/, absoluteScssPath)
  }
})
