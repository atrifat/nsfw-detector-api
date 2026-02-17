import * as fs from 'node:fs'
import axios from 'axios'
import mime from 'mime'

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

  return { finalUrl: currentUrl, response }
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
  extraHeaders = {},
  signal
) {
  try {
    const response = await axios({
      method: 'GET',
      url: src,
      responseType: 'stream',
      headers: extraHeaders,
      timeout: timeout,
      signal,
    })

    if (response?.data && response.status === 200) {
      const writer = fs.createWriteStream(dest)

      // Pipe the result stream into a file on disk
      response.data.pipe(writer)

      // Return a promise and resolve when download finishes
      return new Promise((resolve, reject) => {
        response.data.on('error', (error) => {
          writer.close()
          reject(error)
        })

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
    console.error(
      `Download failed: ${e.message}. Aborted: ${signal ? signal.aborted : 'N/A'}`
    )
    throw new Error(`Download failed: ${e.message}`, { cause: e })
  }
}

/**
 * Downloads a file from a given URL to a Buffer.
 * @param {string} src - The source URL of the file.
 * @param {number} [timeout=60000] - The download timeout in milliseconds.
 * @param {object} [extraHeaders={}] - Additional headers for the request.
 * @returns {Promise<Buffer>} - A promise that resolves with the downloaded file as a Buffer.
 * @throws {Error} If the download fails.
 */
export const downloadFileToBuffer = async function (
  src,
  timeout = 60000,
  extraHeaders = {},
  signal
) {
  try {
    const response = await axios({
      method: 'GET',
      url: src,
      responseType: 'arraybuffer',
      headers: extraHeaders,
      timeout: timeout,
      signal,
    })

    if (response?.data && response.status === 200) {
      return Buffer.from(response.data)
    } else {
      throw new Error(`Failed to download file. Status: ${response.status}`)
    }
  } catch (e) {
    console.error(
      `Download failed: ${e.message}. Aborted: ${signal ? signal.aborted : 'N/A'}`
    )
    throw new Error(`Download failed: ${e.message}`, { cause: e })
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
  maxVideoSize,
  timeout = 60000,
  extraHeaders = {},
  signal
) => {
  const { finalUrl: redirectedUrl, response } = await handleRedirects(
    url,
    extraHeaders,
    timeout
  )

  let fileSize = parseInt(response.headers['content-length'])
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
      signal,
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
    signal,
  })

  if (partialResponse.status === 206 || partialResponse.status === 200) {
    // console.log("Server returned partial content.");
    await saveOutput(outputFile, partialResponse, downloadSize)
    return true
  } else if (partialResponse.status === 416) {
    throw new Error('Server does not support Range header request.')
  } else {
    console.error(
      `Failed to download partial file. Status: ${partialResponse.status}. Aborted: ${signal?.aborted}`
    )
    throw new Error(
      `Failed to download partial file. Status: ${partialResponse.status}`
    )
  }
}

/**
 * Downloads a part of a file from a given URL to a Buffer, with a maximum size limit.
 * Useful for large video files where only a portion is needed.
 * @param {string} url - The source URL of the file.
 * @param {number} [maxVideoSize=104857600] - The maximum size to download in bytes (default: 100MB).
 * @param {number} [timeout=60000] - The download timeout in milliseconds.
 * @param {object} [extraHeaders={}] - Additional headers for the request.
 * @returns {Promise<Buffer>} - A promise that resolves with the downloaded part of the file as a Buffer.
 * @throws {Error} If the download fails or the server does not support range requests.
 */
export const downloadPartFileToBuffer = async (
  url,
  maxVideoSize,
  timeout = 60000,
  extraHeaders = {},
  signal
) => {
  const { finalUrl: redirectedUrl, response } = await handleRedirects(
    url,
    extraHeaders,
    timeout
  )

  let fileSize = parseInt(response.headers['content-length'])
  // Workaround for unreliable Content-Length: assume fileSize if not available or invalid
  if (isNaN(fileSize) || fileSize <= 0) {
    fileSize = maxVideoSize
  }

  // Download immediately if file is smaller than or equal to target maxVideoSize
  // const downloadSize = Math.min(fileSize, maxVideoSize)
  if (fileSize <= maxVideoSize) {
    const getResponse = await axios.get(redirectedUrl, {
      headers: extraHeaders,
      responseType: 'arraybuffer',
      timeout: timeout,
      signal,
    })
    if (getResponse?.data && getResponse.status === 200) {
      return Buffer.from(getResponse.data)
    } else {
      throw new Error(`Failed to download file. Status: ${getResponse.status}`)
    }
  }

  // Set range headers to download with partial bytes size
  const rangeHeaders = {
    ...extraHeaders,
    Range: `bytes=0-${maxVideoSize - 1}`,
  }

  const partialResponse = await axios.get(redirectedUrl, {
    headers: rangeHeaders,
    responseType: 'arraybuffer',
    timeout: timeout,
    signal,
  })

  if (partialResponse.status === 206 || partialResponse.status === 200) {
    // console.log("Server returned partial content.");
    if (partialResponse?.data) {
      return Buffer.from(partialResponse.data)
    }
    throw new Error(
      `Downloaded part successfully (status ${partialResponse.status}) but no data received.`
    )
  } else if (partialResponse.status === 416) {
    throw new Error('Server does not support Range header request.')
  } else {
    console.error(
      `Failed to download partial file. Status: ${partialResponse.status}. Aborted: ${signal?.aborted}`
    )
    throw new Error(
      `Failed to download partial file. Status: ${partialResponse.status}`
    )
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
  const { response } = await handleRedirects(src, extraHeaders, timeout)

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
    console.error(`Failed to get content info. Status: ${response.status}`)
    throw new Error(`Failed to get content info. Status: ${response.status}`)
  }
}

/**
 * Fetches a video URL and returns the response body as a readable stream.
 * Throws an error on network issues or non-successful HTTP status codes.
 * IMPORTANT: Ensure SSRF protection is applied to the URL *before* calling this.
 * @param {string} url - The validated video URL to fetch.
 * @returns {Promise<ReadableStream>} - A promise resolving to the readable stream.
 */
export async function getVideoStream(
  url,
  extraHeaders = {},
  timeout = 60000,
  signal
) {
  let response
  try {
    response = await axios.get(url, {
      responseType: 'stream',
      timeout: timeout,
      headers: { 'User-Agent': extraHeaders['User-Agent'] },
      maxRedirects: 5, // Follow redirects
      signal,
    })

    // Axios generally throws for >= 400, but explicit check is safe
    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        `Failed to get video stream: HTTP status ${response.status}`
      )
    }

    // CRITICAL: Check content type to ensure it's a video stream or a generic binary stream that might be a video
    const contentType = response.headers['content-type']
    if (
      !contentType ||
      (!contentType.startsWith('video/') &&
        contentType !== 'application/octet-stream')
    ) {
      throw new Error(
        `Invalid content type: Expected video or application/octet-stream, got ${contentType || 'N/A'}`
      )
    }
    // Optional: Consider adding maxContentLength to axios.get options to prevent unbounded downloads
    // maxContentLength: MAX_VIDEO_SIZE_BYTES, // Define MAX_VIDEO_SIZE_BYTES based on MAX_VIDEO_SIZE_MB

    return response.data // response.data is the readable stream
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error(
        `Failed to get video stream: ${error.message} (Status: ${error.response?.status || 'N/A'}). Aborted: ${signal ? signal.aborted : 'N/A'}`
      )
      throw new Error(
        `Failed to get video stream: ${error.message} (Status: ${error.response?.status || 'N/A'})`,
        { cause: error }
      )
    } else {
      console.error(
        `Failed to get video stream: ${error.message}. Aborted: ${signal ? signal.aborted : 'N/A'}`
      )
      throw error // Re-throw other errors
    }
  } finally {
    // Ensure the stream is always destroyed on error or non-success
    if (response?.data && (response.status < 200 || response.status >= 300)) {
      response.data.destroy()
    }
  }
}

