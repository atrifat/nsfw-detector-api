import { jest } from '@jest/globals'
import { Readable } from 'stream'

jest.unstable_mockModule('node:fs', () => ({
  ...jest.requireActual('node:fs'),
  unlink: jest.fn().mockResolvedValue(undefined),
  createWriteStream: jest.fn().mockReturnValue({
    write: jest.fn(),
    end: jest.fn(),
  }),
}))

// Create a mock readable stream
const createMockReadableStream = (data) => {
  const stream = new Readable({
    read() {
      this.push(data)
      this.push(null)
    },
  })
  stream.pipe = jest.fn().mockImplementation((dest) => {
    process.nextTick(() => {
      dest.write(data)
      dest.end()
    })
    return dest
  })
  return stream
}

// Create mock response headers that work with both get() and array access
const createMockHeaders = (headers) => {
  const mockHeaders = Object.entries(headers).reduce((acc, [key, value]) => {
    acc[key.toLowerCase()] = value
    return acc
  }, {})

  return {
    ...mockHeaders,
    get: (name) => mockHeaders[name.toLowerCase()],
    // Support direct property access
    toJSON: () => mockHeaders,
    valueOf: () => mockHeaders,
  }
}

// Mock axios with proper structure matching how it's used in the code
jest.unstable_mockModule('axios', () => {
  const mockHead = jest.fn().mockImplementation(() =>
    Promise.resolve({
      status: 200,
      headers: createMockHeaders({
        'content-length': '2000',
      }),
    })
  )

  const mockGet = jest.fn().mockImplementation((url, config) => {
    const mockData = Buffer.from('test data')
    const mockStream = createMockReadableStream(mockData)

    if (config?.headers?.Range) {
      return Promise.resolve({
        status: 206,
        data: mockStream,
        headers: createMockHeaders({
          'content-type': 'video/mp4',
          'content-range': 'bytes 0-1000/2000',
          'content-length': '1000',
        }),
      })
    }

    return Promise.resolve({
      status: 200,
      data: mockStream,
      headers: createMockHeaders({
        'content-type': 'video/mp4',
        'content-length': '2000',
      }),
    })
  })

  const mockAxios = jest.fn().mockImplementation((config) => {
    if (config.method?.toLowerCase() === 'head') {
      return mockHead(config.url, config)
    }
    return mockGet(config.url, config)
  })

  mockAxios.head = mockHead
  mockAxios.get = mockGet
  mockAxios.create = jest.fn().mockReturnValue(mockAxios)
  mockAxios.defaults = { headers: {} }

  return { default: mockAxios }
})

// Mock mime with proper default export
jest.unstable_mockModule('mime', () => ({
  default: {
    getExtension: jest.fn().mockReturnValue('jpg'),
  },
}))

const { getContentInfo, downloadFile, downloadPartFile } = await import(
  '../src/download.mjs'
)

let mockAxios

beforeEach(async () => {
  jest.clearAllMocks()
  const axiosModule = await import('axios')
  mockAxios = axiosModule.default
})

describe('getContentInfo', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  it('should return content info for a valid URL', async () => {
    const mockResponse = {
      status: 200,
      headers: createMockHeaders({
        'content-type': 'image/jpeg',
        'content-length': '1234',
      }),
    }
    mockAxios.mockResolvedValueOnce(mockResponse)

    const result = await getContentInfo('http://example.com/image.jpg')

    expect(result).toEqual({
      contentType: 'image/jpeg',
      contentLength: 1234, // Now number, as it's parsed by the implementation
      extension: 'jpg',
    })
  })

  it('should handle errors gracefully', async () => {
    mockAxios.mockRejectedValueOnce(new Error('Network error'))

    await expect(
      getContentInfo('http://example.com/image.jpg')
    ).rejects.toThrow('Network error')
  })

  it('should return default values when content-length is missing', async () => {
    const mockResponse = {
      status: 200,
      headers: createMockHeaders({
        'content-type': 'image/jpeg',
      }),
    }
    mockAxios.mockResolvedValueOnce(mockResponse)

    const result = await getContentInfo('http://example.com/image.jpg')

    expect(result).toEqual({
      contentType: 'image/jpeg',
      contentLength: 0,
      extension: 'jpg',
    })
  })

  it('should return default values when content-type is missing', async () => {
    const mockResponse = {
      status: 200,
      headers: createMockHeaders({
        'content-length': '1234',
      }),
    }
    mockAxios.mockResolvedValueOnce(mockResponse)

    const result = await getContentInfo('http://example.com/image.jpg')

    expect(result).toEqual({
      contentType: 'application/octet-stream',
      contentLength: 1234,
      extension: 'jpg',
    })
  })

  it('should pass extra headers to axios in getContentInfo', async () => {
    const mockResponse = {
      status: 200,
      headers: createMockHeaders({
        'content-type': 'image/jpeg',
        'content-length': '1234',
      }),
    }
    mockAxios.mockResolvedValueOnce(mockResponse)
    const extraHeaders = { 'X-Custom-Header': 'value' }

    await getContentInfo('http://example.com/image.jpg', 60000, extraHeaders)

    expect(mockAxios).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'HEAD',
        url: 'http://example.com/image.jpg',
        timeout: 60000,
        headers: extraHeaders,
      })
    )
  })

  it('should throw an error when the HEAD request fails', async () => {
    mockAxios.mockRejectedValueOnce({
      status: 404,
      response: {
        headers: createMockHeaders({}),
      },
      message: 'Request failed with status code 404',
    })

    await expect(
      getContentInfo('http://example.com/image.jpg')
    ).rejects.toThrow('Request failed with status code 404')
  })

  it('should throw an error when the HEAD request throws an error', async () => {
    mockAxios.mockRejectedValueOnce(new Error('Network error'))

    await expect(
      getContentInfo('http://example.com/image.jpg')
    ).rejects.toThrow('Network error')
  })

  it('should throw an error when the HEAD request returns 400 status', async () => {
    mockAxios.mockRejectedValueOnce({
      status: 400,
      response: {
        headers: createMockHeaders({}),
      },
      message: 'Request failed with status code 400',
    })

    await expect(
      getContentInfo('http://example.com/image.jpg')
    ).rejects.toThrow('Request failed with status code 400')
  })

  it('should throw an error when the HEAD request returns 500 status', async () => {
    mockAxios.mockRejectedValueOnce({
      status: 500,
      response: {
        headers: createMockHeaders({}),
      },
      message: 'Request failed with status code 500',
    })

    await expect(
      getContentInfo('http://example.com/image.jpg')
    ).rejects.toThrow('Request failed with status code 500')
  })
})

