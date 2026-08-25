const { contextBridge, ipcRenderer, webUtils } = require('electron')

const on = (channel) => (cb) => {
  const handler = (_e, payload) => cb(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

contextBridge.exposeInMainWorld('island', {
  snapshot: () => ipcRenderer.invoke('island:snapshot'),

  onMedia: on('island:media'),
  onVitals: on('island:vitals'),
  onTimers: on('island:timers'),
  onClipboard: on('island:clipboard'),
  onAudio: on('island:audio'),
  onNotifications: on('island:notifications'),
  onCapture: on('island:capture'),
  onWeather: on('island:weather'),
  onCommand: on('island:command'),

  setShape: (rects) => ipcRenderer.send('island:shape', rects),
  openMenu: () => ipcRenderer.send('island:menu'),

  media: (action) => ipcRenderer.invoke('island:media', action),

  setVolume: (pct) => ipcRenderer.invoke('island:audio-volume', pct),
  toggleMute: () => ipcRenderer.invoke('island:audio-mute'),

  listApps: () => ipcRenderer.invoke('island:apps-list'),
  appIcon: (id) => ipcRenderer.invoke('island:app-icon', id),
  launchApp: (id) => ipcRenderer.invoke('island:app-launch', id),

  screenshot: (mode) => ipcRenderer.invoke('island:capture-shot', mode),
  toggleRecord: () => ipcRenderer.invoke('island:capture-record'),
  reveal: (file) => ipcRenderer.invoke('island:capture-reveal', file),

  markNotifsRead: () => ipcRenderer.invoke('island:notif-read'),
  clearNotifs: () => ipcRenderer.invoke('island:notif-clear'),
  removeNotif: (id) => ipcRenderer.invoke('island:notif-remove', id),

  addTimer: (text) => ipcRenderer.invoke('island:timer-add', text),
  cancelTimer: (id) => ipcRenderer.invoke('island:timer-cancel', id),

  copyClip: (id) => ipcRenderer.invoke('island:clip-copy', id),
  removeClip: (id) => ipcRenderer.invoke('island:clip-remove', id),
  clearClips: () => ipcRenderer.invoke('island:clip-clear'),
  pauseClips: (paused) => ipcRenderer.invoke('island:clip-pause', paused),

  pickForConvert: (mode) => ipcRenderer.invoke('island:convert-pick', mode),
  convert: (mode, files) => ipcRenderer.invoke('island:convert-run', mode, files),
  revealConverted: (file) => ipcRenderer.invoke('island:convert-reveal', file),
  // Electron dropped File.path; this is the supported way to get a real path
  // for a dropped file.
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return null
    }
  },

  storeGet: (key, fallback) => ipcRenderer.invoke('island:store-get', key, fallback),
  storeSet: (key, value) => ipcRenderer.invoke('island:store-set', key, value),
})
