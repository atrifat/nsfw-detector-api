import express from 'express'
import bodyparser from 'body-parser'
import { cleanupTemporaryFile } from './util.mjs'
import { predictUrlHandler, predictDataHandler } from './prediction-handler.mjs'
import { Mutex } from 'async-mutex'
import bearerToken from 'express-bearer-token'
import { config } from './config.mjs'
import {
  nsfwDetectorWorkerPool,
  imageProcessingWorkerPool,
  nsfwSpy,
  imageProcessingInstance,
  resultCache,
  mutexes,
} from './resources.mjs'
import { z } from 'zod' // Import Zod
import pLimit from 'p-limit'

// --- Global Concurrency Limiter ---
const limit = pLimit(config.VIDEO_PROCESSING_CONCURRENCY)

const app = express()

// Middleware to parse JSON request bodies
app.use(bodyparser.json({ limit: '5mb' }))

/**
 * Middleware to log incoming requests.
 * @param {object} req - Express request object.
 * @param {object} _res - Express response object (unused).
 * @param {function} next - The next middleware function.
 */
const requestLogger = function (req, _res, next) {
  console.info(`${req.method} request to "${req.url}" by ${req.hostname}`)
  next()
}

app.use(requestLogger)

/**
 * Simple authentication middleware using bearer token.
 * Checks for the presence and validity of an API token if ENABLE_API_TOKEN is true.
 * @param {object} req - Express request object. Expected to have a `req.token` property from `express-bearer-token`.
 * @param {object} res - Express response object.
 * @param {function} next - The next middleware function.
 * @returns {object|void} - Returns a 401 JSON response if authentication fails, otherwise proceeds to the next middleware.
 */
const authMiddleware = function (req, res, next) {
  if (config.ENABLE_API_TOKEN) {
    const token = typeof req.token !== 'undefined' ? req.token : null
    if (!token) {
      const error = new Error('Missing API token')
      error.statusCode = 401
      return res.status(401).json({ message: error.message })
    }

    if (config.API_TOKEN !== token) {
      const error = new Error('Invalid API token')
      error.statusCode = 401
      return res.status(401).json({ message: error.message })
    }
  }
  next()
}

// Extract bearer token from Authorization header
app.use(bearerToken())

// Apply authentication middleware
app.use(authMiddleware)

/**
 * Zod schema for validating the request body of the /predict endpoint.
 * Ensures the presence and correct format of the 'url' field.
 */
const predictUrlSchema = z.object({
  url: z.string().url('Invalid URL format'),
})

/**
 * Zod schema for validating the request body of the /predict_data endpoint.
 * Ensures the presence and non-empty nature of the 'data' field.
 */
const predictDataSchema = z.object({
  data: z.string().min(1, 'Data cannot be empty'),
})

/**
 * Middleware factory to validate request bodies against a given Zod schema.
 * @param {z.ZodSchema} schema - The Zod schema to validate against.
 * @returns {function(object, object, function): object|void} - The middleware function.
 */
const validateRequest = (schema) => (req, res, next) => {
  try {
    schema.parse(req.body)
    next()
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res
        .status(400)
        .json({ message: 'Validation failed', errors: error.errors })
    }
    next(error) // Pass other errors to the next error handler
  }
}

/**
 * Handles the root endpoint and returns a welcome message.
 * @param {object} req - Express request object.
 * @param {object} res - Express response object.
 */
app.get('/', (req, res) => {
  res.status(200).json({
    data: 'A PoC of NSFW detector, send your post url data to /predict to get prediction result',
  })
})

/**
 * Handles the /predict endpoint for URL-based NSFW detection.
 * @param {object} req - Express request object.
 * @param {object} res - Express response object.
 */
app.post('/predict', validateRequest(predictUrlSchema), async (req, res) => {
  const abortController = new AbortController()
  req.on('close', () => {
    if (!res.writableEnded) {
      abortController.abort()
      console.log('Client disconnected, aborting request.')
    }
  })

  await predictUrlHandler(
    req,
    res,
    {
      nsfwSpy,
      imageProcessingInstance,
      resultCache,
      mutexes,
      limit,
      config,
      cleanupTemporaryFile,
      Mutex,
    },
    abortController.signal
  )
})

/**
 * Handles the /predict_data endpoint for base64 image data NSFW detection.
 * @param {object} req - Express request object.
 * @param {object} res - Express response object.
 */
app.post(
  '/predict_data',
  validateRequest(predictDataSchema),
  async (req, res) => {
    await predictDataHandler(req, res, {
      nsfwSpy,
      imageProcessingInstance,
      resultCache,
      config, // Pass the config object
      cleanupTemporaryFile, // Although not strictly needed in predictDataHandler, keeping consistent
    })
  }
)

// Graceful shutdown
const gracefulShutdown = async () => {
  console.log('Shutting down gracefully...')
  await Promise.allSettled([
    nsfwDetectorWorkerPool.terminate(false, 2000),
    imageProcessingWorkerPool.terminate(false, 2000),
  ])
  console.log('NSFW detector worker pool terminated.')
  console.log('Image processing worker pool terminated.')
  process.exit(0)
}

process.on('SIGTERM', gracefulShutdown)
process.on('SIGINT', gracefulShutdown) // Ctrl+C

// Start the Express server
app.listen(config.PORT, () => {
  console.log(`Listening on port ${config.PORT} ...`)
})
