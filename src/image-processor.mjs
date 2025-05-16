import sharp from 'sharp'
import { to } from 'await-to-js'

/**
 * @typedef {object} ImageProcessingOutputInfo
 * @property {string} format - The output image format.
 * @property {number} size - The output image size in bytes.
 * @property {number} width - The output image width in pixels.
 * @property {number} height - The output image height in pixels.
 * @property {number} channels - The number of channels in the output image.
 * @property {boolean} premultiplied - Whether the image is premultiplied.
 */
/**
 * Processes an image file by resizing and converting it to JPEG format.
 * @param {string} filePath - The path to the input image file.
 * @param {string} outputPath - The path to save the processed output image file.
 * @returns {Promise<ImageProcessingOutputInfo>} - A promise that resolves with information about the output image.
 * @throws {Error} If image processing fails.
 */
export const processImageFile = async (filePath, outputPath) => {
  const img = sharp(filePath)

  // Optional: Load metadata for debugging
  const [metadataErr] = await to(img.metadata())
  if (metadataErr) {
    console.warn(
      `Failed to get image metadata for ${filePath}: ${metadataErr.message}`
    )
  }

  // Resize to 224 px (model input size), convert to JPEG, and save
  const [processErr, outputInfo] = await to(
    img.resize(224).jpeg().withMetadata().toFile(outputPath)
  )

  if (processErr) {
    throw new Error(
      `Failed to process image file ${filePath}: ${processErr.message}`
    )
  }

  return outputInfo
}

/**
 * Processes image data from a buffer by resizing and converting it to JPEG format.
 * @param {Buffer} buffer - The input image data buffer.
 * @returns {Promise<Buffer>} - A promise that resolves with the processed image buffer.
 * @throws {Error} If image data processing fails.
 */
export const processImageData = async (buffer) => {
  const img = sharp(buffer)

  // Optional: Load metadata for debugging
  const [metadataErr] = await to(img.metadata())
  if (metadataErr) {
    console.warn(
      `Failed to get image metadata from buffer: ${metadataErr.message}`
    )
  }

  console.time('Preprocess Image Data')
  // Resize to 224 px (model input size), convert to JPEG, and save
  const [processErr, processedBuffer] = await to(
    img.resize(224).jpeg().withMetadata().toBuffer()
  )
  if (processErr) {
    throw new Error(`Failed to process image data: ${processErr.message}`)
  }
  console.timeEnd('Preprocess Image Data')

  return processedBuffer
}
