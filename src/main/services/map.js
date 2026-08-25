const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFile } = require('child_process')

// CARTO's dark basemap, so the map belongs to the panel rather than glowing
// white in the middle of it. Attribution is shown in the UI, as their terms
// require. Tiles are fetched here rather than in the renderer: the page's CSP
// allows no remote images, and it should stay that way.
const TILE = (z, x, y) => `https://basemaps.cartocdn.com/dark_all/${z}/${x}/${y}@2x.png`
const UA = 'island-panel/0.1 (personal desktop widget)'
const SIZE = 512 // @2x tiles
const CACHE_DIR = path.join(os.tmpdir(), 'island-map')
const MAX_AGE_MS = 24 * 60 * 60 * 1000

const run = (cmd, args, timeout = 20000) =>
  new Promise((resolve) => {
    execFile(cmd, args, { timeout }, (err, stdout, stderr) =>
      resolve({ ok: !err, err: err ? String(stderr || err.message) : '' })
    )
  })

const lonToX = (lon, z) => ((lon + 180) / 360) * 2 ** z
const latToY = (lat, z) => {
  const r = (lat * Math.PI) / 180
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z
}

async function fetchTile(z, x, y) {
  const file = path.join(CACHE_DIR, `${z}_${x}_${y}.png`)
  try {
    const st = fs.statSync(file)
    if (Date.now() - st.mtimeMs < MAX_AGE_MS && st.size > 0) return file
  } catch {}
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 12000)
  try {
    const res = await fetch(TILE(z, x, y), { signal: ctrl.signal, headers: { 'User-Agent': UA } })
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (!buf.length) return null
    fs.mkdirSync(CACHE_DIR, { recursive: true })
    fs.writeFileSync(file, buf)
    return file
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

async function render({ lat, lon, zoom = 6, width = 520, height = 180 }) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  const z = Math.max(2, Math.min(12, Math.round(zoom)))

  const fx = lonToX(lon, z)
  const fy = latToY(lat, z)
  const cols = Math.ceil(width / SIZE) + 1
  const rows = Math.ceil(height / SIZE) + 1
  const startX = Math.floor(fx) - Math.floor(cols / 2)
  const startY = Math.floor(fy) - Math.floor(rows / 2)
  const span = 2 ** z

  const jobs = []
  for (let ry = 0; ry < rows; ry++) {
    for (let rx = 0; rx < cols; rx++) {
      // Longitude wraps; latitude does not, so out-of-range rows stay blank.
      const tx = ((startX + rx) % span + span) % span
      const ty = startY + ry
      jobs.push(ty < 0 || ty >= span ? Promise.resolve(null) : fetchTile(z, tx, ty))
    }
  }
  const tiles = await Promise.all(jobs)
  if (!tiles.some(Boolean)) return null

  fs.mkdirSync(CACHE_DIR, { recursive: true })
  const blank = path.join(CACHE_DIR, 'blank.png')
  if (!fs.existsSync(blank)) await run('magick', ['-size', `${SIZE}x${SIZE}`, 'xc:#101014', blank])

  const grid = path.join(CACHE_DIR, `grid-${z}-${startX}-${startY}.png`)
  const montage = await run('magick', [
    'montage', ...tiles.map((t) => t || blank),
    '-tile', `${cols}x${rows}`, '-geometry', '+0+0', '-background', '#101014', grid,
  ])
  if (!montage.ok) return null

  // Where the requested point lands inside the assembled grid.
  const px = Math.round((fx - startX) * SIZE)
  const py = Math.round((fy - startY) * SIZE)
  const ox = Math.max(0, px - Math.round(width / 2))
  const oy = Math.max(0, py - Math.round(height / 2))

  const out = path.join(CACHE_DIR, `map-${z}-${lat.toFixed(3)}-${lon.toFixed(3)}-${width}x${height}.png`)
  const cx = px - ox
  const cy = py - oy
  const draw = await run('magick', [
    grid,
    '-crop', `${width}x${height}+${ox}+${oy}`, '+repage',
    '-fill', 'rgba(47,111,235,0.30)', '-stroke', 'none',
    '-draw', `circle ${cx},${cy} ${cx},${cy + 16}`,
    '-fill', '#2f6feb', '-stroke', 'white', '-strokewidth', '2',
    '-draw', `circle ${cx},${cy} ${cx},${cy + 5}`,
    out,
  ])
  if (!draw.ok || !fs.existsSync(out)) return null

  try {
    return `data:image/png;base64,${fs.readFileSync(out).toString('base64')}`
  } catch {
    return null
  }
}

module.exports = { render }
