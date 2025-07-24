import { to } from 'await-to-js'
import { deleteFile } from './util.mjs'

/**
 * Runs the image preprocessing and classification pipeline.
 * This function handles both buffer-based and file-based processing.
 * @param {Buffer|string} imageData - The image data (Buffer for buffer-based, file path string for file-based).
 * @param {string} filename - A unique identifier for the image (e.g., SHA256 hash).
 * @param {object} dependencies - Injected dependencies.
 * @param {import("./nsfw-detector.mjs").NsfwSpy} dependencies.nsfwSpy - The NSFW detector instance.
 * @param {import("./nsfw-detector-factory.mjs").ImageProcessingWorkerInterface} dependencies.imageProcessingInstance - The image processing instance.
 * @param {object} dependencies.config - Configuration setting
 * @param {string} dependencies.config.IMG_DOWNLOAD_PATH - Directory for temporary files.
 * @param {boolean} dependencies.config.ENABLE_BUFFER_PROCESSING - Flag to enable buffer processing.
 * @returns {Promise<object>} - The classification result.
 * @throws {Error} If any step in the process fails.
 */
export const runImagePredictionPipeline = async (
  imageData,
  filename,
  { nsfwSpy, imageProcessingInstance, config }
) => {
  const { IMG_DOWNLOAD_PATH, ENABLE_BUFFER_PROCESSING } = config
  let classificationResult

  try {
    if (ENABLE_BUFFER_PROCESSING) {
      console.debug(
        `Running Prediction Pipeline (Buffer Processing Path): Filename: ${filename}`
      )
      console.time(`Preprocess Image Buffer ${filename}`)
      const [errProcess, processedBuffer] = await to(
        imageProcessingInstance.processImageData(imageData)
      )
      console.timeEnd(`Preprocess Image Buffer ${filename}`)
      if (errProcess) {
        throw new Error(`Image processing failed: ${errProcess.message}`)
      }

      console.time(`Classify Buffer ${filename}`)
      const [errClassify, prediction] = await to(
        nsfwSpy.classifyImageFromByteArray(processedBuffer)
      )
      console.timeEnd(`Classify Buffer ${filename}`)
      if (errClassify) {
        throw new Error(`Classification failed: ${errClassify.message}`)
      }
      classificationResult = prediction
    } else {
      console.debug(
        `Running Prediction Pipeline (File Path): Filename: ${filename}`
      )
      const imageFile = imageData // In file-based path, imageData is already the file path
      const processedFile = IMG_DOWNLOAD_PATH + filename + '_final'

      console.time(`Preprocess Image File ${filename}`)
      const [errProcessFile] = await to(
        imageProcessingInstance.processImageFile(imageFile, processedFile)
      )
      console.timeEnd(`Preprocess Image File ${filename}`)
      if (errProcessFile) {
        throw new Error(`Image processing failed: ${errProcessFile.message}`)
      }

      console.time(`Classify ${filename}`)
      const [errClassifyFile, prediction] = await to(
        nsfwSpy.classifyImageFile(processedFile)
      )
      console.timeEnd(`Classify ${filename}`)
      if (errClassifyFile) {
        throw new Error(`Classification failed: ${errClassifyFile.message}`)
      }
      classificationResult = prediction
    }

    return classificationResult
  } catch (error) {
    console.error(error)
    throw error
  } finally {
    // Cleanup processed file for file-based path
    if (!ENABLE_BUFFER_PROCESSING) {
      const [err] = await to(
        deleteFile(IMG_DOWNLOAD_PATH + filename + '_final')
      )
      if (err) {
        console.warn(
          `[Cleanup Warning] Failed to delete processed file ${IMG_DOWNLOAD_PATH + filename + '_final'}: ${err.message}`
        )
      }
    }
  }
}
