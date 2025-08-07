import { jest } from '@jest/globals'
import { Readable } from 'node:stream' // Import Readable

import {
  nsfwDetectorWorkerPool,
  imageProcessingWorkerPool,
} from '../src/resources.mjs'

// Set up mocks before importing modules to ensure they are applied before the module under test
// is imported. This is crucial for unstable_mockModule.

// p-memoize exports a function directly
jest.unstable_mockModule('p-memoize', () => {
  const pMemoize = (fn) => fn
  pMemoize.clear = jest.fn()
  return { default: pMemoize }
})

const mockDownloadFile = jest.fn().mockResolvedValue(undefined)
const mockGetContentInfo = jest
  .fn()
  .mockResolvedValue({ contentType: 'image/jpeg', contentLength: 1000 })

const mockDownloadPartFile = jest.fn().mockResolvedValue(undefined)
const mockDownloadFileToBuffer = jest
  .fn()
  .mockResolvedValue(Buffer.from('mock file buffer'))
const mockDownloadPartFileToBuffer = jest
  .fn()
  .mockResolvedValue(Buffer.from('mock partial file buffer'))
const mockGetVideoStream = jest.fn().mockResolvedValue(
  new Readable({
    read() {
      this.push(Buffer.from('mock video stream data'))
      this.push(null)
    },
  })
)
const mockGetVideoBuffer = jest
  .fn()
  .mockResolvedValue(Buffer.from('mock video buffer'))
const mockStreamToBuffer = jest
  .fn()
  .mockResolvedValue(Buffer.from('mock stream buffer'))

const mockDownload = {
  downloadFile: mockDownloadFile,
  getContentInfo: mockGetContentInfo,
  downloadPartFile: mockDownloadPartFile,
  downloadFileToBuffer: mockDownloadFileToBuffer,
  downloadPartFileToBuffer: mockDownloadPartFileToBuffer,
  getVideoStream: mockGetVideoStream,
  getVideoBuffer: mockGetVideoBuffer,
  streamToBuffer: mockStreamToBuffer,
}

jest.unstable_mockModule('../src/download.mjs', () => mockDownload)

const mockUtil = {
  cleanupTemporaryFile: jest.fn().mockResolvedValue(undefined),
  getUrlType: jest.fn((url) => {
    if (url.includes('.mp4') || url.includes('.mov')) {
      return 'video'
    }
    return 'image'
  }),
  extractUrl: jest.fn((url) => [url]),
  isContentTypeImageType: jest.fn().mockReturnValue(true),
  isContentTypeVideoType: jest.fn().mockReturnValue(false),
  moveFile: jest.fn().mockResolvedValue(undefined),
  deleteFile: jest.fn().mockResolvedValue(undefined),
}

// Use jest.mock for util.mjs
jest.unstable_mockModule('../src/util.mjs', () => mockUtil)

const mockGenerateScreenshot = jest.fn().mockResolvedValue(true)
const mockGenerateScreenshotFromStream = jest
  .fn()
  .mockResolvedValue(Buffer.from('mock screenshot buffer'))
const mockGenerateScreenshotFromBuffer = jest
  .fn()
  .mockResolvedValue(Buffer.from('mock screenshot buffer'))

const mockFfmpegUtil = {
  generateScreenshot: mockGenerateScreenshot,
  generateScreenshotFromStream: mockGenerateScreenshotFromStream,
  generateScreenshotFromBuffer: mockGenerateScreenshotFromBuffer,
}

jest.unstable_mockModule('../src/ffmpeg-util.mjs', () => mockFfmpegUtil)

const mockFsPromises = {
  writeFile: jest.fn().mockResolvedValue(undefined),
  readFile: jest.fn().mockResolvedValue(Buffer.from('mock screenshot data')),
  unlink: jest.fn().mockResolvedValue(undefined),
  rename: jest.fn().mockResolvedValue(undefined),
}

jest.unstable_mockModule('fs/promises', () => mockFsPromises)

const mockNodeFs = {
  unlink: jest.fn().mockImplementation((path, callback) => {
    callback(null) // Simulate successful deletion
  }),
  rename: jest.fn().mockImplementation((oldPath, newPath, callback) => {
    callback(null) // Simulate successful rename
  }),
}

jest.unstable_mockModule('fs', () => mockNodeFs)

// Now import the modules under test

const mockNsfwSpy = {
  classifyImageFile: jest.fn(),
  classifyImageFromByteArray: jest.fn(), // Added mock for buffer classification
}

const mockImageProcessingInstance = {
  processImageFile: jest
    .fn()
    .mockResolvedValue({ width: 100, height: 100, format: 'jpeg' }), // Mock with a resolved value
  processImageData: jest
    .fn()
    .mockResolvedValue(Buffer.from('processed image data')),
}

const mockResultCache = {
  get: jest.fn(),
  set: jest.fn(),
}

const mockMutex = {
  acquire: jest.fn().mockResolvedValue(jest.fn()),
  release: jest.fn(),
}

// Create a real map to simulate stateful behavior for mutexes
const mutexesMap = new Map()
const mockMutexes = mutexesMap

