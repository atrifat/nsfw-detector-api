import { jest } from '@jest/globals'

// Set up mocks before importing modules
jest.unstable_mockModule('../src/download.mjs', () => ({
  downloadFile: jest
    .fn()
    .mockResolvedValue({ status: 'downloaded', path: '/tmp/nsfw/test_image' }),
  getContentInfo: jest.fn().mockResolvedValue({ contentType: 'image/jpeg' }),
  downloadPartFile: jest
    .fn()
    .mockResolvedValue({ status: 'downloaded', path: '/tmp/nsfw/test_video' }),
  downloadFileToBuffer: jest
    .fn()
    .mockResolvedValue(Buffer.from('mock image data')), // Added mock
  downloadPartFileToBuffer: jest
    .fn()
    .mockResolvedValue(Buffer.from('mock video data')), // Added mock
}))

jest.unstable_mockModule('../src/util.mjs', () => {
  return {
    cleanupTemporaryFile: jest.fn().mockResolvedValue(undefined),
    getUrlType: jest.fn().mockReturnValue('image'),
    extractUrl: jest.fn().mockReturnValue(['http://example.com/test.jpg']),
    isContentTypeImageType: jest.fn().mockReturnValue(true),
    isContentTypeVideoType: jest.fn().mockReturnValue(false),
    moveFile: jest.fn().mockResolvedValue(undefined),
    deleteFile: jest.fn().mockResolvedValue(undefined), // Added deleteFile mock
  }
})

jest.unstable_mockModule('../src/ffmpeg-util.mjs', () => ({
  generateScreenshot: jest.fn().mockResolvedValue(undefined),
}))

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

// p-memoize exports a function directly
jest.unstable_mockModule('p-memoize', () => {
  const pMemoize = (fn) => fn
  pMemoize.clear = jest.fn()
  return { default: pMemoize }
})

// Now import the modules under test
const { predictUrlHandler, predictDataHandler } = await import(
  '../src/prediction-handler.mjs'
)

const mockNsfwSpy = {
  classifyImageFile: jest.fn(),
  classifyImageFromByteArray: jest.fn(), // Added mock for buffer classification
}

const mockImageProcessingInstance = {
  processImageFile: jest.fn(),
  processImageData: jest.fn(),
}

const mockResultCache = {
  get: jest.fn(),
  set: jest.fn(),
}

const mockMutex = {
  acquire: jest.fn().mockResolvedValue(jest.fn()),
  delete: jest.fn(),
}

const mockMutexes = {
  get: jest.fn().mockReturnValue(mockMutex),
  set: jest.fn(),
  delete: jest.fn(),
}

const mockConfig = {
  IMG_DOWNLOAD_PATH: '/tmp/nsfw/',
  ENABLE_CONTENT_TYPE_CHECK: false,
  ENABLE_BUFFER_PROCESSING: false, // Added feature flag to mock config
  FFMPEG_PATH: 'ffmpeg',
  MAX_VIDEO_SIZE_MB: 10,
  REQUEST_TIMEOUT_IN_SECONDS: 30,
  USER_AGENT: 'TestAgent/1.0',
  MAX_CACHE_ITEM_NUM: 100,
  CACHE_DURATION_IN_SECONDS: 3600,
}

