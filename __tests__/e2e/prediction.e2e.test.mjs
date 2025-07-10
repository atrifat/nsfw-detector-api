import { jest } from '@jest/globals'

import { NsfwSpy } from '../../src/nsfw-detector.mjs'
import * as imageProcessor from '../../src/image-processor.mjs'
import { predictUrlHandler } from '../../src/prediction-handler.mjs'
import { config } from '../../src/config.mjs'
import { Mutex } from 'async-mutex'
import pLimit from 'p-limit'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Increase the timeout for these E2E tests since they involve network calls and model loading.
jest.setTimeout(60000) // 1 minute

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const modelPath = `file://${path.join(__dirname, '../../models/mobilenet-v1.0.0/model.json')}`

const limit = pLimit(1)

const realDependencies = {
  nsfwSpy: new NsfwSpy(modelPath),
  imageProcessingInstance: imageProcessor,
  resultCache: new Map(),
  mutexes: new Map(),
  config: {
    ...config,
    ENABLE_BUFFER_PROCESSING: true,
    USER_AGENT:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  }, // Use buffer processing and a realistic user agent for E2E
  Mutex: Mutex,
  limit: limit,
}

describe('E2E Prediction Handler', () => {
  beforeAll(async () => {
    // Load the model once for all E2E tests
    await realDependencies.nsfwSpy.load()
  })

  it('should download and classify a real, safe image from a URL', async () => {
    const req = {
      body: {
        url: 'https://i.imgur.com/CzXTtJV.jpg', // A more reliable public image
      },
    }
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    }

    await predictUrlHandler(req, res, realDependencies)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({
      data: expect.objectContaining({
        neutral: expect.any(Number),
        sexy: expect.any(Number),
        pornography: expect.any(Number),
        hentai: expect.any(Number),
        predictedLabel: expect.any(String),
      }),
    })
    // It's a cat, so it should be classified as neutral/sfw
    const result = res.json.mock.calls[0][0].data
    expect(result.predictedLabel).toBe('neutral')
  })

  it('should download and classify a real, safe video from a URL', async () => {
    const req = {
      body: {
        url: 'https://raw.githubusercontent.com/mediaelement/mediaelement-files/master/big_buck_bunny.mp4',
      },
    }
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    }

    await predictUrlHandler(req, res, realDependencies)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({
      data: expect.objectContaining({
        neutral: expect.any(Number),
        sexy: expect.any(Number),
        pornography: expect.any(Number),
        hentai: expect.any(Number),
        predictedLabel: expect.any(String),
      }),
    })
    // It's Big Buck Bunny, so it should be classified as neutral/sfw
    const result = res.json.mock.calls[0][0].data
    expect(result.predictedLabel).toBe('neutral')
  })
})
