import path from 'path'
import https from 'https'
import fs from 'fs-extra'
import InjectPlugin, { ENTRY_ORDER } from 'webpack-inject-plugin'
import WebSocket from 'ws'
import { compileTemplate } from './compileTemplate'
import type webpack from 'webpack'

type BrowserVendors =
  | 'chrome'
  | 'safari'
  | 'firefox'
  | 'edge'
  | 'opera'
  | 'unknown'
export class BrowserExtensionPlugin {
  vendor: BrowserVendors
  port: number
  host: string
  reconnectTime: number
  autoReload: boolean
  quiet: boolean
  backgroundEntry: string
  ignoreEntries: Array<string>
  server: WebSocket.Server | null
  startTime: number
  prevFileTimestamps: Map<string, number>
  manifestFilePath?: string
  manifest?: any
  cert?: Buffer
  key?: Buffer
  isSecure: boolean
  onCompileManifest?: (
    manifest: browser._manifest.ManifestBase,
  ) => Promise<browser._manifest.ManifestBase>
  localeDirectory?: string

  /**
   * @param {object} options a set of options that allows you to configure this plugin
   * @param {string} options.vendor the browser vendor of the extension
   * @param {number} options.port the port to listen on
   * @param {string} options.host the host to listen on
   * @param {number} options.reconnectTime the amount of time it will attempt to reconnect
   * @param {boolean} options.autoReload if the plugin should auto reload, webpack watch mode will turn this on
   * @param {boolean} options.quiet turn off any logging from this plugin
   * @param {string} options.backgroundEntry string of the background entry name
   * @param {Array<string>} options.ignoreEntries string of entries not to reload
   */
  constructor({
    port = 9090,
    host = 'localhost',
    reconnectTime = 3000,
    autoReload = true,
    quiet = false,
    backgroundEntry = 'background',
    ignoreEntries = [],
    manifestFilePath,
    localeDirectory,
    onCompileManifest,
    key,
    cert,
    vendor,
  }: {
    port?: number
    host?: string
    reconnectTime?: number
    autoReload?: boolean
    quiet?: boolean
    backgroundEntry?: string
    ignoreEntries?: Array<string>
    manifestFilePath?: string
    localeDirectory?: string
    key: Buffer
    cert: Buffer
    vendor?: BrowserVendors
    onCompileManifest?: (
      manifest: browser._manifest.ManifestBase,
    ) => Promise<browser._manifest.ManifestBase>
  }) {
    // Apply Settings
    this.port = port
    this.host = host
    this.autoReload = autoReload
    this.reconnectTime = reconnectTime
    this.quiet = quiet
    this.backgroundEntry = backgroundEntry
    this.ignoreEntries = ignoreEntries
    this.manifestFilePath = manifestFilePath
    this.localeDirectory = localeDirectory
    this.onCompileManifest = onCompileManifest
    this.isSecure = !!(key && cert)
    this.key = key
    this.cert = cert
    this.vendor = vendor ?? 'unknown'
    // Set some defaults
    this.server = null
    this.startTime = Date.now()
    this.prevFileTimestamps = new Map()
  }

  /**
   * Install plugin (install hooks)
   */
  async apply(compiler: webpack.Compiler) {
    const { name } = this.constructor
    if (this.autoReload) {
      compiler.hooks.watchRun.tapPromise(name, this.watchRun.bind(this))
      compiler.hooks.compile.tap(name, this.compile.bind(this))
      compiler.hooks.afterCompile.tap(name, this.afterCompile.bind(this))
      compiler.hooks.done.tap(name, this.done.bind(this))
      this.addClient(compiler)
    }
    if (this.manifestFilePath) {
      await this.compileManifest(compiler)
    }
    if (this.localeDirectory) {
      await this.syncLocales(compiler)
    }
  }

  /**
   * Webpack watchRun hook only ran when autoReload is on
   */
  async watchRun(compiler: webpack.Compiler) {
    const changedFiles = Array.from(
      this.getChangedFiles(compiler.fileTimestamps).keys(),
    ) as string[]

    // Compile manifest when it changes
    if (changedFiles.some(file => file.includes('manifest.json'))) {
      await this.compileManifest(compiler)
    }

    if (changedFiles.some(file => file.includes('_locales'))) {
      await this.syncLocales(compiler)
    }

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
  afterCompile(compilation: webpack.compilation.Compilation) {
    this.notifyExtension({ action: 'afterCompile' })
    if (this.manifestFilePath) {
      compilation.fileDependencies.add(path.resolve(this.manifestFilePath))
    }
    if (this.localeDirectory) {
      compilation.contextDependencies.add(path.resolve(this.localeDirectory))
    }
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
      const { host, port, key, cert } = this
      if (key && cert) {
        const server = https.createServer({ key, cert })
        this.server = new WebSocket.Server({
          server,
        })
        server.listen(port, host, () => {
          this.log(`listens on wss://${host}:${port}`)
          resolve(this.server)
        })
      } else {
        this.server = new WebSocket.Server({ port, host }, () => {
          this.log(`listens on ws://${host}:${port}`)
          resolve(this.server)
        })
        this.server.on('error', reject)
      }
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
   * compiles the manifest file using an external hook
   */
  async compileManifest(compiler: webpack.Compiler) {
    if (this.manifestFilePath) {
      try {
        this.manifest = JSON.parse(
          await fs.readFile(this.manifestFilePath, 'utf8'),
        ) as browser._manifest.ManifestBase

        if (this.onCompileManifest) {
          this.manifest = await this.onCompileManifest(this.manifest)
        }

        await fs.writeFile(
          path.resolve(compiler.outputPath, 'manifest.json'),
          JSON.stringify(this.manifest, null, 2),
        )
      } catch (err) {
        this.log(`failed to compile manifest: ${err.message}`)
      }
    }
  }

  /**
   * Sync locales with webpack
   */
  async syncLocales(compiler: webpack.Compiler) {
    if (this.localeDirectory) {
      await fs.copySync(
        this.localeDirectory,
        path.resolve(compiler.outputPath, './_locales'),
      )
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
    const clientBuffer = await fs.readFile(clientPath, 'utf8')

    const hasManifestContentScripts =
      this.manifest &&
      'content_scripts' in this.manifest &&
      this.manifest.content_scripts.length > 0

    // // Inject settings
    const client = compileTemplate(clientBuffer, {
      port: this.port,
      host: this.host,
      reconnectTime: this.reconnectTime,
      quiet: this.quiet,
      entryName,
      isBackground,
      isSecure: this.isSecure,
      // Firefox caching on programmatic injection is pretty strong so we need to clear it
      alwayFullReload: this.vendor === 'firefox' || hasManifestContentScripts,
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

  getChangedFiles(fileTimestamps: Map<string, number>) {
    const changedFiles = new Map()
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
    return changedFiles
  }

  /**
   * Get the changed files since
   * last compilation
   */
  extractChangedFiles(stats: webpack.Stats) {
    // @ts-ignore options is not in types
    const { fileTimestamps, options } = stats.compilation
    const changedFiles = this.getChangedFiles(fileTimestamps)
    // TODO: this probably needs better type checking
    const projectChunks =
      stats
        .toJson()
        .chunks?.flatMap(chunk =>
          chunk.modules?.filter(({ name }) => !name.includes('node_modules')),
        ) ?? []

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
