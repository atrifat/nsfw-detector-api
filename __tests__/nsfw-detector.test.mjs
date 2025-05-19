import { NsfwSpy } from '../src/nsfw-detector.mjs'
import * as fs from 'node:fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

describe('NsfwSpy', () => {
  let nsfwSpy

  beforeAll(async () => {
    nsfwSpy = new NsfwSpy('file://models/mobilenet-v1.0.0/model.json')
    await nsfwSpy.load()
  })

  it('should classify an image from a byte array', async () => {
    const imagePath = path.join(__dirname, './data/test.jpg')
    const imageBuffer = await fs.readFile(imagePath)
    const result = await nsfwSpy.classifyImageFromByteArray(imageBuffer)

    expect(result).toBeDefined()
    expect(result.hentai).toBeGreaterThanOrEqual(0)
    expect(result.neutral).toBeGreaterThanOrEqual(0)
    expect(result.pornography).toBeGreaterThanOrEqual(0)
    expect(result.sexy).toBeGreaterThanOrEqual(0)
    expect(result.isNsfw).toBeDefined()
    expect(result.predictedLabel).toBeDefined()
  })

  it('should classify an image from a file path', async () => {
    const imagePath = path.join(__dirname, './data/test.jpg')
    const result = await nsfwSpy.classifyImageFile(imagePath)

    expect(result).toBeDefined()
    expect(result.hentai).toBeGreaterThanOrEqual(0)
    expect(result.neutral).toBeGreaterThanOrEqual(0)
    expect(result.pornography).toBeGreaterThanOrEqual(0)
    expect(result.sexy).toBeGreaterThanOrEqual(0)
    expect(result.isNsfw).toBeDefined()
    expect(result.predictedLabel).toBeDefined()
  })
})
