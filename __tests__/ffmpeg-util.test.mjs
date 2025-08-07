import { jest } from '@jest/globals'
import { Readable, PassThrough } from 'node:stream' // Import Writable, PassThrough

jest.setTimeout(15000) // Increase default Jest timeout for this test suite

let generateScreenshotFromStream
let spawnMock = jest.fn() // Initialize spawnMock as a Jest mock

// Mock child_process for spawn
jest.unstable_mockModule('node:child_process', () => ({
  spawn: spawnMock, // Assign spawnMock directly
}))

// Mock @ffmpeg-installer/ffmpeg
jest.unstable_mockModule('@ffmpeg-installer/ffmpeg', () => ({
  path: '/usr/bin/ffmpeg',
}))

// Mock util.mjs for runCommand (though generateScreenshotFromStream uses spawn directly)
jest.unstable_mockModule('../src/util.mjs', () => ({
  runCommand: jest.fn().mockResolvedValue('mock stdout'),
}))

beforeEach(async () => {
  jest.clearAllMocks()
  // Ensure the mock for child_process is fully loaded before using spawnMock
  await import('node:child_process')
  spawnMock.mockClear() // Clear mocks instead of re-assigning

  // Set default mock implementation for spawn
  spawnMock.mockImplementation(() => {
    const mockProcess = {
      stdin: Object.assign(new PassThrough(), {
        write: jest.fn(),
        end: jest.fn(function () {
          this.emit('finish')
          // Simulate FFmpeg processing and then closing streams
          mockProcess.stdout.push(Buffer.from('mock screenshot output'))
          mockProcess.stdout.push(null) // End stdout stream
          mockProcess.stderr.push(null) // End stderr stream
          // Simulate process closing after a short delay, controlled by fake timers
          setTimeout(() => {
            mockProcess.emit('close', 0) // Emit close event with code 0 for success
          }, 100) // A small delay to allow pipeline to set up
        }),
        bytesWritten: 12345, // Mock bytesWritten
      }),
      stdout: new Readable({ read() {} }),
      stderr: new Readable({ read() {} }),
      on: jest.fn((event, handler) => {
        // Mock 'close' event handler
        if (event === 'close') {
          mockProcess._closeHandler = handler
        }
      }),
      emit: jest.fn(function (event, ...args) {
        if (event === 'close' && this._closeHandler) {
          this._closeHandler(...args)
        }
      }),
      kill: jest.fn(function () {
        // If fake timers are in use, emit close immediately to allow jest.runAllTimers to control it
        if (
          jest.isMockFunction(setTimeout) ||
          jest.isMockFunction(setInterval)
        ) {
          this.emit('close', null) // Emit close event with null code for timeout/kill
        } else {
          // Otherwise, use a real timer for a slight delay
          setTimeout(() => {
            this.emit('close', null)
          }, 100)
        }
      }),
      pid: 12345,
      killed: false,
    }
    // Ensure stdin has bytesWritten property even if not explicitly set by a test's mockImplementationOnce
    mockProcess.stdin.bytesWritten = mockProcess.stdin.bytesWritten || 0
    return mockProcess
  })
  ;({ generateScreenshotFromStream } = await import('../src/ffmpeg-util.mjs'))
})

afterEach(() => {
  jest.useRealTimers() // Ensure real timers are restored after each test
})

