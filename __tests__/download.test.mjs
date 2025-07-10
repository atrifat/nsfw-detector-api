import { jest } from '@jest/globals'
import { Readable } from 'stream'
import { tmpdir } from 'os'
import { join } from 'path'
import * as fs from 'node:fs/promises'

// This helper is stateless and can be defined once.
const createMockHeaders = (headers) => {
  const mockHeaders = Object.entries(headers).reduce((acc, [key, value]) => {
    acc[key.toLowerCase()] = value
    return acc
  }, {})
  return {
    ...mockHeaders,
    get: (name) => mockHeaders[name.toLowerCase()],
  }
}

describe('Download Utilities', () => {
  beforeEach(() => {
    jest.resetModules()
  })

  // A more robust helper for setting up axios mocks
  const setupAxiosMock = async (mocks) => {
    const axios = jest.fn((config) => {
      if (mocks[config.url] && mocks[config.url].default) {
        return Promise.resolve(mocks[config.url].default)
      }
      return Promise.reject(new Error(`No mock for ${config.url}`))
    })
    axios.head = jest.fn((url) => {
      if (mocks[url] && mocks[url].head) {
        return Promise.resolve(mocks[url].head)
      }
      return Promise.reject(new Error(`No head mock for ${url}`))
    })
    axios.get = jest.fn((url, config) => {
      if (mocks[url] && mocks[url].get) {
        return Promise.resolve(mocks[url].get(config))
      }
      return Promise.reject(new Error(`No get mock for ${url}`))
    })
    axios.isAxiosError = (payload) => payload && payload.isAxiosError === true
    jest.unstable_mockModule('axios', () => ({
      __esModule: true,
      default: axios,
    }))
    return (await import('axios')).default
  }

  describe('getContentInfo', () => {
    beforeEach(async () => {
      const mime = (await import('mime')).default
      const getExtension = (contentType) => {
        if (contentType === 'video/mp4') return 'mp4'
        if (contentType === 'image/jpeg') return 'jpg'
        return 'bin'
      }
      mime.__setMockGetExtension(getExtension)
    })

    it('should return content info for a valid URL', async () => {
      await setupAxiosMock({
        'http://example.com/image.jpg': {
          head: {
            status: 200,
            headers: createMockHeaders({
              'content-type': 'image/jpeg',
              'content-length': '1234',
            }),
          },
        },
      })
      const { getContentInfo } = await import('../src/download.mjs')
      const info = await getContentInfo('http://example.com/image.jpg')
      expect(info).toEqual({
        contentType: 'image/jpeg',
        contentLength: 1234,
        extension: 'jpg',
      })
    })

    it('should handle errors gracefully', async () => {
      const mockAxios = {
        head: jest.fn().mockRejectedValue(new Error('Network error')),
      }
      jest.unstable_mockModule('axios', () => ({
        __esModule: true,
        default: mockAxios,
      }))
      const { getContentInfo } = await import('../src/download.mjs')
      await expect(
        getContentInfo('http://example.com/image.jpg')
      ).rejects.toThrow('Network error')
    })

    it('should throw an error if a redirect loop is detected', async () => {
      const url = 'http://example.com/redirect-loop'
      const mockAxios = {
        head: jest
          .fn()
          .mockResolvedValueOnce({
            status: 302,
            headers: createMockHeaders({ location: url }),
          })
          .mockResolvedValueOnce({
            status: 302,
            headers: createMockHeaders({ location: url }),
          })
          .mockResolvedValueOnce({
            status: 302,
            headers: createMockHeaders({ location: url }),
          })
          .mockResolvedValueOnce({
            status: 302,
            headers: createMockHeaders({ location: url }),
          })
          .mockResolvedValueOnce({
            status: 302,
            headers: createMockHeaders({ location: url }),
          })
          .mockResolvedValueOnce({
            status: 302,
            headers: createMockHeaders({ location: url }),
          }),
      }
      jest.unstable_mockModule('axios', () => ({
        __esModule: true,
        default: mockAxios,
        isAxiosError: (payload) => payload && payload.isAxiosError === true,
      }))
      const { getContentInfo } = await import('../src/download.mjs')
      await expect(getContentInfo(url)).rejects.toThrow('Too many redirects')
    })

    it('should handle invalid content-length', async () => {
      await setupAxiosMock({
        'http://example.com/image.jpg': {
          head: {
            status: 200,
            headers: createMockHeaders({
              'content-type': 'image/jpeg',
              'content-length': 'invalid',
            }),
          },
        },
      })
      const { getContentInfo } = await import('../src/download.mjs')
      const info = await getContentInfo('http://example.com/image.jpg')
      expect(info).toEqual({
        contentType: 'image/jpeg',
        contentLength: 0,
        extension: 'jpg',
      })
    })

    it('should throw an error for non-200 status code', async () => {
      await setupAxiosMock({
        'http://example.com/image.jpg': {
          head: {
            status: 500,
            headers: createMockHeaders({}),
          },
        },
      })
      const { getContentInfo } = await import('../src/download.mjs')
      await expect(
        getContentInfo('http://example.com/image.jpg')
      ).rejects.toThrow('Failed to get content info. Status: 500')
    })
  })

  describe('downloadFile', () => {
    let tempFilePath

    beforeEach(() => {
      tempFilePath = join(tmpdir(), `test-file-${Date.now()}.txt`)
    })

    afterEach(async () => {
      try {
        await fs.unlink(tempFilePath)
        // eslint-disable-next-line no-unused-vars
      } catch (error) {
        // Ignore
      }
    })

    it('should download a file successfully', async () => {
      const mockStream = new Readable({
        read() {
          this.push('file content')
          this.push(null)
        },
      })
      const mockAxios = jest.fn().mockResolvedValue({
        status: 200,
        data: mockStream,
        headers: createMockHeaders({ 'content-type': 'text/plain' }),
      })
      jest.unstable_mockModule('axios', () => ({
        __esModule: true,
        default: mockAxios,
      }))
      const { downloadFile } = await import('../src/download.mjs')
      await downloadFile('http://example.com/file.txt', tempFilePath)
      const content = await fs.readFile(tempFilePath, 'utf-8')
      expect(content).toBe('file content')
    })

    it('should handle download errors', async () => {
      const mockAxios = jest.fn().mockResolvedValue({
        status: 500,
        data: null,
      })
      jest.unstable_mockModule('axios', () => ({
        __esModule: true,
        default: mockAxios,
        isAxiosError: (payload) => payload && payload.isAxiosError === true,
      }))
      const { downloadFile } = await import('../src/download.mjs')
      await expect(
        downloadFile('http://example.com/file.txt', 'some/path')
      ).rejects.toThrow('Download failed: Failed to download file. Status: 500')
    })

    it('should reject on write stream error', async () => {
      const mockStream = new Readable({
        read() {
          this.push('file content')
          this.push(null)
        },
      })
      const mockAxios = jest.fn().mockResolvedValue({
        status: 200,
        data: mockStream,
        headers: createMockHeaders({ 'content-type': 'text/plain' }),
      })
      jest.unstable_mockModule('axios', () => ({
        __esModule: true,
        default: mockAxios,
      }))

      const { Writable } = await import('stream')
      const mockWriteStream = new Writable()
      mockWriteStream._write = (chunk, encoding, done) => {
        done(new Error('write error'))
      }

      jest.unstable_mockModule('node:fs', () => ({
        createWriteStream: jest.fn().mockReturnValue(mockWriteStream),
      }))

      const { downloadFile } = await import('../src/download.mjs')
      await expect(
        downloadFile('http://example.com/file.txt', 'some/path')
      ).rejects.toThrow('write error')
    })
  })

  describe('downloadFileToBuffer', () => {
    it('should download a file to a buffer', async () => {
      const mockAxios = jest.fn().mockResolvedValue({
        status: 200,
        data: Buffer.from('file content'),
        headers: createMockHeaders({ 'content-type': 'text/plain' }),
      })
      jest.unstable_mockModule('axios', () => ({
        __esModule: true,
        default: mockAxios,
      }))
      const { downloadFileToBuffer } = await import('../src/download.mjs')
      const buffer = await downloadFileToBuffer('http://example.com/file.txt')
      expect(buffer.toString()).toBe('file content')
    })

    it('should handle download errors', async () => {
      const mockAxios = jest.fn().mockResolvedValue({
        status: 500,
        data: null,
      })
      jest.unstable_mockModule('axios', () => ({
        __esModule: true,
        default: mockAxios,
        isAxiosError: (payload) => payload && payload.isAxiosError === true,
      }))
      const { downloadFileToBuffer } = await import('../src/download.mjs')
      await expect(
        downloadFileToBuffer('http://example.com/file.txt')
      ).rejects.toThrow('Download failed: Failed to download file. Status: 500')
    })
  })

  describe('downloadPartFile', () => {
    let tempFilePath

    beforeEach(() => {
      tempFilePath = join(tmpdir(), `test-file-${Date.now()}.txt`)
    })

    afterEach(async () => {
      try {
        await fs.unlink(tempFilePath)
        // eslint-disable-next-line no-unused-vars
      } catch (error) {
        // Ignore
      }
    })

    it('should download a partial file successfully', async () => {
      const { PassThrough } = await import('stream')
      const mockWriteStream = new PassThrough()
      const chunks = []
      mockWriteStream.on('data', (chunk) => chunks.push(chunk))

      jest.unstable_mockModule('node:fs', () => ({
        createWriteStream: jest.fn().mockReturnValue(mockWriteStream),
      }))

      const mockStream = Readable.from(['file content'])
      const mockAxios = {
        head: jest.fn().mockResolvedValue({
          status: 200,
          headers: createMockHeaders({
            'content-length': '1000',
          }),
        }),
        get: jest.fn().mockResolvedValue({
          status: 206,
          data: mockStream,
          headers: createMockHeaders({ 'content-type': 'video/mp4' }),
        }),
      }
      jest.unstable_mockModule('axios', () => ({
        __esModule: true,
        default: mockAxios,
      }))

      const { downloadPartFile } = await import('../src/download.mjs')
      await downloadPartFile('http://example.com/video.mp4', tempFilePath, 500)

      const content = Buffer.concat(chunks).toString('utf-8')
      expect(content).toBe('file content')
    })

    it('should throw an error when the server returns 416 status', async () => {
      const mockAxios = {
        head: jest.fn().mockResolvedValue({
          status: 200,
          headers: createMockHeaders({
            'content-length': '2000',
          }),
        }),
        get: jest.fn().mockResolvedValue({
          status: 416,
        }),
      }
      jest.unstable_mockModule('axios', () => ({
        __esModule: true,
        default: mockAxios,
        isAxiosError: (payload) => payload && payload.isAxiosError === true,
      }))
      const { downloadPartFile } = await import('../src/download.mjs')
      await expect(
        downloadPartFile('http://example.com/video.mp4', 'some/path', 1000)
      ).rejects.toThrow('Server does not support Range header request.')
    })

    it('should throw an error when the download fails due to a network error', async () => {
      const mockAxios = {
        head: jest.fn().mockResolvedValue({
          status: 200,
          headers: createMockHeaders({
            'content-length': '2000',
          }),
        }),
        get: jest.fn().mockRejectedValue(new Error('Network error')),
      }
      jest.unstable_mockModule('axios', () => ({
        __esModule: true,
        default: mockAxios,
        isAxiosError: (payload) => payload && payload.isAxiosError === true,
      }))
      const { downloadPartFile } = await import('../src/download.mjs')
      await expect(
        downloadPartFile('http://example.com/video.mp4', 'some/path', 1000)
      ).rejects.toThrow('Network error')
    })

    it('should handle missing content-length by downloading the full file', async () => {
      const { PassThrough } = await import('stream')
      const mockWriteStream = new PassThrough()
      jest.unstable_mockModule('node:fs', () => ({
        createWriteStream: jest.fn().mockReturnValue(mockWriteStream),
      }))

      const mockStream = Readable.from(['full file content'])
      const mockAxios = {
        head: jest.fn().mockResolvedValue({
          status: 200,
          headers: createMockHeaders({}), // No content-length
        }),
        get: jest.fn().mockResolvedValue({
          status: 200, // Full download
          data: mockStream,
          headers: createMockHeaders({ 'content-type': 'video/mp4' }),
        }),
      }
      jest.unstable_mockModule('axios', () => ({
        __esModule: true,
        default: mockAxios,
      }))

      const { downloadPartFile } = await import('../src/download.mjs')
      await downloadPartFile('http://example.com/video.mp4', tempFilePath, 500)

      expect(mockAxios.get).toHaveBeenCalledWith(
        'http://example.com/video.mp4',
        expect.objectContaining({
          headers: expect.not.objectContaining({
            Range: expect.any(String),
          }),
        })
      )
    })

    it('should download the full file if smaller than maxVideoSize', async () => {
      const { PassThrough } = await import('stream')
      const mockWriteStream = new PassThrough()
      const chunks = []
      mockWriteStream.on('data', (chunk) => chunks.push(chunk))

      jest.unstable_mockModule('node:fs', () => ({
        createWriteStream: jest.fn().mockReturnValue(mockWriteStream),
      }))

      const mockStream = Readable.from(['file content'])
      const mockAxios = {
        head: jest.fn().mockResolvedValue({
          status: 200,
          headers: createMockHeaders({
            'content-length': '1000',
          }),
        }),
        get: jest.fn().mockResolvedValue({
          status: 200,
          data: mockStream,
          headers: createMockHeaders({ 'content-type': 'video/mp4' }),
        }),
      }
      jest.unstable_mockModule('axios', () => ({
        __esModule: true,
        default: mockAxios,
      }))

      const { downloadPartFile } = await import('../src/download.mjs')
      await downloadPartFile('http://example.com/video.mp4', tempFilePath, 2000)

      expect(mockAxios.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.not.objectContaining({
            Range: expect.any(String),
          }),
        })
      )
      const content = Buffer.concat(chunks).toString('utf-8')
      expect(content).toBe('file content')
    })

    it('should throw an error for unexpected partial download status code', async () => {
      const mockAxios = {
        head: jest.fn().mockResolvedValue({
          status: 200,
          headers: createMockHeaders({
            'content-length': '2000',
          }),
        }),
        get: jest.fn().mockResolvedValue({
          status: 500, // Not 206
        }),
      }
      jest.unstable_mockModule('axios', () => ({
        __esModule: true,
        default: mockAxios,
        isAxiosError: (payload) => payload && payload.isAxiosError === true,
      }))
      const { downloadPartFile } = await import('../src/download.mjs')
      await expect(
        downloadPartFile('http://example.com/video.mp4', 'some/path', 1000)
      ).rejects.toThrow('Failed to download partial file. Status: 500')
    })

    it('should reject if content-length exceeds max size in saveOutput', async () => {
      const mockAxios = {
        head: jest.fn().mockResolvedValue({
          status: 200,
          headers: createMockHeaders({
            'content-length': '3000', // Exceeds maxVideoSize
          }),
        }),
        get: jest.fn().mockResolvedValue({
          status: 200,
          data: Readable.from(['some data']),
          headers: createMockHeaders({ 'content-length': '3000' }),
        }),
      }
      jest.unstable_mockModule('axios', () => ({
        __esModule: true,
        default: mockAxios,
      }))
      const { downloadPartFile } = await import('../src/download.mjs')
      await expect(
        downloadPartFile('http://example.com/video.mp4', tempFilePath, 2000)
      ).rejects.toThrow('Content length exceeds maximum allowed size.')
    })

    it('should reject if downloaded size exceeds max size in saveOutput', async () => {
      const mockStream = Readable.from(['a'.repeat(2000)]) // Push a single large chunk

      const mockAxios = {
        head: jest.fn().mockResolvedValue({
          status: 200,
          headers: createMockHeaders({
            'content-length': '2000',
          }),
        }),
        get: jest.fn().mockResolvedValue({
          status: 200,
          data: mockStream,
          headers: createMockHeaders({ 'content-type': 'video/mp4' }),
        }),
      }
      jest.unstable_mockModule('axios', () => ({
        __esModule: true,
        default: mockAxios,
      }))
      const { downloadPartFile } = await import('../src/download.mjs')
      await expect(
        downloadPartFile('http://example.com/video.mp4', tempFilePath, 1500)
      ).rejects.toThrow('Downloaded size exceeds content length.')
    })
  })

  describe('downloadPartFileToBuffer', () => {
    it('should download a partial file to a buffer', async () => {
      const mockAxios = {
        head: jest.fn().mockResolvedValue({
          status: 200,
          headers: createMockHeaders({
            'content-length': '1000',
          }),
        }),
        get: jest.fn().mockResolvedValue({
          status: 206,
          data: Buffer.from('file content'),
          headers: createMockHeaders({ 'content-type': 'video/mp4' }),
        }),
      }
      jest.unstable_mockModule('axios', () => ({
        __esModule: true,
        default: mockAxios,
      }))
      const { downloadPartFileToBuffer } = await import('../src/download.mjs')
      const buffer = await downloadPartFileToBuffer(
        'http://example.com/video.mp4',
        500
      )
      expect(buffer.toString()).toBe('file content')
    })

    it('should throw an error when the server returns 416 status', async () => {
      const mockAxios = {
        head: jest.fn().mockResolvedValue({
          status: 200,
          headers: createMockHeaders({
            'content-length': '2000',
          }),
        }),
        get: jest.fn().mockResolvedValue({
          status: 416,
        }),
      }
      jest.unstable_mockModule('axios', () => ({
        __esModule: true,
        default: mockAxios,
        isAxiosError: (payload) => payload && payload.isAxiosError === true,
      }))
      const { downloadPartFileToBuffer } = await import('../src/download.mjs')
      await expect(
        downloadPartFileToBuffer('http://example.com/video.mp4', 1000)
      ).rejects.toThrow('Server does not support Range header request.')
    })

    it('should throw an error when the download fails due to a network error', async () => {
      const mockAxios = {
        head: jest.fn().mockResolvedValue({
          status: 200,
          headers: createMockHeaders({
            'content-length': '2000',
          }),
        }),
        get: jest.fn().mockRejectedValue(new Error('Network error')),
      }
      jest.unstable_mockModule('axios', () => ({
        __esModule: true,
        default: mockAxios,
        isAxiosError: (payload) => payload && payload.isAxiosError === true,
      }))
      const { downloadPartFileToBuffer } = await import('../src/download.mjs')
      await expect(
        downloadPartFileToBuffer('http://example.com/video.mp4', 1000)
      ).rejects.toThrow('Network error')
    })

    it('should handle missing content-length', async () => {
      const mockAxios = {
        head: jest.fn().mockResolvedValue({
          status: 200,
          headers: createMockHeaders({}),
        }),
        get: jest.fn().mockResolvedValue({
          status: 200,
          data: Buffer.from('file content'),
          headers: createMockHeaders({ 'content-type': 'video/mp4' }),
        }),
      }
      jest.unstable_mockModule('axios', () => ({
        __esModule: true,
        default: mockAxios,
      }))
      const { downloadPartFileToBuffer } = await import('../src/download.mjs')
      await downloadPartFileToBuffer('http://example.com/video.mp4', 500)
      expect(mockAxios.get).toHaveBeenCalledWith(
        'http://example.com/video.mp4',
        expect.objectContaining({
          headers: expect.not.objectContaining({
            Range: expect.any(String),
          }),
        })
      )
    })

    it('should download the full file if smaller than maxVideoSize', async () => {
      const mockAxios = {
        head: jest.fn().mockResolvedValue({
          status: 200,
          headers: createMockHeaders({
            'content-length': '1000',
          }),
        }),
        get: jest.fn().mockResolvedValue({
          status: 200,
          data: Buffer.from('file content'),
          headers: createMockHeaders({ 'content-type': 'video/mp4' }),
        }),
      }
      jest.unstable_mockModule('axios', () => ({
        __esModule: true,
        default: mockAxios,
      }))
      const { downloadPartFileToBuffer } = await import('../src/download.mjs')
      await downloadPartFileToBuffer('http://example.com/video.mp4', 2000)
      expect(mockAxios.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.not.objectContaining({
            Range: expect.any(String),
          }),
        })
      )
    })

    it('should throw an error for unexpected status code', async () => {
      const mockAxios = {
        head: jest.fn().mockResolvedValue({
          status: 200,
          headers: createMockHeaders({
            'content-length': '2000',
          }),
        }),
        get: jest.fn().mockResolvedValue({
          status: 500,
        }),
      }
      jest.unstable_mockModule('axios', () => ({
        __esModule: true,
        default: mockAxios,
        isAxiosError: (payload) => payload && payload.isAxiosError === true,
      }))
      const { downloadPartFileToBuffer } = await import('../src/download.mjs')
      await expect(
        downloadPartFileToBuffer('http://example.com/video.mp4', 1000)
      ).rejects.toThrow('Failed to download partial file. Status: 500')
    })

    it('should throw an error if getResponse has no data', async () => {
      const mockAxios = {
        head: jest.fn().mockResolvedValue({
          status: 200,
          headers: createMockHeaders({
            'content-length': '1000',
          }),
        }),
        get: jest.fn().mockResolvedValue({
          status: 200,
          data: null,
          headers: createMockHeaders({ 'content-type': 'video/mp4' }),
        }),
      }
      jest.unstable_mockModule('axios', () => ({
        __esModule: true,
        default: mockAxios,
      }))
      const { downloadPartFileToBuffer } = await import('../src/download.mjs')
      await expect(
        downloadPartFileToBuffer('http://example.com/video.mp4', 2000)
      ).rejects.toThrow('Failed to download file. Status: 200')
    })

    it('should throw an error if partialResponse has no data', async () => {
      const mockAxios = {
        head: jest.fn().mockResolvedValue({
          status: 200,
          headers: createMockHeaders({
            'content-length': '3000',
          }),
        }),
        get: jest.fn().mockResolvedValue({
          status: 206,
          data: null,
          headers: createMockHeaders({ 'content-type': 'video/mp4' }),
        }),
      }
      jest.unstable_mockModule('axios', () => ({
        __esModule: true,
        default: mockAxios,
      }))
      const { downloadPartFileToBuffer } = await import('../src/download.mjs')
      await expect(
        downloadPartFileToBuffer('http://example.com/video.mp4', 2000)
      ).rejects.toThrow(
        'Downloaded part successfully (status 206) but no data received.'
      )
    })
  })

  describe('getVideoStream', () => {
    it('should return a readable stream for a valid video URL', async () => {
      const mockStream = new Readable({
        read() {
          this.push('video data')
          this.push(null)
        },
      })
      await setupAxiosMock({
        'http://example.com/video.mp4': {
          get: () =>
            Promise.resolve({
              status: 200,
              data: mockStream,
              headers: createMockHeaders({ 'content-type': 'video/mp4' }),
            }),
        },
      })
      const { getVideoStream } = await import('../src/download.mjs')
      const result = await getVideoStream('http://example.com/video.mp4')
      expect(result).toBeInstanceOf(Readable)
    })

    it('should throw an error for non-200 HTTP status codes', async () => {
      await setupAxiosMock({
        'http://example.com/nonexistent.mp4': {
          get: () =>
            Promise.resolve({
              status: 404,
              data: {
                destroy: jest.fn(),
              },
            }),
        },
      })
      const { getVideoStream } = await import('../src/download.mjs')
      await expect(
        getVideoStream('http://example.com/nonexistent.mp4')
      ).rejects.toThrow('Failed to get video stream: HTTP status 404')
    })

    it('should throw an error for invalid content types', async () => {
      const mockStream = new Readable({
        read() {
          this.push('')
          this.push(null)
        },
      })
      await setupAxiosMock({
        'http://example.com/image.jpg': {
          get: () =>
            Promise.resolve({
              status: 200,
              data: mockStream,
              headers: createMockHeaders({ 'content-type': 'image/jpeg' }),
            }),
        },
      })
      const { getVideoStream } = await import('../src/download.mjs')
      await expect(
        getVideoStream('http://example.com/image.jpg')
      ).rejects.toThrow(
        'Invalid content type: Expected video or application/octet-stream, got image/jpeg'
      )
    })

    it('should throw an error on network issues (AxiosError)', async () => {
      await setupAxiosMock({
        'http://example.com/network-error.mp4': {
          get: () =>
            Promise.reject(
              Object.assign(new Error('Network Error'), {
                isAxiosError: true,
                message: 'Network Error',
                code: 'ERR_NETWORK',
              })
            ),
        },
      })
      const { getVideoStream } = await import('../src/download.mjs')
      await expect(
        getVideoStream('http://example.com/network-error.mp4')
      ).rejects.toThrow(
        'Failed to get video stream: Network Error (Status: N/A)'
      )
    })
  })

  describe('getVideoBuffer', () => {
    it('should download a full video to a buffer successfully', async () => {
      const mockVideoData = Buffer.from('full video content data')
      await setupAxiosMock({
        'http://example.com/full-video.mp4': {
          get: () =>
            Promise.resolve({
              status: 200,
              data: mockVideoData,
              headers: createMockHeaders({
                'content-type': 'video/mp4',
                'content-length': mockVideoData.length.toString(),
              }),
            }),
        },
      })
      const { getVideoBuffer } = await import('../src/download.mjs')
      const resultBuffer = await getVideoBuffer(
        'http://example.com/full-video.mp4'
      )
      expect(resultBuffer).toEqual(mockVideoData)
    })

    it('should throw an error on network issues (AxiosError)', async () => {
      await setupAxiosMock({
        'http://example.com/network-error.mp4': {
          get: () =>
            Promise.reject(
              Object.assign(new Error('Network Error'), {
                isAxiosError: true,
                message: 'Network Error',
                code: 'ERR_NETWORK',
              })
            ),
        },
      })
      const { getVideoBuffer } = await import('../src/download.mjs')
      await expect(
        getVideoBuffer('http://example.com/network-error.mp4')
      ).rejects.toThrow(
        'Failed to get video buffer: Network Error (Status: N/A)'
      )
    })

    it('should throw an error for non-200 HTTP status codes', async () => {
      await setupAxiosMock({
        'http://example.com/not-found.mp4': {
          get: () =>
            Promise.reject(
              Object.assign(new Error('Request failed with status code 404'), {
                isAxiosError: true,
                response: {
                  status: 404,
                },
              })
            ),
        },
      })
      const { getVideoBuffer } = await import('../src/download.mjs')
      await expect(
        getVideoBuffer('http://example.com/not-found.mp4')
      ).rejects.toThrow(
        'Failed to get video buffer: Request failed with status code 404 (Status: 404)'
      )
    })

    it('should log a warning if content-length header mismatches buffer length', async () => {
      const consoleWarnSpy = jest
        .spyOn(console, 'warn')
        .mockImplementation(() => {})
      const mockVideoData = Buffer.from('full video content data')
      await setupAxiosMock({
        'http://example.com/mismatch.mp4': {
          get: () =>
            Promise.resolve({
              status: 200,
              data: mockVideoData,
              headers: createMockHeaders({
                'content-type': 'video/mp4',
                'content-length': (mockVideoData.length + 100).toString(),
              }),
            }),
        },
      })
      const { getVideoBuffer } = await import('../src/download.mjs')
      await getVideoBuffer('http://example.com/mismatch.mp4')
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Buffer size mismatch')
      )
      consoleWarnSpy.mockRestore()
    })
  })

  describe('streamToBuffer', () => {
    it('should convert a readable stream to a buffer', async () => {
      const { streamToBuffer } = await import('../src/download.mjs')
      const stream = Readable.from([Buffer.from('hello'), Buffer.from('world')])
      const buffer = await streamToBuffer(stream)
      expect(buffer.toString()).toBe('helloworld')
    })

    it('should reject promise if stream emits an error', async () => {
      const { streamToBuffer } = await import('../src/download.mjs')
      const stream = new Readable({
        read() {
          this.emit('error', new Error('Stream error'))
        },
      })
      await expect(streamToBuffer(stream)).rejects.toThrow('Stream error')
    })
  })
})
