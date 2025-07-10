import { LRUCache } from 'lru-cache'
import { config } from './config.mjs'
import {
  createNsfwDetectorWorkerPool,
  createImageProcessingWorkerPool,
  createNsfwSpyInstanceFromWorker,
  createImageProcessingInstanceFromWorker,
} from './nsfw-detector-factory.mjs'

// --- Shared Worker Pools ---
export const nsfwDetectorWorkerPool = await createNsfwDetectorWorkerPool(config)
export const imageProcessingWorkerPool =
  await createImageProcessingWorkerPool(config)

// --- Shared Service Instances from Workers ---
export const nsfwSpy = await createNsfwSpyInstanceFromWorker(
  nsfwDetectorWorkerPool
)
export const imageProcessingInstance =
  await createImageProcessingInstanceFromWorker(imageProcessingWorkerPool)

// --- Shared Caches ---
export const resultCache = new LRUCache({
  max: config.MAX_CACHE_ITEM_NUM,
  ttl: config.CACHE_DURATION_IN_SECONDS * 1000, // time to live in ms
})

// LRU Cache for Mutexes to prevent unbounded growth (solves Issue #1)
export const mutexes = new LRUCache({
  max: config.MUTEX_CACHE_MAX_ITEM_NUM,
  ttl: config.MUTEX_CACHE_TTL_IN_SECONDS * 1000,
})
