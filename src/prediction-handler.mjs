import { to } from 'await-to-js'
import {
  downloadFile,
  downloadPartFile,
  getContentInfo,
  downloadFileToBuffer,
  downloadPartFileToBuffer,
  getVideoStream,
} from './download.mjs'
import * as fs from 'fs/promises'
import path from 'path'

import {
  extractUrl,
  isContentTypeImageType,
  isContentTypeVideoType,
  getUrlType,
  moveFile,
  deleteFile,
  cleanupTemporaryFile,
} from './util.mjs'

import {
  generateScreenshot,
  generateScreenshotFromBuffer,
  generateScreenshotFromStream,
} from './ffmpeg-util.mjs'
import { sha256 } from 'js-sha256'
import pMemoize from 'p-memoize'

/**
 * Private helper to get a screenshot buffer from a video URL using a tiered fallback system.
 * @param {string} url - The URL of the video.
 * @param {string} filename - The SHA256 hash of the URL.
 * @param {object} params - Contains necessary parameters and dependencies.
 * @returns {Promise<{screenshotBuffer: Buffer, downloadStatus: object, tempFilesCreated: string[]}>}
 */
const _getScreenshotBufferWithFallbacks = async (url, filename, params) => {
  const {
    limit,
    extraHeaders,
    REQUEST_TIMEOUT_MS,
    FFMPEG_PATH,
    MAX_VIDEO_SIZE_BYTES,
    IMG_DOWNLOAD_PATH,
  } = params

  const tempFilesCreated = []
  let err, screenshotBuffer, videoStream, videoBuffer, success, downloadStatus

  // --- TIER 1: Attempt efficient streaming (fastest path) ---
  console.debug(`[Tier 1] Processing video via streaming for ${url}`)
  ;[err, videoStream] = await to(
    limit(() => getVideoStream(url, extraHeaders, REQUEST_TIMEOUT_MS))
  )
  if (!err) {
    ;[err, screenshotBuffer] = await to(
      limit(() => generateScreenshotFromStream(videoStream, FFMPEG_PATH))
    )
    if (!err) {
      downloadStatus = { status: 'screenshot from stream' }
      return [null, { screenshotBuffer, downloadStatus, tempFilesCreated }]
    }
  }
  console.warn(
    `[Tier 1 Failed] Streaming failed: ${err.message}. Falling back to size-limited buffer download.`
  )

  // --- TIER 2: Fallback to a size-limited in-memory buffer ---
  console.debug(
    `[Tier 2] Processing video via size-limited in-memory buffer for ${url}`
  )
  ;[err, videoBuffer] = await to(
    limit(() =>
      downloadPartFileToBuffer(
        url,
        MAX_VIDEO_SIZE_BYTES,
        REQUEST_TIMEOUT_MS,
        extraHeaders
      )
    )
  )
  if (!err) {
    ;[err, screenshotBuffer] = await to(
      limit(() => generateScreenshotFromBuffer(videoBuffer, FFMPEG_PATH))
    )
    if (!err) {
      downloadStatus = { status: 'screenshot from partial buffer (fallback)' }
      return [null, { screenshotBuffer, downloadStatus, tempFilesCreated }]
    }
  }
  console.warn(
    `[Tier 2 Failed] Buffer processing also failed: ${err.message}. Falling back to size-limited file download.`
  )

  // --- TIER 3: Final fallback to a size-limited temporary file (most reliable) ---
  console.debug(
    `[Tier 3] Processing video via size-limited temporary file for ${url}`
  )
  const tempVideoFile = path.join(
    IMG_DOWNLOAD_PATH,
    `${filename}_video_fallback`
  )
  const tempScreenshotFile = path.join(
    IMG_DOWNLOAD_PATH,
    `${filename}_screenshot_fallback.jpg`
  )
  tempFilesCreated.push(tempVideoFile, tempScreenshotFile)
  ;[err] = await to(
    limit(() =>
      downloadPartFile(
        url,
        tempVideoFile,
        MAX_VIDEO_SIZE_BYTES,
        REQUEST_TIMEOUT_MS,
        extraHeaders
      )
    )
  )
  if (err) {
    const finalError = new Error(
      `[Tier 3] Final fallback download failed: ${err.message}`
    )
    return [finalError, { tempFilesCreated }]
  }

  ;[err, success] = await to(
    limit(() =>
      generateScreenshot(tempVideoFile, tempScreenshotFile, FFMPEG_PATH)
    )
  )
  if (err || !success) {
    const finalError = new Error(
      `[Tier 3] Final fallback screenshot generation from file failed: ${err?.message || 'Unknown error'}`
    )
    return [finalError, { tempFilesCreated }]
  }

  ;[err, screenshotBuffer] = await to(fs.readFile(tempScreenshotFile))
  if (err) {
    const finalError = new Error(
      `[Tier 3] Final fallback screenshot read failed: ${err.message}`
    )
    return [finalError, { tempFilesCreated }]
  }

  downloadStatus = { status: 'screenshot from temporary file (final fallback)' }
  return [null, { screenshotBuffer, downloadStatus, tempFilesCreated }]
}
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
  {
    nsfwSpy,
    imageProcessingInstance,
    resultCache,
    mutexes,
    limit,
    config,
    Mutex,
  }
) => {
  const {
    IMG_DOWNLOAD_PATH,
    ENABLE_CONTENT_TYPE_CHECK,
    ENABLE_BUFFER_PROCESSING,
    FFMPEG_PATH,
    MAX_VIDEO_SIZE_MB,
    REQUEST_TIMEOUT_IN_SECONDS,
    USER_AGENT,
  } = config

  const extraHeaders = {
    'User-Agent': USER_AGENT,
  }

  // Convert config values once for use in download functions
  const MAX_VIDEO_SIZE_BYTES = MAX_VIDEO_SIZE_MB * 1024 * 1024
  const REQUEST_TIMEOUT_MS = REQUEST_TIMEOUT_IN_SECONDS * 1000

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
  const tempFilesCreated = [] // Array to track temporary files for cleanup

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
        `Processing URL (Buffer Processing Path): ${url}, Filename: ${filename}`
      )

      if (getUrlType(url) === 'video') {
        // --- Video Processing Path (in-memory download and processing) ---
        const params = {
          limit,
          extraHeaders,
          REQUEST_TIMEOUT_MS,
          FFMPEG_PATH,
          MAX_VIDEO_SIZE_BYTES,
          IMG_DOWNLOAD_PATH,
        }
        const [err, result] = await _getScreenshotBufferWithFallbacks(
          url,
          filename,
          params
        )

        // The helper now returns the list of created files even on error
        if (result?.tempFilesCreated?.length) {
          tempFilesCreated.push(...result.tempFilesCreated)
        }

        if (err) {
          // The helper function returns a detailed error on total failure
          throw err
        }

        imageBuffer = result.screenshotBuffer
        downloadStatus = result.downloadStatus
      } else {
        // --- Image Processing Path (in-memory download) ---
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
    // Always attempt to clean up any files that were explicitly tracked for deletion.
    // This is crucial for the Tier 3 video fallback path.
    for (const tempFile of tempFilesCreated) {
      const [err] = await to(deleteFile(tempFile))
      if (err) {
        console.warn(
          `[Cleanup Warning] Failed to delete tracked temporary file ${tempFile}: ${err.message}`
        )
      }
    }

    // Additionally, run the original cleanup for the general file-based path.
    if (!ENABLE_BUFFER_PROCESSING) {
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
      console.debug(
        `Processing Data (Buffer Processing Path): Filename: ${filename}`
      )
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
      const [errProcessFile] = await to(
        imageProcessingInstance.processImageFile(imageFile, processedFile)
      ) // Process file
      console.timeEnd(`Preprocess Image File ${filename}`)
      if (errProcessFile) {
        throw new Error(
          `Image data processing failed: ${errProcessFile.message}`
        )
      }

      console.time(`Classify ${filename}`)
      const [errClassifyFile, classificationResult] = await to(
        nsfwSpy.classifyImageFile(processedFile) // Classify from file
      )
      console.timeEnd(`Classify ${filename}`)
      if (errClassifyFile) {
        throw new Error(`Classification failed: ${errClassifyFile.message}`)
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
  const [err, result] = await to(processUrl(extractedUrl[0], dependencies))

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
