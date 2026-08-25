const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')
const { EventEmitter } = require('events')
const { app, dialog } = require('electron')

// The icon in the collapsed pill. Whatever the user picks is normalised to a
// square PNG here, so the renderer only ever deals with one shape and one
// format, and the original file can move or be deleted afterwards.
const SIZE = 96
const MAX_SOURCE_BYTES = 24 * 1024 * 1024

const run = (cmd, args, timeout = 20000) =>
  new Promise((resolve) => {
    execFile(cmd, args, { timeout }, (err, stdout, stderr) =>
      resolve({ ok: !err, out: String(stdout || ''), err: err ? String(stderr || err.message) : '' })
    )
  })

class Avatar extends EventEmitter {
  constructor() {
    super()
    this.state = { custom: false, url: null, pixelArt: false }
  }

  file() {
    return path.join(app.getPath('userData'), 'icon.png')
  }

  metaFile() {
    return path.join(app.getPath('userData'), 'icon.json')
  }

  start() {
    this.load()
    this.emit('update', this.state)
  }

  load() {
    try {
      const buf = fs.readFileSync(this.file())
      let pixelArt = false
      try {
        pixelArt = !!JSON.parse(fs.readFileSync(this.metaFile(), 'utf8')).pixelArt
      } catch {}
      this.state = {
        custom: true,
        url: `data:image/png;base64,${buf.toString('base64')}`,
        pixelArt,
      }
    } catch {
      this.state = { custom: false, url: null, pixelArt: false }
    }
    return this.state
  }

  async pick() {
    const res = await dialog.showOpenDialog({
      title: 'Choose a panel icon',
      properties: ['openFile'],
      filters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'svg'] },
      ],
    })
    if (res.canceled || !res.filePaths.length) return { ok: false, cancelled: true }
    return this.setFrom(res.filePaths[0])
  }

  async setFrom(source) {
    try {
      const stat = fs.statSync(source)
      if (!stat.isFile()) return { ok: false, error: 'Not a file' }
      if (stat.size > MAX_SOURCE_BYTES) return { ok: false, error: 'Image is too large' }
    } catch {
      return { ok: false, error: 'Cannot read that file' }
    }

    // A small source is almost certainly pixel art, and smooth resampling would
    // turn it to mush. Those get nearest-neighbour scaling and keep their crisp
    // edges in the renderer; anything larger is resampled normally.
    const probe = await run('magick', ['identify', '-format', '%w %h', `${source}[0]`], 10000)
    const [w, h] = probe.ok ? probe.out.trim().split(/\s+/).map(Number) : [0, 0]
    const pixelArt = !!(w && h && Math.max(w, h) <= 128)

    const args = [`${source}[0]`, '-background', 'none', '-alpha', 'on']
    if (pixelArt) args.push('-filter', 'point')
    args.push(
      '-resize', `${SIZE}x${SIZE}^`,
      '-gravity', 'center',
      '-extent', `${SIZE}x${SIZE}`,
      this.file()
    )
    const conv = await run('magick', args)
    if (!conv.ok || !fs.existsSync(this.file())) {
      return { ok: false, error: conv.err.split('\n')[0] || 'Could not read that image' }
    }

    try {
      fs.writeFileSync(this.metaFile(), JSON.stringify({ pixelArt }))
    } catch {}

    this.load()
    this.emit('update', this.state)
    return { ok: true, ...this.state }
  }

  reset() {
    for (const f of [this.file(), this.metaFile()]) {
      try {
        fs.unlinkSync(f)
      } catch {}
    }
    this.load()
    this.emit('update', this.state)
    return { ok: true }
  }

  current() {
    return this.state
  }

  stop() {}
}

module.exports = new Avatar()
