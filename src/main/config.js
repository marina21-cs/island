const fs = require('fs')
const path = require('path')
const { app } = require('electron')

const DEFAULTS = {
  // The stage spans the full width of the primary display and hangs from its
  // top edge. Nothing in it is clickable except the surfaces the renderer
  // reports, so the size costs nothing.
  stage: { height: 560 },
  hotkeys: {
    toggle: 'Control+Alt+Space',
    clipboard: 'Control+Alt+V',
    timers: 'Control+Alt+Shift+T',
    shot: 'Control+Alt+S',
    quit: 'Control+Alt+Shift+Q',
  },
  clipboard: { pollMs: 600, max: 60 },
  vitals: { pollMs: 2000 },
  weatherCity: 'Manila',
  // Collapse the expanded panel this long after the pointer leaves it.
  collapseDelayMs: 700,
  // Dwell before hover opens the panel; the top of the screen sees a lot of
  // incidental mouse traffic.
  hoverDelayMs: 220,
  // The X11 shape extension clips rendering as well as input, so a drop shadow
  // only survives if the shape is padded out to contain it — and that padding
  // then swallows clicks aimed at the desktop. 0 means no shadow and no dead
  // zone. Raise it (18 is a good value) to trade one for the other.
  shadowPadding: 0,
}

function deepMerge(base, patch) {
  if (!patch || typeof patch !== 'object') return base
  const out = { ...base }
  for (const [k, v] of Object.entries(patch)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? deepMerge(base[k] || {}, v) : v
  }
  return out
}

let cached = null

function load() {
  if (cached) return cached
  let user = {}
  try {
    user = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'config.json'), 'utf8'))
  } catch {
    // No user config is the normal case.
  }
  cached = deepMerge(DEFAULTS, user)
  return cached
}

module.exports = { load, DEFAULTS }
