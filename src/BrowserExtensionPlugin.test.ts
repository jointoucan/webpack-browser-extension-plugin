import { BrowserExtensionPlugin } from './BrowserExtensionPlugin'

jest.mock('ws')
const WebSocket = require('ws')

describe('BrowserExtensionPlugin', () => {
  let compilerMock
  beforeEach(() => {
    compilerMock = {
      hooks: {
        watchRun: {
          tapPromise: jest.fn(),
        },
        compile: {
          tap: jest.fn(),
        },
        afterCompile: {
          tap: jest.fn(),
        },
        done: {
          tap: jest.fn(),
        },
      },
      options: {
        entry: {
          background: './src/index.ts',
        },
        output: {},
      },
    }
  })
  it('should be able to load a BrowserExtension', () => {
    const plugin = new BrowserExtensionPlugin({
      autoReload: false,
    })
    expect(plugin).toBeTruthy()
  })
  it('should start a WebSocket server if autoReload is true', async () => {
    let serverCallback
    const serverMock = jest.fn().mockImplementation((options, callback) => {
      callback()
      return {
        on: jest.fn(),
        close: jest.fn(),
      }
    })
    WebSocket.Server = serverMock

    const plugin = new BrowserExtensionPlugin({
      autoReload: true,
      quiet: true,
    })
    // Mocking behaviors of webpack
    plugin.apply(compilerMock)
    await plugin.watchRun()

    expect(serverMock).toBeCalled()
  })
})
