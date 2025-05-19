// __tests__/nsfw-detector-factory.test.mjs

import { jest } from '@jest/globals'

// --- Mock Definitions (not the mock itself yet) ---
const mockPoolFunction = jest.fn()
const mockPoolProxyMethod = jest.fn()

const mockWorkerProxyObject = {
  classifyImageFile: jest.fn().mockResolvedValue('nsfwClassifyFileResult'),
  classifyImageFromByteArray: jest
    .fn()
    .mockResolvedValue('nsfwClassifyByteArrayResult'),
  processImageFile: jest.fn().mockResolvedValue('imageProcessFileResult'),
  processImageData: jest.fn().mockResolvedValue('imageProcessDataResult'),
}

// --- Variables to hold imported factory functions ---
let createNsfwSpy,
  createNsfwDetectorWorkerPool,
  createImageProcessingWorkerPool,
  createNsfwSpyInstanceFromWorker,
  createImageProcessingInstanceFromWorker
let NsfwSpy

// --- Test Suite ---
describe('NsfwDetectorFactory', () => {
  beforeAll(async () => {
    // Establish the mock *before* importing the module that uses 'workerpool'
    jest.doMock('workerpool', () => ({
      __esModule: true,
      pool: mockPoolFunction,
    }))

    // Dynamically import the factory and NsfwSpy *after* the mock is in place
    const factoryModule = await import('../src/nsfw-detector-factory.mjs')
    createNsfwSpy = factoryModule.createNsfwSpy
    createNsfwDetectorWorkerPool = factoryModule.createNsfwDetectorWorkerPool
    createImageProcessingWorkerPool =
      factoryModule.createImageProcessingWorkerPool
    createNsfwSpyInstanceFromWorker =
      factoryModule.createNsfwSpyInstanceFromWorker
    createImageProcessingInstanceFromWorker =
      factoryModule.createImageProcessingInstanceFromWorker

    const nsfwSpyModule = await import('../src/nsfw-detector.mjs')
    NsfwSpy = nsfwSpyModule.NsfwSpy
  })

  beforeEach(() => {
    // Reset all mocks before each test
    mockPoolFunction.mockReset()
    mockPoolFunction.mockReturnValue({
      proxy: mockPoolProxyMethod,
      terminate: jest.fn(),
      stats: jest.fn(),
    })

    mockPoolProxyMethod.mockReset()
    mockPoolProxyMethod.mockResolvedValue(mockWorkerProxyObject)

    mockWorkerProxyObject.classifyImageFile
      .mockClear()
      .mockResolvedValue('nsfwClassifyFileResult')
    mockWorkerProxyObject.classifyImageFromByteArray
      .mockClear()
      .mockResolvedValue('nsfwClassifyByteArrayResult')
    mockWorkerProxyObject.processImageFile
      .mockClear()
      .mockResolvedValue('imageProcessFileResult')
    mockWorkerProxyObject.processImageData
      .mockClear()
      .mockResolvedValue('imageProcessDataResult')
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  // Tests remain the same as your last provided version:
  it('should create an NsfwSpy instance and call load', async () => {
    const mockModelPath = 'testModelPath'
    const loadSpy = jest
      .spyOn(NsfwSpy.prototype, 'load')
      .mockResolvedValue(undefined)
    const nsfwSpyInstance = await createNsfwSpy(mockModelPath)
    expect(nsfwSpyInstance).toBeInstanceOf(NsfwSpy)
    expect(loadSpy).toHaveBeenCalledTimes(1)
    loadSpy.mockRestore()
  })

  it('should create an NsfwDetectorWorkerPool instance', async () => {
    const mockConfig = {
      WORKER_POOL_MIN_WORKERS: 1,
      WORKER_POOL_MAX_WORKERS: 2,
    }
    const nsfwDetectorPool = await createNsfwDetectorWorkerPool(mockConfig)
    expect(mockPoolFunction).toHaveBeenCalledTimes(1)
    expect(mockPoolFunction).toHaveBeenCalledWith(
      expect.stringContaining('nsfw-detector-worker.mjs'),
      {
        minWorkers: mockConfig.WORKER_POOL_MIN_WORKERS,
        maxWorkers: mockConfig.WORKER_POOL_MAX_WORKERS,
        workerType: 'auto',
      }
    )
    expect(nsfwDetectorPool).toBeDefined()
    expect(typeof nsfwDetectorPool.proxy).toBe('function')
    expect(typeof nsfwDetectorPool.terminate).toBe('function')
  })

  it('should create an ImageProcessingWorkerPool instance', async () => {
    const mockConfig = {
      WORKER_POOL_MIN_WORKERS: 1,
      WORKER_POOL_MAX_WORKERS: 2,
    }
    const imageProcessingPool =
      await createImageProcessingWorkerPool(mockConfig)
    expect(mockPoolFunction).toHaveBeenCalledTimes(1)
    expect(mockPoolFunction).toHaveBeenCalledWith(
      expect.stringContaining('image-processor-worker.mjs'),
      {
        minWorkers: mockConfig.WORKER_POOL_MIN_WORKERS,
        maxWorkers: mockConfig.WORKER_POOL_MAX_WORKERS,
        workerType: 'auto',
      }
    )
    expect(imageProcessingPool).toBeDefined()
    expect(typeof imageProcessingPool.proxy).toBe('function')
    expect(typeof imageProcessingPool.terminate).toBe('function')
  })

  it('should create an NsfwSpyInstance from worker and call its methods', async () => {
    const mockPoolForNsfwInstance = {
      proxy: mockPoolProxyMethod,
      terminate: jest.fn(),
    }
    const nsfwSpyWorkerInstance = await createNsfwSpyInstanceFromWorker(
      mockPoolForNsfwInstance
    )
    expect(mockPoolForNsfwInstance.proxy).toHaveBeenCalledTimes(1)
    expect(nsfwSpyWorkerInstance).toBeDefined()
    expect(typeof nsfwSpyWorkerInstance.classifyImageFile).toBe('function')
    expect(typeof nsfwSpyWorkerInstance.classifyImageFromByteArray).toBe(
      'function'
    )
    const filePath = 'testPathFile.jpg'
    const fileResult = await nsfwSpyWorkerInstance.classifyImageFile(filePath)
    expect(fileResult).toBe('nsfwClassifyFileResult')
    expect(mockWorkerProxyObject.classifyImageFile).toHaveBeenCalledWith(
      filePath
    )
    expect(mockPoolForNsfwInstance.proxy).toHaveBeenCalledTimes(1)
    const buffer = Buffer.from('testBuffer')
    const byteArrayResult =
      await nsfwSpyWorkerInstance.classifyImageFromByteArray(buffer)
    expect(byteArrayResult).toBe('nsfwClassifyByteArrayResult')
    expect(
      mockWorkerProxyObject.classifyImageFromByteArray
    ).toHaveBeenCalledWith(buffer)
    expect(mockPoolForNsfwInstance.proxy).toHaveBeenCalledTimes(1)
  })

  it('should create an ImageProcessingInstance from worker and call its methods', async () => {
    const mockPoolForImageInstance = {
      proxy: mockPoolProxyMethod,
      terminate: jest.fn(),
    }
    const imageProcessingInstance =
      await createImageProcessingInstanceFromWorker(mockPoolForImageInstance)
    expect(mockPoolForImageInstance.proxy).toHaveBeenCalledTimes(1)
    expect(imageProcessingInstance).toBeDefined()
    expect(typeof imageProcessingInstance.processImageFile).toBe('function')
    expect(typeof imageProcessingInstance.processImageData).toBe('function')
    const filePath = 'testPath.jpg'
    const outputPathFile = 'outputPathFile.jpg'
    const fileResult = await imageProcessingInstance.processImageFile(
      filePath,
      outputPathFile
    )
    expect(fileResult).toBe('imageProcessFileResult')
    expect(mockWorkerProxyObject.processImageFile).toHaveBeenCalledWith(
      filePath,
      outputPathFile
    )
    expect(mockPoolForImageInstance.proxy).toHaveBeenCalledTimes(1)
    const buffer = Buffer.from('testData')
    const outputPathData = 'outputPathData.jpg'
    const byteArrayResult = await imageProcessingInstance.processImageData(
      buffer,
      outputPathData
    )
    expect(byteArrayResult).toBe('imageProcessDataResult')
    expect(mockWorkerProxyObject.processImageData).toHaveBeenCalledWith(
      buffer,
      outputPathData
    )
    expect(mockPoolForImageInstance.proxy).toHaveBeenCalledTimes(1)
  })
})
