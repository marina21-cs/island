/* eslint-env browser */
'use strict'

const api = window.island

const $ = (id) => document.getElementById(id)

// Tiny DOM builder. `cls` may carry a tag prefix, e.g. h('button.iconbtn').
function h(spec, props, ...kids) {
  const [tag, ...classes] = String(spec).split('.')
  const node = document.createElement(tag || 'div')
  if (classes.length) node.className = classes.join(' ')
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'text') node.textContent = v
    else if (k === 'html') node.innerHTML = v
    else if (k === 'class') node.className = [node.className, v].filter(Boolean).join(' ')
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v)
    else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v)
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue
    node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)))
  }
  return node
}

const svg = (paths, size = 12) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}">${paths}</svg>`

const pad = (n) => String(n).padStart(2, '0')

function clockText(ms) {
  const total = Math.max(0, Math.round(ms / 1000))
  const hh = Math.floor(total / 3600)
  const mm = Math.floor((total % 3600) / 60)
  const ss = total % 60
  return hh > 0 ? `${hh}:${pad(mm)}:${pad(ss)}` : `${mm}:${pad(ss)}`
}

function bytes(perSec) {
  if (perSec < 1024) return `${Math.round(perSec)} B/s`
  if (perSec < 1024 * 1024) return `${(perSec / 1024).toFixed(0)} KB/s`
  return `${(perSec / 1024 / 1024).toFixed(1)} MB/s`
}

function ago(ts) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

// MacBook-notch proportions: short across, chunky down.
const SIZES = {
  idle: { w: 196, h: 36, r: 18 },
  ambient: { w: 348, h: 40, r: 20 },
  activity: { w: 428, h: 106, r: 26 },
}

// Hover is a size modifier, not a mode — the collapsed pill grows a little
// under the pointer to say it is reachable, without changing what it shows.
const HOVER_BUMP = { w: 30, h: 8, r: 3 }

const el = {
  root: document.documentElement,
  notch: $('notch'),
  volume: $('volume'),
  nav: $('nav'),
  tabsBar: $('tabs'),
  panes: $('panes'),
  btnPin: $('btnPin'),
  btnMenu: $('btnMenu'),
  layers: [...document.querySelectorAll('.layer')],
}

const state = {
  mode: null,
  tab: 'home',
  pinned: false,
  hovering: false,
  activity: false,
  cfg: { collapseDelayMs: 700, hoverDelayMs: 220 },
  feeds: {},
  toast: null,
}

const tabs = new Map()
const order = []

/* --- shape ---------------------------------------------------------------
   The window's clickable region is the union of the visible surfaces. Rather
   than predicting where they will be mid-animation, a rAF pump re-reads their
   live rectangles for as long as a transition is running. setShape is cheap,
   and the dirty check keeps the IPC quiet once things settle. */

let lastShape = ''
let pumpUntil = 0
let rafId = null

function syncShape() {
  const rects = []
  for (const node of document.querySelectorAll('.surface')) {
    const cs = getComputedStyle(node)
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) continue
    const r = node.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) continue
    rects.push({
      x: Math.floor(r.left),
      y: Math.floor(r.top),
      width: Math.ceil(r.width),
      height: Math.ceil(r.height),
    })
  }
  const key = JSON.stringify(rects)
  if (key === lastShape) return
  lastShape = key
  api.setShape(rects)
}

function step() {
  syncShape()
  if (performance.now() < pumpUntil) rafId = requestAnimationFrame(step)
  else rafId = null
}

// Keep re-reading geometry for `ms`, covering the longest CSS transition.
function pump(ms = 620) {
  pumpUntil = Math.max(pumpUntil, performance.now() + ms)
  if (!rafId) rafId = requestAnimationFrame(step)
}

/* --- sizing and mode ----------------------------------------------------- */

// The nav has to fit whatever tabs are registered. A tab that asks for less
// width than the nav needs would clip it — measured once the tabs exist rather
// than assumed, so adding a tab later cannot silently break the row.
let navFloor = 0

function measureNav() {
  requestAnimationFrame(() => {
    const tabsW = el.tabsBar.scrollWidth
    const buttons = [...el.nav.querySelectorAll('.navbtn')]
      .reduce((sum, b) => sum + b.offsetWidth + 3, 0)
    // nav padding, plus room so the last tab is not shoulder to shoulder with
    // the buttons.
    const padding = 10 + 8 + 20
    const next = Math.ceil(tabsW + buttons + padding)
    if (next === navFloor || !tabsW) return
    navFloor = next
    if (state.mode === 'expanded') applySize()
  })
}