describe('Prediction Handlers', () => {
  let mockReq
  let mockRes
  let dependencies

  beforeEach(async () => {
    jest.clearAllMocks()

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
      config: { ...mockConfig }, // Clone config to allow modification in tests
      Mutex: jest.fn().mockImplementation(() => mockMutex),
    }
  })

  describe('predictUrlHandler', () => {
    it('should successfully process a URL using the worker pool proxy and return a classification (File Path)', async () => {
      const mockImageUrl = 'http://example.com/image.jpg'
      mockReq.body.url = mockImageUrl
      const expectedClassification = { nsfw: 0.1, sfw: 0.9 }

      dependencies.config.ENABLE_BUFFER_PROCESSING = false // Explicitly set for file path test

      mockResultCache.get.mockReturnValue(undefined)
      mockImageProcessingInstance.processImageFile.mockResolvedValue({
        /* info from sharp */
      })
      mockNsfwSpy.classifyImageFile.mockResolvedValue(expectedClassification)

      await predictUrlHandler(mockReq, mockRes, dependencies)

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
      expect(mockMutexes.delete).toHaveBeenCalled()
    })

    it('should successfully process a URL using the worker pool proxy and return a classification (Buffer Path)', async () => {
      const mockImageUrl = 'http://example.com/image.jpg'
      mockReq.body.url = mockImageUrl
      const expectedClassification = { nsfw: 0.1, sfw: 0.9 }

      dependencies.config.ENABLE_BUFFER_PROCESSING = true // Explicitly set for buffer path test

      mockResultCache.get.mockReturnValue(undefined)
      mockImageProcessingInstance.processImageData.mockResolvedValue(
        Buffer.from('processed image data')
      )
      mockNsfwSpy.classifyImageFromByteArray.mockResolvedValue(
        expectedClassification
      )

      await predictUrlHandler(mockReq, mockRes, dependencies)

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
      expect(mockMutexes.delete).toHaveBeenCalled()
    })

    it('should handle errors from the worker method via proxy (File Path)', async () => {
      const mockImageUrl = 'http://example.com/badimage.jpg'
      mockReq.body.url = mockImageUrl
      const workerError = new Error('Worker failed to process image')

      dependencies.config.ENABLE_BUFFER_PROCESSING = false // Explicitly set for file path test

      mockResultCache.get.mockReturnValue(undefined)
      mockImageProcessingInstance.processImageFile.mockRejectedValue(
        workerError
      )

      await predictUrlHandler(mockReq, mockRes, dependencies)

      expect(mockImageProcessingInstance.processImageFile).toHaveBeenCalled()
      expect(mockNsfwSpy.classifyImageFile).not.toHaveBeenCalled()
      expect(mockRes.status).toHaveBeenCalledWith(500)
      expect(mockRes.json).toHaveBeenCalledWith({
        message: expect.stringContaining(workerError.message),
      })
      expect(dependencies.Mutex().acquire).toHaveBeenCalled()
      expect(mockMutexes.delete).toHaveBeenCalled()
    })

    it('should handle errors from the worker method via proxy (Buffer Path)', async () => {
      const mockImageUrl = 'http://example.com/badimage.jpg'
      mockReq.body.url = mockImageUrl
      const workerError = new Error('Worker failed to process image')

      dependencies.config.ENABLE_BUFFER_PROCESSING = true // Explicitly set for buffer path test

      mockResultCache.get.mockReturnValue(undefined)
      mockImageProcessingInstance.processImageData.mockRejectedValue(
        workerError
      )

      await predictUrlHandler(mockReq, mockRes, dependencies)

      expect(mockImageProcessingInstance.processImageData).toHaveBeenCalled()
      expect(mockNsfwSpy.classifyImageFromByteArray).not.toHaveBeenCalled()
      expect(mockRes.status).toHaveBeenCalledWith(500)
      expect(mockRes.json).toHaveBeenCalledWith({
        message: expect.stringContaining(workerError.message),
      })
      expect(dependencies.Mutex().acquire).toHaveBeenCalled()
      expect(mockMutexes.delete).toHaveBeenCalled()
    })

    it('should return cached result if available for URL', async () => {
      const mockImageUrl = 'http://example.com/cached.jpg'
      mockReq.body.url = mockImageUrl
      const cachedResult = { nsfw: 0.2, sfw: 0.8 }

      mockResultCache.get.mockReturnValue(cachedResult)

      await predictUrlHandler(mockReq, mockRes, dependencies)

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
      expect(dependencies.Mutex().acquire).toHaveBeenCalled()
      expect(mockMutexes.delete).toHaveBeenCalled()
    })
  })

  describe('predictDataHandler', () => {
    beforeEach(() => {
      mockReq.body = { data: Buffer.from('testdata').toString('base64') }
    })

    it('should successfully process image data using the worker pool proxy (File Path)', async () => {
      const expectedClassification = { nsfw: 0.3, sfw: 0.7 }
      dependencies.config.ENABLE_BUFFER_PROCESSING = false // Explicitly set for file path test

      mockResultCache.get.mockReturnValue(undefined)
      mockImageProcessingInstance.processImageFile.mockResolvedValue({
        // Corrected mock call
        /* info from sharp */
      })
      mockNsfwSpy.classifyImageFile.mockResolvedValue(expectedClassification)

      await predictDataHandler(mockReq, mockRes, dependencies)

      expect(mockFsPromises.writeFile).toHaveBeenCalled()
      expect(mockImageProcessingInstance.processImageFile).toHaveBeenCalledWith(
        // Corrected assertion
        mockConfig.IMG_DOWNLOAD_PATH +
          '20a6a116aa9ba5d005639a444f268732b37ae1b9946ef2d9c66c82e97e190a94_image',
        mockConfig.IMG_DOWNLOAD_PATH +
          '20a6a116aa9ba5d005639a444f268732b37ae1b9946ef2d9c66c82e97e190a94_final'
      )
      expect(mockNsfwSpy.classifyImageFile).toHaveBeenCalledWith(
        mockConfig.IMG_DOWNLOAD_PATH +
          '20a6a116aa9ba5d005639a444f268732b37ae1b9946ef2d9c66c82e97e190a94_final'
      )
      expect(mockRes.status).toHaveBeenCalledWith(200)
      expect(mockRes.json).toHaveBeenCalledWith({
        data: expectedClassification,
      })
    })

    it('should successfully process image data using the worker pool proxy (Buffer Path)', async () => {
      const expectedClassification = { nsfw: 0.3, sfw: 0.7 }
      dependencies.config.ENABLE_BUFFER_PROCESSING = true // Explicitly set for buffer path test

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
      dependencies.config.ENABLE_BUFFER_PROCESSING = false // Explicitly set for file path test

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
    })

    it('should handle errors from the data processing worker method via proxy (Buffer Path)', async () => {
      const workerError = new Error('Worker failed to process data')
      dependencies.config.ENABLE_BUFFER_PROCESSING = true // Explicitly set for buffer path test

      mockResultCache.get.mockReturnValue(undefined)
      mockImageProcessingInstance.processImageData.mockRejectedValue(
        workerError
      )

      await predictDataHandler(mockReq, mockRes, dependencies)

      expect(mockImageProcessingInstance.processImageData).toHaveBeenCalled()
      expect(mockNsfwSpy.classifyImageFromByteArray).not.toHaveBeenCalled()
      expect(mockRes.status).toHaveBeenCalledWith(500)
      expect(mockRes.json).toHaveBeenCalledWith({
        message: expect.stringContaining(workerError.message),
      })
    })
  })
})
