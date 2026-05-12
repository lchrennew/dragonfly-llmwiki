let uiHandle = null

export function setDebugUI(ui) {
  uiHandle = ui
}

export const debug = {
  print(...args) {
    if (!uiHandle) {
      console.log('[DEBUG]', ...args)
      return
    }

    const message = args.map(arg => {
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg, null, 2)
        } catch (e) {
          return String(arg)
        }
      }
      return String(arg)
    }).join(' ')

    uiHandle.appendChat('debug', message)
  }
}
