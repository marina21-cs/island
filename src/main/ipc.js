const { ipcMain, Menu, shell } = require('electron')

const S = {
  mpris: require('./services/mpris'),
  vitals: require('./services/vitals'),
  timers: require('./services/timers'),
  clip: require('./services/clipboard'),
  audio: require('./services/audio'),
  brightness: require('./services/brightness'),
  apps: require('./services/apps'),
  notifs: require('./services/notifications'),
  capture: require('./services/capture'),
  weather: require('./services/weather'),
  store: require('./services/store'),
  convert: require('./services/convert'),
  map: require('./services/map'),
}

// Every service pushes to one channel; the renderer subscribes by name.
const FEEDS = [
  ['media', S.mpris],
  ['vitals', S.vitals],
  ['timers', S.timers],
  ['clipboard', S.clip],
  ['audio', S.audio],
  ['brightness', S.brightness],
  ['notifications', S.notifs],
  ['capture', S.capture],
  ['weather', S.weather],
]

function snapshot(cfg) {
  return {
    media: S.mpris.current(),
    vitals: S.vitals.current(),
    timers: S.timers.current(),
    clipboard: S.clip.current(),
    audio: S.audio.current(),
    brightness: S.brightness.current(),
    notifications: S.notifs.current(),
    capture: S.capture.current(),
    weather: S.weather.current(),
    pinned: S.store.read('pinned', null),
    config: {
      collapseDelayMs: cfg.collapseDelayMs,
      hoverDelayMs: cfg.hoverDelayMs,
      dormantDelayMs: cfg.dormantDelayMs,
      shadowPadding: cfg.shadowPadding,
      hotkeys: cfg.hotkeys,
    },
  }
}

// Services start before the renderer attaches its listeners, so their first
// update can land in the void — weather resolves once every 15 minutes, so
// losing that one costs the whole session. Replay everything on load.
function resync(send, cfg) {
  const snap = snapshot(cfg)
  for (const [name] of FEEDS) {
    if (snap[name] !== undefined) send(`island:${name}`, snap[name])
  }
}

// The last shape the renderer asked for. Coming back from suspend, KWin can
// drop the window's shape and its always-on-top flag; re-applying what we
// already know avoids waiting for the renderer's next idle sweep.
let lastShape = null

function reapplyShape(win) {
  if (!win || win.isDestroyed() || !lastShape) return
  win.setShape(lastShape)
}

