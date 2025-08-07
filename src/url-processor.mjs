import { to } from 'await-to-js'
import {
  downloadFile,
  downloadPartFile,
  getContentInfo,
  downloadFileToBuffer,
} from './download.mjs'
import {
  isContentTypeImageType,
  isContentTypeVideoType,
  getUrlType,
  moveFile,
  deleteFile,
} from './util.mjs'
import { generateScreenshot } from './ffmpeg-util.mjs'
import { sha256 } from 'js-sha256'
import pMemoize from 'p-memoize'
import { getScreenshotBufferWithFallbacks } from './video-processor.mjs'
import { runImagePredictionPipeline } from './image-prediction-pipeline.mjs'

/** * Retrieves or creates a mutex for the given filename.
 * Uses pMemoize to ensure that the mutex is created only once per filename.
 * This prevents multiple concurrent downloads for the same URL.
 * @param {string} filename - The filename to associate with the mutex.
 * @param {Map<string, import('async-mutex').Mutex>} mutexes - Map of mutexes for concurrency control.
 * @param {import('async-mutex').Mutex} Mutex - The Mutex class from async-mutex.
 * @returns {Promise<import('async-mutex').Mutex>} - The mutex associated with the filename.
 */
const getOrCreateMutex = pMemoize(async (filename, mutexes, Mutex) => {
  if (mutexes.has(filename)) {
    return mutexes.get(filename)
  }
  const newMutex = new Mutex()
  mutexes.set(filename, newMutex)
  return newMutex
})

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
export const processUrlForPrediction = async (
  url,
  {
    nsfwSpy,
    imageProcessingInstance,
    resultCache,
    mutexes,
    limit,
    config,
    Mutex,
  },
  signal
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
  const mutex = await getOrCreateMutex(filename, mutexes, Mutex)

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

  let imageDataForPipeline // This will hold either a Buffer or a file path
  let downloadStatus
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
        try {
          const result = await getScreenshotBufferWithFallbacks(
            url,
            filename,
            params,
            signal
          )
          if (result?.tempFilesCreated?.length) {
            tempFilesCreated.push(...result.tempFilesCreated)
          }
          imageDataForPipeline = result.screenshotBuffer
          downloadStatus = result.downloadStatus
        } catch (err) {
          if (err.tempFilesCreated?.length) {
            tempFilesCreated.push(...err.tempFilesCreated)
          }
          throw err
        }
      } else {
        // --- Image Processing Path (in-memory download) ---
        const [errDownload, buffer] = await to(
          downloadFileToBuffer(
            url,
            REQUEST_TIMEOUT_IN_SECONDS * 1000,
            extraHeaders,
            signal
          )
        ) // Download image directly to buffer
        if (errDownload) {
          throw new Error(`Download failed for ${url}: ${errDownload.message}`)
        }
        imageDataForPipeline = buffer
        downloadStatus = { status: 'downloaded to buffer' }
      }
    } else {
      console.debug(`Processing URL (File Path): ${url}, Filename: ${filename}`)
      let downloadedFile // This will be the path to the downloaded image/screenshot file

      if (getUrlType(url) === 'video') {
        const videoFile = IMG_DOWNLOAD_PATH + filename + '_video'
        const [errDownload, downloadResult] = await to(
          downloadPartFile(
            url,
            videoFile,
            MAX_VIDEO_SIZE_MB * 1024 * 1024,
            REQUEST_TIMEOUT_IN_SECONDS * 1000,
            extraHeaders,
            signal
          )
        )
        if (errDownload) {
          throw new Error(`Video download failed: ${errDownload.message}`)
        }
        downloadStatus = downloadResult
        // Add videoFile to tempFilesCreated for cleanup immediately after download
        tempFilesCreated.push(videoFile)

        const screenshotFile = IMG_DOWNLOAD_PATH + filename + '.jpg'
        const [errScreenshot] = await to(
          generateScreenshot(videoFile, screenshotFile, FFMPEG_PATH)
        )

        downloadedFile = IMG_DOWNLOAD_PATH + filename + '_' + 'image'
        const [errMove] = await to(
          moveFile(IMG_DOWNLOAD_PATH + filename + '.jpg', downloadedFile)
        )

        if (errScreenshot || errMove) {
          throw new Error(
            `Screenshot generation or move failed: ${errScreenshot?.message || errMove?.message}`
          )
        }
      } else {
        downloadedFile = IMG_DOWNLOAD_PATH + filename + '_' + 'image'
        const [errDownload, downloadResult] = await to(
          downloadFile(
            url,
            downloadedFile,
            REQUEST_TIMEOUT_IN_SECONDS * 1000,
            extraHeaders,
            signal
          )
        )
        if (errDownload) {
          throw new Error(`Image download failed: ${errDownload.message}`)
        }
        downloadStatus = downloadResult
      }
      imageDataForPipeline = downloadedFile // Pass file path to pipeline
      // Add the downloaded image file to tempFilesCreated for cleanup
      tempFilesCreated.push(downloadedFile)
    }

    console.debug(`Download status for ${filename}:`, downloadStatus)

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
    resultCache.set('url' + '-' + filename, cache)
    console.debug('Classification result:', cache)
    return cache // Return the classification result
  } catch (error) {
    console.error(error)
    throw error // Re-throw the error to be caught by the handler
  } finally {
    safeReleaseMutex()
    // Always attempt to clean up any files that were explicitly tracked for deletion.
    // This is crucial for the Tier 3 video fallback path and initial downloaded files.
    for (const tempFile of tempFilesCreated) {
      const [err] = await to(deleteFile(tempFile))
      if (err) {
        console.warn(
          `[Cleanup Warning] Failed to delete tracked temporary file ${tempFile}: ${err.message}`
        )
      }
    }
    // The pipeline now handles cleanup of processedFile, so no need for general cleanup here.
  }
}
