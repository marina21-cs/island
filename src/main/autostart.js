const fs = require('fs')
const os = require('os')
const path = require('path')
const { app } = require('electron')

// Electron's setLoginItemSettings is macOS/Windows only, so on Linux we write
// the XDG autostart entry ourselves.
const dir = path.join(os.homedir(), '.config', 'autostart')
const file = path.join(dir, 'island.desktop')

function isEnabled() {
  return fs.existsSync(file)
}

function setEnabled(enabled) {
  try {
    if (!enabled) {
      if (fs.existsSync(file)) fs.unlinkSync(file)
      return true
    }
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      file,
      [
        '[Desktop Entry]',
        'Type=Application',
        'Name=Island',
        'Comment=Dynamic Island for KDE Plasma',
        `Exec=${process.execPath} ${app.getAppPath()}`,
        'Terminal=false',
        'X-GNOME-Autostart-enabled=true',
        // Plasma restores the session before the compositor settles; a short
        // delay avoids the window coming up without an ARGB visual.
        'X-KDE-autostart-after=panel',
        '',
      ].join('\n')
    )
    return true
  } catch (err) {
    console.warn('[island] autostart write failed:', err.message)
    return false
  }
}

module.exports = { isEnabled, setEnabled }