function applySize() {
  let size = SIZES[state.mode] || SIZES.idle
  if (state.mode === 'expanded') {
    const tab = tabs.get(state.tab)
    size = {
      w: Math.max((tab && tab.width) || 470, navFloor),
      h: (tab && tab.height) || 200,
      r: 26,
    }
  } else if (state.hovering) {
    size = { w: size.w + HOVER_BUMP.w, h: size.h + HOVER_BUMP.h, r: size.r + HOVER_BUMP.r }
  }
  el.root.style.setProperty('--w', `${size.w}px`)
  el.root.style.setProperty('--h', `${size.h}px`)
  el.root.style.setProperty('--r', `${size.r}px`)
  pump()
}

function ambientAvailable() {
  if (state.toast) return true
  const m = state.feeds.media
  // Playing, not merely present: a browser leaves its player registered and
  // paused long after the sound stops, which kept the pill up indefinitely.
  if (m && m.available && m.title && m.status === 'Playing') return true
  return (state.feeds.timers || []).length > 0
}

function baseMode() {
  if (state.activity) return 'activity'
  return ambientAvailable() ? 'ambient' : 'idle'
}

// A new track announces itself with the full card, then gets out of the way.
let activityTimer = null

function showActivity(ms = 5200) {
  state.activity = true
  clearTimeout(activityTimer)
  if (!state.pinned && state.mode !== 'expanded') setMode('activity')
  activityTimer = setTimeout(() => {
    state.activity = false
    settle()
  }, ms)
}

function setMode(mode) {
  if (state.mode === mode) return
  const previous = state.mode
  state.mode = mode
  if (mode === 'expanded') {
    state.hovering = false
    delete el.notch.dataset.hover
  }
  el.notch.dataset.state = mode
  for (const layer of el.layers) layer.classList.toggle('on', layer.dataset.layer === mode)
  el.volume.classList.toggle('off', mode !== 'expanded')
  // Hand focus back when the panel closes; a collapsed pill has nothing to
  // type into and should not be swallowing the user's keystrokes.
  if (mode !== 'expanded' && previous === 'expanded') api.releaseFocus()
  applySize()
  if (mode === 'expanded') {
    const tab = tabs.get(state.tab)
    if (tab && tab.shown) tab.shown()
  }
}

function settle() {
  if (state.pinned || state.mode === 'expanded') return
  setMode(baseMode())
}

let hoverTimer = null
let collapseTimer = null

function onHover() {
  clearTimeout(collapseTimer)
  if (state.mode === 'expanded') return
  // Grow a touch straight away — the acknowledgement should not wait out the
  // dwell, or the pill feels dead until it suddenly opens.
  state.hovering = true
  el.notch.dataset.hover = 'on'
  applySize()
  clearTimeout(hoverTimer)
  // Dwell before opening: the top of the screen sees a lot of incidental
  // mouse travel.
  hoverTimer = setTimeout(() => setMode('expanded'), state.cfg.hoverDelayMs)
}

function onLeave() {
  clearTimeout(hoverTimer)
  state.hovering = false
  delete el.notch.dataset.hover
  if (state.mode !== 'expanded') applySize()
  if (state.mode !== 'expanded' || state.pinned) return
  clearTimeout(collapseTimer)
  collapseTimer = setTimeout(() => {
    // Never yank the panel away mid-typing.
    const active = document.activeElement
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return
    setMode(baseMode())
  }, state.cfg.collapseDelayMs)
}

function setPinned(next) {
  state.pinned = next
  el.btnPin.classList.toggle('on', next)
  if (next) setMode('expanded')
  else setMode(baseMode())
}

/* --- tabs ---------------------------------------------------------------- */

function registerTab(def) {
  tabs.set(def.id, def)
  order.push(def.id)
}

function buildTabs() {
  el.tabsBar.textContent = ''
  el.panes.textContent = ''
  for (const id of order) {
    const def = tabs.get(id)
    const badge = h('i.badge')
    const btn = h(
      'button.tab',
      { 'data-tab': id, title: def.label, onclick: (e) => (e.stopPropagation(), setTab(id)) },
      h('span.tab-icon', { html: def.icon || '' }),
      h('span.tab-label', { text: def.label }),
      badge
    )
    def.button = btn
    def.badgeEl = badge
    el.tabsBar.append(btn)

    const pane = h('div.pane', { 'data-pane': id })
    def.pane = pane
    el.panes.append(pane)
    if (def.mount) def.mount(pane)
  }
  applyTabClasses()
  measureNav()
}

function applyTabClasses() {
  for (const id of order) {
    const def = tabs.get(id)
    def.button.classList.toggle('on', id === state.tab)
    def.pane.classList.toggle('on', id === state.tab)
  }
}

