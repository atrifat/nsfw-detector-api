import { to } from 'await-to-js'
import { extractUrl } from './util.mjs'
import { processUrlForPrediction } from './url-processor.mjs'
import { processDataForPrediction } from './data-processor.mjs'

/**
 * Processes a URL for NSFW detection by calling the core processing logic.
 * This function serves as an exported wrapper for `processUrlForPrediction`.
 * @param {string} url - The URL to process.
 * @param {object} dependencies - The dependencies required by `processUrlForPrediction`.
 * @returns {Promise<object>} - The prediction result from `processUrlForPrediction`.
 * @throws {Error} If `processUrlForPrediction` throws an error.
 */
export const processUrl = processUrlForPrediction
export const processData = processDataForPrediction

/**
 * Handles the /predict endpoint for URL-based NSFW detection.
 * @param {object} req - Express request object.
 * @param {object} res - Express response object.
 * @param {object} dependencies - Injected dependencies.
 */
export const predictUrlHandler = async (req, res, dependencies, signal) => {
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
  const [err, result] = await to(
    processUrl(extractedUrl[0], dependencies, signal)
  )

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