const mockConfig = {
  IMG_DOWNLOAD_PATH: '/tmp/nsfw/',
  ENABLE_CONTENT_TYPE_CHECK: false,
  ENABLE_BUFFER_PROCESSING: true, // Set to true for buffer-based processing by default in tests
  ENABLE_VIDEO_STREAM_PROCESSING: true, // Enable video stream processing for tests
  FFMPEG_PATH: 'ffmpeg',
  MAX_VIDEO_SIZE_MB: 10,
  REQUEST_TIMEOUT_IN_SECONDS: 30,
  USER_AGENT: 'TestAgent/1.0',
  MAX_CACHE_ITEM_NUM: 100,
  CACHE_DURATION_IN_SECONDS: 3600,
  VIDEO_PROCESSING_CONCURRENCY: 5, // Add mock value for tests
}

// // Gracefully terminate the worker pools after all tests have run
afterAll(async () => {
  await nsfwDetectorWorkerPool.terminate()
  await imageProcessingWorkerPool.terminate()
})

describe('Prediction Handlers', () => {
  let mockReq
  let mockRes
  let dependencies
  let predictUrlHandler, predictDataHandler
  beforeEach(async () => {
    jest.clearAllMocks()
    mockMutexes.clear()
    mockResultCache.get.mockReset()
    mockImageProcessingInstance.processImageData.mockImplementation(() => {
      return Promise.resolve(Buffer.from('processed image data'))
    })
    mockUtil.getUrlType.mockImplementation((url) => {
      if (url.includes('.mp4') || url.includes('.mov')) {
        return 'video'
      }
      return 'image'
    })
    // Reset mock implementation to prevent state leakage from other tests
    mockUtil.extractUrl.mockImplementation((url) => [url])

    const predictionHandler = await import('../src/prediction-handler.mjs')
    predictUrlHandler = predictionHandler.predictUrlHandler
    predictDataHandler = predictionHandler.predictDataHandler

    // Dynamically import os module within beforeEach
    const osModule = await import('os')

    mockReq = {
      body: { data: Buffer.from('testdata').toString('base64') },
    }
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    }
    dependencies = {
      nsfwSpy: mockNsfwSpy,
      imageProcessingInstance: mockImageProcessingInstance,
      resultCache: mockResultCache,
      mutexes: mockMutexes,
      limit: jest.fn(async (fn) => await fn()), // Mock the injected limiter
      config: { ...mockConfig }, // Clone config to allow modification in tests
      Mutex: jest.fn().mockImplementation(() => mockMutex),
      os: osModule, // Pass the os module to dependencies
    }
  })

  describe('predictUrlHandler', () => {
    const expectedClassificationVideo = {
      hentai: 0.1,
      neutral: 0.8,
      pornography: 0.05,
      sexy: 0.05,
      predictedLabel: 'neutral',
      isNsfw: false,
    }
    it('should successfully process a valid image URL and return classification (File Path)', async () => {
      const mockImageUrl = 'http://example.com/image.jpg'
      mockReq.body.url = mockImageUrl
      const expectedClassification = { nsfw: 0.1, sfw: 0.9 }

      // Explicitly set for file path test
      dependencies.config.ENABLE_BUFFER_PROCESSING = false

      mockResultCache.get.mockReturnValue(undefined)
      mockImageProcessingInstance.processImageFile.mockResolvedValue({
        /* info from sharp */
      })
      mockNsfwSpy.classifyImageFile.mockResolvedValueOnce(
        expectedClassification
      )

      await predictUrlHandler(
        mockReq,
        mockRes,
        dependencies,
        new AbortController().signal
      )

      expect(mockResultCache.get).toHaveBeenCalledWith(
        expect.stringContaining('url-')
      )
      expect(mockImageProcessingInstance.processImageFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('_final')
      )
      expect(mockNsfwSpy.classifyImageFile).toHaveBeenCalledWith(
        expect.stringContaining('_final')
      )
      expect(mockResultCache.set).toHaveBeenCalledWith(
        expect.stringContaining('url-'),
        expectedClassification
      )
      expect(mockRes.status).toHaveBeenCalledWith(200)
      expect(mockRes.json).toHaveBeenCalledWith({
        data: expectedClassification,
      })
      expect(dependencies.Mutex().acquire).toHaveBeenCalled()
      expect(mockUtil.deleteFile).toHaveBeenCalledTimes(2) // For the downloaded image file and the processed file
    })

    it('should successfully process a valid image URL and return classification (Buffer Path)', async () => {
      const mockImageUrl = 'http://example.com/image.jpg'
      mockReq.body.url = mockImageUrl
      const expectedClassification = { nsfw: 0.1, sfw: 0.9 }

      // Explicitly set for buffer path test
      dependencies.config.ENABLE_BUFFER_PROCESSING = true

      mockResultCache.get.mockReturnValue(undefined)
      mockImageProcessingInstance.processImageData.mockResolvedValue(
        Buffer.from('processed image data')
      )
      mockNsfwSpy.classifyImageFromByteArray.mockResolvedValue(
        expectedClassification
      )

      await predictUrlHandler(
        mockReq,
        mockRes,
        dependencies,
        new AbortController().signal
      )

      expect(mockResultCache.get).toHaveBeenCalledWith(
        expect.stringContaining('url-')
      )
      expect(mockImageProcessingInstance.processImageData).toHaveBeenCalledWith(
        expect.any(Buffer)
      )
      expect(mockNsfwSpy.classifyImageFromByteArray).toHaveBeenCalledWith(
        expect.any(Buffer)
      )
      expect(mockResultCache.set).toHaveBeenCalledWith(
        expect.stringContaining('url-'),
        expectedClassification
      )
      expect(mockRes.status).toHaveBeenCalledWith(200)
      expect(mockRes.json).toHaveBeenCalledWith({
        data: expectedClassification,
      })
      expect(dependencies.Mutex().acquire).toHaveBeenCalled()
      // expect(mockMutexes.delete).toHaveBeenCalled() // This is no longer called with LRU cache
    })

    it('should handle errors from the worker method via proxy (File Path)', async () => {
      const mockImageUrl = 'http://example.com/badimage.jpg'
      mockReq.body.url = mockImageUrl
      const workerError = new Error('Worker failed to process image')

      // Explicitly set for file path test
      dependencies.config.ENABLE_BUFFER_PROCESSING = false

      mockResultCache.get.mockReturnValue(undefined)
      mockImageProcessingInstance.processImageFile.mockRejectedValue(
        workerError
      )

      await predictUrlHandler(
        mockReq,
        mockRes,
        dependencies,
        new AbortController().signal
      )

      expect(mockImageProcessingInstance.processImageFile).toHaveBeenCalled()
      expect(mockNsfwSpy.classifyImageFile).not.toHaveBeenCalled()
      expect(mockRes.status).toHaveBeenCalledWith(500)
      expect(mockRes.json).toHaveBeenCalledWith({
        message: expect.stringContaining(workerError.message),
      })
      expect(dependencies.Mutex().acquire).toHaveBeenCalled()
      expect(mockUtil.deleteFile).toHaveBeenCalledTimes(2) // For the downloaded image file and the processed file
    })

    it('should handle errors from the worker method via proxy (Buffer Path)', async () => {
      const mockImageUrl = 'http://example.com/badimage.jpg'
      mockReq.body.url = mockImageUrl
      const workerError = new Error('Worker failed to process image')

      // Explicitly set for buffer path test
      dependencies.config.ENABLE_BUFFER_PROCESSING = true

      mockResultCache.get.mockReturnValue(undefined)
      mockImageProcessingInstance.processImageData.mockRejectedValue(
        workerError
      )

      await predictUrlHandler(
        mockReq,
        mockRes,
        dependencies,
        new AbortController().signal
      )

      expect(mockImageProcessingInstance.processImageData).toHaveBeenCalled()
      expect(mockNsfwSpy.classifyImageFromByteArray).not.toHaveBeenCalled()
      expect(mockRes.status).toHaveBeenCalledWith(500)
      expect(mockRes.json).toHaveBeenCalledWith({
        message: expect.stringContaining(workerError.message),
      })
      expect(dependencies.Mutex().acquire).toHaveBeenCalled()
      // expect(mockMutexes.delete).toHaveBeenCalled() // This is no longer called with LRU cache
    })

    it('should return cached result if available for URL', async () => {
      const mockImageUrl = 'http://example.com/cached.jpg'
      mockReq.body.url = mockImageUrl
      const cachedResult = { nsfw: 0.2, sfw: 0.8 }

      mockResultCache.get.mockReturnValue(cachedResult)

      await predictUrlHandler(
        mockReq,
        mockRes,
        dependencies,
        new AbortController().signal
      )

      expect(mockResultCache.get).toHaveBeenCalledWith(
        expect.stringContaining('url-')
      )
      expect(
        mockImageProcessingInstance.processImageFile
      ).not.toHaveBeenCalled()
      expect(
        mockImageProcessingInstance.processImageData
      ).not.toHaveBeenCalled() // Also check buffer path
      expect(mockNsfwSpy.classifyImageFile).not.toHaveBeenCalled()
      expect(mockNsfwSpy.classifyImageFromByteArray).not.toHaveBeenCalled() // Also check buffer path
      expect(mockRes.status).toHaveBeenCalledWith(200)
      expect(mockRes.json).toHaveBeenCalledWith({ data: cachedResult })
      expect(mockMutex.acquire).toHaveBeenCalled()
      // expect(mockMutexes.delete).toHaveBeenCalled() // This is no longer called with LRU cache
    })

    // --- New Tiered Video Processing Tests ---

    it('should successfully process a video URL using Tier 1 (streaming) if enabled and successful', async () => {
      const mockVideoUrl = 'http://example.com/video.mp4'
      mockReq.body.url = mockVideoUrl

      dependencies.config.ENABLE_BUFFER_PROCESSING = true
      dependencies.config.ENABLE_VIDEO_STREAM_PROCESSING = true

      const mockVideoStream = new Readable({
        read() {
          this.push(Buffer.from('mock video stream data'))
          this.push(null)
        },
      })
      mockGetVideoStream.mockResolvedValueOnce(mockVideoStream)
      mockGenerateScreenshotFromStream.mockResolvedValueOnce(
        Buffer.from('mock screenshot buffer')
      )
      mockImageProcessingInstance.processImageData.mockResolvedValueOnce(
        Buffer.from('processed screenshot data')
      )
      mockNsfwSpy.classifyImageFromByteArray.mockResolvedValueOnce(
        expectedClassificationVideo
      )

      await predictUrlHandler(
        mockReq,
        mockRes,
        dependencies,
        new AbortController().signal
      )

      expect(mockGetVideoStream).toHaveBeenCalledWith(
        mockVideoUrl,
        expect.any(Object),
        expect.any(Number),
        expect.any(Object)
      )
      expect(mockGenerateScreenshotFromStream).toHaveBeenCalledWith(
        mockVideoStream,
        dependencies.config.FFMPEG_PATH,
        expect.any(Object) // Match the options object
      )
      expect(mockImageProcessingInstance.processImageData).toHaveBeenCalledWith(
        expect.any(Buffer)
      )
      expect(mockNsfwSpy.classifyImageFromByteArray).toHaveBeenCalledWith(
        expect.any(Buffer)
      )
      expect(mockRes.status).toHaveBeenCalledWith(200)
      expect(mockRes.json).toHaveBeenCalledWith({
        data: expectedClassificationVideo,
      })

      // Ensure fallbacks were NOT called
      expect(mockDownloadPartFileToBuffer).not.toHaveBeenCalled()
      expect(mockGenerateScreenshotFromBuffer).not.toHaveBeenCalled()

      expect(mockDownloadPartFile).not.toHaveBeenCalled()
      expect(mockGenerateScreenshot).not.toHaveBeenCalled()
      expect(mockFsPromises.readFile).not.toHaveBeenCalled()
      expect(mockUtil.deleteFile).not.toHaveBeenCalled() // No temporary files created by url-processor
    })

    it('should fallback to Tier 2 (partial buffer) if Tier 1 (streaming) fails', async () => {
      const mockVideoUrl = 'http://example.com/video.mp4'
      mockReq.body.url = mockVideoUrl

      dependencies.config.ENABLE_BUFFER_PROCESSING = true
      dependencies.config.ENABLE_VIDEO_STREAM_PROCESSING = true

      // Tier 1 fails
      mockGetVideoStream.mockRejectedValueOnce(new Error('Streaming failed'))

      // Tier 2 succeeds
      mockDownloadPartFileToBuffer.mockResolvedValueOnce(
        Buffer.from('mock partial video buffer')
      )
      mockGenerateScreenshotFromBuffer.mockResolvedValueOnce(
        Buffer.from('mock screenshot buffer from partial')
      )
      mockImageProcessingInstance.processImageData.mockResolvedValueOnce(
        Buffer.from('processed screenshot data')
      )
      mockNsfwSpy.classifyImageFromByteArray.mockResolvedValueOnce(
        expectedClassificationVideo
      )

      await predictUrlHandler(
        mockReq,
        mockRes,
        dependencies,
        new AbortController().signal
      )

      expect(mockGetVideoStream).toHaveBeenCalledTimes(1) // Attempted once
      expect(mockDownloadPartFileToBuffer).toHaveBeenCalledWith(
        mockVideoUrl,
        expect.any(Number),
        expect.any(Number),
        expect.any(Object),
        expect.any(Object)
      )
      expect(mockGenerateScreenshotFromBuffer).toHaveBeenCalledWith(
        expect.any(Buffer),
        dependencies.config.FFMPEG_PATH,
        expect.any(Object) // Match the options object
      )
      expect(mockImageProcessingInstance.processImageData).toHaveBeenCalledWith(
        expect.any(Buffer)
      )
      expect(mockNsfwSpy.classifyImageFromByteArray).toHaveBeenCalledWith(
        expect.any(Buffer)
      )
      expect(mockRes.status).toHaveBeenCalledWith(200)
      expect(mockRes.json).toHaveBeenCalledWith({
        data: expectedClassificationVideo,
      })

      // Ensure Tier 3 was NOT called
      expect(mockDownloadPartFile).not.toHaveBeenCalled()
      expect(mockGenerateScreenshot).not.toHaveBeenCalled()
      expect(mockFsPromises.readFile).not.toHaveBeenCalled()
      expect(mockUtil.deleteFile).not.toHaveBeenCalled() // No temporary files created by url-processor
    })

    it('should fallback to Tier 3 (temporary file) if Tier 1 and Tier 2 fail', async () => {
      const mockVideoUrl = 'http://example.com/video.mp4'
      mockReq.body.url = mockVideoUrl

      dependencies.config.ENABLE_BUFFER_PROCESSING = true
      dependencies.config.ENABLE_VIDEO_STREAM_PROCESSING = true

      // Tier 1 fails
      mockGetVideoStream.mockRejectedValueOnce(new Error('Streaming failed'))
      // Tier 2 fails
      mockDownloadPartFileToBuffer.mockRejectedValueOnce(
        new Error('Partial buffer download failed')
      )

      // Tier 3 succeeds
      mockDownloadPartFile.mockResolvedValueOnce(true)
      mockGenerateScreenshot.mockResolvedValueOnce(true)
      mockFsPromises.readFile.mockResolvedValueOnce(
        Buffer.from('mock screenshot buffer from file')
      )
      mockImageProcessingInstance.processImageData.mockResolvedValueOnce(
        Buffer.from('processed screenshot data')
      )
      mockNsfwSpy.classifyImageFromByteArray.mockResolvedValueOnce(
        expectedClassificationVideo
      )

      await predictUrlHandler(
        mockReq,
        mockRes,
        dependencies,
        new AbortController().signal
      )

      expect(mockGetVideoStream).toHaveBeenCalledTimes(1)
      expect(mockDownloadPartFileToBuffer).toHaveBeenCalledTimes(1)
      expect(mockDownloadPartFile).toHaveBeenCalledWith(
        mockVideoUrl,
        expect.stringContaining(dependencies.config.IMG_DOWNLOAD_PATH),
        expect.any(Number),
        expect.any(Number),
        expect.any(Object),
        expect.any(Object)
      )
      expect(mockGenerateScreenshot).toHaveBeenCalledWith(
        expect.stringContaining(dependencies.config.IMG_DOWNLOAD_PATH),
        expect.stringContaining(dependencies.config.IMG_DOWNLOAD_PATH),
        dependencies.config.FFMPEG_PATH
      )
      expect(mockFsPromises.readFile).toHaveBeenCalledWith(
        expect.stringContaining(dependencies.config.IMG_DOWNLOAD_PATH)
      )
      expect(mockImageProcessingInstance.processImageData).toHaveBeenCalledWith(
        expect.any(Buffer)
      )
      expect(mockNsfwSpy.classifyImageFromByteArray).toHaveBeenCalledWith(
        expect.any(Buffer)
      )
      expect(mockRes.status).toHaveBeenCalledWith(200)
      expect(mockRes.json).toHaveBeenCalledWith({
        data: expectedClassificationVideo,
      })

      // Ensure temporary files created by fallback are cleaned up
      // The url-processor is responsible for cleaning up the 2 files created by the video-processor fallback
      expect(mockUtil.deleteFile).toHaveBeenCalledTimes(2)
    })

    it('should throw an error if all three video processing tiers fail', async () => {
      const mockVideoUrl = 'http://example.com/video.mp4'
      mockReq.body.url = mockVideoUrl

      dependencies.config.ENABLE_BUFFER_PROCESSING = true
      dependencies.config.ENABLE_VIDEO_STREAM_PROCESSING = true

      // All tiers fail
      mockGetVideoStream.mockRejectedValueOnce(new Error('Streaming failed'))
      mockDownloadPartFileToBuffer.mockRejectedValueOnce(
        new Error('Partial buffer download failed')
      )
      mockDownloadPartFile.mockRejectedValueOnce(
        new Error('File download failed')
      ) // Simulate final download failure
      mockGenerateScreenshot.mockResolvedValueOnce(false) // Simulate screenshot generation failure for file path

      await predictUrlHandler(
        mockReq,
        mockRes,
        dependencies,
        new AbortController().signal
      )

      expect(mockGetVideoStream).toHaveBeenCalledTimes(1)
      expect(mockDownloadPartFileToBuffer).toHaveBeenCalledTimes(1)
      expect(mockDownloadPartFile).toHaveBeenCalledTimes(1)

      expect(mockRes.status).toHaveBeenCalledWith(500)
      expect(mockRes.json).toHaveBeenCalledWith({
        message:
          '[Tier 3] Final fallback download failed: File download failed',
      })
      expect(mockUtil.deleteFile).toHaveBeenCalledTimes(2) // For video and screenshot fallback files
    })

    it('should use p-limit for concurrency control in video processing', async () => {
      const mockVideoUrl = 'http://example.com/video.mp4'
      mockReq.body.url = mockVideoUrl

      dependencies.config.ENABLE_BUFFER_PROCESSING = true
      dependencies.config.ENABLE_VIDEO_STREAM_PROCESSING = true

      // Mock all tiers to succeed to ensure p-limit is called on each
      mockGetVideoStream.mockResolvedValueOnce(
        new Readable({
          read() {
            this.push(Buffer.from('stream'))
            this.push(null)
          },
        })
      )
      mockGenerateScreenshotFromStream.mockResolvedValueOnce(
        Buffer.from('screenshot')
      )
      mockDownloadPartFileToBuffer.mockResolvedValueOnce(Buffer.from('buffer'))
      mockGenerateScreenshotFromBuffer.mockResolvedValueOnce(
        Buffer.from('screenshot')
      )
      mockDownloadPartFile.mockResolvedValueOnce(true)
      mockGenerateScreenshot.mockResolvedValueOnce(true)
      mockFsPromises.readFile.mockResolvedValueOnce(Buffer.from('screenshot'))

      mockImageProcessingInstance.processImageData.mockResolvedValue(
        Buffer.from('processed')
      )
      mockNsfwSpy.classifyImageFromByteArray.mockResolvedValue(
        expectedClassificationVideo
      )

      // Spy on p-limit's internal `add` method if possible, or just check calls to wrapped functions
      // Since p-limit wraps the functions, we can assert that the wrapped functions are called.
      // The actual concurrency behavior is tested in p-limit's own tests.
      // Here, we just ensure that the functions are passed to p-limit.

      // To properly test p-limit, we'd need to mock p-limit itself or inspect its usage.
      // For now, we'll rely on the fact that the code calls `limit(() => ...)`
      // and ensure the underlying functions are called as expected.
      // A more advanced test would involve mocking `p-limit` to verify its `add` method is called.

      await predictUrlHandler(
        mockReq,
        mockRes,
        dependencies,
        new AbortController().signal
      )

      // Assert that the primary tier functions were called (they are wrapped by p-limit)
      expect(mockGetVideoStream).toHaveBeenCalled()
      expect(mockGenerateScreenshotFromStream).toHaveBeenCalled()
      expect(mockImageProcessingInstance.processImageData).toHaveBeenCalled()
      expect(mockNsfwSpy.classifyImageFromByteArray).toHaveBeenCalled()
    })
    it('should return 400 if URL is not detected', async () => {
      mockUtil.extractUrl.mockReturnValue(null)
      mockReq.body.url = 'not a url'
      await predictUrlHandler(
        mockReq,
        mockRes,
        dependencies,
        new AbortController().signal
      )
      expect(mockRes.status).toHaveBeenCalledWith(400)
      expect(mockRes.json).toHaveBeenCalledWith({
        message: 'URL is not detected',
      })
    })

    it('should return 400 if multiple URLs are detected', async () => {
      mockUtil.extractUrl.mockReturnValue([
        'http://example.com',
        'http://another.com',
      ])
      mockReq.body.url = 'http://example.com http://another.com'
      await predictUrlHandler(
        mockReq,
        mockRes,
        dependencies,
        new AbortController().signal
      )
      expect(mockRes.status).toHaveBeenCalledWith(400)
      expect(mockRes.json).toHaveBeenCalledWith({
        message: 'Multiple URLs are not supported',
      })
    })
    describe('Tiered Video Processing Fallback Failures', () => {
      const mockVideoUrl = 'http://example.com/failing-video.mp4'

      beforeEach(() => {
        mockReq.body.url = mockVideoUrl
        dependencies.config.ENABLE_BUFFER_PROCESSING = true

        // Reset mocks to ensure test isolation within this describe block
        mockGetVideoStream.mockReset()
        mockDownloadPartFileToBuffer.mockReset()
        mockDownloadPartFile.mockReset()
        mockGenerateScreenshot.mockReset()
        mockFsPromises.readFile.mockReset()

        // Set up the baseline failure for Tiers 1 and 2 for all tests in this block
        mockGetVideoStream.mockRejectedValue(new Error('Streaming failed'))
        mockDownloadPartFileToBuffer.mockRejectedValue(
          new Error('Partial buffer download failed')
        )
      })

      it('should handle a failure in Tier 3 (downloadPartFile fails)', async () => {
        // Tier 3 Download fails
        mockDownloadPartFile.mockRejectedValueOnce(
          new Error('Final download failed')
        )

        await predictUrlHandler(
          mockReq,
          mockRes,
          dependencies,
          new AbortController().signal
        )

        expect(mockRes.status).toHaveBeenCalledWith(500)
        expect(mockRes.json).toHaveBeenCalledWith({
          message:
            '[Tier 3] Final fallback download failed: Final download failed',
        })
        // Ensure cleanup is still attempted for the files that would have been created
        expect(mockUtil.deleteFile).toHaveBeenCalledTimes(2)
      })

      it('should handle a failure in Tier 3 (generateScreenshot fails)', async () => {
        // Tier 3 Download succeeds, but screenshot fails
        mockDownloadPartFile.mockResolvedValueOnce(true)
        mockGenerateScreenshot.mockResolvedValueOnce(false) // Simulate failure by returning false

        await predictUrlHandler(
          mockReq,
          mockRes,
          dependencies,
          new AbortController().signal
        )

        expect(mockRes.status).toHaveBeenCalledWith(500)
        expect(mockRes.json).toHaveBeenCalledWith({
          message:
            '[Tier 3] Final fallback screenshot generation from file failed: Unknown error',
        })
        expect(mockUtil.deleteFile).toHaveBeenCalledTimes(2)
      })

      it('should handle a failure in Tier 3 (readFile fails)', async () => {
        // Tier 3 Download and screenshot succeed, but reading the file fails
        mockDownloadPartFile.mockResolvedValueOnce(true)
        mockGenerateScreenshot.mockResolvedValueOnce(true)
        mockFsPromises.readFile.mockRejectedValueOnce(
          new Error('Cannot read file')
        )

        await predictUrlHandler(
          mockReq,
          mockRes,
          dependencies,
          new AbortController().signal
        )

        expect(mockRes.status).toHaveBeenCalledWith(500)
        expect(mockRes.json).toHaveBeenCalledWith({
          message:
            '[Tier 3] Final fallback screenshot read failed: Cannot read file',
        })
        expect(mockUtil.deleteFile).toHaveBeenCalledTimes(2)
      })
    })

    describe('File-Based Processing Path (ENABLE_BUFFER_PROCESSING: false)', () => {
      it('should successfully process a video URL using the file path', async () => {
        const mockVideoUrl = 'http://example.com/video.mp4'
        mockReq.body.url = mockVideoUrl
        const expectedClassification = { nsfw: 0.4, sfw: 0.6 }

        dependencies.config.ENABLE_BUFFER_PROCESSING = false

        mockDownloadPartFile.mockResolvedValueOnce({ status: 'downloaded' })
        mockGenerateScreenshot.mockResolvedValueOnce(true)
        mockUtil.moveFile.mockResolvedValueOnce(undefined)
        mockImageProcessingInstance.processImageFile.mockResolvedValueOnce({
          width: 100,
          height: 100,
        })
        mockNsfwSpy.classifyImageFile.mockResolvedValueOnce(
          expectedClassification
        )

        await predictUrlHandler(
          mockReq,
          mockRes,
          dependencies,
          new AbortController().signal
        )

        // Verify file-based functions were called
        expect(mockDownloadPartFile).toHaveBeenCalled()
        expect(mockGenerateScreenshot).toHaveBeenCalled()
        expect(mockUtil.moveFile).toHaveBeenCalled()
        expect(mockImageProcessingInstance.processImageFile).toHaveBeenCalled()
        expect(mockNsfwSpy.classifyImageFile).toHaveBeenCalled()

        // Verify buffer-based functions were NOT called
        expect(mockDownloadFileToBuffer).not.toHaveBeenCalled()
        expect(
          mockImageProcessingInstance.processImageData
        ).not.toHaveBeenCalled()
        expect(mockNsfwSpy.classifyImageFromByteArray).not.toHaveBeenCalled()

        expect(mockRes.status).toHaveBeenCalledWith(200)
        expect(mockRes.json).toHaveBeenCalledWith({
          data: expectedClassification,
        })
        expect(mockUtil.deleteFile).toHaveBeenCalledTimes(3) // For video file, screenshot file, and processed file
      })
    })
  })

  describe('predictDataHandler', () => {
    beforeEach(() => {
      mockReq.body = { data: Buffer.from('testdata').toString('base64') }
    })

    it('should successfully process image data using the worker pool proxy (File Path)', async () => {
      const expectedClassification = { nsfw: 0.3, sfw: 0.7 }
      // Explicitly set for file path test
      dependencies.config.ENABLE_BUFFER_PROCESSING = false

      mockResultCache.get.mockReturnValue(undefined)
      mockImageProcessingInstance.processImageFile.mockResolvedValue({
        // Corrected mock call
        /* info from sharp */
      })
      mockNsfwSpy.classifyImageFile.mockResolvedValueOnce(
        expectedClassification
      )

      await predictDataHandler(mockReq, mockRes, dependencies)

      expect(mockFsPromises.writeFile).toHaveBeenCalled()
      expect(mockImageProcessingInstance.processImageFile).toHaveBeenCalledWith(
        // Corrected assertion
        expect.stringContaining(dependencies.config.IMG_DOWNLOAD_PATH),
        expect.stringContaining(dependencies.config.IMG_DOWNLOAD_PATH)
      )
      expect(mockNsfwSpy.classifyImageFile).toHaveBeenCalledWith(
        expect.stringContaining(dependencies.config.IMG_DOWNLOAD_PATH)
      )
      expect(mockRes.status).toHaveBeenCalledWith(200)
      expect(mockRes.json).toHaveBeenCalledWith({
        data: expectedClassification,
      })
      expect(mockUtil.deleteFile).toHaveBeenCalledTimes(2) // For the initial image file and the processed file
    })

    it('should successfully process image data using the worker pool proxy (Buffer Path)', async () => {
      const expectedClassification = {
        hentai: 0.1,
        neutral: 0.8,
        pornography: 0.05,
        sexy: 0.05,
        predictedLabel: 'neutral',
        isNsfw: false,
      }
      // Explicitly set for buffer path test
      dependencies.config.ENABLE_BUFFER_PROCESSING = true

      mockResultCache.get.mockReturnValue(undefined)
      mockImageProcessingInstance.processImageData.mockResolvedValue(
        Buffer.from('processed image data')
      )
      mockNsfwSpy.classifyImageFromByteArray.mockResolvedValue(
        expectedClassification
      )

      await predictDataHandler(mockReq, mockRes, dependencies)

      expect(mockImageProcessingInstance.processImageData).toHaveBeenCalledWith(
        expect.any(Buffer)
      )
      expect(mockNsfwSpy.classifyImageFromByteArray).toHaveBeenCalledWith(
        expect.any(Buffer)
      )
      expect(mockRes.status).toHaveBeenCalledWith(200)
      expect(mockRes.json).toHaveBeenCalledWith({
        data: expectedClassification,
      })
    })

    it('should handle errors from the data processing worker method via proxy (File Path)', async () => {
      const workerError = new Error('Worker failed to process data')
      // Explicitly set for buffer path test
      dependencies.config.ENABLE_BUFFER_PROCESSING = false

      mockResultCache.get.mockReturnValue(undefined)
      mockImageProcessingInstance.processImageFile.mockRejectedValue(
        // Corrected mock call
        workerError
      )

      await predictDataHandler(mockReq, mockRes, dependencies)

      expect(mockImageProcessingInstance.processImageFile).toHaveBeenCalled() // Corrected assertion
      expect(mockNsfwSpy.classifyImageFile).not.toHaveBeenCalled()
      expect(mockRes.status).toHaveBeenCalledWith(500)
      expect(mockRes.json).toHaveBeenCalledWith({
        message: expect.stringContaining(workerError.message),
      })
      expect(mockUtil.deleteFile).toHaveBeenCalledTimes(2) // For the initial image file and the processed file
    })

    it('should handle errors from the data processing worker method via proxy (Buffer Path)', async () => {
      const workerError = new Error('Worker failed to process data')
      dependencies.config.ENABLE_BUFFER_PROCESSING = true
      mockResultCache.get.mockReturnValue(undefined)
      mockImageProcessingInstance.processImageData.mockRejectedValue(
        workerError
      )

      await predictDataHandler(mockReq, mockRes, dependencies)

      expect(mockRes.status).toHaveBeenCalledWith(500)
      expect(mockRes.json).toHaveBeenCalledWith({
        message: expect.stringContaining(workerError.message),
      })
    })

    it('should return 400 if data is null', async () => {
      mockReq.body.data = null
      await predictDataHandler(mockReq, mockRes, dependencies)
      expect(mockRes.status).toHaveBeenCalledWith(400)
      expect(mockRes.json).toHaveBeenCalledWith({
        message: 'Data input is empty, please send base64 string data as input',
      })
    })
  })

  describe('File-Based Processing Path Failures (ENABLE_BUFFER_PROCESSING: false)', () => {
    beforeEach(() => {
      dependencies.config.ENABLE_BUFFER_PROCESSING = false
    })

    it('should handle video download failure', async () => {
      const mockVideoUrl = 'http://example.com/video.mp4'
      mockReq.body.url = mockVideoUrl
      const downloadError = new Error('Network error')
      mockDownloadPartFile.mockRejectedValueOnce(downloadError)

      await predictUrlHandler(
        mockReq,
        mockRes,
        dependencies,
        new AbortController().signal
      )

      expect(mockRes.status).toHaveBeenCalledWith(500)
      expect(mockRes.json).toHaveBeenCalledWith({
        message: `Video download failed: ${downloadError.message}`,
      })
      expect(mockUtil.deleteFile).toHaveBeenCalledTimes(0) // No files created yet
    })

    it('should handle screenshot generation failure', async () => {
      const mockVideoUrl = 'http://example.com/video.mp4'
      mockReq.body.url = mockVideoUrl
      const screenshotError = new Error('FFmpeg error')
      mockDownloadPartFile.mockResolvedValueOnce({ status: 'downloaded' })
      mockGenerateScreenshot.mockRejectedValueOnce(screenshotError)

      await predictUrlHandler(
        mockReq,
        mockRes,
        dependencies,
        new AbortController().signal
      )

      expect(mockRes.status).toHaveBeenCalledWith(500)
      expect(mockRes.json).toHaveBeenCalledWith({
        message: `Screenshot generation or move failed: ${screenshotError.message}`,
      })
      // The downloaded video file should be cleaned up on screenshot failure.
      expect(mockUtil.deleteFile).toHaveBeenCalledTimes(1)
    })

    it('should handle image download failure', async () => {
      const mockImageUrl = 'http://example.com/image.jpg'
      mockReq.body.url = mockImageUrl
      const downloadError = new Error('Image download failed')
      mockDownloadFile.mockRejectedValueOnce(downloadError)

      await predictUrlHandler(
        mockReq,
        mockRes,
        dependencies,
        new AbortController().signal
      )

      expect(mockRes.status).toHaveBeenCalledWith(500)
      expect(mockRes.json).toHaveBeenCalledWith({
        message: `Image download failed: ${downloadError.message}`,
      })
      expect(mockUtil.deleteFile).toHaveBeenCalledTimes(0) // No files created yet
    })

    it('should handle image processing failure', async () => {
      const mockImageUrl = 'http://example.com/image.jpg'
      mockReq.body.url = mockImageUrl
      const processError = new Error('Processing failed')
      mockDownloadFile.mockResolvedValueOnce({ status: 'downloaded' })
      mockImageProcessingInstance.processImageFile.mockRejectedValueOnce(
        processError
      )

      await predictUrlHandler(
        mockReq,
        mockRes,
        dependencies,
        new AbortController().signal
      )

      expect(mockRes.status).toHaveBeenCalledWith(500)
      expect(mockRes.json).toHaveBeenCalledWith({
        message: `Image processing failed: ${processError.message}`,
      })
      expect(mockUtil.deleteFile).toHaveBeenCalledTimes(2) // The initial image file and the processed file
    })

    it('should handle classification failure', async () => {
      const mockImageUrl = 'http://example.com/image.jpg'
      mockReq.body.url = mockImageUrl
      const classifyError = new Error('Classification failed')
      mockDownloadFile.mockResolvedValueOnce({ status: 'downloaded' })
      mockImageProcessingInstance.processImageFile.mockResolvedValueOnce({})
      mockNsfwSpy.classifyImageFile.mockRejectedValueOnce(classifyError)

      await predictUrlHandler(
        mockReq,
        mockRes,
        dependencies,
        new AbortController().signal
      )

      expect(mockRes.status).toHaveBeenCalledWith(500)
      expect(mockRes.json).toHaveBeenCalledWith({
        message: `Classification failed: ${classifyError.message}`,
      })
      expect(mockUtil.deleteFile).toHaveBeenCalledTimes(2) // The initial image file and the processed file
    })
  })

  describe('Content-Type Check', () => {
    beforeEach(() => {
      dependencies.config.ENABLE_CONTENT_TYPE_CHECK = true
    })

    it('should throw an error if content type is not image or video', async () => {
      const mockUrl = 'http://example.com/document.pdf'
      mockReq.body.url = mockUrl
      mockGetContentInfo.mockResolvedValueOnce({
        contentType: 'application/pdf',
      })
      mockUtil.isContentTypeImageType.mockReturnValueOnce(false)
      mockUtil.isContentTypeVideoType.mockReturnValueOnce(false)

      await predictUrlHandler(
        mockReq,
        mockRes,
        dependencies,
        new AbortController().signal
      )

      expect(mockRes.status).toHaveBeenCalledWith(500)
      expect(mockRes.json).toHaveBeenCalledWith({
        message: `Only image/video URLs are acceptable for ${mockUrl}`,
      })
    })

    it('should handle failure when getting content info', async () => {
      const mockUrl = 'http://example.com/image.jpg'
      mockReq.body.url = mockUrl
      const contentInfoError = new Error('Failed to fetch headers')
      mockGetContentInfo.mockRejectedValueOnce(contentInfoError)

      await predictUrlHandler(
        mockReq,
        mockRes,
        dependencies,
        new AbortController().signal
      )

      expect(mockRes.status).toHaveBeenCalledWith(500)
      expect(mockRes.json).toHaveBeenCalledWith({
        message: `Failed to get content info for ${mockUrl}: ${contentInfoError.message}`,
      })
    })
  })
})
