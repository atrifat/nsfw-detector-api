import {
  getContentInfo,
  downloadFile,
  downloadPartFile,
} from '../src/download.mjs'
import axios from 'axios'
import mime from 'mime'
import { PassThrough } from 'stream'

jest.mock('axios')
jest.mock('mime')

import * as fs from 'node:fs'

jest.mock('node:fs', () => ({
  ...jest.requireActual('node:fs'),
  createWriteStream: jest.fn(),
}))

// Define the mock function without internal logic
const mockHandleRedirects = jest.fn()

jest.mock('../src/download.mjs', () => {
  const originalModule = jest.requireActual('../src/download.mjs')
  return {
    ...originalModule,
    saveOutput: jest.fn().mockResolvedValue(true),
    handleRedirects: mockHandleRedirects, // Use the pure mock
  }
})

describe('getContentInfo', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  it('should return content information on a successful HEAD request', async () => {
    const mockContentLength = '12345'
    const mockContentType = 'image/jpeg'
    const mockExtension = 'jpeg'

    axios.mockResolvedValue({
      status: 200,
      headers: {
        'content-length': mockContentLength,
        'content-type': mockContentType,
      },
    })
    mime.getExtension.mockReturnValue(mockExtension)

    const url = 'http://example.com/image.jpg'
    const result = await getContentInfo(url)

    expect(axios).toHaveBeenCalledWith({
      method: 'HEAD',
      url: url,
      timeout: 60000,
      headers: {},
    })
    expect(result).toEqual({
      contentLength: parseInt(mockContentLength),
      contentType: mockContentType,
      extension: mockExtension,
    })
  })

  it('should return default values when content-length is missing', async () => {
    const mockContentType = 'image/jpeg'
    const mockExtension = 'jpeg'

    axios.mockResolvedValue({
      status: 200,
      headers: {
        'content-type': mockContentType,
      },
    })
    mime.getExtension.mockReturnValue(mockExtension)

    const url = 'http://example.com/image.jpg'
    const result = await getContentInfo(url)

    expect(result).toEqual({
      contentLength: 0,
      contentType: mockContentType,
      extension: mockExtension,
    })
  })

  it('should return default values when content-type is missing', async () => {
    const mockContentLength = '12345'

    axios.mockResolvedValue({
      status: 200,
      headers: {
        'content-length': mockContentLength,
      },
    })
    mime.getExtension.mockReturnValue(undefined)

    const url = 'http://example.com/image.jpg'
    const result = await getContentInfo(url)

    expect(result).toEqual({
      contentLength: parseInt(mockContentLength),
      contentType: 'application/octet-stream',
      extension: 'bin',
    })
  })

  it('should throw an error when the HEAD request fails', async () => {
    axios.mockResolvedValue({
      status: 404,
      headers: {},
    })

    const url = 'http://example.com/image.jpg'

    await expect(getContentInfo(url)).rejects.toThrowError(
      'Failed to get content info. Status: 404'
    )
  })

  it('should throw an error when the HEAD request throws an error', async () => {
    axios.mockRejectedValue(new Error('Network error'))

    const url = 'http://example.com/image.jpg'

    await expect(getContentInfo(url)).rejects.toThrowError(
      'Get content info failed: Network error'
    )
  })

  it('should pass extra headers to axios in getContentInfo', async () => {
    const mockContentLength = '12345'
    const mockContentType = 'image/jpeg'
    const mockExtension = 'jpeg'
    const mockExtraHeaders = { 'X-Custom-Header': 'value' }

    axios.mockResolvedValue({
      status: 200,
      headers: {
        'content-length': mockContentLength,
        'content-type': mockContentType,
      },
    })
    mime.getExtension.mockReturnValue(mockExtension)

    const url = 'http://example.com/image.jpg'
    await getContentInfo(url, 60000, mockExtraHeaders)

    expect(axios).toHaveBeenCalledWith({
      method: 'HEAD',
      url: url,
      timeout: 60000,
      headers: { ...mockExtraHeaders },
    })
  })
})

