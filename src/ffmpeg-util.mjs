import * as ffmpeg from '@ffmpeg-installer/ffmpeg'
import { runCommand } from './util.mjs'
import { spawn } from 'node:child_process'
import { Readable, pipeline } from 'node:stream'

/**
 * Generates a screenshot from a video file using FFmpeg.
 * @param {string} inputFile - The path to the input video file.
 * @param {string} outputFile - The path to save the output screenshot image.
 * @param {string} [ffmpegPath=''] - The path to the FFmpeg binary. Defaults to the installed ffmpeg path.
 * @returns {Promise<boolean>} - A promise that resolves to true on successful screenshot generation, false otherwise.
 */
export const generateScreenshot = async (
  inputFile,
  outputFile,
  ffmpegPath = ''
) => {
  try {
    const ffmpegBinary = ffmpegPath !== '' ? ffmpegPath : ffmpeg.path
    // FFmpeg command to generate a single screenshot at 1 second
    const args = [
      '-ignore_unknown', // Ignore unknown stream types
      '-y', // Overwrite output files without asking
      '-an', // Disable audio
      '-dn', // Disable data
      '-ss',
      '00:00:01', // Seek to 1 second
      '-i',
      inputFile, // Input file
      '-update',
      1, // Write only one frame
      '-frames:v',
      1, // Output only one video frame
      outputFile, // Output file
    ]

    await runCommand(ffmpegBinary, args, { timeout: 15000 }) // Set a 15-second timeout
    return true
  } catch (err) {
    console.error(
      `Error generating screenshot: ${err.message}. Aborted: ${err.code === 'ABORT_ERR'}`
    )
    return false
  }
}

// Promisify the pipeline function for cleaner async/await usage if preferred,
// but the callback pattern is excellent for this specific EPIPE case.

/**
 * @typedef {object} ScreenshotOptions
 * @property {string} [seekTime='00:00:01.000'] - The timestamp to seek to in the video (HH:mm:ss.SSS format).
 * @property {number} [timeout=15000] - The maximum time in milliseconds to allow the FFmpeg process to run.
 */

/**
 * Generates a screenshot from a video Buffer using the reliable "fast seek" method.
 * This is the correct function for processing a complete, in-memory file.
 *
 * @param {Buffer} videoBuffer - The complete video content as a Buffer.
 * @param {string} ffmpegPath - The path to the FFmpeg executable.
 * @param {object} options - Optional settings.
 * @returns {Promise<Buffer>} - A promise that resolves with the screenshot buffer.
 */
export function generateScreenshotFromBuffer(
  videoBuffer,
  ffmpegPath,
  options = {}
) {
  const { seekTime = '00:00:01.000', timeout = 15000, signal } = options
  // Use robust seek args, consistent with the streaming function
  const ffmpegArgs = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    'pipe:0',
    '-ss',
    seekTime,
    '-y',
    '-an',
    '-dn',
    '-frames:v',
    '1',
    '-f',
    'image2pipe',
    '-vcodec',
    'mjpeg',
    'pipe:1',
  ]

  return new Promise((resolve, reject) => {
    const ffmpegProcess = spawn(ffmpegPath, ffmpegArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      signal,
    })

    const bufferStream = Readable.from(videoBuffer) // The stream comes from the complete buffer

    // ... The rest of the promise and event handling logic from your
    // ... working buffer-based function remains exactly the same.
    // ... (It correctly pipes the bufferStream, captures output/error, and handles exit)

    let outputBuffer = Buffer.alloc(0)
    let stderrOutput = ''
    let processError = null

    const cleanup = (error) => {
      if (error && !processError) processError = error
      if (!bufferStream.destroyed) bufferStream.destroy()
      if (ffmpegProcess.stdout && !ffmpegProcess.stdout.destroyed)
        ffmpegProcess.stdout.destroy()
      if (ffmpegProcess.stderr && !ffmpegProcess.stderr.destroyed)
        ffmpegProcess.stderr.destroy()
      if (!ffmpegProcess.killed) ffmpegProcess.kill('SIGKILL')
    }

    const timeoutHandle = setTimeout(() => {
      cleanup(new Error(`FFmpeg process timed out after ${timeout}ms.`))
    }, timeout)

    pipeline(bufferStream, ffmpegProcess.stdin, (err) => {
      if (processError) return // Don't log pipeline errors if a timeout or other error has already been handled.
      // EPIPE is still possible if FFmpeg finds the frame and exits before the buffer is fully written.
      // It's less likely with this command structure but still a "safe" error.
      if (err && err.code !== 'EPIPE') {
        console.error('Unexpected buffer pipeline error:', err)
        cleanup(err)
      }
    })

    ffmpegProcess.stdout.on(
      'data',
      (data) => (outputBuffer = Buffer.concat([outputBuffer, data]))
    )
    ffmpegProcess.stderr.on('data', (data) => (stderrOutput += data.toString()))
    ffmpegProcess.on('error', (err) => {
      console.error(
        `FFmpeg process error: ${err.message}. Aborted: ${signal?.aborted}`
      )
      cleanup(err)
    })

    ffmpegProcess.on('close', (code) => {
      clearTimeout(timeoutHandle)
      if (processError) return reject(processError)
      if (code === 0) {
        if (outputBuffer.length === 0) {
          reject(
            new Error(
              `FFmpeg exited successfully but produced no output. Stderr: ${stderrOutput}`
            )
          )
        } else {
          resolve(outputBuffer)
        }
      } else {
        reject(
          new Error(
            `FFmpeg process exited with code ${code}. Stderr: ${stderrOutput}`
          )
        )
      }
    })
  })
}