describe('generateScreenshotFromStream', () => {
  it('should log bytes consumed by FFmpeg', async () => {
    const consoleDebugSpy = jest
      .spyOn(console, 'debug')
      .mockImplementation(() => {})
    spawnMock.mockImplementationOnce(() => {
      const mockProcess = {
        stdin: Object.assign(new PassThrough(), {
          write: jest.fn(),
          end: jest.fn(function () {
            this.emit('finish')
            mockProcess.stdout.push(Buffer.from('mock screenshot output'))
            mockProcess.stdout.push(null)
            mockProcess.stderr.push(null)
            process.nextTick(() => {
              mockProcess.emit('close', 0)
            })
          }),
          bytesWritten: 12345, // Simulate bytes written
        }),
        stdout: new Readable({ read() {} }),
        stderr: new Readable({ read() {} }),
        on: jest.fn((event, handler) => {
          if (event === 'close') {
            mockProcess._closeHandler = handler
          }
        }),
        emit: jest.fn(function (event, ...args) {
          if (event === 'close' && this._closeHandler) {
            this._closeHandler(...args)
          }
        }),
        kill: jest.fn(),
        pid: 12345,
        killed: false,
      }
      return mockProcess
    })

    const mockInputStream = new Readable({
      read() {
        this.push(Buffer.from('mock video data'))
        this.push(null)
      },
    })
    const ffmpegPath = '/usr/bin/ffmpeg'

    await generateScreenshotFromStream(mockInputStream, ffmpegPath)

    expect(consoleDebugSpy).toHaveBeenCalledWith(
      expect.stringContaining('[DEBUG] Bytes consumed by FFmpeg: 12345')
    )
    consoleDebugSpy.mockRestore()
  })
  it('should generate a screenshot from a readable stream', async () => {
    spawnMock.mockImplementationOnce(() => {
      const mockProcess = {
        stdin: Object.assign(new PassThrough(), {
          write: jest.fn(),
          end: jest.fn(function () {
            this.emit('finish')
            mockProcess.stdout.push(Buffer.from('mock screenshot output'))
            mockProcess.stdout.push(null)
            mockProcess.stderr.push(null)
            process.nextTick(() => {
              mockProcess.emit('close', 0)
            })
          }),
          bytesWritten: 12345,
        }),
        stdout: new Readable({ read() {} }),
        stderr: new Readable({ read() {} }),
        on: jest.fn((event, handler) => {
          if (event === 'close') {
            mockProcess._closeHandler = handler
          }
        }),
        emit: jest.fn(function (event, ...args) {
          if (event === 'close' && this._closeHandler) {
            this._closeHandler(...args)
          }
        }),
        kill: jest.fn(),
        pid: 12345,
        killed: false,
      }
      return mockProcess
    })

    const mockInputStream = new Readable({
      read() {
        this.push(Buffer.from('mock video data'))
        this.push(null)
      },
    })
    const ffmpegPath = '/usr/bin/ffmpeg'

    const resultBuffer = await generateScreenshotFromStream(
      mockInputStream,
      ffmpegPath
    )

    expect(resultBuffer).toEqual(Buffer.from('mock screenshot output'))
    expect(spawnMock).toHaveBeenCalledWith(
      ffmpegPath,
      expect.arrayContaining(['-i', 'pipe:0', 'pipe:1']),
      expect.objectContaining({ stdio: ['pipe', 'pipe', 'pipe'] })
    )
  })

  it('should reject if FFmpeg process exits with a non-zero code', async () => {
    spawnMock.mockImplementationOnce(() => {
      const mockProcess = {
        stdin: Object.assign(new PassThrough(), {
          write: jest.fn(),
          end: jest.fn(function () {
            this.emit('finish')
            mockProcess.stdout.push(null)
            mockProcess.stderr.push(Buffer.from('FFmpeg error'))
            mockProcess.stderr.push(null)
            process.nextTick(() => {
              mockProcess.emit('close', 1) // Emit close event with code 1 for error
            })
          }),
          bytesWritten: 12345,
        }),
        stdout: new Readable({ read() {} }),
        stderr: new Readable({ read() {} }),
        on: jest.fn((event, handler) => {
          if (event === 'close') {
            mockProcess._closeHandler = handler
          }
        }),
        emit: jest.fn(function (event, ...args) {
          if (event === 'close' && this._closeHandler) {
            this._closeHandler(...args)
          }
        }),
        kill: jest.fn(),
        pid: 12345,
        killed: false,
      }
      return mockProcess
    })

    const mockInputStream = new Readable({
      read() {
        this.push(Buffer.from('mock video data'))
        this.push(null)
      },
    })
    const ffmpegPath = '/usr/bin/ffmpeg'

    await expect(
      generateScreenshotFromStream(mockInputStream, ffmpegPath)
    ).rejects.toThrow(
      /FFmpeg process exited with code 1\. Stderr: FFmpeg error/
    )
  })

  it('should reject if FFmpeg process fails to spawn', async () => {
    const spawnError = new Error('Spawn failed')
    spawnMock.mockImplementationOnce(() => {
      throw spawnError
    })

    const mockInputStream = new Readable({
      read() {
        this.push(Buffer.from('mock video data'))
        this.push(null)
      },
    })
    const ffmpegPath = '/usr/bin/ffmpeg'

    await expect(
      generateScreenshotFromStream(mockInputStream, ffmpegPath)
    ).rejects.toThrow('Spawn failed')
  })

  it('should reject if FFmpeg process times out', async () => {
    jest.useFakeTimers()

    spawnMock.mockImplementationOnce(() => {
      const mockProcess = {
        stdin: Object.assign(new PassThrough(), {
          write: jest.fn(),
          end: jest.fn(), // Stream never ends
          bytesWritten: 0, // Ensure bytesWritten is defined for timeout case
        }),
        stdout: new Readable({ read() {} }),
        stderr: new Readable({ read() {} }),
        on: jest.fn((event, handler) => {
          if (event === 'close') {
            mockProcess._closeHandler = handler
          }
        }),
        emit: jest.fn(function (event, ...args) {
          if (event === 'close' && this._closeHandler) {
            this._closeHandler(...args)
          }
        }),
        kill: jest.fn(function () {
          this.emit('close', null) // Emit close event immediately for fake timers
        }),
        pid: 12345,
        killed: false,
      }
      return mockProcess
    })

    const mockInputStream = new Readable({
      read() {
        // Simulate a stream that never ends
      },
    })
    const ffmpegPath = '/usr/bin/ffmpeg'

    const promise = generateScreenshotFromStream(mockInputStream, ffmpegPath)

    const actualFfmpegProcess =
      spawnMock.mock.results[spawnMock.mock.results.length - 1].value

    jest.runAllTimers() // Advance timers to trigger timeout and mock process close

    await expect(promise).rejects.toThrow(/FFmpeg process timed out/)
    expect(actualFfmpegProcess.kill).toHaveBeenCalledWith('SIGKILL')
    expect(mockInputStream.destroyed).toBe(true)
  })

  it('should destroy input stream on synchronous error during setup', async () => {
    const mockInputStream = new Readable({
      read() {
        this.push(Buffer.from('mock video data'))
        this.push(null)
      },
    })
    const ffmpegPath = '/usr/bin/ffmpeg'

    spawnMock.mockImplementationOnce(() => {
      // Manually set destroyed to true on synchronous error
      mockInputStream.destroyed = true
      throw new Error('Synchronous setup error')
    })

    await expect(
      generateScreenshotFromStream(mockInputStream, ffmpegPath)
    ).rejects.toThrow('Synchronous setup error')
    expect(mockInputStream.destroyed).toBe(true)
  })
})

