export type BrowserPort = chrome.runtime.Port | browser.runtime.Port

export type AnyUniversalMessage =
  | { action: 'compile' }
  | { action: 'afterCompile' }
  | {
      action: 'reload'
      changedFiles: Array<{ filePath: string; chunks: string[] }>
    }

export type AnyServerMessage = AnyUniversalMessage

export type AnyPortMessage =
  | AnyUniversalMessage
  | { action: 'backgroundReload'; reason: string }

export type BrowserVendors =
  | 'chrome'
  | 'safari'
  | 'firefox'
  | 'edge'
  | 'opera'
  | 'unknown'