/**
 * Reads a readable stream completely into a single Buffer.
 * This is the crucial step to ensure the entire file is in memory before processing.
 * @param {import('stream').Readable} stream - The readable stream to consume.
 * @returns {Promise<Buffer>} A promise that resolves with the full file buffer.
 */
export function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = []
    stream.on('data', (chunk) => {
      chunks.push(chunk)
    })
    stream.on('error', (err) => {
      // This will catch any network errors during the download.
      reject(err)
    })
    stream.on('end', () => {
      // This event only fires when the download is 100% complete.
      resolve(Buffer.concat(chunks))
    })
  })
}

/**
 * Fetches a video URL and returns its complete content as a Buffer.
 * This is the most robust method for handling redirects and ensuring file integrity.
 * @param {string} url - The validated video URL to fetch.
 * @returns {Promise<Buffer>} - A promise resolving to the complete video buffer.
 */
export async function getVideoBuffer(url, extraHeaders = {}, timeout = 30000) {
  try {
    const response = await axios.get(url, {
      // CRITICAL CHANGE: Tell axios to download the whole file and give us a buffer.
      responseType: 'arraybuffer',
      timeout: timeout,
      headers: { 'User-Agent': extraHeaders['User-Agent'] },
      maxRedirects: 5,
    })

    // Axios with arraybuffer gives a Buffer-like object in response.data.
    // We explicitly convert it to a Node.js Buffer for consistency.
    const videoBuffer = Buffer.from(response.data)

    // Optional but good: Check the content-length if available.
    const expectedLength = response.headers['content-length']
    if (expectedLength && videoBuffer.length !== parseInt(expectedLength, 10)) {
      console.warn(
        `Buffer size mismatch for ${url}. Expected ${expectedLength}, Got ${videoBuffer.length}`
      )
    }

    return videoBuffer
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error(
        `Failed to get video buffer: ${error.message} (Status: ${error.response?.status || 'N/A'})`
      )
      throw new Error(
        `Failed to get video buffer: ${error.message} (Status: ${error.response?.status || 'N/A'})`,
        { cause: error }
      )
    } else {
      console.error(`Failed to get video buffer: ${error.message}`)
      throw error
    }
  }
}
