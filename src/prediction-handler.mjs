import { to } from 'await-to-js'
import {
  downloadFile,
  downloadPartFile,
  getContentInfo,
  downloadFileToBuffer,
} from './download.mjs'
import * as fs from 'fs/promises' // Import fs.promises for readFile
import {
  extractUrl,
  isContentTypeImageType,
  isContentTypeVideoType,
  getUrlType,
  moveFile,
  deleteFile, // Added deleteFile import
  cleanupTemporaryFile,
} from './util.mjs'

import { generateScreenshot } from './ffmpeg-util.mjs'
import { sha256 } from 'js-sha256'
import pMemoize from 'p-memoize'

/**
 * Downloads, processes, and classifies content from a URL.
 * Handles temporary files, video screenshots, and concurrency.
 * @param {string} url - The URL of the content.
 * @param {object} dependencies - Injected dependencies.
 * @param {import("./nsfw-detector-factory.mjs").NsfwSpyWorkerInterface} dependencies.nsfwSpy - The NSFW detector instance.
 * @param {import("./nsfw-detector-factory.mjs").ImageProcessingWorkerInterface} dependencies.imageProcessingInstance - The image processing instance.
 * @param {object} dependencies.resultCache - The LRU cache instance.
 * @param {Map<string, import('async-mutex').Mutex>} dependencies.mutexes - Map of mutexes for concurrency control. This map stores the mutexes associated with each URL.
 * @param {object} dependencies.config - Configuration setting
 * @param {string} dependencies.config.IMG_DOWNLOAD_PATH - Directory for temporary files.
 * @param {boolean} dependencies.config.ENABLE_CONTENT_TYPE_CHECK - Flag to enable content type check.
 * @param {boolean} dependencies.config.ENABLE_BUFFER_PROCESSING - Flag to enable buffer processing.
 * @param {string} dependencies.config.FFMPEG_PATH - Path to the FFmpeg binary.
 * @param {number} dependencies.config.MAX_VIDEO_SIZE_MB - Maximum video size in MB.
 * @param {number} dependencies.config.REQUEST_TIMEOUT_IN_SECONDS - Request timeout in seconds.
 * @param {string} dependencies.config.USER_AGENT - User agent string for downloads.
 * @param {import('async-mutex').Mutex} dependencies.Mutex - The Mutex class. This function uses `p-memoize` to ensure atomic mutex creation.
 * @returns {Promise<object>} - The classification result.
 * @throws {Error} If any step in the process fails.
 */
