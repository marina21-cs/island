const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

const APP_DIRS = [
  path.join(os.homedir(), '.local', 'share', 'applications'),
  '/usr/share/applications',
  '/usr/local/share/applications',
  '/var/lib/flatpak/exports/share/applications',
  path.join(os.homedir(), '.local', 'share', 'flatpak', 'exports', 'share', 'applications'),
]

const ICON_BASES = [
  path.join(os.homedir(), '.local', 'share', 'icons'),
  '/usr/share/icons',
]
const THEMES = ['breeze', 'Papirus', 'Papirus-Dark', 'Adwaita', 'hicolor']
const SIZES = ['64x64', '48x48', '96x96', '128x128', '256x256', '32x32', 'scalable', '64', '48', '128', '32']
const CATS = ['apps', 'devices', 'places', 'mimetypes']
const EXTS = ['.png', '.svg', '.xpm']
const MAX_ICON_BYTES = 256 * 1024

// --- .desktop parsing ------------------------------------------------------

function parseDesktop(file) {
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
  const entry = {}
  let inSection = false
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line.startsWith('[')) {
      inSection = line === '[Desktop Entry]'
      continue
    }
    if (!inSection || !line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const key = line.slice(0, eq).trim()
    // Ignore localised variants like Name[de]; the C locale value is enough.
    if (key.includes('[')) continue
    entry[key] = line.slice(eq + 1).trim()
  }
  if (entry.Type !== 'Application') return null
  if (entry.NoDisplay === 'true' || entry.Hidden === 'true') return null
  if (!entry.Name || !entry.Exec) return null
  return {
    id: path.basename(file, '.desktop'),
    name: entry.Name,
    exec: entry.Exec,
    icon: entry.Icon || '',
    terminal: entry.Terminal === 'true',
    categories: (entry.Categories || '').split(';').filter(Boolean),
    file,
  }
}

let cachedApps = null

function list() {
  if (cachedApps) return cachedApps
  const seen = new Map()
  for (const dir of APP_DIRS) {
    let names = []
    try {
      names = fs.readdirSync(dir)
    } catch {
      continue
    }
    for (const n of names) {
      if (!n.endsWith('.desktop')) continue
      const app = parseDesktop(path.join(dir, n))
      // Earlier directories win, so a user override beats the system entry.
      if (app && !seen.has(app.id)) seen.set(app.id, app)
    }
  }
  cachedApps = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
  return cachedApps
}

// --- icon lookup -----------------------------------------------------------

let iconIndex = null

// One pass over the plausible theme directories, building basename -> path.
// Resolving each icon by probing paths individually would be thousands of
// stat calls; this is a few dozen readdirs.
function buildIconIndex() {
  const index = new Map()
  const add = (name, file) => {
    if (!index.has(name)) index.set(name, file)
  }
  const scan = (dir) => {
    let names = []
    try {
      names = fs.readdirSync(dir)
    } catch {
      return
    }
    for (const n of names) {
      const ext = path.extname(n)
      if (!EXTS.includes(ext)) continue
      add(path.basename(n, ext), path.join(dir, n))
    }
  }
  for (const base of ICON_BASES) {
    for (const theme of THEMES) {
      for (const size of SIZES) {
        for (const cat of CATS) {
          scan(path.join(base, theme, size, cat)) // hicolor layout
          scan(path.join(base, theme, cat, size)) // breeze layout
        }
      }
    }
  }
  scan('/usr/share/pixmaps')
  return index
}

function iconFor(name) {
  if (!name) return null
  if (path.isAbsolute(name)) return fs.existsSync(name) ? name : null
  if (!iconIndex) iconIndex = buildIconIndex()
  return iconIndex.get(name) || null
}

const MIME = { '.png': 'image/png', '.svg': 'image/svg+xml', '.xpm': null }
const iconCache = new Map()

function iconDataUrl(appId) {
  if (iconCache.has(appId)) return iconCache.get(appId)
  const app = list().find((a) => a.id === appId)
  let url = null
  const file = app && iconFor(app.icon)
  if (file) {
    const mime = MIME[path.extname(file).toLowerCase()]
    try {
      const stat = fs.statSync(file)
      if (mime && stat.size <= MAX_ICON_BYTES) {
        url = `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`
      }
    } catch {
      url = null
    }
  }
  iconCache.set(appId, url)
  return url
}

// --- launching -------------------------------------------------------------

// Exec lines carry field codes (%f, %U, ...) that only mean something when
// opening a document. Launching bare, they must be stripped.
function parseExec(exec) {
  const out = []
  let cur = ''
  let quote = null
  for (let i = 0; i < exec.length; i++) {
    const c = exec[i]
    if (quote) {
      if (c === quote) quote = null
      else if (c === '\\' && exec[i + 1]) cur += exec[++i]
      else cur += c
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      continue
    }
    if (c === ' ') {
      if (cur) out.push(cur)
      cur = ''
      continue
    }
    cur += c
  }
  if (cur) out.push(cur)
  // Codes also show up embedded, e.g. Spotify's `--uri=%u`. An argument that
  // carries one only means something when opening a document, so drop it whole.
  return out.filter((a) => !/%[fFuUdDnNickvm]/.test(a))
}

function launch(appId) {
  const app = list().find((a) => a.id === appId)
  if (!app) return { ok: false, error: 'Unknown app' }
  const argv = parseExec(app.exec)
  if (!argv.length) return { ok: false, error: 'No command' }
  try {
    const child = app.terminal
      ? spawn('konsole', ['-e', ...argv], { detached: true, stdio: 'ignore' })
      : spawn(argv[0], argv.slice(1), { detached: true, stdio: 'ignore' })
    child.on('error', () => {})
    child.unref()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

module.exports = { list, iconDataUrl, launch, parseExec }
