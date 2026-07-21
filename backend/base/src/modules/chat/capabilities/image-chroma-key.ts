import sharp from 'sharp'

export type ChromaKeyOutputBackground = 'transparent' | 'white' | 'black'

type RawImage = {
  data: Buffer
  height: number
  width: number
}

const opaqueAlpha = 255
const strongGreenDominance = 72
const softGreenDominance = 18

function greenDominance(data: Buffer, offset: number) {
  return data[offset + 1] - Math.max(data[offset], data[offset + 2])
}

function isStrongGreen(data: Buffer, offset: number) {
  return data[offset + 1] >= 145 && greenDominance(data, offset) >= strongGreenDominance
}

function isSoftGreen(data: Buffer, offset: number) {
  return data[offset + 1] >= 70 && greenDominance(data, offset) >= softGreenDominance
}

function markSoftGreenConnectedToKey(image: RawImage) {
  const { data, height, width } = image
  const pixelCount = width * height
  const marked = new Uint8Array(pixelCount)
  const queue = new Uint32Array(pixelCount)
  let queueStart = 0
  let queueEnd = 0

  function enqueue(pixelIndex: number) {
    if (marked[pixelIndex]) {
      return
    }
    const offset = pixelIndex * 4
    if (!isSoftGreen(data, offset)) {
      return
    }
    marked[pixelIndex] = 1
    queue[queueEnd] = pixelIndex
    queueEnd += 1
  }

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    if (isStrongGreen(data, pixelIndex * 4)) {
      enqueue(pixelIndex)
    }
  }

  while (queueStart < queueEnd) {
    const pixelIndex = queue[queueStart]
    queueStart += 1
    const x = pixelIndex % width
    if (pixelIndex >= width) {
      enqueue(pixelIndex - width)
    }
    if (pixelIndex < pixelCount - width) {
      enqueue(pixelIndex + width)
    }
    if (x > 0) {
      enqueue(pixelIndex - 1)
    }
    if (x < width - 1) {
      enqueue(pixelIndex + 1)
    }
  }

  return marked
}

function alphaForGreen(data: Buffer, offset: number) {
  const dominance = greenDominance(data, offset)
  if (dominance >= strongGreenDominance) {
    return 0
  }
  const normalized = (dominance - softGreenDominance) / (strongGreenDominance - softGreenDominance)
  return Math.round(opaqueAlpha * (1 - Math.max(0, Math.min(1, normalized))))
}

function applyChromaKey(image: RawImage) {
  const { data, height, width } = image
  const connectedSoftGreen = markSoftGreenConnectedToKey(image)
  for (let pixelIndex = 0; pixelIndex < width * height; pixelIndex += 1) {
    const offset = pixelIndex * 4
    const strongGreen = isStrongGreen(data, offset)
    if (!strongGreen && !connectedSoftGreen[pixelIndex]) {
      continue
    }
    const keyedAlpha = alphaForGreen(data, offset)
    const originalAlpha = data[offset + 3]
    const alpha = Math.round(originalAlpha * keyedAlpha / opaqueAlpha)
    const removedRatio = 1 - alpha / Math.max(1, originalAlpha)
    const neutralGreen = Math.max(data[offset], data[offset + 2])
    data[offset + 1] = Math.round(data[offset + 1] * (1 - removedRatio) + neutralGreen * removedRatio)
    data[offset + 3] = alpha
  }
  return data
}

export async function chromaKeyGeneratedImage(
  buffer: Buffer,
  outputBackground: ChromaKeyOutputBackground,
) {
  const decoded = await sharp(buffer)
    .rotate()
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const data = applyChromaKey({
    data: decoded.data,
    height: decoded.info.height,
    width: decoded.info.width,
  })
  const keyedImage = sharp(data, {
    raw: {
      channels: 4,
      height: decoded.info.height,
      width: decoded.info.width,
    },
  })
  const output = outputBackground === 'transparent'
    ? keyedImage
    : keyedImage.flatten({ background: outputBackground })
  return {
    buffer: await output.png().toBuffer(),
    mimeType: 'image/png',
  }
}
