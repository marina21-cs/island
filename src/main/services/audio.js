const { execFile } = require('child_process')
const { EventEmitter } = require('events')

const run = (cmd, args) =>
  new Promise((resolve) => {
    execFile(cmd, args, { timeout: 2500 }, (err, stdout) => resolve(err ? null : stdout))
  })

class Audio extends EventEmitter {
  constructor() {
    super()
    this.state = { available: false, volume: 0, muted: false }
    this.timer = null
    this.busy = false
  }

  start(pollMs = 1500) {
    this.timer = setInterval(() => this.sample(), pollMs)
    this.sample()
  }

  async sample() {
    if (this.busy) return
    this.busy = true
    try {
      const vol = await run('pactl', ['get-sink-volume', '@DEFAULT_SINK@'])
      const mute = await run('pactl', ['get-sink-mute', '@DEFAULT_SINK@'])
      if (vol === null) {
        this.set({ available: false, volume: 0, muted: false })
        return
      }
      // "Volume: front-left: 45875 /  70% / -9.29 dB, ..." — first % is enough.
      const m = vol.match(/(\d+)%/)
      this.set({
        available: true,
        volume: m ? parseInt(m[1], 10) : 0,
        muted: /yes/i.test(mute || ''),
      })
    } finally {
      this.busy = false
    }
  }

  set(next) {
    const changed =
      next.available !== this.state.available ||
      next.volume !== this.state.volume ||
      next.muted !== this.state.muted
    this.state = next
    if (changed) this.emit('update', this.state)
  }

  async setVolume(pct) {
    const v = Math.max(0, Math.min(100, Math.round(pct)))
    // Optimistic: the slider should not wait a poll cycle to feel connected.
    this.set({ ...this.state, volume: v })
    await run('pactl', ['set-sink-volume', '@DEFAULT_SINK@', `${v}%`])
    return v
  }

  async toggleMute() {
    this.set({ ...this.state, muted: !this.state.muted })
    await run('pactl', ['set-sink-mute', '@DEFAULT_SINK@', 'toggle'])
    return this.state.muted
  }

  current() {
    return this.state
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}

module.exports = new Audio()
