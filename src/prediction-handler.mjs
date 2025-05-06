import { to } from 'await-to-js'
import { downloadFile, downloadPartFile, getContentInfo } from './download.mjs'
import {
  extractUrl,
  isContentTypeImageType,
  isContentTypeVideoType,
  getUrlType,
  moveFile,
  cleanupTemporaryFile, // Added cleanupTemporaryFile
} from './util.mjs'
import { processImageFile, processImageData } from './image-processor.mjs'
import { generateScreenshot } from './ffmpeg-util.mjs'
import { sha256 } from 'js-sha256'
import pMemoize from 'p-memoize'

/**
 * Downloads, processes, and classifies content from a URL.
 * Handles temporary files, video screenshots, and concurrency.
 * @param {string} url - The URL of the content.
 * @param {object} dependencies - Injected dependencies.
 * @param {object} dependencies.nsfwSpy - The NSFW detector instance.
 * @param {object} dependencies.resultCache - The LRU cache instance.
 * @param {Map<string, import('async-mutex').Mutex>} dependencies.mutexes - Map of mutexes for concurrency control. This map stores the mutexes associated with each URL.
 * @param {object} dependencies.config - Configuration setting
 * @param {string} dependencies.config.IMG_DOWNLOAD_PATH - Directory for temporary files.
 * @param {boolean} dependencies.config.ENABLE_CONTENT_TYPE_CHECK - Flag to enable content type check.
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
  { nsfwSpy, resultCache, mutexes, config, Mutex }
) => {
  const {
    IMG_DOWNLOAD_PATH,
    ENABLE_CONTENT_TYPE_CHECK,
    FFMPEG_PATH,
    MAX_VIDEO_SIZE_MB,
    REQUEST_TIMEOUT_IN_SECONDS,
    USER_AGENT,
  } = config
  const extraHeaders = {
    'User-Agent': USER_AGENT,
  }

  // Optional content type check
  if (ENABLE_CONTENT_TYPE_CHECK) {
    let contentInfo
    const [errContentInfo, contentInfoResult] = await to(
      getContentInfo(url, REQUEST_TIMEOUT_IN_SECONDS * 1000, extraHeaders)
    )

    if (errContentInfo) {
      throw new Error(`Failed to get content info: ${errContentInfo.message}`)
    }
    contentInfo = contentInfoResult

    if (
      !isContentTypeImageType(contentInfo.contentType) &&
      !isContentTypeVideoType(contentInfo.contentType)
    ) {
      console.debug(contentInfo)
      throw new Error('Only image/video URLs are acceptable')
    }

    console.debug(contentInfo)
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

  console.debug(`Processing URL: ${url}, Filename: ${filename}`)

  let downloadStatus
  const urlType = getUrlType(url)

  // Download and process based on URL type
  if (urlType === 'video') {
    const [errDownload, downloadResult] = await to(
      downloadPartFile(
        url,
        IMG_DOWNLOAD_PATH + filename + '_' + 'video',
        MAX_VIDEO_SIZE_MB * 1024 * 1024,
        REQUEST_TIMEOUT_IN_SECONDS * 1000,
        extraHeaders
      )
    )
    if (errDownload) {
      await cleanupTemporaryFile(filename, IMG_DOWNLOAD_PATH)
      safeReleaseMutex()
      throw new Error(`Video download failed: ${errDownload.message}`)
    }
    downloadStatus = downloadResult

    const [errScreenshot] = await to(
      generateScreenshot(
        IMG_DOWNLOAD_PATH + filename + '_' + 'video',
        IMG_DOWNLOAD_PATH + filename + '.jpg',
        FFMPEG_PATH
      )
    )

    const [errMove] = await to(
      moveFile(
        IMG_DOWNLOAD_PATH + filename + '.jpg',
        IMG_DOWNLOAD_PATH + filename + '_' + 'image'
      )
    )

    if (errScreenshot || errMove) {
      await cleanupTemporaryFile(filename, IMG_DOWNLOAD_PATH)
      safeReleaseMutex()
      throw new Error(
        `Screenshot generation or move failed: ${errScreenshot?.message || errMove?.message}`
      )
    }
  } else {
    const [errDownload, downloadResult] = await to(
      downloadFile(
        url,
        IMG_DOWNLOAD_PATH + filename + '_' + 'image',
        REQUEST_TIMEOUT_IN_SECONDS * 1000,
        extraHeaders
      )
    )
    if (errDownload) {
      await cleanupTemporaryFile(filename, IMG_DOWNLOAD_PATH)
      safeReleaseMutex()
      throw new Error(`Image download failed: ${errDownload.message}`)
    }
    downloadStatus = downloadResult
  }

  console.debug(`Download status for ${filename}:`, downloadStatus)

  // Process the downloaded image file
  console.time(`Preprocess Image File ${filename}`)
  const [errProcess] = await to(
    processImageFile(
      IMG_DOWNLOAD_PATH + filename + '_' + 'image',
      IMG_DOWNLOAD_PATH + filename + '_' + 'final'
    )
  )
  console.timeEnd(`Preprocess Image File ${filename}`)

  if (errProcess) {
    await cleanupTemporaryFile(filename, IMG_DOWNLOAD_PATH)
    safeReleaseMutex()
    throw new Error(`Image processing failed: ${errProcess.message}`)
  }

  // Classify the processed image
  console.time(`Classify ${filename}`)
  const [errClassify, classificationResult] = await to(
    nsfwSpy.classifyImageFile(IMG_DOWNLOAD_PATH + filename + '_' + 'final')
  )
  if (errClassify) {
    await cleanupTemporaryFile(filename, IMG_DOWNLOAD_PATH)
    safeReleaseMutex()
    throw new Error(`Classification failed: ${errClassify.message}`)
  }
  cache = classificationResult

  // Store result in cache
  resultCache.set('url' + '-' + filename, cache)

  console.timeEnd(`Classify ${filename}`)
  console.debug('Classification result:', cache)

  // Cleanup temporary files
  await cleanupTemporaryFile(filename, IMG_DOWNLOAD_PATH)
  safeReleaseMutex()

  return cache // Return the classification result
}

/**
 * Processes base64 image data for NSFW detection.
 * @param {string} base64_data - The base64 encoded image data.
 * @param {object} dependencies - Injected dependencies.
 * @param {object} dependencies.nsfwSpy - The NSFW detector instance.
 * @param {object} dependencies.resultCache - The LRU cache instance.
 * @param {object} dependencies.config - Configuration setting
 * @param {string} dependencies.config.IMG_DOWNLOAD_PATH - Directory for temporary files.
 * @returns {Promise<object>} - The classification result.
 * @throws {Error} If any step in the process fails.
 */
