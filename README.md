# Island

A Dynamic Island for KDE Plasma on X11 — a panel that hangs from the top edge
of the screen, collapsed to a pill until you hover it, then opening into a
tabbed launcher.

```bash
npm install
npm start          # or: npm run dev  (opens devtools detached)
```

## How it stays out of the way

The window spans the full width of the display and is 560px tall, but only the
panel and the chips beside it are clickable. Everything else falls through to
whatever is underneath.

That is done with the **X11 shape extension**, not `setIgnoreMouseEvents`.
Two things rule the obvious approaches out on Linux:

- `setIgnoreMouseEvents(true, { forward: true })` — the `forward` option is
  **macOS and Windows only**. On X11 a click-through window receives no mouse
  events at all, so the renderer can never notice the pointer arriving.
- Polling `screen.getCursorScreenPoint()` from the main process does not rescue
  it. That value only refreshes when the app itself receives input, so once the
  window goes click-through it **freezes at the last known position**.

`win.setShape(rects)` has neither problem: the X server clips both input and
rendering to the region, so hover arrives as an ordinary DOM `mouseenter`. The
renderer reports the live rectangle of every `.surface` element on a rAF pump
while transitions run, and main turns that into the shape.

The one cost is that the shape clips **rendering** as well, so an outer drop
shadow would be sliced off at a hard edge. The panel ships without one — the
real Dynamic Island has no shadow either, it is a display cutout. Set
`shadowPadding` in `config.json` to trade a small dead zone for a shadow.

## Tabs

| Tab | What it does | Backed by |
|---|---|---|
| **Home** | Now playing with transport, week calendar, weather, screenshot + record | MPRIS over D-Bus, Open-Meteo, `spectacle`, `ffmpeg` |
| **Tray** | App launcher; pins persist, search covers everything installed | `.desktop` entries + icon theme lookup |
| **Alerts** | Live desktop notifications with an unread badge | D-Bus `BecomeMonitor` |
| **Board** | Kanban (drag or click to advance) and notes | JSON in `userData` |
| **Tools** | Calculator, document converter, budget tracker | `magick`, `soffice` |
| **More** | Countdown timers and clipboard history | Electron `clipboard` |

Beside the panel: CPU / RAM / GPU chips, a record toggle, and a volume slider
that appears while the panel is open.

## Notifications

Island **watches** the bus rather than owning `org.freedesktop.Notifications`.
Claiming that name would take it from Plasma and break your real
notifications, so it opens a second, read-only monitor connection instead.

## Keys

| Shortcut | Action |
|---|---|
| `Ctrl+Alt+Space` | Toggle the panel open |
| `Ctrl+Alt+V` | Open clipboard history |
| `Ctrl+Alt+Shift+T` | Open timers |
| `Ctrl+Alt+S` | Screenshot a region |
| `Ctrl+Alt+Shift+Q` | Quit |
| `1`–`6` | Jump between tabs (once the panel has focus) |
| `Esc` | Unpin and collapse |

`Ctrl+Alt+T` is deliberately **not** used — Plasma binds it to Konsole.
Rebind anything in `~/.config/island/config.json`; a binding Plasma already
owns fails to register and is reported on stdout rather than failing silently.

## Config

`~/.config/island/config.json`, merged over the defaults in
`src/main/config.js`:

```json
{
  "weatherCity": "Manila",
  "hoverDelayMs": 220,
  "collapseDelayMs": 700,
  "shadowPadding": 0,
  "hotkeys": { "toggle": "Control+Alt+Space" }
}
```

State lives beside it: `board.json`, `notes.json`, `budget.json`,
`timers.json`, `clipboard.json`, `pinned.json`.

## Start at login

Tray icon → **Start at login**. That writes
`~/.config/autostart/island.desktop`. Electron's `setLoginItemSettings` is
macOS/Windows only, so the XDG entry is written directly.

## Not wired up

- **Brightness slider** — `/sys/class/backlight/amdgpu_bl1` is not writable;
  you are in `wheel` but not `video`. Needs a one-time udev rule with sudo.
- **FPS counter** — the reference shows one, but FPS is per-application. It
  needs a hook like MangoHud, not a system readout. The chip shows CPU instead.

## Layout

```
src/main/          window, shape, hotkeys, tray, autostart
src/main/services/ mpris, vitals, audio, apps, notifications, capture,
                   weather, timers, clipboard, convert, store
src/preload/       contextBridge surface
src/renderer/      core.js (shape + modes + tab registry), boot.js, tabs/
```

Adding a tab means one file in `src/renderer/tabs/` calling
`Island.registerTab({ id, label, icon, width, height, mount, update })`, plus a
`<script>` line in `index.html`.
