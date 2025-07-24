import { to } from 'await-to-js'
import {
  downloadPartFile,
  downloadPartFileToBuffer,
  getVideoStream,
} from './download.mjs'
import * as fs from 'fs/promises'
import path from 'path'
import {
  generateScreenshot,
  generateScreenshotFromBuffer,
  generateScreenshotFromStream,
} from './ffmpeg-util.mjs'

/**
 * Private helper to get a screenshot buffer from a video URL using a tiered fallback system.
 * @param {string} url - The URL of the video.
 * @param {string} filename - The SHA256 hash of the URL.
 * @param {object} params - Contains necessary parameters and dependencies.
 * @returns {Promise<{screenshotBuffer: Buffer, downloadStatus: object, tempFilesCreated: string[]}>}
 */
export const getScreenshotBufferWithFallbacks = async (
  url,
  filename,
  params
) => {
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
      return { screenshotBuffer, downloadStatus, tempFilesCreated }
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
      return { screenshotBuffer, downloadStatus, tempFilesCreated }
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
  tempFilesCreated.push(tempVideoFile, tempScreenshotFile)[err] = await to(
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
    const error = new Error(
      `[Tier 3] Final fallback download failed: ${err.message}`
    )
    error.tempFilesCreated = tempFilesCreated
    throw error
  }

  ;[err, success] = await to(
    limit(() =>
      generateScreenshot(tempVideoFile, tempScreenshotFile, FFMPEG_PATH)
    )
  )
  if (err || !success) {
    const error = new Error(
      `[Tier 3] Final fallback screenshot generation from file failed: ${err?.message || 'Unknown error'}`
    )
    error.tempFilesCreated = tempFilesCreated
    throw error
  }

  ;[err, screenshotBuffer] = await to(fs.readFile(tempScreenshotFile))
  if (err) {
    const error = new Error(
      `[Tier 3] Final fallback screenshot read failed: ${err.message}`
    )
    error.tempFilesCreated = tempFilesCreated
    throw error
  }

  downloadStatus = {
    status: 'screenshot from temporary file (final fallback)',
  }
  return { screenshotBuffer, downloadStatus, tempFilesCreated }
}
