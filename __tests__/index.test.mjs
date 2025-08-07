import { jest } from '@jest/globals'

// Mock external dependencies first
jest.unstable_mockModule('express', () => {
  const mockApp = {
    use: jest.fn(),
    post: jest.fn(),
    get: jest.fn(),
    listen: jest.fn((port, callback) => callback()), // Immediately call callback for listen
  }
  return { default: jest.fn(() => mockApp) }
})

jest.unstable_mockModule('body-parser', () => ({
  __esModule: true,
  default: {
    json: jest.fn(() => jest.fn()),
  },
}))

jest.unstable_mockModule('express-bearer-token', () => ({
  __esModule: true,
  default: jest.fn(() => jest.fn()),
}))

const mockPredictUrlHandler = jest.fn()
const mockPredictDataHandler = jest.fn()
jest.unstable_mockModule('../src/prediction-handler.mjs', () => ({
  predictUrlHandler: mockPredictUrlHandler,
  predictDataHandler: mockPredictDataHandler,
}))

const mockConfig = {
  PORT: 8081,
  ENABLE_API_TOKEN: false,
  API_TOKEN: 'test-token',
  ENABLE_BUFFER_PROCESSING: true,
  ENABLE_VIDEO_STREAM_PROCESSING: true,
  FFMPEG_PATH: 'ffmpeg',
  MAX_VIDEO_SIZE_MB: 10,
  REQUEST_TIMEOUT_IN_SECONDS: 30,
  USER_AGENT: 'TestAgent/1.0',
  MAX_CACHE_ITEM_NUM: 100,
  CACHE_DURATION_IN_SECONDS: 3600,
  VIDEO_PROCESSING_CONCURRENCY: 5,
}
jest.unstable_mockModule('../src/config.mjs', () => ({ config: mockConfig }))

jest.unstable_mockModule('../src/resources.mjs', () => ({
  nsfwDetectorWorkerPool: { terminate: jest.fn() },
  imageProcessingWorkerPool: { terminate: jest.fn() },
  nsfwSpy: {
    load: jest.fn(),
    classifyImageFile: jest.fn(),
    classifyImageFromByteArray: jest.fn(),
  },
  imageProcessingInstance: {
    processImageFile: jest.fn(),
    processImageData: jest.fn(),
  },
  resultCache: { get: jest.fn(), set: jest.fn() },
  mutexes: new Map(),
}))

jest.unstable_mockModule('async-mutex', () => ({
  Mutex: jest.fn(() => ({
    acquire: jest.fn().mockResolvedValue(jest.fn()),
    release: jest.fn(),
  })),
}))

jest.unstable_mockModule('p-limit', () => ({
  __esModule: true,
  default: jest.fn(() => jest.fn((fn) => fn())),
}))

jest.unstable_mockModule('../src/util.mjs', () => ({
  cleanupTemporaryFile: jest.fn(),
  getUrlType: jest.fn(),
  extractUrl: jest.fn(),
  isContentTypeImageType: jest.fn(),
  isContentTypeVideoType: jest.fn(),
  moveFile: jest.fn(),
  deleteFile: jest.fn(),
}))

// Mock AbortController globally for this test file
let mockAbortControllerInstance
const AbortControllerSpy = jest
  .spyOn(global, 'AbortController')
  .mockImplementation(() => {
    mockAbortControllerInstance = {
      signal: { aborted: false }, // Mock signal object
      abort: jest.fn(() => {
        mockAbortControllerInstance.signal.aborted = true
      }),
    }
    return mockAbortControllerInstance
  })

describe('index.mjs', () => {
  let app
  let consoleSpy

  beforeEach(async () => {
    jest.clearAllMocks()
    jest.resetModules() // Reset modules to ensure fresh imports
    // Dynamically import the module under test after mocks are set up
    const { app: importedApp } = await import('../src/index.mjs')
    app = importedApp

    consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleSpy.mockRestore()
    AbortControllerSpy.mockRestore()
  })

  it('should set up /predict route with abort controller and handle client disconnect', async () => {
    const mockReq = {
      body: { url: 'http://example.com/image.jpg' },
      on: jest.fn(), // Mock req.on
    }
    const mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      writableEnded: false, // Simulate response not yet ended
    }

    // Find the handler registered for the /predict POST route
    const predictRouteHandler = app.post.mock.calls.find(
      (call) => call[0] === '/predict'
    )?.[2] // The handler is the third argument after path and validation middleware

    expect(predictRouteHandler).toBeDefined()

    // Execute the handler
    const handlerPromise = predictRouteHandler(mockReq, mockRes)

    // Simulate the 'aborted' event being emitted by Express
    // Find the callback registered for 'aborted' and call it.
    const abortedCallback = mockReq.on.mock.calls.find(
      (call) => call[0] === 'aborted'
    )?.[1]

    expect(abortedCallback).toBeDefined()

    // Trigger the abort after a very short delay to allow the handler to start
    await new Promise((resolve) => setTimeout(resolve, 10))
    abortedCallback() // This should trigger abortController.abort()

    // Wait for the handler to complete (or for the abort to propagate)
    await handlerPromise

    // Assertions
    expect(mockAbortControllerInstance.abort).toHaveBeenCalledTimes(1)
    expect(consoleSpy).toHaveBeenCalledWith(
      'Client disconnected, aborting request.'
    )
    // Since predictUrlHandler is mocked, we expect it to be called with the signal
    expect(mockPredictUrlHandler).toHaveBeenCalledWith(
      mockReq,
      mockRes,
      expect.any(Object),
      mockAbortControllerInstance.signal
    )
  })

  it('should not abort if client disconnects after response is sent', async () => {
    const mockReq = {
      body: { url: 'http://example.com/image.jpg' },
      on: jest.fn(),
    }
    const mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      writableEnded: true, // Simulate response already ended
    }

    const predictRouteHandler = app.post.mock.calls.find(
      (call) => call[0] === '/predict'
    )?.[2]

    // Execute the handler
    const handlerPromise = predictRouteHandler(mockReq, mockRes)

    const abortedCallback = mockReq.on.mock.calls.find(
      (call) => call[0] === 'aborted'
    )?.[1]

    expect(abortedCallback).toBeDefined()

    // Trigger the abort after a very short delay
    await new Promise((resolve) => setTimeout(resolve, 10))
    abortedCallback() // This should NOT trigger abortController.abort()

    await handlerPromise

    expect(mockAbortControllerInstance.abort).not.toHaveBeenCalled()
    expect(consoleSpy).not.toHaveBeenCalledWith(
      'Client disconnected, aborting request.'
    )
  })
})
