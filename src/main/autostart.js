const fs = require('fs')
const os = require('os')
const path = require('path')
const { app } = require('electron')

// Electron's setLoginItemSettings is macOS/Windows only, so the XDG autostart
// entry is written directly.
//
// When the app has been installed as a service (scripts/island install), that
// entry must hand off to systemd rather than exec the app itself — otherwise
// the tray checkbox would quietly set up a second, unsupervised launch path
// alongside the unit. Only when there is no managed install does this fall
// back to launching the binary directly.
const dir = path.join(os.homedir(), '.config', 'autostart')
const file = path.join(dir, 'island.desktop')
const cli = path.join(os.homedir(), '.local', 'bin', 'island')
const unit = path.join(os.homedir(), '.config', 'systemd', 'user', 'island.service')

function isManaged() {
  try {
    return fs.existsSync(cli) && fs.existsSync(unit)
  } catch {
    return false
  }
}

function isEnabled() {
  return fs.existsSync(file)
}

function entry() {
  const exec = isManaged() ? `${cli} autostart` : `${process.execPath} ${app.getAppPath()}`
  return [
    '[Desktop Entry]',
    'Type=Application',
    isManaged() ? 'Name=Island (session start)' : 'Name=Island',
    isManaged()
      ? 'Comment=Hands the Island to systemd once the desktop is up'
      : 'Comment=Dynamic Island panel for KDE Plasma',
    `Exec=${exec}`,
    'Terminal=false',
    'NoDisplay=true',
    'X-GNOME-Autostart-enabled=true',
    // Phase 2 is after the desktop is up, which is when DISPLAY is usable.
    'X-KDE-autostart-phase=2',
    '',
  ].join('\n')
}

function setEnabled(enabled) {
  try {
    if (!enabled) {
      if (fs.existsSync(file)) fs.unlinkSync(file)
      return true
    }
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(file, entry())
    return true
  } catch (err) {
    console.warn('[island] autostart write failed:', err.message)
    return false
  }
}

module.exports = { isEnabled, setEnabled, isManaged }
