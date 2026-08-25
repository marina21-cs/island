const path = require('path')
const { BrowserWindow, screen } = require('electron')

// The stage is a transparent window pinned to the top edge of the primary
// display. It never moves and never resizes; the panel morphs inside it, and
// the X11 shape decides which parts of it exist as far as the pointer is
// concerned.
function createStage(config) {
  const display = screen.getPrimaryDisplay()
  const width = display.bounds.width
  const height = config.stage.height

  const win = new BrowserWindow({
    width,
    height,
    x: display.bounds.x,
    y: display.bounds.y,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: true,
    show: false,
    acceptFirstMouse: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  })

  // 'screen-saver' is the only level that reliably sits above a fullscreen
  // window under KWin. Anything lower gets buried by a fullscreen browser.
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  // Clip to nothing until the renderer reports where its surfaces are.
  //
  // setIgnoreMouseEvents is the wrong tool here: its `forward` option is
  // macOS/Windows only, so on X11 a click-through window receives no mouse
  // events at all and can never notice the pointer returning. Polling
  // screen.getCursorScreenPoint() does not rescue it either — that value only
  // refreshes when the app itself receives input, so it freezes solid.
  //
  // The X11 shape extension has neither problem: the server clips both input
  // and rendering to the region, so everything outside the panel reaches the
  // desktop and everything inside arrives as an ordinary DOM event.
  win.setShape([{ x: 0, y: 0, width: 1, height: 1 }])

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'))
  win.once('ready-to-show', () => win.showInactive())

  const reposition = () => {
    if (win.isDestroyed()) return
    const d = screen.getPrimaryDisplay()
    win.setBounds({ x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height })
  }
  screen.on('display-metrics-changed', reposition)
  screen.on('display-added', reposition)
  screen.on('display-removed', reposition)

  return win
}

module.exports = { createStage }