const processUrlForPrediction = async (
  url,
  { nsfwSpy, imageProcessingInstance, resultCache, mutexes, config, Mutex }
) => {
  const {
    IMG_DOWNLOAD_PATH,
    ENABLE_CONTENT_TYPE_CHECK,
    ENABLE_BUFFER_PROCESSING, // Added feature flag
    FFMPEG_PATH,
    MAX_VIDEO_SIZE_MB,
    REQUEST_TIMEOUT_IN_SECONDS,
    USER_AGENT,
  } = config
  const extraHeaders = {
    'User-Agent': USER_AGENT,
  }

  const filename = sha256(url)

  // Acquire mutex for this URL to prevent concurrent processing
  let mutex = mutexes.get(filename)
  if (!mutex) {
    const createMutex = async () => {
      const newMutex = new Mutex()
      mutexes.set(filename, newMutex)
      return newMutex
    }

    // Atomically get or create the mutex using p-memoize
    const memoizedCreateMutex = pMemoize(createMutex)
    mutex = await memoizedCreateMutex()
  }

  const release = await mutex.acquire()
  const safeReleaseMutex = () => {
    release()
    mutexes.delete(filename)
  }

  // Check cache first
  let cache = resultCache.get('url' + '-' + filename)
  if (cache) {
    safeReleaseMutex()
    return cache // Return cached result
  }

  let downloadedFile // Used in file-based path
  let screenshotFile // Used in both paths for video
  let imageBuffer // Used in buffer-based path
  let downloadStatus
  let processedFile // Used in file-based path

  try {
    // Optional content type check
    if (ENABLE_CONTENT_TYPE_CHECK) {
      let contentInfo
      const [errContentInfo, contentInfoResult] = await to(
        getContentInfo(url, REQUEST_TIMEOUT_IN_SECONDS * 1000, extraHeaders)
      )

      if (errContentInfo) {
        throw new Error(
          `Failed to get content info for ${url}: ${errContentInfo.message}`
        )
      }
      contentInfo = contentInfoResult

      if (
        !isContentTypeImageType(contentInfo.contentType) &&
        !isContentTypeVideoType(contentInfo.contentType)
      ) {
        console.debug(contentInfo)
        throw new Error(`Only image/video URLs are acceptable for ${url}`)
      }

      console.debug(contentInfo)
    }

    if (ENABLE_BUFFER_PROCESSING) {
      console.debug(
        `Processing URL (Buffer Path): ${url}, Filename: ${filename}`
      )
      if (getUrlType(url) === 'video') {
        downloadedFile = IMG_DOWNLOAD_PATH + filename + '_video' // Still download video to file
        const [errDownload, downloadResult] = await to(
          downloadPartFile(
            url,
            downloadedFile,
            MAX_VIDEO_SIZE_MB * 1024 * 1024,
            REQUEST_TIMEOUT_IN_SECONDS * 1000,
            extraHeaders
          )
        )
        if (errDownload) {
          throw new Error(
            `Video download failed for ${url}: ${errDownload.message}`
          )
        }
        downloadStatus = downloadResult

        screenshotFile = IMG_DOWNLOAD_PATH + filename + '.jpg' // Generate screenshot to file
        const [errScreenshot] = await to(
          generateScreenshot(downloadedFile, screenshotFile, FFMPEG_PATH)
        )
        if (errScreenshot) {
          throw new Error(
            `Screenshot generation failed for ${url}: ${errScreenshot.message}`
          )
        }

        const [errReadFile, screenshotBuffer] = await to(
          fs.readFile(screenshotFile)
        ) // Read screenshot file into buffer
        if (errReadFile || !screenshotBuffer) {
          throw new Error(`Could not read screenshot file for ${url}`)
        }
        imageBuffer = screenshotBuffer
      } else {
        const [errDownload, buffer] = await to(
          downloadFileToBuffer(
            url,
            REQUEST_TIMEOUT_IN_SECONDS * 1000,
            extraHeaders
          )
        ) // Download image directly to buffer
        if (errDownload) {
          throw new Error(`Download failed for ${url}: ${errDownload.message}`)
        }
        imageBuffer = buffer
        downloadStatus = { status: 'downloaded to buffer' }
      }

      console.debug(`Download status for ${filename}:`, downloadStatus)

      console.time(`Preprocess Image Buffer ${filename}`)
      const [errProcess, processedBuffer] = await to(
        imageProcessingInstance.processImageData(imageBuffer)
      ) // Process image buffer
      console.timeEnd(`Preprocess Image Buffer ${filename}`)
      if (errProcess) {
        throw new Error(
          `Image processing failed for ${url}: ${errProcess.message}`
        )
      }

      console.time(`Classify Buffer ${filename}`)
      const [errClassify, prediction] = await to(
        nsfwSpy.classifyImageFromByteArray(processedBuffer)
      ) // Classify from buffer
      console.timeEnd(`Classify Buffer ${filename}`)
      if (errClassify) {
        throw new Error(
          `Classification failed for ${url}: ${errClassify.message}`
        )
      }

      cache = prediction
    } else {
      console.debug(`Processing URL (File Path): ${url}, Filename: ${filename}`)
      if (getUrlType(url) === 'video') {
        downloadedFile = IMG_DOWNLOAD_PATH + filename + '_video'
        const [errDownload, downloadResult] = await to(
          downloadPartFile(
            url,
            downloadedFile,
            MAX_VIDEO_SIZE_MB * 1024 * 1024,
            REQUEST_TIMEOUT_IN_SECONDS * 1000,
            extraHeaders
          )
        )
        if (errDownload) {
          throw new Error(`Video download failed: ${errDownload.message}`)
        }
        downloadStatus = downloadResult

        screenshotFile = IMG_DOWNLOAD_PATH + filename + '.jpg'
        const [errScreenshot] = await to(
          generateScreenshot(downloadedFile, screenshotFile, FFMPEG_PATH)
        )

        const [errMove] = await to(
          moveFile(
            IMG_DOWNLOAD_PATH + filename + '.jpg',
            IMG_DOWNLOAD_PATH + filename + '_' + 'image'
          )
        )

        if (errScreenshot || errMove) {
          throw new Error(
            `Screenshot generation or move failed: ${errScreenshot?.message || errMove?.message}`
          )
        }
        downloadedFile = IMG_DOWNLOAD_PATH + filename + '_' + 'image' // Update downloadedFile for image processing
      } else {
        downloadedFile = IMG_DOWNLOAD_PATH + filename + '_' + 'image'
        const [errDownload, downloadResult] = await to(
          downloadFile(
            url,
            downloadedFile,
            REQUEST_TIMEOUT_IN_SECONDS * 1000,
            extraHeaders
          )
        )
        if (errDownload) {
          throw new Error(`Image download failed: ${errDownload.message}`)
        }
        downloadStatus = downloadResult
      }

      console.debug(`Download status for ${filename}:`, downloadStatus)

      // Process the downloaded image file
      console.time(`Preprocess Image File ${filename}`)

      processedFile = IMG_DOWNLOAD_PATH + filename + '_final'
      // Call the worker function via the proxy
      const [errProcess] = await to(
        imageProcessingInstance.processImageFile(downloadedFile, processedFile)
      )
      console.timeEnd(`Preprocess Image File ${filename}`)

      if (errProcess) {
        throw new Error(`Image processing failed: ${errProcess.message}`)
      }

      // Classify the processed image
      console.time(`Classify ${filename}`)
      const [errClassify, classificationResult] = await to(
        nsfwSpy.classifyImageFile(processedFile)
      )
      console.timeEnd(`Classify ${filename}`)
      if (errClassify) {
        throw new Error(`Classification failed: ${errClassify.message}`)
      }
      cache = classificationResult
    }

    // Store result in cache
    resultCache.set('url' + '-' + filename, cache)
    console.debug('Classification result:', cache)
    return cache // Return the classification result
  } catch (error) {
    console.error(error)
    throw error // Re-throw the error to be caught by the handler
  } finally {
    safeReleaseMutex()
    // Cleanup temporary files based on which path was used
    if (ENABLE_BUFFER_PROCESSING) {
      // Only cleanup video and screenshot files if they were created
      if (getUrlType(url) === 'video') {
        await to(deleteFile(IMG_DOWNLOAD_PATH + filename + '_video'))
        await to(deleteFile(IMG_DOWNLOAD_PATH + filename + '.jpg'))
      }
    } else {
      // Cleanup all temporary files for the file-based path
      await cleanupTemporaryFile(filename, IMG_DOWNLOAD_PATH)
    }
  }
}

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
const processDataForPrediction = async (
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

  let imageFile, processedFile // Used in file-based path

  try {
    let processedBuffer // Used in buffer-based path
    if (ENABLE_BUFFER_PROCESSING) {
      console.debug(`Processing Data (Buffer Path): Filename: ${filename}`)
      console.time(`Preprocess Image Buffer ${filename}`)
      const [errProcess, processedBufferResult] = await to(
        imageProcessingInstance.processImageData(buffer)
      ) // Process buffer
      console.timeEnd(`Preprocess Image Buffer ${filename}`)
      if (errProcess) {
        throw new Error(`Image data processing failed: ${errProcess.message}`)
      }
      processedBuffer = processedBufferResult

      console.time(`Classify Buffer ${filename}`)
      const [errClassify, prediction] = await to(
        nsfwSpy.classifyImageFromByteArray(processedBuffer)
      ) // Classify from buffer
      console.timeEnd(`Classify Buffer ${filename}`)
      if (errClassify) {
        throw new Error(`Classification failed: ${errClassify.message}`)
      }
      cache = prediction
    } else {
      console.debug(`Processing Data (File Path): Filename: ${filename}`)
      imageFile = IMG_DOWNLOAD_PATH + filename + '_image'
      processedFile = IMG_DOWNLOAD_PATH + filename + '_final'

      // Save the buffer to a temporary file
      const [errWriteFile] = await to(fs.writeFile(imageFile, buffer))
      if (errWriteFile) {
        throw new Error(`Failed to write image file: ${errWriteFile.message}`)
      }

      console.time(`Preprocess Image File ${filename}`)
      const [errProcess] = await to(
        imageProcessingInstance.processImageFile(imageFile, processedFile)
      ) // Process file
      console.timeEnd(`Preprocess Image File ${filename}`)
      if (errProcess) {
        throw new Error(`Image data processing failed: ${errProcess.message}`)
      }

      console.time(`Classify ${filename}`)
      const [errClassify, classificationResult] = await to(
        nsfwSpy.classifyImageFile(processedFile) // Classify from file
      )
      console.timeEnd(`Classify ${filename}`)
      if (errClassify) {
        throw new Error(`Classification failed: ${errClassify.message}`)
      }
      cache = classificationResult
    }

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
      await cleanupTemporaryFile(filename, IMG_DOWNLOAD_PATH)
    }
  }
}