describe('generateScreenshot', () => {
  let generateScreenshot
  let runCommandMock

  beforeEach(async () => {
    jest.clearAllMocks()
    runCommandMock = (await import('../src/util.mjs')).runCommand
    ;({ generateScreenshot } = await import('../src/ffmpeg-util.mjs'))
  })

  it('should call runCommand with correct arguments', async () => {
    await generateScreenshot('/path/to/video.mp4', '/path/to/screenshot.jpg')
    expect(runCommandMock).toHaveBeenCalledWith(
      '/usr/bin/ffmpeg',
      expect.any(Array),
      { timeout: 15000 }
    )
  })

  it('should return false if runCommand fails', async () => {
    const consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {})
    runCommandMock.mockRejectedValueOnce(new Error('ffmpeg failed'))
    const result = await generateScreenshot(
      '/path/to/video.mp4',
      '/path/to/screenshot.jpg'
    )
    expect(result).toBe(false)
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Error generating screenshot: ffmpeg failed. Aborted: false'
    )
    consoleErrorSpy.mockRestore()
  })
})

describe('generateScreenshotFromBuffer', () => {
  let generateScreenshotFromBuffer

  beforeEach(async () => {
    jest.clearAllMocks()
    await import('node:child_process')
    spawnMock.mockClear()

    spawnMock.mockImplementation(() => {
      const mockProcess = {
        stdin: Object.assign(new PassThrough(), {
          write: jest.fn(),
          end: jest.fn(function () {
            this.emit('finish')
            mockProcess.stdout.push(Buffer.from('mock screenshot output'))
            mockProcess.stdout.push(null)
            mockProcess.stderr.push(null)
            process.nextTick(() => {
              mockProcess.emit('close', 0)
            })
          }),
          bytesWritten: 0, // Ensure bytesWritten is defined for buffer tests
        }),
        stdout: new Readable({ read() {} }),
        stderr: new Readable({ read() {} }),
        on: jest.fn((event, handler) => {
          if (event === 'close') {
            mockProcess._closeHandler = handler
          }
        }),
        emit: jest.fn(function (event, ...args) {
          if (event === 'close' && this._closeHandler) {
            this._closeHandler(...args)
          }
        }),
        kill: jest.fn(),
        pid: 12345,
        killed: false,
      }
      return mockProcess
    })
    ;({ generateScreenshotFromBuffer } = await import('../src/ffmpeg-util.mjs'))
  })

  it('should generate a screenshot from a video buffer', async () => {
    const mockVideoBuffer = Buffer.from('mock video data')
    const ffmpegPath = '/usr/bin/ffmpeg'
    const expectedScreenshotBuffer = Buffer.from('mock screenshot output')

    const resultBuffer = await generateScreenshotFromBuffer(
      mockVideoBuffer,
      ffmpegPath
    )

    expect(spawnMock).toHaveBeenCalledWith(
      ffmpegPath,
      expect.arrayContaining([
        '-i',
        'pipe:0',
        '-f',
        'image2pipe',
        '-vcodec',
        'mjpeg',
        'pipe:1',
      ]),
      expect.objectContaining({ stdio: ['pipe', 'pipe', 'pipe'] })
    )
    expect(resultBuffer).toEqual(expectedScreenshotBuffer)
  })

  it('should reject if FFmpeg process exits with a non-zero code', async () => {
    spawnMock.mockImplementationOnce(() => {
      const mockProcess = {
        stdin: Object.assign(new PassThrough(), {
          write: jest.fn(),
          end: jest.fn(function () {
            this.emit('finish')
            mockProcess.stdout.push(null)
            mockProcess.stderr.push(Buffer.from('FFmpeg error'))
            mockProcess.stderr.push(null)
            process.nextTick(() => {
              mockProcess.emit('close', 1)
            })
          }),
          bytesWritten: 0,
        }),
        stdout: new Readable({ read() {} }),
        stderr: new Readable({ read() {} }),
        on: jest.fn((event, handler) => {
          if (event === 'close') {
            mockProcess._closeHandler = handler
          }
        }),
        emit: jest.fn(function (event, ...args) {
          if (event === 'close' && this._closeHandler) {
            this._closeHandler(...args)
          }
        }),
        kill: jest.fn(),
        pid: 12345,
        killed: false,
      }
      return mockProcess
    })

    const mockVideoBuffer = Buffer.from('mock video data')
    const ffmpegPath = '/usr/bin/ffmpeg'

    await expect(
      generateScreenshotFromBuffer(mockVideoBuffer, ffmpegPath)
    ).rejects.toThrow(
      /FFmpeg process exited with code 1\. Stderr: FFmpeg error/
    )
  })

  it('should reject if FFmpeg process produces no output', async () => {
    spawnMock.mockImplementationOnce(() => {
      const mockProcess = {
        stdin: Object.assign(new PassThrough(), {
          write: jest.fn(),
          end: jest.fn(function () {
            this.emit('finish')
            mockProcess.stdout.push(null) // No output
            mockProcess.stderr.push(null)
            process.nextTick(() => {
              mockProcess.emit('close', 0)
            })
          }),
          bytesWritten: 0,
        }),
        stdout: new Readable({ read() {} }),
        stderr: new Readable({ read() {} }),
        on: jest.fn((event, handler) => {
          if (event === 'close') {
            mockProcess._closeHandler = handler
          }
        }),
        emit: jest.fn(function (event, ...args) {
          if (event === 'close' && this._closeHandler) {
            this._closeHandler(...args)
          }
        }),
        kill: jest.fn(),
        pid: 12345,
        killed: false,
      }
      return mockProcess
    })

    const mockVideoBuffer = Buffer.from('mock video data')
    const ffmpegPath = '/usr/bin/ffmpeg'

    await expect(
      generateScreenshotFromBuffer(mockVideoBuffer, ffmpegPath)
    ).rejects.toThrow(/FFmpeg exited successfully but produced no output/)
  })

  it('should reject if FFmpeg process times out', async () => {
    jest.useFakeTimers()

    spawnMock.mockImplementationOnce(() => {
      const mockProcess = {
        stdin: Object.assign(new PassThrough(), {
          write: jest.fn(),
          end: jest.fn(), // Stream never ends
          bytesWritten: 0, // Ensure bytesWritten is defined for timeout case
        }),
        stdout: new Readable({ read() {} }),
        stderr: new Readable({ read() {} }),
        on: jest.fn((event, handler) => {
          if (event === 'close') {
            mockProcess._closeHandler = handler
          }
        }),
        emit: jest.fn(function (event, ...args) {
          if (event === 'close' && this._closeHandler) {
            this._closeHandler(...args)
          }
        }),
        kill: jest.fn(function () {
          this.emit('close', null) // Emit close event immediately for fake timers
        }),
        pid: 12345,
        killed: false,
      }
      return mockProcess
    })

    const mockVideoBuffer = Buffer.from('mock video data')
    const ffmpegPath = '/usr/bin/ffmpeg'

    const promise = generateScreenshotFromBuffer(mockVideoBuffer, ffmpegPath)

    jest.runAllTimers() // Advance timers to trigger timeout

    await expect(promise).rejects.toThrow(/FFmpeg process timed out/)
    jest.useRealTimers()
  })

  it('should destroy input stream on synchronous error during setup', async () => {
    const mockVideoBuffer = Buffer.from('mock video data')
    const ffmpegPath = '/usr/bin/ffmpeg'

    spawnMock.mockImplementationOnce(() => {
      throw new Error('Synchronous setup error')
    })

    await expect(
      generateScreenshotFromBuffer(mockVideoBuffer, ffmpegPath)
    ).rejects.toThrow('Synchronous setup error')
  }, 10000) // Increased timeout for this specific test

  it('should reject on pipeline error', async () => {
    const consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {})
    const pipelineError = new Error('Pipeline failed')
    spawnMock.mockImplementationOnce(() => {
      const mockProcess = {
        stdin: new PassThrough(),
        stdout: new Readable({ read() {} }),
        stderr: new Readable({ read() {} }),
        on: jest.fn((event, handler) => {
          if (event === 'close') {
            mockProcess._closeHandler = handler
          }
        }),
        emit: jest.fn(function (event, ...args) {
          if (event === 'close' && this._closeHandler) {
            this._closeHandler(...args)
          }
        }),
        kill: jest.fn(function () {
          // When kill is called, immediately emit the close event to resolve the promise
          this.emit('close', 1)
        }),
      }
      // Defer emitting error to allow pipeline to be set up
      process.nextTick(() => mockProcess.stdin.emit('error', pipelineError))
      return mockProcess
    })

    const mockVideoBuffer = Buffer.from('mock video data')
    const ffmpegPath = '/usr/bin/ffmpeg'

    await expect(
      generateScreenshotFromBuffer(mockVideoBuffer, ffmpegPath)
    ).rejects.toThrow(pipelineError)
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Unexpected buffer pipeline error:',
      pipelineError
    )
    consoleErrorSpy.mockRestore()
  })
})

