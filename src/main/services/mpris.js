const fs = require('fs')
const { EventEmitter } = require('events')
const apps = require('./apps')

const PATH = '/org/mpris/MediaPlayer2'
const PLAYER = 'org.mpris.MediaPlayer2.Player'
const PROPS = 'org.freedesktop.DBus.Properties'
const ROOT = 'org.mpris.MediaPlayer2'
const PREFIX = 'org.mpris.MediaPlayer2.'
const MAX_ART_BYTES = 6 * 1024 * 1024
const ART_TIMEOUT_MS = 6000

const EMPTY = {
  available: false,
  player: null,
  status: 'Stopped',
  title: '',
  artist: '',
  album: '',
  art: null,
  source: '',
  sourceName: '',
  sourceIcon: null,
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

// Cover art has to arrive as a data URL. Spotify and every browser hand out
// https URLs, and the renderer's CSP does not allow remote images — nor should
// it, since that would let whatever is playing decide what the panel fetches.
// Main does the fetching instead, so the renderer only ever sees data:.
const artCache = new Map()
const ART_CACHE_MAX = 24

function cacheArt(url, value) {
  if (artCache.size >= ART_CACHE_MAX) artCache.delete(artCache.keys().next().value)
  artCache.set(url, value)
  return value
}

function readLocalArt(url) {
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

async function fetchArt(url) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ART_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow' })
    if (!res.ok) return null
    const type = (res.headers.get('content-type') || 'image/jpeg').split(';')[0].trim()
    if (!type.startsWith('image/')) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (!buf.length || buf.length > MAX_ART_BYTES) return null
    return `data:${type};base64,${buf.toString('base64')}`
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function resolveArt(url) {
  if (!url) return null
  if (artCache.has(url)) return artCache.get(url)
  if (url.startsWith('file://')) return cacheArt(url, readLocalArt(url))
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return cacheArt(url, await fetchArt(url))
  }
  return null
}

// Browsers register as org.mpris.MediaPlayer2.firefox.instance_1_7; the bus
// name is the only hint when a player omits DesktopEntry.
function sourceFromBusName(name) {
  return name.slice(PREFIX.length).split('.')[0].replace(/^instance\d+$/, '')
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

      // The root interface names the owning app. DesktopEntry is the reliable
      // handle; the bus name is the fallback for players that omit it.
      try {
        const root = await props.GetAll(ROOT)
        const source = str(root.DesktopEntry) || sourceFromBusName(name)
        entry.state.source = source
        entry.state.sourceName = str(root.Identity) || source
        entry.state.sourceIcon = apps.iconDataUrlFor(source)
      } catch {
        const source = sourceFromBusName(name)
        entry.state.source = source
        entry.state.sourceName = source
        entry.state.sourceIcon = apps.iconDataUrlFor(source)
      }

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
        s.art = null
        if (url) {
          // Remote art arrives late; apply it only if the track has not
          // changed underneath us in the meantime.
          resolveArt(url).then((data) => {
            if (s.artUrl !== url || !data) return
            s.art = data
            this.emitState()
          })
        }
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