function setTab(id) {
  if (!tabs.has(id)) return
  state.tab = id
  el.notch.dataset.tab = id
  applyTabClasses()
  applySize()
  const def = tabs.get(id)
  if (def.shown) def.shown()
}

function setBadge(id, count) {
  const def = tabs.get(id)
  if (!def || !def.button) return
  def.button.classList.toggle('has-badge', count > 0)
  def.badgeEl.textContent = count > 99 ? '99+' : String(count)
}

/* --- feeds --------------------------------------------------------------- */

const listeners = []
const onFeed = (fn) => listeners.push(fn)

function dispatch(kind, data) {
  state.feeds[kind] = data
  for (const fn of listeners) fn(kind, data)
  for (const id of order) {
    const def = tabs.get(id)
    if (def && def.update) def.update(kind, data)
  }
}

/* --- toast --------------------------------------------------------------- */

let toastTimer = null

function toast(icon, text, ms = 2600) {
  state.toast = { icon, text }
  $('toastIcon').textContent = icon
  $('toastText').textContent = text
  updateAmbient()
  if (state.mode !== 'expanded') setMode('ambient')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    state.toast = null
    updateAmbient()
    settle()
  }, ms)
}

function updateAmbient() {
  const m = state.feeds.media
  const mediaLive = !!(m && m.available && m.title && m.status === 'Playing')
  const soonest = (state.feeds.timers || [])[0]
  const rows = { ambToast: false, ambTimer: false, ambMedia: false }

  if (state.toast) rows.ambToast = true
  else if (soonest && (soonest.remainingMs <= 120000 || !mediaLive)) rows.ambTimer = true
  else rows.ambMedia = mediaLive

  if (rows.ambTimer && soonest) {
    $('ambTimerLabel').textContent = soonest.label
    $('ambTimerCount').textContent = clockText(soonest.remainingMs)
  }
  for (const [id, on] of Object.entries(rows)) $(id).classList.toggle('on', on)
}

/* --- wiring -------------------------------------------------------------- */

el.notch.addEventListener('mouseenter', onHover)
el.notch.addEventListener('mouseleave', onLeave)

el.notch.addEventListener('click', (e) => {
  if (e.target.closest('button, input, textarea, select, .item, .vtrack, [data-noclick]')) return
  setPinned(!state.pinned)
})

el.notch.addEventListener('contextmenu', (e) => {
  e.preventDefault()
  api.openMenu()
})

el.btnPin.addEventListener('click', (e) => {
  e.stopPropagation()
  setPinned(!state.pinned)
})

el.btnMenu.addEventListener('click', (e) => {
  e.stopPropagation()
  api.openMenu()
})

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (document.activeElement) document.activeElement.blur()
    setPinned(false)
    return
  }
  // Alt+1..7 jump between tabs. Bare digits are deliberately not used: the
  // panel can hold keyboard focus after a click, and plain number keys meant
  // ordinary typing was silently switching tabs out from under the user.
  if (!e.altKey || e.ctrlKey || e.metaKey) return
  const active = document.activeElement
  if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return
  const n = Number(e.key)
  if (state.mode === 'expanded' && n >= 1 && n <= order.length) {
    e.preventDefault()
    setTab(order[n - 1])
  }
})

window.addEventListener('resize', () => pump())

// Layout inside a pane can change without a transition (a list growing, an
// icon loading); a cheap idle sweep keeps the shape honest.
setInterval(syncShape, 500)

// Segmented control: three panels share this, so it lives here.
function segmented(items, onPick, initial) {
  const btns = new Map()
  const wrap = h('div.seg')
  for (const it of items) {
    const b = h(
      'button.seg-b',
      {
        onclick: (e) => {
          e.stopPropagation()
          set(it.id)
          onPick(it.id)
        },
      },
      it.label
    )
    btns.set(it.id, b)
    wrap.append(b)
  }
  let current = initial || items[0].id
  function set(id) {
    current = id
    for (const [k, b] of btns) b.classList.toggle('on', k === id)
  }
  set(current)
  return { el: wrap, set, get: () => current }
}

window.Island = {
  api,
  el,
  state,
  tabs,
  $,
  h,
  svg,
  pad,
  clockText,
  bytes,
  ago,
  registerTab,
  buildTabs,
  measureNav,
  setTab,
  setBadge,
  setMode,
  setPinned,
  settle,
  applySize,
  pump,
  syncShape,
  dispatch,
  onFeed,
  toast,
  showActivity,
  segmented,
  updateAmbient,
  baseMode,
}
