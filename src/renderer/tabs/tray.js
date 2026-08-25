/* eslint-env browser */
'use strict'

;(function () {
  const I = window.Island
  const { h, svg, api } = I

  // First-run favourites: whichever of these are actually installed.
  const SEEDS = [
    'firefox', 'google-chrome', 'chromium', 'brave-browser',
    'code', 'code-oss', 'visual-studio-code',
    'org.kde.konsole', 'spotify', 'discord',
    'org.kde.dolphin', 'obs', 'telegram-desktop',
  ]
  const MAX_PINNED = 14

  const ui = {}
  let apps = []
  let pinned = []
  const iconCache = new Map()

  async function iconFor(id) {
    if (iconCache.has(id)) return iconCache.get(id)
    const url = await api.appIcon(id)
    iconCache.set(id, url)
    return url
  }

  function mount(pane) {
    ui.grid = h('div.tr-grid')
    ui.search = h('input.field.tr-search', {
      type: 'text',
      placeholder: 'Search 100+ apps…',
      spellcheck: 'false',
      oninput: () => render(),
      onkeydown: (e) => {
        if (e.key !== 'Enter') return
        const first = visible()[0]
        if (first) launch(first.id)
      },
    })
    ui.hint = h('span.tr-hint.tiny.muted', { text: '' })
    ui.editBtn = h(
      'button.tr-edit',
      {
        onclick: (e) => {
          e.stopPropagation()
          ui.editing = !ui.editing
          ui.editBtn.classList.toggle('on', ui.editing)
          render()
        },
      },
      'Edit'
    )
    pane.append(
      ui.grid,
      h('div.tr-bar', {}, ui.search, ui.hint, ui.editBtn)
    )
  }

  function visible() {
    const q = ui.search.value.trim().toLowerCase()
    if (!q) return pinned.map((id) => apps.find((a) => a.id === id)).filter(Boolean)
    return apps.filter((a) => a.name.toLowerCase().includes(q)).slice(0, MAX_PINNED)
  }

  async function launch(id) {
    const res = await api.launchApp(id)
    const app = apps.find((a) => a.id === id)
    if (res && res.ok) {
      I.toast('🚀', app ? app.name : 'Launched')
      I.setPinned(false)
    } else {
      I.toast('⚠', (res && res.error) || 'Could not launch')
    }
  }

  function togglePin(id) {
    if (pinned.includes(id)) pinned = pinned.filter((p) => p !== id)
    else if (pinned.length < MAX_PINNED) pinned.push(id)
    api.storeSet('pinned', pinned)
    render()
  }

  function render() {
    const q = ui.search.value.trim()
    const items = visible()
    ui.grid.textContent = ''

    if (!items.length) {
      ui.grid.append(
        h('div.empty', { text: q ? 'No apps match.' : 'No favourites yet — search to add one.' })
      )
    }

    for (const app of items) {
      const img = h('img.tr-icon', { alt: '' })
      iconFor(app.id).then((url) => {
        if (url) img.src = url
        else img.replaceWith(h('span.tr-icon.tr-fallback', { text: app.name.slice(0, 1) }))
        fitHeight()
        I.syncShape()
      })

      const isPinned = pinned.includes(app.id)
      const tile = h(
        'button.tr-tile',
        {
          title: app.name,
          onclick: (e) => {
            e.stopPropagation()
            if (ui.editing || q) togglePin(app.id)
            else launch(app.id)
          },
        },
        img,
        h('span.tr-name', { text: app.name })
      )
      if ((ui.editing || q) && isPinned) tile.classList.add('pinned')
      if (ui.editing || q) {
        tile.append(h('span.tr-pin', { text: isPinned ? '−' : '+' }))
      }
      ui.grid.append(tile)
    }

    ui.hint.textContent = q
      ? 'click to pin'
      : ui.editing
        ? 'click to unpin'
        : `${pinned.length}/${MAX_PINNED} pinned`

    fitHeight()
    I.pump(150)
  }

  // Height follows the content, so a half-full grid does not leave a slab of
  // empty panel below it. Measuring a tile right after append reads short —
  // the icons have not settled — so the grid is briefly laid out at its
  // natural height and measured there instead.
  function fitHeight() {
    requestAnimationFrame(() => {
      const prev = ui.grid.style.height
      ui.grid.style.height = 'auto'
      const content = ui.grid.scrollHeight
      ui.grid.style.height = prev
      if (!content) return
      const def = I.tabs.get('tray')
      const chrome = 34 + 11 + 6 + 26 + 12 // nav + pane padding + search bar
      const next = chrome + content
      if (def.height === next) return
      def.height = next
      if (I.state.tab === 'tray' && I.state.mode === 'expanded') I.applySize()
      I.pump(150)
    })
  }

  async function load() {
    apps = await api.listApps()
    const saved = await api.storeGet('pinned', null)
    if (Array.isArray(saved) && saved.length) {
      pinned = saved.filter((id) => apps.some((a) => a.id === id))
    } else {
      const byId = new Set(apps.map((a) => a.id))
      pinned = SEEDS.filter((id) => byId.has(id)).slice(0, MAX_PINNED)
      api.storeSet('pinned', pinned)
    }
    ui.search.placeholder = `Search ${apps.length} apps…`
    render()
  }

  I.registerTab({
    id: 'tray',
    label: 'Tray',
    icon: svg(
      '<rect x="3.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.6"/>'
    ),
    width: 560,
    height: 196,
    mount,
    ready: load,
    shown: () => I.pump(200),
  })
})()
