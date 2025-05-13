import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { jest } from '@jest/globals'
import { Readable } from 'stream'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TEST_IMAGE_PATH = path.join(__dirname, '../data/test.jpg')

// Create a readable stream from buffer
const createReadableStream = (buffer) => {
  return new Readable({
    read() {
      this.push(buffer)
      this.push(null)
    },
  })
}

// Mock only external HTTP calls
jest.unstable_mockModule('axios', () => {
  const mockAxios = jest.fn().mockImplementation((config) => {
    // Use real test image data
    const testImageData = fs.readFileSync(TEST_IMAGE_PATH)
    const stream = createReadableStream(testImageData)

    // Add pipe method to stream
    stream.pipe = jest.fn().mockImplementation((dest) => {
      dest.write(testImageData)
      dest.end()
      return dest
    })

    // Simulate real HTTP responses but don't make actual calls
    if (config.url === 'http://example.com/test.jpg') {
      return Promise.resolve({
        status: 200,
        data: stream,
        headers: {
          'content-type': 'image/jpeg',
          'content-length': testImageData.length.toString(),
          get: (name) =>
            ({
              'content-type': 'image/jpeg',
              'content-length': testImageData.length.toString(),
            })[name.toLowerCase()],
        },
      })
    }
    return Promise.reject(new Error('Not Found'))
  })
  mockAxios.get = mockAxios
  mockAxios.head = mockAxios
  return { default: mockAxios }
})

const { downloadFile } = await import('../../src/download.mjs')

describe('Download Integration Tests', () => {
  let tempDir

  beforeEach(() => {
    // Create temp directory
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'download-test-'))
  })

  afterEach(() => {
    // Cleanup
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('should download and save a real image file to disk', async () => {
    const destPath = path.join(tempDir, 'test.jpg')

    // Ensure temp directory exists
    expect(fs.existsSync(tempDir)).toBe(true)

    // Use real file system operations
    const result = await downloadFile('http://example.com/test.jpg', destPath)

    expect(result).toBe(true)

    // Verify file was actually written
    expect(fs.existsSync(destPath)).toBe(true)

    // Compare with original test image
    const originalData = fs.readFileSync(TEST_IMAGE_PATH)
    const downloadedData = fs.readFileSync(destPath)
    expect(downloadedData).toEqual(originalData)
  })

  it('should handle download errors', async () => {
    const destPath = path.join(tempDir, 'nonexistent.jpg')

    await expect(
      downloadFile('http://example.com/nonexistent.jpg', destPath)
    ).rejects.toThrow('Not Found')

    // Verify no file was created
    expect(fs.existsSync(destPath)).toBe(false)
  })

  it('should pass extra headers to axios', async () => {
    const destPath = path.join(tempDir, 'test.jpg')
    const extraHeaders = { 'X-Custom-Header': 'value' }

    const result = await downloadFile(
      'http://example.com/test.jpg',
      destPath,
      60000,
      extraHeaders
    )

    expect(result).toBe(true)

    // Verify file was actually written
    expect(fs.existsSync(destPath)).toBe(true)

    // Compare with original test image
    const originalData = fs.readFileSync(TEST_IMAGE_PATH)
    const downloadedData = fs.readFileSync(destPath)
    expect(downloadedData).toEqual(originalData)

    // Verify that axios was called with the extra headers
    const axios = await import('axios')
    const mockAxios = axios.default
    expect(mockAxios).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        url: 'http://example.com/test.jpg',
        responseType: 'stream',
        headers: extraHeaders,
        timeout: 60000,
      })
    )
  })
})
