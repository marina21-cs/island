const { app, Tray, Menu } = require('electron')

// Must be set before the app is ready: without an ARGB visual, a transparent
// window on X11 renders opaque black instead of see-through.
app.commandLine.appendSwitch('enable-transparent-visuals')
if (process.env.ISLAND_NO_GPU) app.disableHardwareAcceleration()

const config = require('./config')
const { createStage } = require('./window')
const { registerHotkeys, unregisterHotkeys } = require('./hotkeys')
const { ensureTrayIcon } = require('./icon')
const autostart = require('./autostart')
const ipc = require('./ipc')

if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

let win = null
let tray = null
let cfg = null
let visible = true
let shapePad = 0

const send = (channel, payload) => {
  if (win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
    win.webContents.send(channel, payload)
  }
}

function setVisible(next) {
  visible = next
  if (!win || win.isDestroyed()) return
  if (visible) {
    win.showInactive()
    win.setAlwaysOnTop(true, 'screen-saver')
  } else {
    win.hide()
  }
  rebuildTrayMenu()
}

function rebuildTrayMenu() {
  if (!tray) return
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: visible ? 'Hide panel' : 'Show panel', click: () => setVisible(!visible) },
      { type: 'separator' },
      {
        label: 'Start at login',
        type: 'checkbox',
        checked: autostart.isEnabled(),
        click: (item) => {
          autostart.setEnabled(item.checked)
          rebuildTrayMenu()
        },
      },
      {
        label: 'Pause clipboard capture',
        type: 'checkbox',
        checked: ipc.services.clip.current().paused,
        click: (item) => ipc.services.clip.setPaused(item.checked),
      },
      { type: 'separator' },
      { label: 'Reload', click: () => win && !win.isDestroyed() && win.reload() },
      { label: 'Quit', click: () => app.quit() },
    ])
  )
}

function open(tab) {
  if (!visible) setVisible(true)
  send('island:command', { type: 'open', tab })
}

function boot() {
  cfg = config.load()
  shapePad = Math.max(0, cfg.shadowPadding | 0)
  win = createStage(cfg)

  if (process.env.ISLAND_DEV) win.webContents.openDevTools({ mode: 'detach' })

  ipc.wire({
    win,
    cfg,
    send,
    shapePad: () => shapePad,
    onQuit: () => app.quit(),
    onHide: () => setVisible(false),
  })
  ipc.startServices(cfg)

  registerHotkeys(cfg.hotkeys, {
    toggle: () => {
      if (!visible) setVisible(true)
      send('island:command', { type: 'toggle' })
    },
    clipboard: () => open('more'),
    timers: () => open('more'),
    shot: () => ipc.services.capture.screenshot('region'),
    quit: () => app.quit(),
  })

  win.webContents.on('did-finish-load', () => {
    ipc.resync(send, cfg)
    // Dev aid: ISLAND_OPEN=tray boots straight into a tab, so a screenshot can
    // be taken without stealing the pointer.
    if (process.env.ISLAND_OPEN) setTimeout(() => open(process.env.ISLAND_OPEN), 600)
  })

  try {
    tray = new Tray(ensureTrayIcon())
    tray.setToolTip('Island')
    rebuildTrayMenu()
    tray.on('click', () => send('island:command', { type: 'toggle' }))
  } catch (err) {
    console.warn('[island] tray unavailable:', err.message)
  }
}

app.whenReady().then(() => {
  // Known Electron/X11 race: creating the window in the same tick as ready
  // sometimes lands before the ARGB visual is selected, giving a black box.
  setTimeout(boot, 150)
})

app.on('second-instance', () => setVisible(true))
app.on('window-all-closed', () => app.quit())

app.on('will-quit', () => {
  unregisterHotkeys()
  ipc.stopServices()
})
