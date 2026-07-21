import assert from 'node:assert/strict'
import test from 'node:test'
import sharp from 'sharp'
import { chromaKeyGeneratedImage } from '../src/modules/chat/capabilities/image-chroma-key.js'

async function pngFromPixels(width: number, height: number, pixels: number[]) {
  return sharp(Buffer.from(pixels), {
    raw: { channels: 3, height, width },
  }).png().toBuffer()
}

async function rawPixels(buffer: Buffer) {
  return sharp(buffer).raw().toBuffer({ resolveWithObject: true })
}

test('removes strong green inside an enclosed foreground ring', async () => {
  const green = [0, 255, 0]
  const red = [220, 20, 20]
  const pixels = [
    ...green, ...green, ...green, ...green, ...green,
    ...green, ...red, ...red, ...red, ...green,
    ...green, ...red, ...green, ...red, ...green,
    ...green, ...red, ...red, ...red, ...green,
    ...green, ...green, ...green, ...green, ...green,
  ]
  const result = await chromaKeyGeneratedImage(await pngFromPixels(5, 5, pixels), 'transparent')
  const decoded = await rawPixels(result.buffer)

  assert.equal(decoded.info.channels, 4)
  assert.equal(decoded.data[(2 * 5 + 2) * 4 + 3], 0)
  assert.equal(decoded.data[(1 * 5 + 1) * 4 + 3], 255)
})

test('preserves an isolated foreground green that differs from the strong key color', async () => {
  const background = [0, 255, 0]
  const red = [220, 20, 20]
  const foregroundGreen = [30, 120, 35]
  const pixels = [
    ...background, ...background, ...background, ...background, ...background,
    ...background, ...red, ...red, ...red, ...background,
    ...background, ...red, ...foregroundGreen, ...red, ...background,
    ...background, ...red, ...red, ...red, ...background,
    ...background, ...background, ...background, ...background, ...background,
  ]
  const result = await chromaKeyGeneratedImage(await pngFromPixels(5, 5, pixels), 'transparent')
  const decoded = await rawPixels(result.buffer)

  assert.equal(decoded.data[(2 * 5 + 2) * 4 + 3], 255)
})

test('composites keyed output onto the requested opaque background', async () => {
  const input = await pngFromPixels(1, 1, [0, 255, 0])
  const result = await chromaKeyGeneratedImage(input, 'black')
  const decoded = await rawPixels(result.buffer)

  assert.equal(decoded.info.channels, 3)
  assert.deepEqual([...decoded.data], [0, 0, 0])
})

test('creates a soft alpha for connected green edge pixels', async () => {
  const input = await pngFromPixels(3, 1, [
    0, 255, 0,
    60, 120, 55,
    220, 20, 20,
  ])
  const result = await chromaKeyGeneratedImage(input, 'transparent')
  const decoded = await rawPixels(result.buffer)
  const edgeAlpha = decoded.data[7]

  assert.ok(edgeAlpha > 0 && edgeAlpha < 255)
  assert.equal(decoded.data[11], 255)
})

test('keys soft edges connected to a strong green enclosed area', async () => {
  const red = [220, 20, 20]
  const pixels = Array.from({ length: 25 }, () => red).flat()
  pixels.splice((2 * 5 + 2) * 3, 3, 0, 255, 0)
  pixels.splice((2 * 5 + 3) * 3, 3, 60, 120, 55)
  const result = await chromaKeyGeneratedImage(await pngFromPixels(5, 5, pixels), 'transparent')
  const decoded = await rawPixels(result.buffer)
  const enclosedEdgeAlpha = decoded.data[(2 * 5 + 3) * 4 + 3]

  assert.equal(decoded.data[(2 * 5 + 2) * 4 + 3], 0)
  assert.ok(enclosedEdgeAlpha > 0 && enclosedEdgeAlpha < 255)
})
