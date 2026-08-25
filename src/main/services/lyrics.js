const { EventEmitter } = require('events')

// LRCLIB: community lyrics database, no API key, and — the reason it is the
// right source here — it indexes by duration. Asking for the wrong length gets
// a 404 rather than someone else's words, which is exactly the failure mode
// lyrics should have.
const BASE = 'https://lrclib.net/api'
const UA = 'island-panel/0.1 (https://github.com/marina21-cs/island)'
const TIMEOUT_MS = 9000
const CACHE_MAX = 40

// Only Spotify, by request. Anything else — a browser tab, a video — has
// metadata too loose to match a recording against with any confidence.
const SOURCES = new Set(['spotify'])

// Matching tolerance for the search fallback. Spotify reports track length
// accurately, so a few seconds is generous; beyond it we are guessing.
const DURATION_SLOP_S = 3

const EMPTY = {
  available: false,
  state: 'idle', // idle | loading | ok | none | instrumental | error
  source: '',
  title: '',
  artist: '',
  synced: [],
  plain: '',
  hasTiming: false,
}

const cache = new Map()

function remember(key, value) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value)
  cache.set(key, value)
  return value
}

// Comparison form: drop the bracketed editions, the "- Live at ..." tails and
// the featured artists that differ between a streaming service and a lyrics
// database for what is the same recording.
function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/\s-\s.*$/, ' ')
    .replace(/\bfeat\.?\b.*$/, ' ')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '')
}

// Standard LRC: one or more [mm:ss.xx] stamps, then the line. Blank lines are
// kept — they are the instrumental gaps, and dropping them makes the highlight
// hang on the previous lyric through a whole solo.
function parseLrc(text) {
  const out = []
  for (const raw of String(text || '').split('\n')) {
    const m = raw.match(/^((?:\s*\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\])+)(.*)$/)
    if (!m) continue
    const body = m[2].trim()
    for (const stamp of m[1].match(/\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/g) || []) {
      const p = stamp.match(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/)
      if (!p) continue
      const frac = p[3] ? Number(p[3].padEnd(3, '0')) / 1000 : 0
      out.push({ t: Number(p[1]) * 60 + Number(p[2]) + frac, text: body })
    }
  }
  return out.sort((a, b) => a.t - b.t)
}

async function json(url) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA } })
    if (res.status === 404) return { notFound: true }
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function shape(record) {
  if (!record) return null
  if (record.instrumental) {
    return { ...EMPTY, available: true, state: 'instrumental' }
  }
  const synced = parseLrc(record.syncedLyrics)
  const plain = String(record.plainLyrics || '').trim()
  if (!synced.length && !plain) return null
  return {
    ...EMPTY,
    available: true,
    state: 'ok',
    synced,
    plain,
    hasTiming: synced.length > 0,
  }
}

// Never return a near match on title alone: a wrong lyric sheet that scrolls in
// time is worse than no lyrics, because it looks authoritative.
function pickFromSearch(results, { artist, title, album, seconds }) {
  if (!Array.isArray(results) || !results.length) return null
  const wantTitle = norm(title)
  const wantArtist = norm(artist)
  const wantAlbum = norm(album)

  const scored = results
    .map((r) => {
      const dt = Math.abs((r.duration || 0) - seconds)
      const titleOk = norm(r.trackName) === wantTitle
      const artistOk = !wantArtist || norm(r.artistName).includes(wantArtist) || wantArtist.includes(norm(r.artistName))
      return { r, dt, titleOk, artistOk, albumOk: !!wantAlbum && norm(r.albumName) === wantAlbum }
    })
    .filter((c) => c.titleOk && c.artistOk && c.dt <= DURATION_SLOP_S)

  if (!scored.length) return null
  scored.sort((a, b) => {
    const timing = Number(!!b.r.syncedLyrics) - Number(!!a.r.syncedLyrics)
    if (timing) return timing
    const album = Number(b.albumOk) - Number(a.albumOk)
    if (album) return album
    return a.dt - b.dt
  })
  return scored[0].r
}

class Lyrics extends EventEmitter {
  constructor() {
    super()
    this.state = { ...EMPTY }
    this.key = ''
    this.token = 0
  }

  start(mpris) {
    mpris.on('update', (m) => this.onMedia(m))
  }

  onMedia(m) {
    const usable =
      m && m.available && m.title && SOURCES.has(String(m.source || '').toLowerCase())

    if (!usable) {
      if (this.state.state !== 'idle') this.set({ ...EMPTY })
      this.key = ''
      return
    }

    const seconds = Math.round((m.lengthMs || 0) / 1000)
    const key = `${norm(m.artist)}|${norm(m.title)}|${seconds}`
    if (key === this.key) return
    this.key = key

    const meta = { artist: m.artist, title: m.title, album: m.album, seconds }
    if (cache.has(key)) {
      this.set({ ...cache.get(key), source: m.source, title: m.title, artist: m.artist })
      return
    }
    this.set({ ...EMPTY, available: true, state: 'loading', source: m.source, title: m.title, artist: m.artist })
    this.load(key, meta, ++this.token)
  }

  async load(key, meta, token) {
    const q = (o) =>
      Object.entries(o)
        .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
        .join('&')

    // Exact first: artist, track, album and duration together.
    let record = await json(
      `${BASE}/get?${q({
        artist_name: meta.artist || '',
        track_name: meta.title || '',
        album_name: meta.album || '',
        duration: meta.seconds || 0,
      })}`
    )

    // Then a search, filtered hard on title, artist and duration.
    if (!record || record.notFound) {
      const results = await json(
        `${BASE}/search?${q({ artist_name: meta.artist || '', track_name: meta.title || '' })}`
      )
      record = results && !results.notFound ? pickFromSearch(results, meta) : null
    }

    if (token !== this.token) return // the track moved on while we were asking

    const shaped = shape(record) || { ...EMPTY, available: true, state: 'none' }
    remember(key, shaped)
    this.set({ ...shaped, source: meta.source || 'spotify', title: meta.title, artist: meta.artist })
  }

  set(next) {
    this.state = next
    this.emit('update', this.state)
  }

  current() {
    return this.state
  }

  stop() {}
}

module.exports = new Lyrics()
module.exports.parseLrc = parseLrc
module.exports.pickFromSearch = pickFromSearch
module.exports.norm = norm
