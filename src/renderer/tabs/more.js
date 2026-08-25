/* eslint-env browser */
'use strict'

;(function () {
  const I = window.Island
  const { h, svg, api, clockText } = I

  const ui = {}
  let timers = []
  let clips = { paused: false, items: [] }
  const timerNodes = new Map()

  function mount(pane) {
    ui.seg = I.segmented(
      [
        { id: 'timers', label: 'Timers' },
        { id: 'clipboard', label: 'Clipboard' },
      ],
      (id) => show(id)
    )

    ui.timerInput = h('input.field', {
      type: 'text',
      placeholder: '25m focus',
      spellcheck: 'false',
      onkeydown: async (e) => {
        if (e.key !== 'Enter') return
        const res = await api.addTimer(ui.timerInput.value)
        if (res && res.ok) {
          ui.timerInput.value = ''
        } else {
          ui.timerInput.classList.remove('shake')
          void ui.timerInput.offsetWidth
          ui.timerInput.classList.add('shake')
          ui.timerInput.placeholder = (res && res.error) || 'Try "25m focus"'
        }
      },
    })
    ui.timerList = h('div.list.mo-list')
    ui.timersView = h('div.mo-view', {}, ui.timerInput, ui.timerList)

    ui.clipSearch = h('input.field', {
      type: 'text',
      placeholder: 'Search clipboard',
      spellcheck: 'false',
      oninput: () => renderClips(),
    })
    ui.clipClear = h(
      'button.tr-edit',
      {
        onclick: (e) => {
          e.stopPropagation()
          api.clearClips()
        },
      },
      'Clear'
    )
    ui.clipPause = h(
      'button.tr-edit',
      {
        onclick: (e) => {
          e.stopPropagation()
          api.pauseClips(!clips.paused)
        },
      },
      'Pause'
    )
    ui.clipList = h('div.list.mo-list')
    ui.clipsView = h(
      'div.mo-view',
      {},
      h('div.mo-row', {}, ui.clipSearch, ui.clipPause, ui.clipClear),
      ui.clipList
    )

    pane.append(h('div.mo-head', {}, ui.seg.el), ui.timersView, ui.clipsView)
    show('timers')
  }

  function show(id) {
    ui.timersView.classList.toggle('on', id === 'timers')
    ui.clipsView.classList.toggle('on', id === 'clipboard')
    I.pump(120)
  }

  function renderTimers() {
    const seen = new Set()
    for (const t of timers) {
      seen.add(t.id)
      let node = timerNodes.get(t.id)
      if (!node) {
        const lbl = h('span.lbl', { text: t.label })
        const val = h('span.val')
        const x = h(
          'button.x',
          {
            title: 'Cancel',
            onclick: (e) => {
              e.stopPropagation()
              api.cancelTimer(t.id)
            },
          },
          '×'
        )
        node = h('div.item', {}, lbl, val, x)
        timerNodes.set(t.id, node)
        ui.timerList.append(node)
      }
      node.querySelector('.lbl').textContent = t.label
      node.querySelector('.val').textContent = clockText(t.remainingMs)
    }
    for (const [id, node] of timerNodes) {
      if (!seen.has(id)) {
        node.remove()
        timerNodes.delete(id)
      }
    }
    empty(ui.timerList, timerNodes.size === 0, 'No timers running. Try "25m focus".')
  }

  function renderClips() {
    const q = ui.clipSearch.value.trim().toLowerCase()
    const items = q ? clips.items.filter((i) => i.text.toLowerCase().includes(q)) : clips.items
    ui.clipPause.textContent = clips.paused ? 'Resume' : 'Pause'
    ui.clipPause.classList.toggle('on', clips.paused)
    ui.clipList.textContent = ''

    for (const item of items.slice(0, 40)) {
      const lbl = h('span.lbl', {
        text: item.text.replace(/\s+/g, ' ').trim().slice(0, 160),
        title: item.text.slice(0, 400),
      })
      const x = h(
        'button.x',
        {
          title: 'Remove',
          onclick: (e) => {
            e.stopPropagation()
            api.removeClip(item.id)
          },
        },
        '×'
      )
      const node = h('div.item', {}, lbl, x)
      node.addEventListener('click', async (e) => {
        e.stopPropagation()
        await api.copyClip(item.id)
        node.classList.add('copied')
        I.toast('📋', 'Copied')
        setTimeout(() => node.classList.remove('copied'), 450)
      })
      ui.clipList.append(node)
    }
    empty(
      ui.clipList,
      items.length === 0,
      clips.items.length === 0 ? 'Nothing captured yet.' : 'No matches.'
    )
  }

  function empty(list, isEmpty, text) {
    let note = list.querySelector('.empty')
    if (isEmpty && !note) list.append(h('div.empty', { text }))
    else if (!isEmpty && note) note.remove()
    else if (isEmpty && note) note.textContent = text
  }

  I.registerTab({
    id: 'more',
    label: 'More',
    icon: svg('<circle cx="5.5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18.5" cy="12" r="1.6"/>'),
    width: 570,
    height: 374,
    mount,
    update: (kind, payload) => {
      if (kind === 'timers') {
        timers = payload
        renderTimers()
      }
      if (kind === 'clipboard') {
        clips = payload
        renderClips()
      }
    },
    shown: () => I.pump(200),
  })
})()
