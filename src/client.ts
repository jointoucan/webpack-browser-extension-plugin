import { AnyPortMessage } from './types'
;(function webextensionAutoReload() {
  const reconnectTime = /* PLACEHOLDER-RECONNECTTIME */ 3000 /* PLACEHOLDER-RECONNECTTIME */
  const quiet = /* PLACEHOLDER-QUIET */ false /* PLACEHOLDER-QUIET */
  const entryName =
    /* PLACEHOLDER-ENTRYNAME */ 'anon' /* PLACEHOLDER-ENTRYNAME */
  const container = document.createElement('div')
  const extension = getWebExtensionApis()

  connectPort(handlePortMessage)
  setupContainer()

  function getWebExtensionApis() {
    if (typeof chrome === 'object') {
      return chrome
    }
    return browser
  }

  function setupContainer() {
    container.id = 'web-extension-auto-reload'
    container.style.position = 'fixed'
    container.style.backgroundColor = '#222'
    container.style.fontSize = '12px'
    container.style.borderRadius = '8px'
    container.style.color = '#fff'
    container.style.margin = '8px'
    container.style.padding = '8px'
    container.style.bottom = '0'
    container.style.right = '0'
    container.style.zIndex = '10000'
    container.textContent = 'auto reload'
    document.body.appendChild(container)
  }

  /**
   * Connect to port
   */
  function connectPort(onMessage: (message: AnyPortMessage) => void) {
    try {
      const port = extension.runtime.connect({
        name: 'WebExtensionPlugin',
      })

      /**
       * We set the current port after a small timeout to avoid flicking of UI when
       * reconnecting.
       */

      const connectedTimeout = window.setTimeout(() => {
        log('port connected')
      }, 300)

      /**
       * This listens for the background to disconnect from the port. If the extension does not establish a
       * connection this gets called quickly after creating the port
       */
      port.onDisconnect.addListener(() => {
        clearTimeout(connectedTimeout)
        window.setTimeout(() => {
          log(`attempting reconnect`)
          connectPort(onMessage)
        }, reconnectTime)
      })

      /**
       * This is the onMessage event binding.
       */

      port.onMessage.addListener(onMessage)
    } catch (e) {
      log(`error happened connecting port: ${e.message}`)
    }
  }

  /**
   * Handle messages from the background process
   *
   * @param {object} payload
   * @param {string} payload.action
   * @param {Array<string>} payload.changedFiles
   */
  function handlePortMessage(message: AnyPortMessage) {
    if (!message.action) {
      return
    }

    switch (message.action) {
      case 'backgroundReload':
        log(`reloading page because ${message.reason}`)
        delayedReload()
        break
      case 'reload':
        attemptReload(message.changedFiles)
        break
      case 'compile':
        container.textContent = 'compiling'
        break
      case 'afterCompile':
        container.textContent = 'done'
        break
      default:
        break
    }
  }

  function delayedReload(delay = 300) {
    setTimeout(() => {
      window.location.reload()
    }, delay)
  }

  /**
   * attemptReload.
   * here we would like to use HMR and React fast refresh
   * @todo HMR, React fast refresh
   * @url https://github.com/facebook/react/issues/16604#issuecomment-528663101
   *
   * @param {Array<{ fileName: string; chunks: Array<string>}>} changedFiles
   */
  function attemptReload(
    changedFiles: Array<{ fileName: string; chunks: Array<string> }>,
  ) {
    const effectsEntry = changedFiles.some(({ chunks }) =>
      chunks.includes(entryName),
    )

    if (!effectsEntry) {
      log('ignoring update')
      return
    }

    // Just reload current page
    log(
      `reloading because files changed [${changedFiles
        .map(file => file.fileName)
        .join(', ')}]`,
    )
    window.location.reload()
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
