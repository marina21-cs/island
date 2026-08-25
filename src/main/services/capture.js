const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn, execFile } = require('child_process')
const { EventEmitter } = require('events')
const { screen, shell } = require('electron')

const has = (cmd) => {
  try {
    require('child_process').execFileSync('which', [cmd], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function outDir() {
  const dir = path.join(os.homedir(), 'Pictures', 'Island')
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch {}
  return dir
}

function stamp(now) {
  const d = new Date(now)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

class Capture extends EventEmitter {
  constructor() {
    super()
    this.rec = null
    this.startedAt = 0
    this.ticker = null
  }

  available() {
    return { screenshot: has('spectacle'), record: has('ffmpeg') }
  }

  // Spectacle owns screenshots on Plasma; -b runs it headless, -n skips its
  // own notification so ours is the only one.
  screenshot(mode = 'full') {
    return new Promise((resolve) => {
      const file = path.join(outDir(), `shot-${stamp(Date.now())}.png`)
      const flags = mode === 'region' ? ['-b', '-n', '-r', '-o', file] : ['-b', '-n', '-f', '-o', file]
      execFile('spectacle', flags, { timeout: 60000 }, (err) => {
        if (err || !fs.existsSync(file)) return resolve({ ok: false, error: 'Screenshot failed' })
        this.emit('shot', file)
        resolve({ ok: true, file })
      })
    })
  }

  startRecording() {
    if (this.rec) return { ok: false, error: 'Already recording' }
    const d = screen.getPrimaryDisplay()
    const w = Math.floor(d.bounds.width / 2) * 2
    const h = Math.floor(d.bounds.height / 2) * 2
    const file = path.join(outDir(), `rec-${stamp(Date.now())}.mp4`)
    const args = [
      '-loglevel', 'error', '-y',
      '-f', 'x11grab', '-framerate', '30', '-video_size', `${w}x${h}`,
      '-i', `${process.env.DISPLAY || ':0'}.0+${d.bounds.x},${d.bounds.y}`,
      '-f', 'pulse', '-i', 'default',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k',
      file,
    ]
    try {
      // stdin stays open: ffmpeg needs a 'q' to finalise the container.
      this.rec = spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'] })
    } catch (err) {
      this.rec = null
      return { ok: false, error: err.message }
    }
    this.rec.file = file
    this.startedAt = Date.now()
    let stderr = ''
    this.rec.stderr.on('data', (d) => {
      stderr += d.toString().slice(0, 2000)
    })
    this.rec.on('exit', (code) => {
      const done = this.rec ? this.rec.file : file
      this.rec = null
      clearInterval(this.ticker)
      this.ticker = null
      this.emitState()
      // Recording without a working audio source is common; the video is
      // still there, so only report a failure if no file landed.
      if (fs.existsSync(done) && fs.statSync(done).size > 0) this.emit('recorded', done)
      else this.emit('error', stderr.split('\n')[0] || `ffmpeg exited ${code}`)
    })
    this.rec.on('error', () => {
      this.rec = null
      this.emitState()
      this.emit('error', 'ffmpeg not available')
    })
    this.ticker = setInterval(() => this.emitState(), 1000)
    this.emitState()
    return { ok: true }
  }

  stopRecording() {
    if (!this.rec) return { ok: false }
    try {
      this.rec.stdin.write('q')
      this.rec.stdin.end()
    } catch {
      try {
        this.rec.kill('SIGINT')
      } catch {}
    }
    return { ok: true }
  }

  toggleRecording() {
    return this.rec ? this.stopRecording() : this.startRecording()
  }

  reveal(file) {
    if (file && fs.existsSync(file)) shell.showItemInFolder(file)
  }

  current() {
    return {
      recording: !!this.rec,
      seconds: this.rec ? Math.floor((Date.now() - this.startedAt) / 1000) : 0,
      ...this.available(),
    }
  }

  emitState() {
    this.emit('update', this.current())
  }

  stop() {
    if (this.rec) this.stopRecording()
    clearInterval(this.ticker)
  }
}

module.exports = new Capture()
