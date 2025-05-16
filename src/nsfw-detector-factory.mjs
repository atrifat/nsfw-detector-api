import { NsfwSpy } from './nsfw-detector.mjs'
import { to } from 'await-to-js'
import { handleFatalError } from './util.mjs'
import * as workerpool from 'workerpool'
import { fileURLToPath } from 'url'
import path from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const imageProcessingWorkerScriptPath = path.join(
  __dirname,
  'image-processor-worker.mjs'
)
const nsfwDetectorWorkerScriptPath = path.join(
  __dirname,
  'nsfw-detector-worker.mjs'
)

/**
 * Factory function to create and load an NsfwSpy instance.
 * @param {string} modelPath - The path to the model.json file.
 * @returns {Promise<NsfwSpy>} - A promise that resolves with the loaded NsfwSpy instance.
 */
export const createNsfwSpy = async (modelPath) => {
  const nsfwSpy = new NsfwSpy(modelPath)

  console.time('load model')
  const [err] = await to(nsfwSpy.load())
  handleFatalError(err) // Handle fatal errors during model loading
  console.timeEnd('load model')

  return nsfwSpy
}

/**
 * @typedef {object} NsfwSpyWorkerInterface
 * @property {typeof NsfwSpy.prototype.classifyImageFile} classifyImageFile - Classifies an image from a file path using the worker.
 * @property {typeof NsfwSpy.prototype.classifyImageFromByteArray} classifyImageFromByteArray - Classifies an image from a byte array using the worker.
 */

/**
 * @typedef {object} ImageProcessingWorkerInterface
 * @property {(filePath: string, outputPath: string) => Promise<import('sharp').OutputInfo>} processImageFile
 * @property {(buffer: Buffer, outputPath: string) => Promise<import('sharp').OutputInfo>} processImageData
 */

/** Factory function to create a worker pool for NSFW detection.
 * @param {import('./config.mjs').config} config - Application configuration object.
 * @returns {Promise<workerpool.Pool>} - A promise that resolves with the created worker pool.
 */
export const createNsfwDetectorWorkerPool = async (config) => {
  const nsfwDetectorPool = workerpool.pool(nsfwDetectorWorkerScriptPath, {
    minWorkers: config.WORKER_POOL_MIN_WORKERS,
    maxWorkers: config.WORKER_POOL_MAX_WORKERS,
    workerType: 'auto',
  })

  return nsfwDetectorPool
}

/**
 * Factory function to create a worker pool for image processing.
 * @param {import('./config.mjs').config} config - Application configuration object.
 * @returns {Promise<workerpool.Pool>} - A promise that resolves with the created worker pool.
 */
export const createImageProcessingWorkerPool = async (config) => {
  const imageProcessingPool = workerpool.pool(imageProcessingWorkerScriptPath, {
    minWorkers: config.WORKER_POOL_MIN_WORKERS,
    maxWorkers: config.WORKER_POOL_MAX_WORKERS,
    workerType: 'auto',
  })

  return imageProcessingPool
}

/**
 * Factory function to create and load an NsfwSpy instance from worker.
 * @param {workerpool.Pool} workerpool - The worker pool to use for creating the NsfwSpy instance.
 * @returns {Promise<NsfwSpyWorkerInterface>} - A promise that resolves with an object containing the worker interface.
 */
export const createNsfwSpyInstanceFromWorker = async (workerpool) => {
  const proxy = await workerpool.proxy()
  /**
   * @type {NsfwSpyWorkerInterface}
   */
  const nsfwSpyInterface = {
    classifyImageFile: async (filePath) => {
      return await proxy.classifyImageFile(filePath)
    },
    classifyImageFromByteArray: async (imageBuffer) => {
      return await proxy.classifyImageFromByteArray(imageBuffer)
    },
  }
  return nsfwSpyInterface
}

/**
 * Factory function to create an image processing instance from a worker pool.
 * @param {workerpool.Pool} workerpool - The worker pool to use for creating the image processing instance.
 * @returns {Promise<ImageProcessingWorkerInterface>} - A promise that resolves with the created image processing instance.
 */
export const createImageProcessingInstanceFromWorker = async (workerpool) => {
  const proxy = await workerpool.proxy()
  /**
   * @type {ImageProcessingWorkerInterface}
   */
  const imageProcessingInstance = {
    processImageFile: async (filePath, outputPath) => {
      return await proxy.processImageFile(filePath, outputPath)
    },
    processImageData: async (buffer, outputPath) => {
      return await proxy.processImageData(buffer, outputPath)
    },
  }
  return imageProcessingInstance
}
