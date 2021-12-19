import { AnyPortMessage } from './types'
;(function webextensionAutoReload() {
  const reconnectTime = /* PLACEHOLDER-RECONNECTTIME */ 3000 /* PLACEHOLDER-RECONNECTTIME */
  const quiet = /* PLACEHOLDER-QUIET */ false /* PLACEHOLDER-QUIET */
  const entryName =
    /* PLACEHOLDER-ENTRYNAME */ 'anon' /* PLACEHOLDER-ENTRYNAME */
  const containerId = 'web-extension-auto-reload'
  const stylesId = 'web-extension-auto-reload-styles'
  const loadingClassName = 'web-extension-auto-reload-loading'
  const container = upsertElement(
    containerId,
    'div',
    document.body,
    setupContainer,
  )
  const extension = getWebExtensionApis()
  // Upsert styles
  upsertElement(stylesId, 'style', document.head, setupStyles)

  connectPort(handlePortMessage)

  function setupContainer(thisContainer: HTMLElement) {
    // Setup SVG
    const svgSize = 26
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')

    // Set attributes for svg
    svg.setAttribute('width', `${svgSize}px`)
    svg.setAttribute('height', `${svgSize}px`)
    svg.setAttribute('viewBox', `0 0 ${svgSize} ${svgSize}`)

    // Set attributes for g
    g.classList.add('browser-puzzle')
    g.setAttribute('stroke', 'none')
    g.setAttribute('stroke-width', '1')
    g.setAttribute('fill', 'none')

    // Set attributes for path
    path.setAttribute(
      'd',
      'M20.047619,23.4761905 C20.047619,24.5281614 19.1948281,25.3809524 18.1428571,25.3809524 L13.5714286,25.3809524 L13.5714286,22.8130511 C13.5714286,21.5241588 12.4336202,20.4741127 11.0115081,20.4300134 L10.9183673,20.4285714 L10.5102041,20.4285714 C9.07613426,20.4285714 7.90781381,21.4511942 7.85874724,22.7293395 L7.85714286,22.8130511 L7.85714286,25.3809524 L2.9047619,25.3809524 C1.85279095,25.3809524 1,24.5281614 1,23.4761905 L1,17.952381 L3.56790123,17.952381 C4.85679362,17.952381 5.90683965,16.8145726 5.95093899,15.3924605 L5.95238095,15.2993197 L5.95238095,14.8911565 C5.95238095,13.4570866 4.92975816,12.2887662 3.65161292,12.2396996 L3.56790123,12.2380952 L1,12.2380952 L1,7.85714286 C1,6.80517191 1.85279095,5.95238095 2.9047619,5.95238095 L7.47619048,5.95238095 L7.47619048,3.38447972 C7.47619048,2.06756793 8.58481871,1 9.95238095,1 L10.3333333,1 C11.7008956,1 12.8095238,2.06756793 12.8095238,3.38447972 L12.8095238,5.95238095 L18.1428571,5.95238095 C19.1948281,5.95238095 20.047619,6.80517191 20.047619,7.85714286 L20.047619,12.6190476 L22.6155203,12.6190476 C23.9324321,12.6190476 25,13.7276759 25,15.0952381 L25,15.4761905 C25,16.8437527 23.9324321,17.952381 22.6155203,17.952381 L20.047619,17.952381 L20.047619,23.4761905 Z',
    )

    // Append to page
    svg.appendChild(g)
    g.appendChild(path)
    thisContainer.appendChild(svg)
  }

  function getWebExtensionApis() {
    if (typeof chrome === 'object') {
      return chrome
    }
    return browser
  }

  function upsertElement(
    id: string,
    tag: string,
    element: Element,
    setup?: (el: HTMLElement) => void,
  ) {
    const el = document.getElementById(id)
    if (el) {
      return el
    }
    const newEl = document.createElement(tag)
    newEl.id = id
    element.appendChild(newEl)
    setup?.(newEl)

    return newEl
  }

  function setupStyles(style: HTMLElement) {
    const containerCSS = `
      #${containerId} {
        background-color: #272b32;
        border-radius: 8px;
        width: 40px;
        height: 40px;
        display: flex;
        justify-content: center;
        align-items: center;
        position: fixed;
        bottom: 0;
        left: 0;
        margin: 16px;
        z-index: 2147483647;
        box-shadow: 0 3px 5px rgba(0,0,0,0.2);
        transition: all 0.3s ease-in-out;
        transform: translateY(5px);
        opacity: 0;
      }
    `
    const loadingCSS = `  
      #${containerId}.${loadingClassName} {
        transform: translateY(0px);
        opacity: 1;
      }
    `

    const puzzleCSS = `
      #${containerId}.${loadingClassName} .browser-puzzle {
        stroke-dasharray: 104;
        animation-iteration-count: infinite;
        animation-duration: 2s;
        animation-name: dash;
        transition-timing-function: linear;
        transform-origin: center center;
        stroke: #9eb3d7;
      }
    `

    const animationKeyFrames = `
      @keyframes dash {
        0% {
          stroke-dashoffset: 97;
          opacity: 0;
        }
        80% {
          stroke-dashoffset: 0;
          opacity: 1;
        }
        100% {
          stroke-dashoffset: 97;
          opacity: 0;
        }
      }
    `

    if (style instanceof HTMLStyleElement) {
      style.sheet?.insertRule(containerCSS, 0)
      style.sheet?.insertRule(loadingCSS, 1)
      style.sheet?.insertRule(puzzleCSS, 2)
      style.sheet?.insertRule(animationKeyFrames, 3)
    }
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
        container.classList.add(loadingClassName)
        break
      case 'afterCompile':
        container.classList.add(loadingClassName)
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
    changedFiles: Array<{ filePath: string; chunks: Array<string> }>,
  ) {
    const effectsEntry = changedFiles.some(({ chunks }) =>
      chunks.includes(entryName),
    )

    console.log(JSON.stringify(changedFiles))
    if (!effectsEntry) {
      container.classList.remove(loadingClassName)
      log('ignoring update')
      return
    }

    // Just reload current page
    log(
      `reloading because files changed [${changedFiles
        .map(file => file.filePath)
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
