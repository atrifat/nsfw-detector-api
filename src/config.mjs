import * as ffmpeg from '@ffmpeg-installer/ffmpeg'
import * as dotenv from 'dotenv'

// Load environment variables from .env file
dotenv.config()

// Parse MIN_WORKERS first as it's a fallback for MAX_WORKERS
const minWorkers = parseInt(process.env.WORKER_POOL_MIN_WORKERS || 2)

/**
 * Application configuration object.
 */
export const config = {
  IMG_DOWNLOAD_PATH: process.env.IMG_DOWNLOAD_PATH ?? '/tmp/',
  CACHE_DURATION_IN_SECONDS: parseInt(
    process.env.CACHE_DURATION_IN_SECONDS || 86400
  ),
  MAX_CACHE_ITEM_NUM: parseInt(process.env.MAX_CACHE_ITEM_NUM || 200000),
  PORT: process.env.PORT || 8081,
  ENABLE_API_TOKEN: process.env.ENABLE_API_TOKEN
    ? process.env.ENABLE_API_TOKEN === 'true'
    : false,
  API_TOKEN: process.env.API_TOKEN || 'myapitokenchangethislater', // TODO: Change this default token
  ENABLE_CONTENT_TYPE_CHECK: process.env.ENABLE_CONTENT_TYPE_CHECK
    ? process.env.ENABLE_TYPE_CHECK === 'true'
    : false,
  FFMPEG_PATH: process.env.FFMPEG_PATH || ffmpeg.path,
  MAX_VIDEO_SIZE_MB: parseInt(process.env.MAX_VIDEO_SIZE_MB || 100),
  REQUEST_TIMEOUT_IN_SECONDS: parseInt(
    process.env.REQUEST_TIMEOUT_IN_SECONDS || 60
  ),
  USER_AGENT:
    process.env.USER_AGENT ||
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
  WORKER_POOL_MIN_WORKERS: minWorkers, // Use the parsed value
  // Implement the fallback logic for MAX_WORKERS
  WORKER_POOL_MAX_WORKERS: parseInt(
    process.env.WORKER_POOL_MAX_WORKERS || minWorkers
  ),
  ENABLE_BUFFER_PROCESSING: process.env.ENABLE_BUFFER_PROCESSING
    ? process.env.ENABLE_BUFFER_PROCESSING === 'true'
    : false,
  VIDEO_PROCESSING_CONCURRENCY: parseInt(
    process.env.VIDEO_PROCESSING_CONCURRENCY || 10
  ),
  MUTEX_CACHE_MAX_ITEM_NUM: parseInt(
    process.env.MUTEX_CACHE_MAX_ITEM_NUM || 5000
  ),
  MUTEX_CACHE_TTL_IN_SECONDS: parseInt(
    process.env.MUTEX_CACHE_TTL_IN_SECONDS || 600
  ),
}
