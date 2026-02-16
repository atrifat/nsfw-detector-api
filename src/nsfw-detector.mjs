// This wrapper code is based on the original NsfwSpyJs, modified to support GPU acceleration if available.
import util from 'node:util'

// TODO: Polyfill for util.isNullOrUndefined() which was removed in Node.js 24
// This is a workaround until @tensorflow/tfjs-node-gpu is updated to not use the deprecated util.isNullOrUndefined()
// Consider migrating to a more actively maintained NSFW detection library or TensorFlow backend
if (!util.isNullOrUndefined) {
  util.isNullOrUndefined = (obj) => obj == null
}

import * as tf from '@tensorflow/tfjs-node-gpu'
import * as fs from 'fs/promises'

/**
 * Wrapper class for the NSFW detection model.
 * Provides methods for loading the model and classifying images.
 */
export class NsfwSpy {
  /**
   * The expected image size (width and height) for the model's input.
   * @type {number}
   */
  imageSize

  /**
   * The file path to the model's JSON configuration file.
   * @type {string}
   */
  modelPath

  /**
   * The loaded TensorFlow GraphModel instance.
   * This model is used for performing NSFW classification on images.
   * @type {tf.GraphModel|null}
   */
  model

  /**
   * Creates an instance of NsfwSpy.
   * @param {string} modelPath - The path to the model.json file containing the model's architecture and weights.
   * This path should be relative to the application's root directory or an absolute path.
   */
  constructor(modelPath) {
    this.imageSize = 224
    this.modelPath = modelPath
    this.model = null
  }

  /**
   * Loads the NSFW detection model from the specified modelPath.
   * This method initializes the TensorFlow GraphModel, preparing it for image classification.
   * @param {tf.LoadOptions} [loadOptions] - Optional loading configurations for the TensorFlow model.
   * These options can be used to specify HTTP headers, credentials, or other settings.
   * @returns {Promise<void>} - A promise that resolves when the model is successfully loaded.
   * @throws {Error} If the model fails to load.
   */
  async load(loadOptions) {
    this.model = await tf.loadGraphModel(this.modelPath, loadOptions)
  }

  /**
   * Classifies an image provided as a byte array (Buffer).
   * This method takes an image buffer, decodes it, resizes it to the expected input size,
   * normalizes the pixel values, and then runs the image through the loaded TensorFlow model
   * to obtain NSFW classification scores.
   * @param {Buffer} imageBuffer - The image data as a Buffer. This should be the raw bytes of the image file.
   * @returns {Promise<NsfwSpyResult>} - A promise that resolves with an NsfwSpyResult object containing the classification scores.
   * @throws {Error} If the model has not been loaded.
   */
  async classifyImageFromByteArray(imageBuffer) {
    const outputs = tf.tidy(() => {
      if (!this.model) {
        throw new Error('The NsfwSpy model has not been loaded yet.')
      }

      // Decode, resize, and normalize the image
      const decodedImage = tf.node
        .decodeImage(imageBuffer, 3)
        .toFloat()
        .div(tf.scalar(255))

      const resizedImage = tf.image.resizeBilinear(
        decodedImage,
        [this.imageSize, this.imageSize],
        true
      )
      const image = resizedImage.reshape([1, this.imageSize, this.imageSize, 3])

      // Execute the model
      return this.model.execute({ 'import/input': image }, ['Score'])
    })

    let data
    try {
      data = await outputs.data()
    } finally {
      outputs.dispose()
    }

    // Create and return the result object
    const result = new NsfwSpyResult(data)
    return result
  }

  /**
   * Classifies an image from a file path.
   * This method reads the image file from the given path, converts it to a byte array (Buffer),
   * and then calls the classifyImageFromByteArray method to perform the classification.
   * @param {string} filePath - The path to the image file. This can be a relative or absolute path.
   * @returns {Promise<NsfwSpyResult>} - A promise that resolves with an NsfwSpyResult object containing the classification scores.
   * @throws {Error} If the file does not exist or cannot be read.
   */
  async classifyImageFile(filePath) {
    const imageBuffer = await fs.readFile(filePath)
    return this.classifyImageFromByteArray(imageBuffer)
  }
}

/**
 * Represents the result of an NSFW classification.
 * This class encapsulates the classification scores for different categories
 * (hentai, neutral, pornography, sexy) and provides utility methods for
 * accessing and interpreting the results.
 */
export class NsfwSpyResult {
  /**
   * Score representing the probability of the content being hentai.
   * @type {number}
   */
  hentai = 0.0

  /**
   * Score representing the probability of the content being neutral.
   * @type {number}
   */
  neutral = 0.0

  /**
   * Score representing the probability of the content being pornography.
   * @type {number}
   */
  pornography = 0.0

  /**
   * Score representing the probability of the content being sexy.
   * @type {number}
   */
  sexy = 0.0

  /**
   * The predicted label based on the highest score among all categories.
   * This label indicates the most likely NSFW category for the analyzed content.
   * @type {string}
   */
  predictedLabel = ''

  /**
   * Creates an instance of NsfwSpyResult.
   * @param {number[]} results - An array of classification scores, expected in the order: [hentai, neutral, pornography, sexy].
   * @throws {Error} If the results array is not of the expected length (4).
   */
  constructor(results) {
    this.hentai = results[0]
    this.neutral = results[1]
    this.pornography = results[2]
    this.sexy = results[3]
    this.predictedLabel = this.toDictionary()[0].key
  }

  /**
   * Checks if the content is considered NSFW based on the neutral score.
   * Content is considered NSFW if the neutral score is below 0.5.
   * @type {boolean}
   */
  get isNsfw() {
    return this.neutral < 0.5
  }

  /**
   * Converts the classification scores to a sorted dictionary array.
   * This method transforms the scores into an array of key-value pairs,
   * where each pair represents a category (hentai, neutral, pornography, sexy)
   * and its corresponding score. The array is sorted in descending order based on the scores.
   * @returns {{key: string, value: number}[]} - A sorted array of results, with each element containing the category name (key) and score (value).
   */
  toDictionary() {
    const dictionary = [
      { key: 'hentai', value: this.hentai },
      { key: 'neutral', value: this.neutral },
      { key: 'pornography', value: this.pornography },
      { key: 'sexy', value: this.sexy },
    ]

    return dictionary.sort((a, b) => {
      return b.value - a.value
    })
  }
}
