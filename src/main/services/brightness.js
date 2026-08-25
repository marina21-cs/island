const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')
const { EventEmitter } = require('events')

const BACKLIGHT = '/sys/class/backlight'
// xrandr's brightness is a gamma curve, not a backlight: below about a
// quarter the screen is unreadable rather than dim, so the range is clamped.
const SOFT_MIN = 0.25

const run = (cmd, args) =>
  new Promise((resolve) => {
    execFile(cmd, args, { timeout: 3000 }, (err, stdout) => resolve(err ? null : stdout))
  })

function findBacklight() {
  let names = []
  try {
    names = fs.readdirSync(BACKLIGHT)
  } catch {
    names = ['amdgpu_bl1', 'amdgpu_bl0', 'intel_backlight', 'acpi_video0']
  }
  for (const n of names) {
    const dir = path.join(BACKLIGHT, n)
    try {
      if (fs.existsSync(path.join(dir, 'brightness'))) return dir
    } catch {}
  }
  return null
}

function writable(file) {
  try {
    fs.accessSync(file, fs.constants.W_OK)
    return true
  } catch {
    return false
  }
}

class Brightness extends EventEmitter {
  constructor() {
    super()
    this.state = { available: false, mode: 'none', value: 100 }
    this.dir = null
    this.max = 255
    this.output = null
    this.timer = null
  }

  async start(pollMs = 4000) {
    this.dir = findBacklight()
    // Hardware is the real thing — it dims the panel and saves power — but it
    // needs a udev rule granting the video group write access. Without that,
    // fall back to xrandr, which any user can drive.
    if (this.dir && writable(path.join(this.dir, 'brightness'))) {
      this.max = parseInt(fs.readFileSync(path.join(this.dir, 'max_brightness'), 'utf8'), 10) || 255
      this.state = { available: true, mode: 'hardware', value: this.readHardware() }
      this.timer = setInterval(() => {
        const v = this.readHardware()
        if (v !== this.state.value) this.set({ ...this.state, value: v })
      }, pollMs)
    } else {
      this.output = await this.findOutput()
      if (this.output) {
        this.state = { available: true, mode: 'software', value: await this.readSoftware() }
      } else {
        this.state = { available: false, mode: 'none', value: 100 }
      }
    }
    this.emit('update', this.state)
  }

  readHardware() {
    try {
      const raw = parseInt(fs.readFileSync(path.join(this.dir, 'brightness'), 'utf8'), 10)
      return Math.round((raw / this.max) * 100)
    } catch {
      return this.state.value
    }
  }

  async findOutput() {
    const out = await run('xrandr', ['--query'])
    if (!out) return null
    const line = out.split('\n').find((l) => / connected/.test(l))
    return line ? line.split(' ')[0] : null
  }

  async readSoftware() {
    const out = await run('xrandr', ['--verbose'])
    if (!out) return 100
    const lines = out.split('\n')
    let seen = false
    for (const l of lines) {
      if (l.startsWith(`${this.output} `)) seen = true
      else if (seen && /^\S/.test(l)) break
      if (seen && l.includes('Brightness:')) {
        const v = parseFloat(l.split('Brightness:')[1])
        if (Number.isFinite(v)) return Math.round(((v - SOFT_MIN) / (1 - SOFT_MIN)) * 100)
      }
    }
    return 100
  }

  async setValue(pct) {
    const v = Math.max(0, Math.min(100, Math.round(pct)))
    if (!this.state.available) return this.state.value
    // Optimistic, so the slider tracks the pointer rather than a poll.
    this.set({ ...this.state, value: v })
    if (this.state.mode === 'hardware') {
      try {
        const raw = Math.max(1, Math.round((v / 100) * this.max))
        fs.writeFileSync(path.join(this.dir, 'brightness'), String(raw))
      } catch {}
    } else {
      const scaled = (SOFT_MIN + (v / 100) * (1 - SOFT_MIN)).toFixed(3)
      await run('xrandr', ['--output', this.output, '--brightness', scaled])
    }
    return v
  }

  set(next) {
    const changed = next.value !== this.state.value || next.mode !== this.state.mode
    this.state = next
    if (changed) this.emit('update', this.state)
  }

  current() {
    return this.state
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}

module.exports = new Brightness()
