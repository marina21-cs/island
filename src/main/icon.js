const fs = require('fs')
const path = require('path')
const zlib = require('zlib')
const { app } = require('electron')

// A tray icon with no image dependency: encode a 22x22 RGBA PNG by hand.
const CRC = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

function encodePng(w, h, rgba) {
  const stride = w * 4
  const raw = Buffer.alloc((stride + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0 // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // truecolour + alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// Signed distance to a rounded rectangle, sampled 3x3 for antialiasing.
function pillCoverage(px, py, w, h, rx, ry, rw, rh, r) {
  let hits = 0
  for (let sy = 0; sy < 3; sy++) {
    for (let sx = 0; sx < 3; sx++) {
      const x = px + (sx + 0.5) / 3
      const y = py + (sy + 0.5) / 3
      const dx = Math.max(Math.abs(x - (rx + rw / 2)) - (rw / 2 - r), 0)
      const dy = Math.max(Math.abs(y - (ry + rh / 2)) - (rh / 2 - r), 0)
      if (Math.hypot(dx, dy) <= r) hits++
    }
  }
  return hits / 9
}

function ensureTrayIcon() {
  const out = path.join(app.getPath('userData'), 'tray.png')
  if (fs.existsSync(out)) return out

  const S = 22
  const rgba = Buffer.alloc(S * S * 4)
  // A wide pill, the island in miniature.
  const rw = 18
  const rh = 9
  const rx = (S - rw) / 2
  const ry = (S - rh) / 2
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const a = pillCoverage(x, y, S, S, rx, ry, rw, rh, rh / 2)
      const i = (y * S + x) * 4
      // White so it reads on both light and dark Plasma trays.
      rgba[i] = 255
      rgba[i + 1] = 255
      rgba[i + 2] = 255
      rgba[i + 3] = Math.round(a * 255)
    }
  }
  fs.writeFileSync(out, encodePng(S, S, rgba))
  return out
}

module.exports = { ensureTrayIcon }
