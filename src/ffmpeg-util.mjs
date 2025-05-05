import * as ffmpeg from '@ffmpeg-installer/ffmpeg'
import { runCommand } from './util.mjs'

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

    await runCommand(ffmpegBinary, args)
    return true
  } catch (err) {
    console.error(`Error generating screenshot: ${err.message}`)
    return false
  }
}