function wire({ win, cfg, send, shapePad, onQuit, onHide }) {
  for (const [name, service] of FEEDS) {
    service.on('update', (state) => send(`island:${name}`, state))
  }
  S.notifs.on('arrived', (item) => send('island:command', { type: 'notification', item }))
  S.timers.on('fired', (t) => send('island:command', { type: 'timer-fired', timer: t }))
  S.capture.on('recorded', (file) => send('island:command', { type: 'recorded', file }))
  S.capture.on('shot', (file) => send('island:command', { type: 'shot', file }))
  S.capture.on('error', (msg) => send('island:command', { type: 'capture-error', message: msg }))

  ipcMain.handle('island:snapshot', () => snapshot(cfg))

  // The renderer reports every visible surface; those rectangles become the
  // window's X11 shape, so only they are clickable and everything else falls
  // through to the desktop.
  ipcMain.on('island:shape', (_e, rects) => {
    if (!win || win.isDestroyed()) return
    const pad = shapePad()
    const shape = (rects || [])
      .filter((r) => r && r.width > 0 && r.height > 0)
      .map((r) => ({
        x: Math.max(0, Math.round(r.x) - pad),
        y: Math.max(0, Math.round(r.y) - pad),
        width: Math.round(r.width) + pad * 2,
        height: Math.round(r.height) + pad * 2,
      }))
    lastShape = shape.length ? shape : [{ x: 0, y: 0, width: 1, height: 1 }]
    win.setShape(lastShape)
  })

  ipcMain.handle('island:media', (_e, action) => S.mpris.control(action))

  ipcMain.handle('island:audio-volume', (_e, pct) => S.audio.setVolume(pct))
  ipcMain.handle('island:audio-mute', () => S.audio.toggleMute())
  ipcMain.handle('island:brightness', (_e, pct) => S.brightness.setValue(pct))

  ipcMain.handle('island:apps-list', () => S.apps.list().map(({ file, exec, ...rest }) => rest))
  ipcMain.handle('island:app-icon', (_e, id) => S.apps.iconDataUrl(id))
  ipcMain.handle('island:app-launch', (_e, id) => S.apps.launch(id))

  ipcMain.handle('island:capture-shot', (_e, mode) => S.capture.screenshot(mode))
  ipcMain.handle('island:capture-record', () => S.capture.toggleRecording())
  ipcMain.handle('island:capture-reveal', (_e, file) => S.capture.reveal(file))

  ipcMain.handle('island:notif-read', () => S.notifs.markRead())
  ipcMain.handle('island:notif-clear', () => S.notifs.clear())
  ipcMain.handle('island:notif-remove', (_e, id) => S.notifs.remove(id))

  ipcMain.handle('island:timer-add', (_e, text) => S.timers.add(text))
  ipcMain.handle('island:timer-cancel', (_e, id) => S.timers.cancel(id))

  ipcMain.handle('island:clip-copy', (_e, id) => S.clip.copy(id))
  ipcMain.handle('island:clip-remove', (_e, id) => S.clip.remove(id))
  ipcMain.handle('island:clip-clear', () => S.clip.clear())
  ipcMain.handle('island:clip-pause', (_e, paused) => S.clip.setPaused(paused))

  // Generic document store for the notes, board and budget panels.
  ipcMain.handle('island:store-get', (_e, key, fallback) => S.store.read(key, fallback))
  ipcMain.handle('island:store-set', (_e, key, value) => S.store.write(key, value))

  // Windy's own forecast API needs an account key, so the panel shows
  // Open-Meteo's numbers and hands the map off to Windy in the browser.
  ipcMain.handle('island:open-windy', () => {
    const c = coords()
    if (!c) return false
    shell.openExternal(`https://www.windy.com/?${c.lat},${c.lon},9`)
    return true
  })

  // The map only needs coordinates, which survive a failed forecast: the
  // geocode is cached to disk, so the map still draws when the API is down.
  function coords() {
    const w = S.weather.current()
    if (w && w.lat !== undefined && w.lon !== undefined) return { lat: w.lat, lon: w.lon }
    const p = S.store.read('weather-place', null)
    if (p && Number.isFinite(p.lat) && Number.isFinite(p.lon)) return { lat: p.lat, lon: p.lon }
    return null
  }

  ipcMain.handle('island:map', (_e, opts) => {
    const c = coords()
    return c ? S.map.render({ ...c, ...(opts || {}) }) : null
  })

  ipcMain.handle('island:convert-pick', (_e, mode) => S.convert.pick(mode))
  ipcMain.handle('island:convert-run', (_e, mode, files) => S.convert.convert(mode, files))
  ipcMain.handle('island:convert-reveal', (_e, file) => S.convert.reveal(file))

  ipcMain.on('island:blur', () => {
    if (win && !win.isDestroyed() && win.isFocused()) win.blur()
  })

  ipcMain.on('island:menu', () => {
    if (!win || win.isDestroyed()) return
    Menu.buildFromTemplate([
      { label: 'Hide panel', click: onHide },
      { label: 'Reload', click: () => win.reload() },
      { type: 'separator' },
      { label: 'Quit', click: onQuit },
    ]).popup({ window: win })
  })
}

function startServices(cfg) {
  S.vitals.start(cfg.vitals.pollMs)
  S.timers.start()
  S.clip.start(cfg.clipboard)
  S.audio.start()
  S.brightness.start()
  S.mpris.start()
  S.notifs.start()
  S.weather.start(cfg.weatherCity, undefined, cfg.weatherLat, cfg.weatherLon)
}

function stopServices() {
  for (const s of Object.values(S)) if (typeof s.stop === 'function') s.stop()
}

module.exports = { wire, startServices, stopServices, snapshot, resync, reapplyShape, services: S }
