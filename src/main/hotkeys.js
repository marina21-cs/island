const { globalShortcut } = require('electron')

// KDE claims a lot of shortcuts. Registration failing is expected and
// non-fatal; report it so the user can pick another binding in config.json.
function registerHotkeys(hotkeys, handlers) {
  const failed = []
  for (const [name, accel] of Object.entries(hotkeys)) {
    const fn = handlers[name]
    if (!fn || !accel) continue
    let ok = false
    try {
      ok = globalShortcut.register(accel, fn)
    } catch {
      ok = false
    }
    if (!ok) failed.push(`${name} (${accel})`)
  }
  if (failed.length) {
    console.warn(
      `[island] could not bind: ${failed.join(', ')} — likely taken by KDE. ` +
        `Override them in config.json.`
    )
  }
  return failed
}

function unregisterHotkeys() {
  globalShortcut.unregisterAll()
}

module.exports = { registerHotkeys, unregisterHotkeys }
