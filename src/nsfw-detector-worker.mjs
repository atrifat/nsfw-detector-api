import * as workerpool from 'workerpool'
import { createNsfwSpy } from './nsfw-detector-factory.mjs'

const nsfwSpy = await createNsfwSpy('file://models/mobilenet-v1.0.0/model.json')

async function classifyImageFile(imagePath) {
  const result = await nsfwSpy.classifyImageFile(imagePath)
  return result
}

// Expose the classify function to the worker pool
if (!workerpool.isMainThread) {
  workerpool.worker({
    classifyImageFile: classifyImageFile,
  })
}
