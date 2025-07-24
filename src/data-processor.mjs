import { to } from 'await-to-js'
import * as fs from 'fs/promises'
import { sha256 } from 'js-sha256'
import { deleteFile } from './util.mjs'
import { runImagePredictionPipeline } from './image-prediction-pipeline.mjs'

/**
 * Processes base64 image data for NSFW detection.
 * @param {string} base64_data - The base64 encoded image data.
 * @param {object} dependencies - Injected dependencies.
 * @param {import("./nsfw-detector.mjs").NsfwSpy} dependencies.nsfwSpy - The NSFW detector instance.
 * @param {import("./nsfw-detector-factory.mjs").ImageProcessingWorkerInterface} dependencies.imageProcessingInstance - The image processing instance.
 * @param {object} dependencies.resultCache - The LRU cache instance.
 * @param {object} dependencies.config - Configuration setting
 * @param {string} dependencies.config.IMG_DOWNLOAD_PATH - Directory for temporary files.
 * @param {boolean} dependencies.config.ENABLE_BUFFER_PROCESSING - Flag to enable buffer processing.
 * @returns {Promise<object>} - The classification result.
 * @throws {Error} If any step in the process fails.
 */
export const processDataForPrediction = async (
  base64_data,
  { nsfwSpy, imageProcessingInstance, resultCache, config }
) => {
  const buffer = Buffer.from(base64_data, 'base64')
  const filename = sha256(base64_data)
  const { IMG_DOWNLOAD_PATH, ENABLE_BUFFER_PROCESSING } = config

  // Check cache first
  let cache = resultCache.get('data' + '-' + filename)
  if (cache) {
    return cache // Return cached result
  }

  let imageDataForPipeline = buffer // Default to buffer for buffer processing path

  try {
    if (!ENABLE_BUFFER_PROCESSING) {
      // For file-based processing, save buffer to a temporary file first
      const imageFile = IMG_DOWNLOAD_PATH + filename + '_image'
      const [errWriteFile] = await to(fs.writeFile(imageFile, buffer))
      if (errWriteFile) {
        throw new Error(`Failed to write image file: ${errWriteFile.message}`)
      }
      imageDataForPipeline = imageFile // Pass file path to pipeline
    }

    // Run the common image prediction pipeline
    const [errPrediction, predictionResult] = await to(
      runImagePredictionPipeline(imageDataForPipeline, filename, {
        nsfwSpy,
        imageProcessingInstance,
        config,
      })
    )

    if (errPrediction) {
      throw errPrediction
    }
    cache = predictionResult

    // Store result in cache
    resultCache.set('data' + '-' + filename, cache)
    console.debug('Classification result:', cache)
    return cache // Return the classification result
  } catch (error) {
    console.error(error)
    throw error // Re-throw the error to be caught by the handler
  } finally {
    // Cleanup temporary files only for the file-based path
    if (!ENABLE_BUFFER_PROCESSING) {
      const [err] = await to(
        deleteFile(IMG_DOWNLOAD_PATH + filename + '_image')
      )
      if (err) {
        console.warn(
          `[Cleanup Warning] Failed to delete temporary image file ${IMG_DOWNLOAD_PATH + filename + '_image'}: ${err.message}`
        )
      }
    }
  }
}
