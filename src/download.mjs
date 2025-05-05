import * as fs from 'node:fs'
import axios from 'axios'
import mime from 'mime'

const DEFAULT_MAX_VIDEO_SIZE = 1024 * 1024 * 100 // 100MB
const MAX_REDIRECTS = 5

/**
 * Handles redirects for a given URL.
 * @param {string} url - The URL to check for redirects.
 * @param {object} [extraHeaders={}] - Additional headers for the request.
 * @param {number} [timeout=60000] - The request timeout in milliseconds.
 * @returns {Promise<string>} - The final URL after following redirects.
 */
const handleRedirects = async (url, extraHeaders = {}, timeout = 60000) => {
  let currentUrl = url
  let response = await axios.head(currentUrl, {
    headers: extraHeaders,
    timeout: timeout,
  })
  let redirectCount = 0

  while (response.headers.get('location') !== undefined) {
    const newUrl = response.headers.get('location')
    currentUrl = newUrl
    response = await axios.head(currentUrl, {
      headers: extraHeaders,
      timeout: timeout,
    })
    redirectCount++

    if (redirectCount > MAX_REDIRECTS) {
      throw new Error('Too many redirects')
    }
  }

  return currentUrl
}

/**
 * Downloads a file from a given URL to a destination path.
 * @param {string} src - The source URL of the file.
 * @param {string} dest - The destination path to save the file.
 * @param {number} [timeout=60000] - The download timeout in milliseconds.
 * @param {object} [extraHeaders={}] - Additional headers for the request.
 * @returns {Promise<boolean>} - A promise that resolves to true on successful download.
 * @throws {Error} If the download fails.
 */
export const downloadFile = async function (
  src,
  dest,
  timeout = 60000,
  extraHeaders = {}
) {
  try {
    const response = await axios({
      method: 'GET',
      url: src,
      responseType: 'stream',
      headers: extraHeaders,
      timeout: timeout,
    })

    if (response?.data && response.status === 200) {
      const writer = fs.createWriteStream(dest)

      // Pipe the result stream into a file on disk
      response.data.pipe(writer)

      // Return a promise and resolve when download finishes
      return new Promise((resolve, reject) => {
        writer.on('finish', () => {
          resolve(true)
        })

        writer.on('error', (error) => {
          reject(error)
        })
      })
    } else {
      throw new Error(`Failed to download file. Status: ${response.status}`)
    }
  } catch (e) {
    throw new Error(`Download failed: ${e.message}`)
  }
}

/**
 * Saves the response stream to a file, with a size limit.
 * @param {string} outputFile - The path to save the output file.
 * @param {object} response - The Axios response object with a stream data.
 * @param {number} size - The maximum allowed size in bytes.
 * @returns {Promise<boolean>} - A promise that resolves to true on successful save within the size limit.
 * @throws {Error} If the downloaded size exceeds the content length or writing fails.
 */
const saveOutput = async (outputFile, response, size) => {
  const contentLength = response.headers['content-length']
  if (contentLength && parseInt(contentLength) > size) {
    response.data.destroy()
    throw new Error('Content length exceeds maximum allowed size.')
  }

  const writeStream = fs.createWriteStream(outputFile)
  response.data.pipe(writeStream)

  let receivedLength = 0

  return new Promise((resolve, reject) => {
    response.data.on('data', (chunk) => {
      receivedLength += chunk.length
      if (receivedLength > size) {
        // Abort the download immediately when downloaded file exceeds content length
        response.data.destroy()
        reject(new Error('Downloaded size exceeds content length.'))
      }
    })

    writeStream.on('finish', () => {
      resolve(true)
    })

    writeStream.on('error', (error) => {
      reject(error)
    })
  })
}

/**
 * Downloads a part of a file from a given URL to a destination path, with a maximum size limit.
 * Useful for large video files where only a portion is needed.
 * @param {string} url - The source URL of the file.
 * @param {string} outputFile - The destination path to save the file.
 * @param {number} [maxVideoSize=104857600] - The maximum size to download in bytes (default: 100MB).
 * @param {number} [timeout=60000] - The download timeout in milliseconds.
 * @param {object} [extraHeaders={}] - Additional headers for the request.
 * @returns {Promise<boolean>} - A promise that resolves to true on successful download of the part.
 * @throws {Error} If the download fails or the server does not support range requests.
 */
export const downloadPartFile = async (
  url,
  outputFile,
  maxVideoSize = DEFAULT_MAX_VIDEO_SIZE,
  timeout = 60000,
  extraHeaders = {}
) => {
  try {
    const redirectedUrl = await handleRedirects(url, extraHeaders, timeout)

    let response = await axios.head(redirectedUrl, {
      headers: extraHeaders,
      timeout: timeout,
    })

    let fileSize = parseInt(response.headers['content-length'])
    console.log(
      `File size for ${redirectedUrl}: ${(fileSize / (1024 * 1024)).toFixed(2)} MB`
    )
    // Workaround for unreliable Content-Length: assume fileSize if not available or invalid
    if (isNaN(fileSize) || fileSize <= 0) {
      fileSize = maxVideoSize
    }

    // Download immediately if file is smaller than or equal to target maxVideoSize
    const downloadSize = Math.min(fileSize, maxVideoSize)
    if (fileSize <= maxVideoSize) {
      const getResponse = await axios.get(redirectedUrl, {
        headers: extraHeaders,
        responseType: 'stream',
        timeout: timeout,
      })
      await saveOutput(outputFile, getResponse, downloadSize)
      return true
    }

    // Set range headers to download with partial bytes size
    const rangeHeaders = {
      ...extraHeaders,
      Range: `bytes=0-${maxVideoSize - 1}`,
    }

    const partialResponse = await axios.get(redirectedUrl, {
      headers: rangeHeaders,
      responseType: 'stream',
      timeout: timeout,
    })

    if (partialResponse.status === 206) {
      // console.log("Server returned partial content.");
      await saveOutput(outputFile, partialResponse, downloadSize)
      return true
    } else if (partialResponse.status === 416) {
      throw new Error('Server does not support Range header request.')
    } else {
      throw new Error(
        `Failed to download partial file. Status: ${partialResponse.status}`
      )
    }
  } catch (e) {
    throw new Error(`Partial file download failed: ${e.message}`)
  }
}

/**
 * Gets content information (content length, content type, extension) for a given URL using a HEAD request.
 * @param {string} src - The source URL.
 * @param {number} [timeout=60000] - The request timeout in milliseconds.
 * @param {object} [extraHeaders={}] - Additional headers for the request.
 * @returns {Promise<{contentLength: number, contentType: string, extension: string}>} - A promise that resolves to an object containing content information.
 * @throws {Error} If the HEAD request fails.
 */
export const getContentInfo = async function (
  src,
  timeout = 60000,
  extraHeaders = {}
) {
  try {
    const response = await axios({
      method: 'HEAD',
      url: src,
      timeout: timeout,
      headers: { ...extraHeaders },
    })

    console.log('Response headers:', response.headers)
    if (response?.headers && response.status === 200) {
      let contentLength = parseInt(response.headers['content-length'])
      if (isNaN(contentLength)) {
        contentLength = 0
      }
      const contentType = response.headers['content-type']
      const extension = mime.getExtension(contentType)

      const output = {
        contentLength: contentLength,
        contentType: contentType ?? 'application/octet-stream',
        extension: extension ?? 'bin',
      }

      return output
    } else {
      throw new Error(`Failed to get content info. Status: ${response.status}`)
    }
  } catch (e) {
    throw new Error(`Get content info failed: ${e.message}`)
  }
}
