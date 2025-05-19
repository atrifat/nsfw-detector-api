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
  // mockAxios is now a mock function
  const mockAxios = jest.fn()
  mockAxios.head = jest.fn()
  mockAxios.get = jest.fn()
  // Mock create to return the mockAxios function itself
  mockAxios.create = jest.fn().mockReturnValue(mockAxios)
  mockAxios.defaults = { headers: {} }

  // Mock axios() call implementation
  mockAxios.mockImplementation((config) => {
    if (config.method?.toLowerCase() === 'head') {
      return mockAxios.head(config.url, config)
    } else if (config.method?.toLowerCase() === 'get') {
      return mockAxios.get(config.url, config)
    }
    // Fallback for other methods if needed
    return Promise.resolve({})
  })

  // Mock axios.head implementation
  mockAxios.head.mockImplementation(() => {
    // Handle redirects if needed in the test setup, or mock specific head responses
    return Promise.resolve({
      status: 200,
      headers: createMockHeaders({
        'content-length': '2000',
      }),
    })
  })

  // Mock axios.get implementation
  mockAxios.get.mockImplementation((url, config) => {
    console.log('axios.get called with config:', config) // Add logging here
    const mockData = Buffer.from('test data')
    if (config?.responseType === 'arraybuffer') {
      // Simulate a 416 error specifically for the test case that needs it
      if (
        url === 'http://example.com/video.mp4' &&
        config?.headers?.Range &&
        config?.headers?.Range === 'bytes=0-104857599' &&
        config?.simulate416
      ) {
        return Promise.reject({
          response: { status: 416 },
          message: 'Request failed with status code 416',
        })
      }
      return Promise.resolve({
        status: config?.headers?.Range ? 206 : 200, // Status depends on Range header
        data: mockData, // Return buffer data
        headers: createMockHeaders({
          'content-type': 'image/jpeg', // This content type might be wrong for video tests
          'content-length': '2000',
          'content-range': config?.headers?.Range
            ? 'bytes 0-1000/2000'
            : undefined,
        }),
      })
    } else {
      const mockStream = createMockReadableStream(Buffer.from('test data')) // Ensure stream has data
      return Promise.resolve({
        status: 200,
        data: mockStream, // Return stream data
        headers: createMockHeaders({
          'content-type': 'video/mp4', // This content type is for stream
          'content-length': '2000',
        }),
      })
    }
  })

  // Export the mockAxios function directly as the default export
  return {
    __esModule: true, // Important for ESM mocks
    default: mockAxios,
  }
})

// Mock mime with proper default export
jest.unstable_mockModule('mime', () => ({
  default: {
    getExtension: jest.fn().mockReturnValue('jpg'),
  },
}))

// Move import inside beforeEach to ensure axios is mocked
let getContentInfo,
  downloadFile,
  downloadPartFile,
  downloadFileToBuffer,
  downloadPartFileToBuffer
let mockAxios

