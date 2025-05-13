import * as workerpool from 'workerpool'
import { processImageFile, processImageData } from './image-processor.mjs'

// Expose the classify function to the worker pool
if (!workerpool.isMainThread) {
  try {
    workerpool.worker({
      processImageFile: processImageFile,
      processImageData: processImageData,
    })
  } catch (error) {
    console.error('workerpool worker error', error)
    throw error
  }
}