describe('downloadFile', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  it('should download a file successfully', async () => {
    const mockUrl = 'http://example.com/image.jpg'
    const mockDest = 'image.jpg'
    const mockResponse = {
      status: 200,
      data: new PassThrough(),
    }
    axios.mockResolvedValue(mockResponse)
    fs.createWriteStream.mockReturnValue({
      on: jest.fn().mockImplementation((event, cb) => {
        if (event === 'finish') {
          cb()
        }
      }),
      once: jest.fn().mockImplementation((event, cb) => {
        if (event === 'finish') {
          cb()
        }
      }),
      emit: jest.fn(),
      removeListener: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
      pipe: jest.fn(),
    })

    const result = await downloadFile(mockUrl, mockDest)

    expect(axios).toHaveBeenCalledWith({
      method: 'GET',
      url: mockUrl,
      responseType: 'stream',
      headers: {},
      timeout: 60000,
    })
    expect(fs.createWriteStream).toHaveBeenCalledWith(mockDest)
    expect(result).toBe(true)
  })

  it('should throw an error when the download fails with a non-200 status', async () => {
    const mockUrl = 'http://example.com/image.jpg'
    const mockDest = 'image.jpg'
    axios.mockResolvedValue({
      status: 404,
      data: null,
    })

    await expect(downloadFile(mockUrl, mockDest)).rejects.toThrowError(
      'Failed to download file. Status: 404'
    )
  })

  it('should throw an error when the download fails due to a network error', async () => {
    const mockUrl = 'http://example.com/image.jpg'
    const mockDest = 'image.jpg'
    axios.mockRejectedValue(new Error('Network error'))

    await expect(downloadFile(mockUrl, mockDest)).rejects.toThrowError(
      'Download failed: Network error'
    )
  })

  it('should pass extra headers to axios', async () => {
    const mockUrl = 'http://example.com/image.jpg'
    const mockDest = 'image.jpg'
    const mockExtraHeaders = { 'X-Custom-Header': 'value' }
    const mockResponse = {
      status: 200,
      data: new PassThrough(),
    }
    axios.mockResolvedValue(mockResponse)
    fs.createWriteStream.mockReturnValue({
      on: jest.fn().mockImplementation((event, cb) => {
        if (event === 'finish') {
          cb()
        }
      }),
      once: jest.fn().mockImplementation((event, cb) => {
        if (event === 'finish') {
          cb()
        }
      }),
      emit: jest.fn(),
      removeListener: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
      pipe: jest.fn(),
    })

    await downloadFile(mockUrl, mockDest, 60000, mockExtraHeaders)

    expect(axios).toHaveBeenCalledWith({
      method: 'GET',
      url: mockUrl,
      responseType: 'stream',
      headers: mockExtraHeaders,
      timeout: 60000,
    })
  })

  it('should handle timeout correctly', async () => {
    const mockUrl = 'http://example.com/image.jpg'
    const mockDest = 'image.jpg'
    const mockTimeout = 1000
    axios.mockResolvedValue({
      status: 200,
      data: new PassThrough(),
    })
    fs.createWriteStream.mockReturnValue({
      on: jest.fn().mockImplementation((event, cb) => {
        if (event === 'finish') {
          cb()
        }
      }),
      once: jest.fn().mockImplementation((event, cb) => {
        if (event === 'finish') {
          cb()
        }
      }),
      emit: jest.fn(),
      removeListener: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
      pipe: jest.fn(),
    })

    await downloadFile(mockUrl, mockDest, mockTimeout)

    expect(axios).toHaveBeenCalledWith({
      method: 'GET',
      url: mockUrl,
      responseType: 'stream',
      headers: {},
      timeout: mockTimeout,
    })
  })
})

describe('downloadPartFile', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  it('should throw an error when the server returns 416 status', async () => {
    const mockUrl = 'http://example.com/video.mp4'
    const mockOutputFile = 'video.mp4'
    const mockMaxVideoSize = 1024 * 1024 * 10 // 10MB
    const mockResponse = {
      status: 200,
      headers: {
        'content-length': '104857600',
        get: jest.fn(() => {
          return undefined
        }),
      },
      data: new PassThrough(),
    }
    axios.head.mockResolvedValue(mockResponse)
    axios.get.mockResolvedValue({
      status: 416,
      headers: {
        get: jest.fn(() => {
          return undefined
        }),
      },
      data: null,
    })

    await expect(
      downloadPartFile(mockUrl, mockOutputFile, mockMaxVideoSize)
    ).rejects.toThrowError('Server does not support Range header request.')
  })

  it('should throw an error when the download fails due to a network error', async () => {
    const mockUrl = 'http://example.com/video.mp4'
    const mockOutputFile = 'video.mp4'
    const mockMaxVideoSize = 1024 * 1024 * 10 // 10MB
    axios.head.mockRejectedValue(new Error('Network error'))

    await expect(
      downloadPartFile(mockUrl, mockOutputFile, mockMaxVideoSize)
    ).rejects.toThrowError('Partial file download failed: Network error')
  })
})
