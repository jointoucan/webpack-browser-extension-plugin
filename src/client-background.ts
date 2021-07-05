import { AnyPortMessage, AnyServerMessage, BrowserPort } from './types'
;(function webextensionAutoReload() {
  const host = /* PLACEHOLDER-HOST */ 'localhost' /* PLACEHOLDER-HOST */
  const port = /* PLACEHOLDER-PORT */ 35729 /* PLACEHOLDER-PORT */
  const reconnectTime = /* PLACEHOLDER-RECONNECTTIME */ 3000 /* PLACEHOLDER-RECONNECTTIME */
  const quiet = /* PLACEHOLDER-QUIET */ false /* PLACEHOLDER-QUIET */
  const entryName =
    /* PLACEHOLDER-ENTRYNAME */ 'anon' /* PLACEHOLDER-ENTRYNAME */
  const fileRegex = /[^"]*\.[a-zA-Z]+/g
  const extension = getWebExtensionApis()
  const connections: (chrome.runtime.Port | browser.runtime.Port)[] = []

  connect()

  /**
   * broadcastMessage sends a message to all connections
   */
  function broadcastMessage(message: AnyPortMessage) {
    connections.forEach(port => {
      port.postMessage(message)
    })
  }

  function getWebExtensionApis() {
    if (typeof chrome === 'object') {
      return chrome
    }
    return browser
  }

  const onAddConnection = (port: BrowserPort) => {
    if (port.name !== 'WebExtensionPlugin') {
      return
    }
    connections.push(port)
    /**
     * This port disconnect handler just handles when a client disconnects we cleanup the connection
     * from the extension memory. If the connection is terminated from this side, eg like the background
     * process shutting down the client will attempt to make another connection.
     */

    port.onDisconnect.addListener(() => {
      const portIndex = connections.indexOf(port)
      if (portIndex === -1) {
        return
      }
      connections.splice(portIndex, 1)
    })
  }

  extension.runtime.onConnect.addListener(onAddConnection)

  /**
   * Connect to the server
   */
  function connect() {
    const connection = new WebSocket(`ws://${host}:${port}`)
    connection.onopen = () => {
      log('Connected')
    }
    connection.onmessage = event => {
      let payload
      try {
        payload = JSON.parse(event.data)
      } catch (error) {
        log('Could not parse server payload')
      }
      handleServerMessage(payload)
    }
    connection.onerror = () => {
      log('Connection error.')
    }
    connection.onclose = () => {
      log("Connection lost. Reconnecting in %ss'", reconnectTime / 1000)
      reconnect()
    }
  }

  /**
   * Debounced connect to the server
   */
  const reconnect = debounce(connect, reconnectTime)

  /**
   * Simple debounce function
   * Delay and throttle the execution
   * of the fs function
   *
   * @param {function} fn
   * @param {number} time
   */
  function debounce(fn: () => void, time: number) {
    let timeout: number
    return function debounceInner() {
      const functionCall = () => fn.call(this)
      clearTimeout(timeout)
      // Casting here because we can not really pull from window to get number
      // since this might be in a service worker
      timeout = setTimeout(functionCall, time) as unknown as number
    }
  }

  /**
   * Handle messages from the server
   *
   * @param {object} payload
   * @param {string} payload.action
   * @param {Array<string>} payload.changedFiles
   */
  function handleServerMessage(message: AnyServerMessage) {
    switch (message.action) {
      case 'reload':
        attemptReload(message.changedFiles)
        break
      default:
        // Passthrough messages to client, about compiling status.
        broadcastMessage({
          action: message.action,
        })
    }
  }

  /**
   * reloadExtension allows us to reload the entire extension.
   * we signal to the clients to reload, and then we reload the background
   * page.
   */
  function reloadExtension(reason: string) {
    if (reason) {
      log(`reloading extension because ${reason}`)
    }
    const message = { action: 'backgroundReload', reason } as const
    broadcastMessage(message)
    extension.runtime.reload()
  }

  /**
   * attemptReload.
   * We don't like reopening our devtools after a browser.runtime.reload.
   * Since it is not possible to open them programmatically, we
   * need to reduce the runtime.reloads.
   * This function prefers softer reloads, by comparing
   * runtime dependencies with the changed files.
   *
   * @param {Array<{ fileName: string; chunks: Array<string>}>} changedFiles
   */
  function attemptReload(
    changedFiles: Array<{ filePath: string; chunks: Array<string> }>,
  ) {
    // TODO send a message to tabs from here, to indicate they need a reload if changed
    log('Checking to see if we need to reload')

    // Full reload if we have no changed files (dump reload!)
    if (!changedFiles.length) {
      reloadExtension('initial compile happened')
      return
    }

    const effectsEntry = changedFiles.some(({ chunks }) =>
      chunks.includes(entryName),
    )

    // Full reload manifest changed
    if (changedFiles.some(file => file.filePath.includes('manifest.json'))) {
      reloadExtension('manifest updated')
      return
    }

    // Full reload if _locales changed
    if (changedFiles.some(file => file.filePath.includes('_locales'))) {
      reloadExtension('locales updated')
      return
    }

    // Full reload if manifest deps changed
    const manifestDeps = getManifestFileDeps()
    if (changedFiles.some(file => manifestDeps.includes(file.filePath))) {
      reloadExtension('manifest dependency updated')
      return
    }

    if (!effectsEntry) {
      // Broadcast change to clients in case a files changed in them
      broadcastMessage({ action: 'reload', changedFiles })
      log('ignoring update')
      return
    }

    reloadExtension('background file updated')
  }

  /**
   * Return all files dependencies listed
   * in the manifest.json.
   */
  function getManifestFileDeps() {
    const manifest = extension.runtime.getManifest()
    const manifestStr = JSON.stringify(manifest)
    return manifestStr.match(fileRegex) || []
  }

  /**
   * Simple namespaced logger
   *
   * @param {*} message
   * @param {*} args
   */
  function log(message: string, ...args: any[]) {
    if (!quiet) {
      console.log(`%cextension-reloader: ${message}`, 'color: grey;', ...args)
    }
  }
})()
