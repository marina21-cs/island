/* eslint-env browser */
'use strict'

;(function () {
  const I = window.Island
  const { h, svg, api, ago } = I

  const ui = {}
  let data = { items: [], unread: 0, available: false }

  function mount(pane) {
    ui.count = h('span.tiny.muted', { text: '' })
    ui.clear = h(
      'button.tr-edit',
      {
        onclick: (e) => {
          e.stopPropagation()
          api.clearNotifs()
        },
      },
      'Clear all'
    )
    ui.list = h('div.list.al-list')
    pane.append(
      h('div.al-head', {}, h('span.kicker', { text: 'Notifications' }), ui.count, h('span.spacer'), ui.clear),
      ui.list
    )
    render()
  }

  function render() {
    ui.list.textContent = ''
    ui.count.textContent = data.items.length ? `${data.items.length}` : ''
    ui.clear.style.display = data.items.length ? '' : 'none'

    if (!data.available) {
      ui.list.append(
        h('div.empty', { text: 'Not watching the bus — D-Bus monitoring was refused.' })
      )
      return
    }
    if (!data.items.length) {
      ui.list.append(h('div.empty', { text: 'Nothing yet. Desktop notifications will appear here.' }))
      return
    }

    for (const n of data.items.slice(0, 40)) {
      const card = h(
        'div.al-item',
        {},
        h(
          'div.al-top',
          {},
          h('span.al-app', { text: n.app }),
          h('span.spacer'),
          h('span.al-ago.tiny', { text: ago(n.at) }),
          h(
            'button.x',
            {
              title: 'Dismiss',
              onclick: (e) => {
                e.stopPropagation()
                api.removeNotif(n.id)
              },
            },
            '×'
          )
        ),
        n.summary ? h('div.al-sum', { text: n.summary }) : null,
        n.body ? h('div.al-body', { text: n.body }) : null
      )
      ui.list.append(card)
    }
  }

  I.registerTab({
    id: 'alerts',
    label: 'Alerts',
    icon: svg('<path d="M18 8.5a6 6 0 1 0-12 0c0 6-2 7.5-2 7.5h16s-2-1.5-2-7.5"/><path d="M10.5 19.5a2 2 0 0 0 3 0"/>'),
    width: 524,
    height: 366,
    mount,
    update: (kind, payload) => {
      if (kind !== 'notifications') return
      data = payload
      render()
    },
    shown: () => {
      api.markNotifsRead()
      I.pump(200)
    },
  })
})()
