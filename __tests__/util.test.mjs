import {
  isContentTypeImageType,
  isContentTypeVideoType,
  getUrlType,
  extractUrl,
  cleanUrlWithoutParam,
  deleteFile,
  moveFile,
  runCommand,
  cleanupTemporaryFile,
} from '../src/util.mjs'
import * as fs from 'node:fs'
import { tmpdir } from 'os'
import { join } from 'path'

describe('util.mjs', () => {
  describe('isContentTypeImageType', () => {
    it('should return true for image content types', () => {
      expect(isContentTypeImageType('image/jpeg')).toBe(true)
      expect(isContentTypeImageType('image/png')).toBe(true)
      expect(isContentTypeImageType('image/gif')).toBe(true)
    })

    it('should return false for non-image content types', () => {
      expect(isContentTypeImageType('video/mp4')).toBe(false)
      expect(isContentTypeImageType('text/html')).toBe(false)
      expect(isContentTypeImageType('application/json')).toBe(false)
    })
  })

  describe('isContentTypeVideoType', () => {
    it('should return true for video content types', () => {
      expect(isContentTypeVideoType('video/mp4')).toBe(true)
      expect(isContentTypeVideoType('video/webm')).toBe(true)
      expect(isContentTypeVideoType('video/quicktime')).toBe(true)
    })

    it('should return false for non-video content types', () => {
      expect(isContentTypeVideoType('image/jpeg')).toBe(false)
      expect(isContentTypeVideoType('text/html')).toBe(false)
      expect(isContentTypeVideoType('application/json')).toBe(false)
    })
  })

  describe('getUrlType', () => {
    it("should return 'image' for image extensions", () => {
      expect(getUrlType('https://example.com/image.png')).toBe('image')
      expect(getUrlType('https://example.com/image.jpg')).toBe('image')
      expect(getUrlType('https://example.com/image.jpeg')).toBe('image')
      expect(getUrlType('https://example.com/image.gif')).toBe('image')
      expect(getUrlType('https://example.com/image.webp')).toBe('image')
    })

    it("should return 'video' for video extensions", () => {
      expect(getUrlType('https://example.com/video.mp4')).toBe('video')
      expect(getUrlType('https://example.com/video.mov')).toBe('video')
      expect(getUrlType('https://example.com/video.wmv')).toBe('video')
      expect(getUrlType('https://example.com/video.webm')).toBe('video')
      expect(getUrlType('https://example.com/video.avi')).toBe('video')
      expect(getUrlType('https://example.com/video.mkv')).toBe('video')
    })

    it("should return 'link' for other extensions", () => {
      expect(getUrlType('https://example.com/page.html')).toBe('link')
      expect(getUrlType('https://example.com/document.pdf')).toBe('link')
    })

    it("should return 'link' for URLs without extensions", () => {
      expect(getUrlType('https://example.com/resource')).toBe('link')
    })
  })

  describe('extractUrl', () => {
    it('should extract URLs from text', () => {
      const text = 'This is a text with a URL: https://example.com'
      const urls = extractUrl(text)
      expect(urls).toEqual(['https://example.com'])
    })

    it('should return null if no URLs are found', () => {
      const text = 'This is a text without URLs'
      const urls = extractUrl(text)
      expect(urls).toBe(null)
    })
  })

  describe('cleanUrlWithoutParam', () => {
    it('should remove query parameters from a URL', () => {
      const url = 'https://example.com/path?param1=value1&param2=value2'
      const cleanedUrl = cleanUrlWithoutParam(url)
      expect(cleanedUrl).toBe('https://example.com/path')
    })

    it('should return the original URL if it has no query parameters', () => {
      const url = 'https://example.com/path'
      const cleanedUrl = cleanUrlWithoutParam(url)
      expect(cleanedUrl).toBe('https://example.com/path')
    })

    it('should return the original URL if parsing fails', () => {
      const url = 'invalid-url'
      const cleanedUrl = cleanUrlWithoutParam(url)
      expect(cleanedUrl).toBe('invalid-url')
    })
  })

  describe('deleteFile', () => {
    let tempFilePath

    beforeEach(() => {
      tempFilePath = join(tmpdir(), `test-file-${Date.now()}.txt`)
      fs.writeFileSync(tempFilePath, 'test content')
    })

    afterEach(async () => {
      try {
        await deleteFile(tempFilePath)
      } catch {
        // Ignore errors during cleanup
      }
    })

    it('should delete an existing file', async () => {
      const result = await deleteFile(tempFilePath)
      expect(result).toBe(true)
      expect(fs.existsSync(tempFilePath)).toBe(false)
    })

    it('should resolve with false if the file does not exist', async () => {
      const nonExistentFilePath = join(
        tmpdir(),
        `non-existent-file-${Date.now()}.txt`
      )
      const result = await deleteFile(nonExistentFilePath)
      expect(result).toBe(false)
    })
  })

  describe('moveFile', () => {
    let srcFilePath
    let dstFilePath

    beforeEach(() => {
      srcFilePath = join(tmpdir(), `src-file-${Date.now()}.txt`)
      dstFilePath = join(tmpdir(), `dst-file-${Date.now()}.txt`)
      fs.writeFileSync(srcFilePath, 'test content')
    })

    afterEach(async () => {
      try {
        await deleteFile(srcFilePath)
        await deleteFile(dstFilePath)
      } catch {
        // Ignore errors during cleanup
      }
    })

    it('should move an existing file', async () => {
      const result = await moveFile(srcFilePath, dstFilePath)
      expect(result).toBe(true)
      expect(fs.existsSync(srcFilePath)).toBe(false)
      expect(fs.existsSync(dstFilePath)).toBe(true)
    })

    it('should reject if the source file does not exist', async () => {
      const nonExistentFilePath = join(
        tmpdir(),
        `non-existent-file-${Date.now()}.txt`
      )
      await expect(moveFile(nonExistentFilePath, dstFilePath)).rejects.toThrow()
    })
  })

  describe('runCommand', () => {
    it('should resolve with the stdout of the command on success', async () => {
      const command = 'echo'
      const args = ['hello world']
      const stdout = await runCommand(command, args)
      expect(stdout.trim()).toBe('hello world')
    })

    it('should reject if the command fails', async () => {
      const command = 'nonexistent-command'
      const args = []
      await expect(runCommand(command, args)).rejects.toThrow()
    })
  })

  describe('cleanupTemporaryFile', () => {
    let filename
    let IMG_DOWNLOAD_PATH

    beforeEach(() => {
      filename = `test-file-${Date.now()}`
      IMG_DOWNLOAD_PATH = tmpdir() + '/'
      fs.writeFileSync(
        IMG_DOWNLOAD_PATH + filename + '_' + 'image',
        'image content'
      )
      fs.writeFileSync(
        IMG_DOWNLOAD_PATH + filename + '_' + 'video',
        'video content'
      )
      fs.writeFileSync(
        IMG_DOWNLOAD_PATH + filename + '_' + 'final',
        'final content'
      )
    })

    afterEach(async () => {
      try {
        await deleteFile(IMG_DOWNLOAD_PATH + filename + '_' + 'image')
        await deleteFile(IMG_DOWNLOAD_PATH + filename + '_' + 'video')
        await deleteFile(IMG_DOWNLOAD_PATH + filename + '_' + 'final')
      } catch {
        // Ignore errors during cleanup
      }
    })

    it('should attempt to delete all temporary files', async () => {
      const result = await cleanupTemporaryFile(filename, IMG_DOWNLOAD_PATH)
      expect(result).toBe(true)
      expect(fs.existsSync(IMG_DOWNLOAD_PATH + filename + '_' + 'image')).toBe(
        false
      )
      expect(fs.existsSync(IMG_DOWNLOAD_PATH + filename + '_' + 'video')).toBe(
        false
      )
      expect(fs.existsSync(IMG_DOWNLOAD_PATH + filename + '_' + 'final')).toBe(
        false
      )
    })
  })
})
