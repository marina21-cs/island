const fs = require('fs')
const path = require('path')
const { EventEmitter } = require('events')
const { app, Notification } = require('electron')

// "25m focus" / "1h30m" / "90s tea" / "5" (bare number means minutes)
function parseDuration(input) {
  const text = String(input || '').trim()
  if (!text) return null
  const re = /(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes|s|sec|secs|second|seconds)?/giy
  let ms = 0
  let matched = 0
  let idx = 0
  re.lastIndex = 0
  let m
  while ((m = re.exec(text)) !== null) {
    const value = parseFloat(m[1])
    const unit = (m[2] || 'm').toLowerCase()
    const mult = unit.startsWith('h') ? 3600 : unit.startsWith('s') ? 1 : 60
    ms += value * mult * 1000
    matched++
    idx = re.lastIndex
    // Skip separator whitespace so the sticky regex can chain "1h30m".
    while (idx < text.length && /\s/.test(text[idx])) idx++
    re.lastIndex = idx
  }
  if (!matched || ms <= 0) return null
  const label = text.slice(idx).trim()
  return { ms: Math.round(ms), label: label || 'Timer' }
}

class Timers extends EventEmitter {
  constructor() {
    super()
    this.items = []
    this.timer = null
    this.seq = 1
    this.file = null
  }

  start() {
    this.file = path.join(app.getPath('userData'), 'timers.json')
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'))
      // Drop anything that expired while we were closed.
      this.items = saved.filter((t) => t.endsAt > Date.now())
      this.seq = this.items.reduce((a, t) => Math.max(a, t.id + 1), 1)
    } catch {
      this.items = []
    }
    this.timer = setInterval(() => this.tick(), 250)
    this.emitState()
  }

  add(input) {
    const parsed = parseDuration(input)
    if (!parsed) return { ok: false, error: 'Try "25m focus" or "1h30m"' }
    const item = {
      id: this.seq++,
      label: parsed.label,
      durationMs: parsed.ms,
      endsAt: Date.now() + parsed.ms,
    }
    this.items.push(item)
    this.items.sort((a, b) => a.endsAt - b.endsAt)
    this.persist()
    this.emitState()
    return { ok: true, item }
  }

  cancel(id) {
    const before = this.items.length
    this.items = this.items.filter((t) => t.id !== id)
    if (this.items.length !== before) {
      this.persist()
      this.emitState()
    }
  }

  tick() {
    const now = Date.now()
    const done = this.items.filter((t) => t.endsAt <= now)
    if (done.length) {
      this.items = this.items.filter((t) => t.endsAt > now)
      this.persist()
      for (const t of done) {
        this.emit('fired', t)
        if (Notification.isSupported()) {
          new Notification({ title: t.label, body: 'Timer finished', urgency: 'critical' }).show()
        }
      }
    }
    // Only tick while something is actually counting down; an idle ping four
    // times a second would churn the renderer for nothing.
    if (this.items.length) this.emitState()
  }

  current() {
    return this.items.map((t) => ({ ...t, remainingMs: Math.max(0, t.endsAt - Date.now()) }))
  }

  emitState() {
    this.emit('update', this.current())
  }

  persist() {
    try {
      fs.writeFileSync(this.file, JSON.stringify(this.items))
    } catch {}
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.persist()
  }
}

module.exports = new Timers()
module.exports.parseDuration = parseDuration