describe('downloadFile', () => {
  const mockDestPath = '/tmp/test.jpg'
  let mockWriteStream

  beforeEach(async () => {
    mockWriteStream = {
      write: jest.fn(),
      end: jest.fn(),
      on: jest.fn((event, cb) => {
        if (event === 'finish') {
          process.nextTick(cb)
        }
        return mockWriteStream
      }),
    }
    const fs = await import('node:fs')
    fs.createWriteStream.mockReturnValue(mockWriteStream)
  })

  it('should download file and write to destination', async () => {
    const mockData = Buffer.from('test image data')
    const mockStream = createMockReadableStream(mockData)

    mockAxios.mockResolvedValueOnce({
      status: 200,
      data: mockStream,
      headers: createMockHeaders({
        'content-type': 'image/jpeg',
      }),
    })

    const result = await downloadFile(
      'http://example.com/image.jpg',
      mockDestPath
    )

    expect(result).toBe(true) // Implementation returns true on success
  })

  it('should handle download errors', async () => {
    mockAxios.mockRejectedValueOnce(new Error('Download failed'))

    await expect(
      downloadFile('http://example.com/image.jpg', mockDestPath)
    ).rejects.toThrow('Download failed')
  })

  it('should pass extra headers to axios', async () => {
    const mockData = Buffer.from('test image data')
    const mockStream = createMockReadableStream(mockData)

    mockAxios.mockResolvedValueOnce({
      status: 200,
      data: mockStream,
      headers: createMockHeaders({
        'content-type': 'image/jpeg',
      }),
    })
    const extraHeaders = { 'X-Custom-Header': 'value' }

    await downloadFile(
      'http://example.com/image.jpg',
      mockDestPath,
      60000,
      extraHeaders
    )

    expect(mockAxios).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        url: 'http://example.com/image.jpg',
        responseType: 'stream',
        headers: extraHeaders,
        timeout: 60000,
      })
    )
  })

  it('should handle timeout correctly', async () => {
    const mockData = Buffer.from('test image data')
    const mockStream = createMockReadableStream(mockData)

    mockAxios.mockResolvedValueOnce({
      status: 200,
      data: mockStream,
      headers: createMockHeaders({
        'content-type': 'image/jpeg',
      }),
    })
    const timeout = 1000

    await downloadFile('http://example.com/image.jpg', mockDestPath, timeout)

    expect(mockAxios).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        url: 'http://example.com/image.jpg',
        responseType: 'stream',
        headers: {},
        timeout: timeout,
      })
    )
  })
})

describe('downloadPartFile', () => {
  const mockDestPath = '/tmp/test.mp4'

  beforeEach(() => {
    jest.clearAllMocks()
  })
  it('should handle redirects in downloadPartFile', async () => {
    mockAxios.head.mockResolvedValueOnce({
      status: 302,
      headers: createMockHeaders({
        location: 'http://example.com/redirected-video.mp4',
        'content-length': '2000',
      }),
    })

    mockAxios.head.mockResolvedValueOnce({
      status: 200,
      headers: createMockHeaders({
        'content-length': '2000',
      }),
    })

    mockAxios.get.mockResolvedValueOnce({
      status: 200,
      data: createMockReadableStream(Buffer.from('test data')),
      headers: createMockHeaders({
        'content-type': 'video/mp4',
        'content-length': '2000',
      }),
    })

    const result = await downloadPartFile(
      'http://example.com/video.mp4',
      mockDestPath
    )

    expect(mockAxios.head).toHaveBeenCalledWith(
      'http://example.com/video.mp4',
      expect.anything()
    )

    expect(mockAxios.head).toHaveBeenCalledWith(
      'http://example.com/redirected-video.mp4',
      expect.anything()
    )

    expect(result).toBe(true)
  })

  it('should download partial content successfully', async () => {
    const result = await downloadPartFile(
      'http://example.com/video.mp4',
      mockDestPath
    )

    expect(result).toBe(true)
  })

  it('should handle partial download errors', async () => {
    mockAxios.get.mockRejectedValueOnce(new Error('Partial download failed'))

    await expect(
      downloadPartFile('http://example.com/video.mp4', mockDestPath)
    ).rejects.toThrow('Partial download failed')
  })

  it('should throw an error when the server returns 416 status', async () => {
    mockAxios.get.mockRejectedValueOnce(
      new Error('Server does not support Range header request.')
    )

    await expect(
      downloadPartFile('http://example.com/video.mp4', mockDestPath)
    ).rejects.toThrow('Server does not support Range header request.')
  })

  it('should throw an error when the download fails due to a network error', async () => {
    mockAxios.get.mockRejectedValueOnce(new Error('Network error'))

    await expect(
      downloadPartFile('http://example.com/video.mp4', mockDestPath)
    ).rejects.toThrow('Network error')
  })
})
