import { processImageFile, processImageData } from '../src/image-processor.mjs'
import { readFile, unlink } from 'fs/promises'

describe('image-processor', () => {
  describe('processImageFile', () => {
    const outputPath = 'output.jpg'

    afterEach(async () => {
      // Clean up the created output file after each test
      try {
        await unlink(outputPath)
      } catch {
        // Ignore error if file doesn't exist
      }
    })

    it('should process an image file successfully', async () => {
      const filePath = '__tests__/data/test.jpg'

      const result = await processImageFile(filePath, outputPath)

      expect(result).toHaveProperty('size')
      expect(typeof result.size).toBe('number')
      expect(result.size).toBeGreaterThan(0) // Expect a non-zero file size

      expect(result).toHaveProperty('width')
      expect(result.width).toBe(224) // Expect the resized width

      expect(result).toHaveProperty('height')
      expect(typeof result.height).toBe('number')
      expect(result.height).toBeGreaterThan(0) // Expect a non-zero height

      // Check if the output file was actually created
      const fileExists = await readFile(outputPath)
        .then(() => true)
        .catch(() => false)
      expect(fileExists).toBe(true)
    })
  })

  describe('processImageData', () => {
    const outputPath = 'output.jpg'

    afterEach(async () => {
      // Clean up the created output file after each test
      try {
        await unlink(outputPath)
      } catch {
        // Ignore error if file doesn't exist
      }
    })

    it('should process image data successfully', async () => {
      const buffer = await readFile('__tests__/data/test.jpg')

      const result = await processImageData(buffer, outputPath)

      expect(result).toHaveProperty('size')
      expect(typeof result.size).toBe('number')
      expect(result.size).toBeGreaterThan(0)

      expect(result).toHaveProperty('width')
      expect(result.width).toBe(224)

      expect(result).toHaveProperty('height')
      expect(typeof result.height).toBe('number')
      expect(result.height).toBeGreaterThan(0)

      // Check if the output file was actually created
      const fileExists = await readFile(outputPath)
        .then(() => true)
        .catch(() => false)
      expect(fileExists).toBe(true)
    })
  })
})