/**
 * Processes a URL for NSFW detection by calling the core processing logic.
 * This function serves as an exported wrapper for `processUrlForPrediction`.
 * @param {string} url - The URL to process.
 * @param {object} dependencies - The dependencies required by `processUrlForPrediction`.
 * @returns {Promise<object>} - The prediction result from `processUrlForPrediction`.
 * @throws {Error} If `processUrlForPrediction` throws an error.
 */
export const processUrl = async (url, dependencies) => {
  return processUrlForPrediction(url, dependencies)
}

/**
 * Processes base64 data for NSFW detection by calling the core processing logic.
 * This function serves as an exported wrapper for `processDataForPrediction`.
 * @param {string} data - The base64 data to process.
 * @param {object} dependencies - The dependencies required by `processDataForPrediction`.
 * @returns {Promise<object>} - The prediction result from `processDataForPrediction`.
 * @throws {Error} If `processDataForPrediction` throws an error.
 */
export const processData = async (data, dependencies) => {
  return processDataForPrediction(data, dependencies)
}

/**
 * Handles the /predict endpoint for URL-based NSFW detection.
 * @param {object} req - Express request object.
 * @param {object} res - Express response object.
 * @param {object} dependencies - Injected dependencies.
 */
export const predictUrlHandler = async (req, res, dependencies) => {
  const url = req.body.url ?? ''

  // Validate URL
  const extractedUrl = extractUrl(url)
  if (extractedUrl === null) {
    return res.status(400).json({ message: 'URL is not detected' })
  }
  if (extractedUrl.length > 1) {
    return res.status(400).json({ message: 'Multiple URLs are not supported' })
  }

  // Process the URL and get the prediction result
  const [err, result] = await to(processUrl(url, dependencies))

  if (err) {
    // Error handling is now centralized in processUrlForPrediction, just return the error response
    return res.status(500).json({ message: err.message })
  }

  // Send the successful result
  res.status(200).json({ data: result })
}

/**
 * Handles the /predict_data endpoint for base64 image data NSFW detection.
 * @param {object} req - Express request object.
 * @param {object} res - Express response object.
 * @param {object} dependencies - Injected dependencies.
 * @param {string} dependencies.IMG_DOWNLOAD_PATH - Directory for temporary files.
 */
export const predictDataHandler = async (req, res, dependencies) => {
  const base64_data = req.body.data ?? null

  if (base64_data === null) {
    return res.status(400).json({
      message: 'Data input is empty, please send base64 string data as input',
    })
  }

  // Process the base64 data and get the prediction result
  const [err, result] = await to(processData(base64_data, dependencies))

  if (err) {
    // Error handling is now centralized in processDataForPrediction, just return the error response
    return res.status(500).json({ message: err.message })
  }

  // Send the successful result
  res.status(200).json({ data: result })
}
