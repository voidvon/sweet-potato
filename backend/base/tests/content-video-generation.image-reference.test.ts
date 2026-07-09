import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { resolveSeedanceImageReferenceUrl } from '../src/modules/content/internals/content-video-generation.js';

test('resolveSeedanceImageReferenceUrl prefers assetUri for virtual portrait assets', async () => {
  const url = await resolveSeedanceImageReferenceUrl({
    resourceType: 'virtual_portrait',
    fileUrl: 'https://cdn.example.com/materials/ref-image.png',
    metadata: {
      assetUri: 'asset://volc-asset-1',
    },
  });

  assert.equal(url, 'asset://volc-asset-1');
});

test('resolveSeedanceImageReferenceUrl prefers public url for normal image assets', async () => {
  const url = await resolveSeedanceImageReferenceUrl({
    resourceType: 'product',
    fileUrl: 'https://cdn.example.com/materials/ref-image.png',
    metadata: {
      assetUri: 'asset://volc-asset-1',
    },
  });

  assert.equal(url, 'https://cdn.example.com/materials/ref-image.png');
});

test('resolveSeedanceImageReferenceUrl falls back to base64 for local files', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'seedance-image-ref-'));
  const filePath = path.join(dir, 'ref-image.png');
  try {
    await writeFile(filePath, Buffer.from('fake-image-content'));
    const url = await resolveSeedanceImageReferenceUrl({
      filePath,
      fileUrl: 'http://localhost:7072/files/ref-image.png',
      mimeType: 'image/png',
      metadata: {
        assetUri: 'asset://volc-asset-2',
      },
    });

    assert.match(url, /^data:image\/png;base64,/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('resolveSeedanceImageReferenceUrl prefers base64 for local_upload image assets', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'seedance-local-upload-ref-'));
  const filePath = path.join(dir, 'ref-image.png');
  try {
    await writeFile(filePath, Buffer.from('fake-image-content'));
    const url = await resolveSeedanceImageReferenceUrl({
      resourceType: 'product',
      filePath,
      fileUrl: 'http://broken-public-host/files/ref-image.png',
      mimeType: 'image/png',
      metadata: {
        source: 'local_upload',
      },
    });

    assert.match(url, /^data:image\/png;base64,/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
