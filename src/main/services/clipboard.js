const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { EventEmitter } = require('events')
const { app, clipboard } = require('electron')

const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12)

class ClipboardHistory extends EventEmitter {
  constructor() {
    super()
    this.items = []
    this.timer = null
    this.max = 60
    this.file = null
    this.paused = false
    this.lastSeen = ''
  }

  start({ pollMs, max }) {
    this.max = max
    this.file = path.join(app.getPath('userData'), 'clipboard.json')
    try {
      this.items = JSON.parse(fs.readFileSync(this.file, 'utf8')).slice(0, this.max)
    } catch {
      this.items = []
    }
    this.lastSeen = clipboard.readText() || ''
    this.timer = setInterval(() => this.poll(), pollMs)
    this.emitState()
  }

  poll() {
    if (this.paused) return
    let text = ''
    try {
      text = clipboard.readText() || ''
    } catch {
      return
    }
    if (!text.trim() || text === this.lastSeen) return
    this.lastSeen = text
    this.record(text)
  }

  record(text) {
    const id = hash(text)
    // A repeat copy moves the entry to the front rather than duplicating it.
    this.items = this.items.filter((i) => i.id !== id)
    this.items.unshift({ id, text, at: Date.now() })
    if (this.items.length > this.max) this.items.length = this.max
    this.persist()
    this.emitState()
  }

  copy(id) {
    const item = this.items.find((i) => i.id === id)
    if (!item) return false
    // Mark it seen first so our own write doesn't bounce back through poll().
    this.lastSeen = item.text
    clipboard.writeText(item.text)
    this.items = [item, ...this.items.filter((i) => i.id !== id)]
    this.persist()
    this.emitState()
    return true
  }

  remove(id) {
    this.items = this.items.filter((i) => i.id !== id)
    this.persist()
    this.emitState()
  }

  clear() {
    this.items = []
    this.persist()
    this.emitState()
  }

  setPaused(paused) {
    this.paused = !!paused
    this.emitState()
  }

  current() {
    return { paused: this.paused, items: this.items }
  }

  emitState() {
    this.emit('update', this.current())
  }

  persist() {
    try {
      fs.writeFileSync(this.file, JSON.stringify(this.items), { mode: 0o600 })
    } catch {}
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.persist()
  }
}

module.exports = new ClipboardHistory()