/**
 * Generates a screenshot by piping a video stream directly into FFmpeg.
 * This is the most efficient method as it does not require downloading the entire file first.
 * It now includes debugging output for the number of bytes consumed by FFmpeg.
 *
 * @param {import('stream').Readable} videoStream - A readable stream of the video data.
 * @param {string} ffmpegPath - The path to the FFmpeg executable.
 * @param {ScreenshotOptions} [options={}] - Optional settings for the screenshot generation.
 * @returns {Promise<Buffer>} A promise that resolves with the screenshot image data.
 */
export function generateScreenshotFromStream(
  videoStream,
  ffmpegPath,
  options = {}
) {
  const { seekTime = '00:00:01.000', timeout = 15000, signal } = options

  // Arguments are optimized for robustly seeking on a stream.
  const ffmpegArgs = [
    '-ignore_unknown',
    '-hide_banner',
    '-loglevel',
    'error',
    // Input must come first for this method.
    '-i',
    'pipe:0',
    // Seek *after* the input to decode from the start of the stream.
    '-ss',
    seekTime,
    '-y',
    '-an',
    '-dn',
    '-frames:v',
    '1',
    '-f',
    'image2pipe',
    '-vcodec',
    'mjpeg',
    'pipe:1',
  ]

  return new Promise((resolve, reject) => {
    const ffmpegProcess = spawn(ffmpegPath, ffmpegArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      signal,
    })

    let outputBuffer = Buffer.alloc(0)
    let stderrOutput = ''
    let processError = null
    // <<< CHANGE #1: Declare a variable to hold the final byte count.
    let bytesConsumed = 0

    const cleanup = (error) => {
      if (error && !processError) {
        processError = error
      }
      if (!videoStream.destroyed) {
        videoStream.destroy()
      }
      if (ffmpegProcess.stdout && !ffmpegProcess.stdout.destroyed) {
        ffmpegProcess.stdout.destroy()
      }
      if (ffmpegProcess.stderr && !ffmpegProcess.stderr.destroyed) {
        ffmpegProcess.stderr.destroy()
      }
      if (!ffmpegProcess.killed) {
        ffmpegProcess.kill('SIGKILL')
      }
    }

    const timeoutHandle = setTimeout(() => {
      cleanup(new Error(`FFmpeg process timed out after ${timeout}ms.`))
    }, timeout)
    const expectedErrors = ['EPIPE', 'ECONNRESET']
    // Pipe the source video stream directly to FFmpeg's standard input.
    pipeline(videoStream, ffmpegProcess.stdin, (err) => {
      if (processError) return // Don't log pipeline errors if a timeout or other error has already been handled.
      // EPIPE and ECONNRESET is the expected error when FFmpeg closes the stream after getting the frame.
      // We treat it as a success for the pipeline and let the 'close' event decide the final outcome.
      if (err && !expectedErrors.includes(err.code)) {
        console.error('Unexpected stream pipeline error:', err)
        cleanup(err)
      }
    })

    ffmpegProcess.stdout.on('data', (data) => {
      outputBuffer = Buffer.concat([outputBuffer, data])
    })
    ffmpegProcess.stderr.on('data', (data) => {
      stderrOutput += data.toString()
    })
    ffmpegProcess.on('error', (err) => {
      console.error(
        `FFmpeg process error: ${err.message}. Aborted: ${signal?.aborted}`
      )
      cleanup(err)
    })

    // The 'close' event is the single source of truth for the final outcome.
    ffmpegProcess.on('close', (code) => {
      clearTimeout(timeoutHandle)

      // <<< CHANGE #2: Capture the byte count and log it for debugging.
      // This is read from the `stdin` stream of the child process.
      bytesConsumed = ffmpegProcess.stdin.bytesWritten
      console.debug(
        `[DEBUG] Bytes consumed by FFmpeg: ${bytesConsumed} bytes (${(bytesConsumed / (1024 * 1024)).toFixed(2)} MB)`
      )

      if (processError) return reject(processError)

      if (code === 0) {
        if (outputBuffer.length === 0) {
          reject(
            new Error(
              `FFmpeg exited successfully but produced no output. Stderr: ${stderrOutput}`
            )
          )
        } else {
          resolve(outputBuffer)
        }
      } else {
        reject(
          new Error(
            `FFmpeg process exited with code ${code}. Stderr: ${stderrOutput}`
          )
        )
      }
    })
  })
}
