import path from 'path'
import fs from 'fs'
import { promisify } from 'util'
import InjectPlugin, { ENTRY_ORDER } from 'webpack-inject-plugin'
import WebSocket from 'ws'
import { compileTemplate } from './compileTemplate'
import type webpack from 'webpack'

const pReadFile = promisify(fs.readFile)

export class BrowserExtensionPlugin {
  port: number
  host: string
  reconnectTime: number
  autoReload: boolean
  vendor: string
  quiet: boolean
  backgroundEntry: string
  ignoreEntries: Array<string>
  server: WebSocket.Server | null
  startTime: number
  prevFileTimestamps: Map<string, number>

  /**
   * @param {object} options a set of options that allows you to configure this plugin
   * @param {number} options.port the port to listen on
   * @param {string} options.host the host to listen on
   * @param {number} options.reconnectTime the amount of time it will attempt to reconnect
   * @param {boolean} options.autoReload if the plugin should auto reload, webpack watch mode will turn this on
   * @param {boolean} options.quiet turn off any logging from this plugin
   * @param {string} options.backgroundEntry string of the background entry name
   * @param {Array<string>} options.ignoreEntries string of entries not to reload
   */
  constructor({
    port = 35729,
    host = 'localhost',
    reconnectTime = 3000,
    autoReload = true,
    quiet = false,
    backgroundEntry = 'background',
    ignoreEntries = [],
  }: {
    port?: number
    host?: string
    reconnectTime?: number
    autoReload?: boolean
    quiet?: boolean
    backgroundEntry?: string
    ignoreEntries?: Array<string>
  }) {
    // Apply Settings
    this.port = port
    this.host = host
    this.autoReload = autoReload
    this.reconnectTime = reconnectTime
    this.quiet = quiet
    this.backgroundEntry = backgroundEntry
    this.ignoreEntries = ignoreEntries

    // Set some defaults
    this.server = null
    this.startTime = Date.now()
    this.prevFileTimestamps = new Map()
  }

  /**
   * Install plugin (install hooks)
   */
  apply(compiler: webpack.Compiler) {
    const { name } = this.constructor
    if (this.autoReload) {
      compiler.hooks.watchRun.tapPromise(name, this.watchRun.bind(this))
      compiler.hooks.compile.tap(name, this.compile.bind(this))
      compiler.hooks.afterCompile.tap(name, this.afterCompile.bind(this))
      compiler.hooks.done.tap(name, this.done.bind(this))
      this.addClient(compiler)
    }
  }

  /**
   * Webpack watchRun hook only ran when autoReload is on
   */
  watchRun() {
    return this.startServer()
  }

  /**
   * Webpack done hook only ran when autoReload is on
   */
  done(stats: webpack.Stats) {
    this.reloadExtensions(stats)
  }

  /**
   * Webpack compile hook only ran when autoReload is on
   */
  compile() {
    this.notifyExtension({ action: 'compile' })
  }

  /**
   * Webpack afterCompile hook only ran when autoReload is on
   */
  afterCompile() {
    this.notifyExtension({ action: 'afterCompile' })
  }

  notifyExtension(data: { [key: string]: any }) {
    this.server?.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(data))
      }
    })
  }

  /**
   * Start websocket server only ran when autoReload is on
   */
  startServer() {
    return new Promise((resolve, reject) => {
      if (!this.autoReload || this.server) return resolve(this.server)
      const { host, port } = this
      this.server = new WebSocket.Server({ port }, () => {
        this.log(`listens on ws://${host}:${port}`)
        resolve(this.server)
      })
      this.server.on('error', reject)
      return true
    })
  }

  /**
   * Namespaced logger
   */
  log(...args: any[]) {
    if (!this.quiet) {
      console.log('webpack-webextension-plugin', ...args)
    }
  }

  /**
   * Add the client script to assets
   * when autoReload enabled
   */
  addClient(compiler: webpack.Compiler) {
    if (this.autoReload) {
      const { compileClient } = this
      const boundCompileClient = compileClient.bind(this)
      const { name } = this.constructor
      if (
        Array.isArray(compiler.options.entry) ||
        typeof compiler.options.entry !== 'object'
      ) {
        throw TypeError(
          `Webpack config key "entry" must be an object \n\r eg { 'background': '<path-to>/background.js' } \n\r to use "WebExtensionPlugin"`,
        )
      }

      // Inject the client script into each entry
      Object.keys(compiler.options.entry).forEach(entryName => {
        if (this.ignoreEntries.includes(entryName)) {
          return
        }

        const isBackground = this.backgroundEntry === entryName
        new InjectPlugin(
          // @ts-ignore
          async function loader() {
            return boundCompileClient({ entryName, isBackground }) as string
          },
          {
            entryName,
            entryOrder: ENTRY_ORDER.First,
            loaderID: `${this.constructor.name}:${entryName}`,
          },
        ).apply(compiler)
      })
    }
  }

  /**
   * Compile the client only once
   * and add it to the assets output
   *
   * @param {object} options contains some per entry options
   * @param {string} options.entryName the entry that this client is going to be injected into
   * @param {boolean} options.isBackground a flag to indicate we are injecting into the background
   */
  async compileClient({
    entryName,
    isBackground,
  }: {
    entryName: string
    isBackground: boolean
  }) {
    // Get the client as string
    const clientPath = path.resolve(
      __dirname,
      isBackground ? 'client-background.js' : 'client.js',
    )
    const clientBuffer = await pReadFile(clientPath, 'utf8')

    // // Inject settings
    const client = compileTemplate(clientBuffer, {
      port: this.port,
      host: this.host,
      reconnectTime: this.reconnectTime,
      quiet: this.quiet,
      entryName,
      isBackground,
    })

    return client
  }

  /**
   * Send message to extensions with
   * changed files
   */
  reloadExtensions(stats: webpack.Stats) {
    // Skip in normal mode
    if (!this.server) return

    // Get changed files since last compile
    const changedFiles = this.extractChangedFiles(stats)
    this.log('reloading extension...')
    this.notifyExtension({
      action: 'reload',
      changedFiles,
    })
  }

  /**
   * Get the changed files since
   * last compilation
   */
  extractChangedFiles(stats: webpack.Stats) {
    const changedFiles = new Map()
    // @ts-ignore options is not in types
    const { fileTimestamps, options } = stats.compilation
    // TODO: this probably needs better type checking
    const projectChunks =
      stats
        .toJson()
        .chunks?.flatMap(chunk =>
          chunk.modules?.filter(({ name }) => !name.includes('node_modules')),
        ) ?? []

    for (const [watchFile, timestamp] of fileTimestamps.entries()) {
      const isFile = Boolean(path.extname(watchFile))
      if (
        isFile &&
        (this.prevFileTimestamps.get(watchFile) || this.startTime) <
          (fileTimestamps.get(watchFile) || Infinity)
      ) {
        changedFiles.set(watchFile, timestamp)
      }
    }

    this.prevFileTimestamps = fileTimestamps

    // Remove context path
    const contextRegex = new RegExp(
      `^${options.context.replace('/', '\\/')}\\/`,
    )
    return Array.from(changedFiles.keys()).map(filePath => {
      const relativePath = filePath.replace(contextRegex, '')
      const module = projectChunks.find(chunk => {
        return chunk?.name === `./${relativePath}`
      })

      return {
        filePath: relativePath,
        chunks: module ? module.chunks : [],
      }
    })
  }
}