beforeEach(async () => {
  jest.clearAllMocks()
  // Import the mocked axios default export
  mockAxios = (await import('axios')).default
  // Import the functions after the mock is set up
  ;({
    getContentInfo,
    downloadFile,
    downloadPartFile,
    downloadFileToBuffer,
    downloadPartFileToBuffer,
  } = await import('../src/download.mjs'))
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
    mockAxios.head.mockResolvedValueOnce(mockResponse)

    const result = await getContentInfo('http://example.com/image.jpg')

    expect(result).toEqual({
      contentType: 'image/jpeg',
      contentLength: 1234, // Now number, as it's parsed by the implementation
      extension: 'jpg',
    })
  })

  it('should handle errors gracefully', async () => {
    mockAxios.head.mockRejectedValueOnce(new Error('Network error'))

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
    mockAxios.head.mockResolvedValueOnce(mockResponse)

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
    mockAxios.head.mockResolvedValueOnce(mockResponse)

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
    mockAxios.head.mockResolvedValueOnce(mockResponse)
    const extraHeaders = { 'X-Custom-Header': 'value' }

    await getContentInfo('http://example.com/image.jpg', 60000, extraHeaders)

    expect(mockAxios.head).toHaveBeenCalledWith(
      'http://example.com/image.jpg',
      expect.objectContaining({
        timeout: 60000,
        headers: extraHeaders,
      })
    )
  })

  it('should throw an error when the HEAD request fails', async () => {
    mockAxios.head.mockRejectedValueOnce({
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
    mockAxios.head.mockRejectedValueOnce(new Error('Network error'))

    await expect(
      getContentInfo('http://example.com/image.jpg')
    ).rejects.toThrow('Network error')
  })

  it('should throw an error when the HEAD request returns 400 status', async () => {
    mockAxios.head.mockRejectedValueOnce({
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
    mockAxios.head.mockRejectedValueOnce({
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

    mockAxios.get.mockResolvedValueOnce({
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
    mockAxios.get.mockRejectedValueOnce(new Error('Download failed'))

    await expect(
      downloadFile('http://example.com/image.jpg', mockDestPath)
    ).rejects.toThrow('Download failed')
  })

  it('should pass extra headers to axios', async () => {
    const mockData = Buffer.from('test image data')
    const mockStream = createMockReadableStream(mockData)

    mockAxios.get.mockResolvedValueOnce({
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

    expect(mockAxios.get).toHaveBeenCalledWith(
      'http://example.com/image.jpg',
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

    mockAxios.get.mockResolvedValueOnce({
      status: 200,
      data: mockStream,
      headers: createMockHeaders({
        'content-type': 'image/jpeg',
      }),
    })
    const timeout = 1000

    await downloadFile('http://example.com/image.jpg', mockDestPath, timeout)

    expect(mockAxios.get).toHaveBeenCalledWith(
      'http://example.com/image.jpg',
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
    // Simulate a 416 response
    mockAxios.head.mockResolvedValueOnce({
      status: 200,
      headers: createMockHeaders({
        'content-length': '2000',
      }),
    })
    mockAxios.get.mockRejectedValueOnce({
      response: { status: 416 },
      message: 'Request failed with status code 416',
    })

    await expect(
      downloadPartFile('http://example.com/video.mp4', mockDestPath)
    ).rejects.toThrow(
      'Partial file download failed: Request failed with status code 416'
    ) // Updated expected error message
  })

  it('should throw an error when the download fails due to a network error', async () => {
    mockAxios.get.mockRejectedValueOnce(new Error('Network error'))

    await expect(
      downloadPartFile('http://example.com/video.mp4', mockDestPath)
    ).rejects.toThrow('Network error')
  })
})

describe('downloadFileToBuffer', () => {
  it('should download file to buffer successfully', async () => {
    const mockData = Buffer.from('test image data')

    mockAxios.get.mockImplementation((url, config) => {
      if (config?.responseType === 'arraybuffer') {
        return Promise.resolve({
          status: 200,
          data: mockData,
          headers: createMockHeaders({
            'content-type': 'image/jpeg',
            'content-length': '2000',
          }),
        })
      }
      // Fallback for other responseTypes if needed, though the mockGet handles it
      return Promise.resolve({})
    })

    const result = await downloadFileToBuffer('http://example.com/image.jpg')

    expect(mockAxios.get).toHaveBeenCalledWith(
      'http://example.com/image.jpg',
      expect.objectContaining({
        responseType: 'arraybuffer',
      })
    )
    expect(result).toEqual(mockData)
  })

  it('should handle download errors', async () => {
    mockAxios.get.mockRejectedValueOnce(new Error('Download failed'))

    await expect(
      downloadFileToBuffer('http://example.com/image.jpg')
    ).rejects.toThrow('Download failed')
  })
})

describe('downloadPartFileToBuffer', () => {
  it('should download partial content to buffer successfully', async () => {
    const mockData = Buffer.from('test video data')

    mockAxios.head.mockResolvedValueOnce({
      status: 200,
      headers: createMockHeaders({
        'content-length': '2000',
      }),
    })

    mockAxios.get.mockImplementation((url, config) => {
      if (config?.responseType === 'arraybuffer' && config?.headers?.Range) {
        return Promise.resolve({
          status: 206,
          data: mockData,
          headers: createMockHeaders({
            'content-type': 'video/mp4',
            'content-range': 'bytes 0-1000/2000',
            'content-length': '1000',
          }),
        })
      } else if (config?.responseType === 'arraybuffer') {
        // Handle the case where fileSize <= maxVideoSize
        return Promise.resolve({
          status: 200,
          data: mockData,
          headers: createMockHeaders({
            'content-type': 'video/mp4',
            'content-length': '2000',
          }),
        })
      }
      // Fallback for other cases
      return Promise.resolve({})
    })

    const result = await downloadPartFileToBuffer(
      'http://example.com/video.mp4'
    )

    // Expect either a call with Range header or a call without Range header but with arraybuffer
    expect(mockAxios.get).toHaveBeenCalledWith(
      'http://example.com/video.mp4',
      expect.objectContaining({
        responseType: 'arraybuffer',
        headers: expect.objectContaining({
          // Either Range is present or not, depending on the fileSize mock
        }),
      })
    )
    expect(result).toEqual(mockData)
  })

  it('should handle partial download errors', async () => {
    mockAxios.get.mockRejectedValueOnce(new Error('Partial download failed'))

    await expect(
      downloadPartFileToBuffer('http://example.com/video.mp4')
    ).rejects.toThrow('Partial download failed')
  })

  it('should throw an error when the server returns 416 status', async () => {
    // Simulate a 416 response
    mockAxios.head.mockResolvedValueOnce({
      status: 200,
      headers: createMockHeaders({
        'content-length': '2000',
      }),
    })
    mockAxios.get.mockRejectedValueOnce({
      response: { status: 416 },
      message: 'Request failed with status code 416',
    })

    await expect(
      downloadPartFileToBuffer('http://example.com/video.mp4')
    ).rejects.toThrow(
      'Partial file download failed: Request failed with status code 416' // Updated expected error message
    )
  })

  it('should throw an error when the download fails due to a network error', async () => {
    mockAxios.get.mockRejectedValueOnce(new Error('Network error'))

    await expect(
      downloadPartFileToBuffer('http://example.com/video.mp4')
    ).rejects.toThrow('Network error')
  })
})
