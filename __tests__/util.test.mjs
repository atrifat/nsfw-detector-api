import { jest } from '@jest/globals'
import { tmpdir } from 'os'
import { join } from 'path'

describe('util.mjs', () => {
  describe('isContentTypeImageType', () => {
    let util
    beforeAll(async () => {
      util = await import('../src/util.mjs')
    })
    it('should return true for image content types', () => {
      expect(util.isContentTypeImageType('image/jpeg')).toBe(true)
    })
    it('should return false for non-image content types', () => {
      expect(util.isContentTypeImageType('video/mp4')).toBe(false)
      expect(util.isContentTypeImageType('application/json')).toBe(false)
    })
  })

  describe('isContentTypeVideoType', () => {
    let util
    beforeAll(async () => {
      util = await import('../src/util.mjs')
    })
    it('should return true for video content types', () => {
      expect(util.isContentTypeVideoType('video/mp4')).toBe(true)
    })
    it('should return false for non-video content types', () => {
      expect(util.isContentTypeVideoType('image/jpeg')).toBe(false)
      expect(util.isContentTypeVideoType('application/json')).toBe(false)
    })
  })

  describe('getUrlType', () => {
    let util
    beforeAll(async () => {
      util = await import('../src/util.mjs')
    })
    it("should return 'image' for image extensions", () => {
      expect(util.getUrlType('https://example.com/image.png')).toBe('image')
    })
    it("should return 'video' for video extensions", () => {
      expect(util.getUrlType('https://example.com/video.mp4')).toBe('video')
    })
    it("should return 'link' for other extensions", () => {
      expect(util.getUrlType('https://example.com/page.html')).toBe('link')
    })
    it("should return 'link' for URLs without extensions", () => {
      expect(util.getUrlType('https://example.com/resource')).toBe('link')
    })
  })

  describe('extractUrl', () => {
    let util
    beforeAll(async () => {
      util = await import('../src/util.mjs')
    })
    it('should extract a url from a string', () => {
      const url = 'https://example.com'
      const text = `this is a test string with a url: ${url}`
      expect(util.extractUrl(text)).toEqual([url])
    })

    it('should return null if no url is found', () => {
      const text = 'this is a test string without a url'
      expect(util.extractUrl(text)).toBeNull()
    })
  })

  describe('cleanUrlWithoutParam', () => {
    let util
    beforeAll(async () => {
      util = await import('../src/util.mjs')
    })
    it('should remove query parameters from a url', () => {
      const url = 'https://example.com/image.png?foo=bar'
      const expectedUrl = 'https://example.com/image.png'
      expect(util.cleanUrlWithoutParam(url)).toBe(expectedUrl)
    })

    it('should return the original url if it is invalid', () => {
      const consoleErrorSpy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => {})
      const url = 'not a url'
      expect(util.cleanUrlWithoutParam(url)).toBe(url)
      expect(consoleErrorSpy).toHaveBeenCalled()
      consoleErrorSpy.mockRestore()
    })
  })

  describe('handleFatalError', () => {
    let util, process, consoleError

    beforeEach(async () => {
      jest.resetModules()
      jest.unstable_mockModule('process', () => ({
        ...jest.requireActual('process'),
        exit: jest.fn(),
      }))
      util = await import('../src/util.mjs')
      process = await import('process')
      consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => {
      jest.restoreAllMocks()
    })

    it('should do nothing if the error is null', () => {
      util.handleFatalError(null)
      expect(process.exit).not.toHaveBeenCalled()
      expect(consoleError).not.toHaveBeenCalled()
    })

    it('should log an error and exit if the error is not null', () => {
      const error = new Error('Test error')
      util.handleFatalError(error)
      expect(consoleError).toHaveBeenCalledWith('Fatal Error:', error)
      expect(process.exit).toHaveBeenCalledWith(1)
    })
  })

  describe('deleteFile', () => {
    let util, fs
    let tempFilePath

    beforeEach(async () => {
      jest.resetModules()
      jest.unstable_mockModule('node:fs/promises', () => ({
        ...jest.requireActual('node:fs/promises'),
        unlink: jest.fn(),
        writeFile: jest.fn().mockResolvedValue(undefined),
      }))
      util = await import('../src/util.mjs')
      fs = await import('node:fs/promises')
      tempFilePath = join(tmpdir(), `test-file-${Date.now()}.txt`)
      await util.deleteFile(tempFilePath)
    })

    it('should delete an existing file', async () => {
      fs.unlink.mockResolvedValue(true)
      await expect(util.deleteFile(tempFilePath)).resolves.toBe(true)
      expect(fs.unlink).toHaveBeenCalledWith(tempFilePath)
    })

    it('should resolve with false if the file does not exist', async () => {
      const nonExistentFilePath = join(tmpdir(), 'non-existent-file.txt')
      const error = new Error('File not found')
      error.code = 'ENOENT'
      fs.unlink.mockRejectedValueOnce(error)
      await expect(util.deleteFile(nonExistentFilePath)).resolves.toBe(false)
    })

    it('should throw an error if deletion fails for a reason other than not found', async () => {
      fs.unlink.mockRejectedValueOnce(new Error('Permission denied'))
      await expect(util.deleteFile(tempFilePath)).rejects.toThrow(
        'Permission denied'
      )
    })
  })

  describe('moveFile', () => {
    let util, fs
    let srcFilePath, dstFilePath

    beforeEach(async () => {
      jest.resetModules()
      jest.unstable_mockModule('node:fs/promises', () => ({
        ...jest.requireActual('node:fs/promises'),
        rename: jest.fn().mockResolvedValue(undefined),
        writeFile: jest.fn().mockResolvedValue(undefined),
      }))
      util = await import('../src/util.mjs')
      fs = await import('node:fs/promises')
      srcFilePath = join(tmpdir(), `src-file-${Date.now()}.txt`)
      dstFilePath = join(tmpdir(), `dst-file-${Date.now()}.txt`)
      await util.moveFile(srcFilePath, dstFilePath)
    })

    it('should move a file', async () => {
      await util.moveFile(srcFilePath, dstFilePath)
      expect(fs.rename).toHaveBeenCalledWith(srcFilePath, dstFilePath)
    })
  })

  describe('cleanupTemporaryFile', () => {
    let util, fs
    let filename, IMG_DOWNLOAD_PATH

    beforeEach(async () => {
      jest.resetModules()
      jest.unstable_mockModule('node:fs/promises', () => ({
        ...jest.requireActual('node:fs/promises'),
        unlink: jest.fn(),
      }))
      util = await import('../src/util.mjs')
      fs = await import('node:fs/promises')
      filename = `test-file-${Date.now()}`
      IMG_DOWNLOAD_PATH = tmpdir() + '/'
    })

    it('should attempt to delete all temporary files', async () => {
      await util.cleanupTemporaryFile(filename, IMG_DOWNLOAD_PATH)
      expect(fs.unlink).toHaveBeenCalledTimes(3)
    })

    it('should log a warning if a file deletion fails', async () => {
      const consoleWarnSpy = jest
        .spyOn(console, 'warn')
        .mockImplementation(() => {})
      fs.unlink.mockRejectedValue(new Error('Test error'))
      await util.cleanupTemporaryFile(filename, IMG_DOWNLOAD_PATH)
      expect(consoleWarnSpy).toHaveBeenCalledTimes(3)
    })
  })

  describe('runCommand', () => {
    let util, childProcess

    beforeEach(async () => {
      jest.resetModules()
      jest.unstable_mockModule('node:child_process', () => ({
        ...jest.requireActual('node:child_process'),
        spawn: jest.fn(),
      }))
      util = await import('../src/util.mjs')
      childProcess = await import('node:child_process')
    })

    it('should resolve with stdout on successful command execution', async () => {
      const mockSpawn = new (await import('node:events')).EventEmitter()
      mockSpawn.stdout = new (await import('node:events')).EventEmitter()
      mockSpawn.stderr = new (await import('node:events')).EventEmitter()
      childProcess.spawn.mockReturnValue(mockSpawn)
      const promise = util.runCommand('test-command', ['arg1'])
      setTimeout(() => {
        mockSpawn.stdout.emit('data', 'test output')
        mockSpawn.emit('close', 0)
      }, 0)
      await expect(promise).resolves.toBe('test output')
    })

    it('should reject on command error', async () => {
      const mockSpawn = new (await import('node:events')).EventEmitter()
      mockSpawn.stdout = new (await import('node:events')).EventEmitter()
      mockSpawn.stderr = new (await import('node:events')).EventEmitter()
      const testError = new Error('spawn error')
      childProcess.spawn.mockReturnValue(mockSpawn)
      const promise = util.runCommand('test-command', ['arg1'])
      setTimeout(() => {
        mockSpawn.emit('error', testError)
      }, 0)
      await expect(promise).rejects.toThrow(testError)
    })

    it('should reject on non-zero exit code', async () => {
      const mockSpawn = new (await import('node:events')).EventEmitter()
      mockSpawn.stdout = new (await import('node:events')).EventEmitter()
      mockSpawn.stderr = new (await import('node:events')).EventEmitter()
      childProcess.spawn.mockReturnValue(mockSpawn)
      const promise = util.runCommand('test-command', ['arg1'])
      setTimeout(() => {
        mockSpawn.stderr.emit('data', 'test error output')
        mockSpawn.emit('close', 1)
      }, 0)
      await expect(promise).rejects.toThrow(
        'Command failed with code 1.\nStderr: test error output'
      )
    })
  })
})
