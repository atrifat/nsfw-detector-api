import urlRegexSafe from 'url-regex-safe'
import { to } from 'await-to-js'
import * as fs from 'node:fs/promises'
import { exit } from 'process'
import { spawn } from 'node:child_process'

/**
 * Checks if a given content type string indicates an image type.
 * @param {string} contentType - The content type string.
 * @returns {boolean} - True if the content type includes "image", false otherwise.
 */
export const isContentTypeImageType = function (contentType) {
  return contentType.includes('image')
}

/**
 * Checks if a given content type string indicates a video type.
 * @param {string} contentType - The content type string.
 * @returns {boolean} - True if the content type includes "video", false otherwise.
 */
export const isContentTypeVideoType = function (contentType) {
  return contentType.includes('video')
}

/**
 * Determines the type of content based on the URL extension.
 * Code is modified based on https://github.com/haorendashu/nostrmo/blob/main/lib/component/content/content_decoder.dart#L505
 * @param {string} path - The URL path.
 * @returns {"image" | "video" | "link" | "unknown"} - The determined content type.
 */
export const getUrlType = function (path) {
  const parts = path.split('?')
  const pathWithoutParams = parts[0]
  const lastDotIndex = pathWithoutParams.lastIndexOf('.')

  if (lastDotIndex === -1) {
    return 'unknown'
  }

  const extension = pathWithoutParams.substring(lastDotIndex).toLowerCase()

  if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(extension)) {
    return 'image'
  } else if (
    ['.mp4', '.mov', '.wmv', '.webm', '.avi', '.mkv'].includes(extension)
  ) {
    return 'video'
  } else {
    return 'link'
  }
}

/**
 * Extracts URLs from a given text string.
 * @param {string} text - The input text.
 * @returns {string[] | null} - An array of extracted URLs or null if none are found.
 */
export const extractUrl = function (text) {
  const matches = text.match(
    urlRegexSafe({ strict: true, localhost: false, returnString: false })
  )

  return matches
}

/**
 * Cleans a URL by removing query parameters.
 * @param {string} url - The input URL.
 * @returns {string} - The URL without query parameters.
 */
export const cleanUrlWithoutParam = function (url) {
  try {
    const newUrl = new URL(url)
    newUrl.search = ''
    return newUrl.toString()
  } catch (error) {
    console.error(`Error cleaning URL: ${error.message}`)
    return url // Return original URL if parsing fails
  }
}

/**
 * Handles fatal errors by logging the error and exiting the process.
 * @param {Error | null | undefined} err - The error to handle.
 */
export const handleFatalError = function (err) {
  if (err) {
    console.error('Fatal Error:', err)
    // force exit
    exit(1)
  }
}

/**
 * Deletes a file asynchronously.
 * @param {string} filePath - The path to the file to delete.
 * @returns {Promise<boolean>} - A promise that resolves to true on successful deletion.
 * @throws {Error} If the file deletion fails.
 */
export async function deleteFile(filePath) {
  try {
    await fs.unlink(filePath)
    return true // Indicate successful deletion
  } catch (err) {
    // Ignore file not found errors during cleanup
    if (err.code === 'ENOENT') {
      return false // Indicate file was not found
    } else {
      throw err
    }
  }
}

/**
 * Moves a file asynchronously.
 * @param {string} srcPath - The source path of the file.
 * @param {string} dstPath - The destination path for the file.
 * @returns {Promise<boolean>} - A promise that resolves to true on successful move.
 * @throws {Error} If the file move fails.
 */
export async function moveFile(srcPath, dstPath) {
  await fs.rename(srcPath, dstPath)
  return true
}

/**
 * Runs a command as a child process and returns its stdout.
 * @param {string} command - The command to run.
 * @param {string[]} args - Arguments for the command.
 * @param {object} [options] - Options for the child process.
 * @returns {Promise<string>} - A promise that resolves with the stdout of the command on success.
 * @throws {Error} If the command fails or exits with a non-zero code.
 */
export async function runCommand(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options)

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    child.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout)
      } else {
        reject(
          new Error(`Command failed with code ${code}.\nStderr: ${stderr}`)
        )
      }
    })

    child.on('error', (error) => {
      reject(error)
    })
  })
}

/**
 * Cleans up temporary files associated with a given filename.
 * @param {string} filename - The base filename.
 * @param {string} IMG_DOWNLOAD_PATH - Directory for temporary files.
 * @returns {Promise<boolean>} - True if cleanup is attempted.
 */
export const cleanupTemporaryFile = async (filename, IMG_DOWNLOAD_PATH) => {
  const filesToDelete = [
    IMG_DOWNLOAD_PATH + filename + '_' + 'image',
    IMG_DOWNLOAD_PATH + filename + '_' + 'video',
    IMG_DOWNLOAD_PATH + filename + '_' + 'final',
  ]

  for (const file of filesToDelete) {
    const [err] = await to(deleteFile(file))
    if (err) {
      // Log as a warning since cleanup failure is not a critical app-breaking error,
      // but it is important to know about.
      console.warn(
        `[Cleanup Warning] Failed to delete temporary file ${file}: ${err.message}`
      )
    }
  }
  return true
}
