const fs = require('fs')
const { EventEmitter } = require('events')

const PATH = '/org/mpris/MediaPlayer2'
const PLAYER = 'org.mpris.MediaPlayer2.Player'
const PROPS = 'org.freedesktop.DBus.Properties'
const PREFIX = 'org.mpris.MediaPlayer2.'
const MAX_ART_BYTES = 2 * 1024 * 1024

const EMPTY = {
  available: false,
  player: null,
  status: 'Stopped',
  title: '',
  artist: '',
  album: '',
  art: null,
  lengthMs: 0,
  positionMs: 0,
  canNext: false,
  canPrev: false,
}

// dbus-next wraps everything in Variants; unwrap defensively because players
// disagree about types constantly (artist is sometimes a string, not an array).
const unwrap = (v) => (v && typeof v === 'object' && 'value' in v ? v.value : v)
const num = (v) => {
  const u = unwrap(v)
  return typeof u === 'bigint' ? Number(u) : typeof u === 'number' ? u : 0
}
const str = (v) => {
  const u = unwrap(v)
  if (Array.isArray(u)) return u.filter(Boolean).join(', ')
  return typeof u === 'string' ? u : ''
}

function resolveArt(url) {
  if (!url) return null
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  if (!url.startsWith('file://')) return null
  try {
    const file = decodeURIComponent(url.slice('file://'.length))
    const stat = fs.statSync(file)
    if (!stat.isFile() || stat.size > MAX_ART_BYTES) return null
    const ext = file.split('.').pop().toLowerCase()
    const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
    return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`
  } catch {
    return null
  }
}

class Mpris extends EventEmitter {
  constructor() {
    super()
    this.bus = null
    this.players = new Map() // name -> { player, props, state }
    this.active = null
    this.positionTimer = null
    this.lastEmitted = null
  }

  async start() {
    let dbus
    try {
      dbus = require('dbus-next')
    } catch {
      console.warn('[island] dbus-next missing — now playing disabled')
      return this.emitState()
    }
    try {
      this.bus = dbus.sessionBus()
      this.bus.on('error', () => {})
    } catch (err) {
      console.warn('[island] no session bus — now playing disabled:', err.message)
      return this.emitState()
    }

    try {
      const obj = await this.bus.getProxyObject('org.freedesktop.DBus', '/org/freedesktop/DBus')
      const dbusIface = obj.getInterface('org.freedesktop.DBus')

      const names = await dbusIface.ListNames()
      await Promise.all(names.filter((n) => n.startsWith(PREFIX)).map((n) => this.attach(n)))

      dbusIface.on('NameOwnerChanged', (name, oldOwner, newOwner) => {
        if (!name.startsWith(PREFIX)) return
        if (newOwner && !oldOwner) this.attach(name)
        else if (!newOwner) this.detach(name)
      })
    } catch (err) {
      console.warn('[island] mpris discovery failed:', err.message)
    }

    this.positionTimer = setInterval(() => this.pollPosition(), 1000)
    this.emitState()
  }

  async attach(name) {
    if (this.players.has(name)) return
    try {
      const obj = await this.bus.getProxyObject(name, PATH)
      const player = obj.getInterface(PLAYER)
      const props = obj.getInterface(PROPS)
      const entry = { player, props, state: { ...EMPTY, available: true, player: name } }
      this.players.set(name, entry)

      props.on('PropertiesChanged', (iface, changed) => {
        if (iface !== PLAYER) return
        this.applyProps(entry, changed)
        this.chooseActive()
        this.emitState()
      })

      const all = await props.GetAll(PLAYER)
      this.applyProps(entry, all)
      this.chooseActive()
      this.emitState()
    } catch {
      // Player vanished mid-handshake, or exposes a broken interface.
      this.players.delete(name)
    }
  }

  detach(name) {
    this.players.delete(name)
    if (this.active === name) this.active = null
    this.chooseActive()
    this.emitState()
  }

  applyProps(entry, changed) {
    const s = entry.state
    if ('PlaybackStatus' in changed) s.status = str(changed.PlaybackStatus) || 'Stopped'
    if ('CanGoNext' in changed) s.canNext = !!unwrap(changed.CanGoNext)
    if ('CanGoPrevious' in changed) s.canPrev = !!unwrap(changed.CanGoPrevious)
    if ('Position' in changed) s.positionMs = Math.round(num(changed.Position) / 1000)
    if ('Metadata' in changed) {
      const m = unwrap(changed.Metadata) || {}
      s.title = str(m['xesam:title'])
      s.artist = str(m['xesam:artist'])
      s.album = str(m['xesam:album'])
      s.lengthMs = Math.round(num(m['mpris:length']) / 1000)
      const url = str(m['mpris:artUrl'])
      if (url !== s.artUrl) {
        s.artUrl = url
        s.art = resolveArt(url)
      }
    }
  }

  // Prefer whatever is actually playing; fall back to the last player we saw.
  chooseActive() {
    const entries = [...this.players.entries()]
    const playing = entries.find(([, e]) => e.state.status === 'Playing')
    if (playing) {
      this.active = playing[0]
      return
    }
    if (this.active && this.players.has(this.active)) return
    const paused = entries.find(([, e]) => e.state.status === 'Paused')
    this.active = paused ? paused[0] : entries.length ? entries[0][0] : null
  }

  async pollPosition() {
    const entry = this.active && this.players.get(this.active)
    if (!entry || entry.state.status !== 'Playing') return
    try {
      const pos = await entry.props.Get(PLAYER, 'Position')
      entry.state.positionMs = Math.round(num(pos) / 1000)
      this.emitState()
    } catch {
      // Some players refuse Position. Not worth logging every second.
    }
  }

  current() {
    const entry = this.active && this.players.get(this.active)
    if (!entry) return { ...EMPTY }
    const { artUrl, ...rest } = entry.state
    return rest
  }

  emitState() {
    const state = this.current()
    const key = JSON.stringify({ ...state, art: state.art ? state.art.length : null })
    if (key === this.lastEmitted) return
    this.lastEmitted = key
    this.emit('update', state)
  }

  async control(action) {
    const entry = this.active && this.players.get(this.active)
    if (!entry) return false
    const fn = { playpause: 'PlayPause', next: 'Next', prev: 'Previous', stop: 'Stop' }[action]
    if (!fn) return false
    try {
      await entry.player[fn]()
      return true
    } catch {
      return false
    }
  }

  stop() {
    if (this.positionTimer) clearInterval(this.positionTimer)
    this.positionTimer = null
    try {
      this.bus?.disconnect()
    } catch {}
  }
}

module.exports = new Mpris()
