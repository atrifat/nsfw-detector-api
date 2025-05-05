import { NsfwSpy } from './nsfw-detector.mjs'
import { to } from 'await-to-js'
import { handleFatalError } from './util.mjs'

/**
 * Factory function to create and load an NsfwSpy instance.
 * @param {string} modelPath - The path to the model.json file.
 * @returns {Promise<NsfwSpy>} - A promise that resolves with the loaded NsfwSpy instance.
 */
export const createNsfwSpy = async (modelPath) => {
  const nsfwSpy = new NsfwSpy(modelPath)

  console.time('load model')
  const [err] = await to(nsfwSpy.load())
  handleFatalError(err) // Handle fatal errors during model loading
  console.timeEnd('load model')

  return nsfwSpy
}
