import { jest } from '@jest/globals'
import { Mutex } from 'async-mutex'

// This test requires mocking several dependencies to isolate the url-processor's mutex logic.
jest.unstable_mockModule('../src/download.mjs', () => ({
  __esModule: true,
  getContentInfo: jest.fn().mockResolvedValue({
    contentType: 'image/jpeg',
    contentLength: 1234,
    extension: 'jpg',
  }),
  downloadFileToBuffer: jest
    .fn()
    .mockResolvedValue(Buffer.from('mock-image-data')),
  // Add other exports from download.mjs as no-op mocks to prevent import errors
  downloadPartFileToBuffer: jest.fn(),
  downloadFile: jest.fn(),
  downloadPartFile: jest.fn(),
  streamToBuffer: jest.fn(),
  getVideoStream: jest.fn(),
  getVideoBuffer: jest.fn(),
}))

describe('url-processor concurrency', () => {
  const mockConfig = {
    IMG_DOWNLOAD_PATH: '/tmp/nsfw-test',
    ENABLE_CONTENT_TYPE_CHECK: false,
    ENABLE_BUFFER_PROCESSING: true,
    FFMPEG_PATH: 'ffmpeg',
    MAX_VIDEO_SIZE_MB: 10,
    REQUEST_TIMEOUT_IN_SECONDS: 5,
    USER_AGENT: 'jest-test',
  }
  let eventLog = []
  let inFlight = 0
  let maxInFlight = 0
  let workTime = 50 // ms

  beforeEach(() => {
    // Reset state before each test
    eventLog = []
    inFlight = 0
    maxInFlight = 0
    jest.resetModules() // This is crucial to get fresh mocks

    // Mock the innermost function that runs inside the mutex lock
    jest.unstable_mockModule('../src/image-prediction-pipeline.mjs', () => ({
      __esModule: true,
      runImagePredictionPipeline: jest.fn(async (imageData, filename) => {
        const url = filename // In the test, filename is the url
        inFlight++
        maxInFlight = Math.max(maxInFlight, inFlight)
        eventLog.push({ event: 'enter', url, time: Date.now() })

        // Simulate async work
        await new Promise((resolve) => setTimeout(resolve, workTime))

        eventLog.push({ event: 'exit', url, time: Date.now() })
        inFlight--
        return { prediction: 'mocked' }
      }),
    }))
  })

  it('serializes processing for the same URL key', async () => {
    const { processUrlForPrediction } = await import('../src/url-processor.mjs')
    const url = 'http://example.com/same-image.jpg'

    const dependencies = {
      resultCache: new Map(),
      mutexes: new Map(),
      config: mockConfig,
      Mutex: Mutex,
      nsfwSpy: {}, // Mocked, not used in this test path
      imageProcessingInstance: {}, // Mocked
    }

    // Act: Start two promises with the SAME URL concurrently
    const p1 = processUrlForPrediction(url, dependencies)
    const p2 = processUrlForPrediction(url, dependencies)
    await Promise.all([p1, p2])

    // Assert
    expect(maxInFlight).toBe(1) // The mutex should prevent them from running in parallel

    // Since the first call's result is now cached, the second call will return immediately
    // and not even enter the mutex-protected block. Let's find the prediction pipeline mock.
    const { runImagePredictionPipeline } = await import(
      '../src/image-prediction-pipeline.mjs'
    )
    expect(runImagePredictionPipeline).toHaveBeenCalledTimes(1)

    const enterEvents = eventLog.filter((e) => e.event === 'enter')
    const exitEvents = eventLog.filter((e) => e.event === 'exit')

    expect(enterEvents.length).toBe(1)
    expect(exitEvents.length).toBe(1)
  })

  it('allows concurrent processing for different URL keys', async () => {
    const { processUrlForPrediction } = await import('../src/url-processor.mjs')
    const url1 = 'http://example.com/image-1.jpg'
    const url2 = 'http://example.com/image-2.jpg'

    const dependencies = {
      resultCache: new Map(),
      mutexes: new Map(),
      config: mockConfig,
      Mutex: Mutex,
      nsfwSpy: {}, // Mocked
      imageProcessingInstance: {}, // Mocked
    }
    // Act: Start two promises with DIFFERENT URLs concurrently
    const p1 = processUrlForPrediction(url1, dependencies)
    const p2 = processUrlForPrediction(url2, dependencies)

    await Promise.all([p1, p2])

    // Assert
    expect(maxInFlight).toBe(2) // With different keys, they should run in parallel

    const enterEvents = eventLog.filter((e) => e.event === 'enter')
    const exitEvents = eventLog.filter((e) => e.event === 'exit')

    expect(enterEvents.length).toBe(2)
    expect(exitEvents.length).toBe(2)

    // The second 'enter' must happen BEFORE the first 'exit'
    const firstExitTime = Math.min(exitEvents[0].time, exitEvents[1].time)
    const secondEnterTime = Math.max(enterEvents[0].time, enterEvents[1].time)

    expect(secondEnterTime).toBeLessThan(firstExitTime)
  })
})