const processDataForPrediction = async (
  base64_data,
  { nsfwSpy, resultCache, config }
) => {
  const buffer = Buffer.from(base64_data, 'base64')
  const filename = sha256(base64_data)
  const { IMG_DOWNLOAD_PATH } = config

  // Check cache first
  let cache = resultCache.get('data' + '-' + filename)
  if (cache) {
    return cache // Return cached result
  }

  // Process the image data buffer
  const [errProcess] = await to(
    processImageData(buffer, IMG_DOWNLOAD_PATH + filename + '_' + 'final')
  )
  if (errProcess) {
    await cleanupTemporaryFile(filename, IMG_DOWNLOAD_PATH)
    throw new Error(`Image data processing failed: ${errProcess.message}`)
  }

  // Classify the processed image
  console.time(`Classify ${filename}`)
  const [errClassify, classificationResult] = await to(
    nsfwSpy.classifyImageFile(IMG_DOWNLOAD_PATH + filename + '_' + 'final')
  )
  if (errClassify) {
    await cleanupTemporaryFile(filename, IMG_DOWNLOAD_PATH)
    throw new Error(`Classification failed: ${errClassify.message}`)
  }
  cache = classificationResult

  // Store result in cache
  resultCache.set('data' + '-' + filename, cache)

  console.timeEnd(`Classify ${filename}`)
  console.debug('Classification result:', cache)

  // Cleanup temporary file
  await cleanupTemporaryFile(filename, IMG_DOWNLOAD_PATH)

  return cache // Return the classification result
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