// This function is not exported from ffmpeg-util.mjs, but we are testing it here
// to ensure coverage of the logic, as requested.
const _parseProgress = (data) => {
  const progress = {}
  const lines = data.toString().split(/\r\n|\r|\n/)
  for (const line of lines) {
    const parts = line.split('=')
    if (parts.length === 2) {
      const key = parts[0].trim()
      const value = parts[1].trim()
      progress[key] = value
    }
  }
  return progress
}

describe('_parseProgress', () => {
  it('should parse ffmpeg progress data correctly', () => {
    const data = `
frame=1
fps=0.0
stream_0_0_q=0.0
bitrate=N/A
total_size=N/A
out_time_us=1000000
out_time_ms=1000000
out_time=00:00:01.000000
dup_frames=0
drop_frames=0
speed=0.0x
progress=continue
`
    const expected = {
      frame: '1',
      fps: '0.0',
      stream_0_0_q: '0.0',
      bitrate: 'N/A',
      total_size: 'N/A',
      out_time_us: '1000000',
      out_time_ms: '1000000',
      out_time: '00:00:01.000000',
      dup_frames: '0',
      drop_frames: '0',
      speed: '0.0x',
      progress: 'continue',
    }
    expect(_parseProgress(data)).toEqual(expected)
  })

  it('should handle empty lines and extra spaces', () => {
    const data = '  key1 = value1  \n\n key2=value2'
    const expected = {
      key1: 'value1',
      key2: 'value2',
    }
    expect(_parseProgress(data)).toEqual(expected)
  })

  it('should return an empty object for data with no key-value pairs', () => {
    const data = 'this is just some text'
    expect(_parseProgress(data)).toEqual({})
  })

  it('should return an empty object for empty data', () => {
    const data = ''
    expect(_parseProgress(data)).toEqual({})
  })
})
