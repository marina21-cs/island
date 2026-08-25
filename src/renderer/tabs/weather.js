/* eslint-env browser */
'use strict'

;(function () {
  const I = window.Island
  const { h, svg, api } = I

  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const ui = {}
  let data = null

  function mount(pane) {
    ui.icon = h('span.wx-icon', { text: '·' })
    ui.temp = h('span.wx-temp', { text: '—' })
    ui.text = h('span.wx-text', { text: '' })
    ui.where = h('span.wx-where.tiny', { text: '' })

    ui.windy = h(
      'button.wx-windy',
      {
        title: 'Open this location on windy.com',
        onclick: async (e) => {
          e.stopPropagation()
          const ok = await api.openWindy()
          I.toast(ok ? '🌐' : '⚠', ok ? 'Opening Windy' : 'No location yet')
        },
      },
      'Windy',
      h('span', { html: svg('<path d="M7 17 17 7M9 7h8v8"/>', 11) })
    )

    ui.hours = h('div.wx-hours')
    ui.days = h('div.wx-days')

    pane.append(
      h(
        'div.wx-head',
        {},
        ui.icon,
        h('div.wx-now', {}, h('div.wx-line', {}, ui.temp, ui.text), ui.where),
        h('span.spacer'),
        ui.windy
      ),
      h('span.kicker.wx-k', { text: 'Next hours' }),
      ui.hours,
      h('span.kicker.wx-k', { text: 'Next days' }),
      ui.days
    )
    render()
  }

  function render() {
    const w = data
    if (!w || !w.available) {
      ui.temp.textContent = '—'
      ui.text.textContent = 'No forecast'
      ui.where.textContent = 'Offline, or the location could not be resolved'
      ui.icon.textContent = '·'
      ui.hours.textContent = ''
      ui.days.textContent = ''
      return
    }

    ui.icon.textContent = w.icon || '·'
    ui.temp.textContent = `${w.temp}°`
    ui.text.textContent = w.text || ''
    const bits = [w.city]
    if (w.humidity !== undefined) bits.push(`${w.humidity}% humidity`)
    if (w.wind !== undefined) bits.push(`${w.wind} km/h wind`)
    ui.where.textContent = bits.filter(Boolean).join(' · ')

    ui.hours.textContent = ''
    for (const hh of w.hourly || []) {
      ui.hours.append(
        h(
          'div.wx-hour',
          {},
          h('span.wx-hh', { text: String(hh.hour).padStart(2, '0') }),
          h('span.wx-hi', { text: hh.icon }),
          h('span.wx-ht', { text: `${hh.temp}°` })
        )
      )
    }

    // One shared scale across the week, so the bars are comparable rather than
    // each stretched to its own row.
    const days = w.daily || []
    const lo = Math.min(...days.map((d) => d.min))
    const hi = Math.max(...days.map((d) => d.max))
    const span = Math.max(1, hi - lo)

    ui.days.textContent = ''
    days.forEach((d, i) => {
      const bar = h('span.wx-range')
      const fill = h('i')
      fill.style.marginLeft = `${((d.min - lo) / span) * 100}%`
      fill.style.width = `${((d.max - d.min) / span) * 100}%`
      bar.append(fill)
      const label = i === 0 ? 'Today' : DAYS[new Date(`${d.date}T12:00:00`).getDay()]
      ui.days.append(
        h(
          'div.wx-day',
          {},
          h('span.wx-dn', { text: label }),
          h('span.wx-di', { text: d.icon }),
          h('span.wx-dl', { text: `${d.min}°` }),
          bar,
          h('span.wx-dh', { text: `${d.max}°` })
        )
      )
    })
    I.pump(150)
  }

  I.registerTab({
    id: 'weather',
    label: 'Weather',
    icon: svg('<path d="M7 18h9.5a3.5 3.5 0 0 0 .3-7 5 5 0 0 0-9.6-1.2A4 4 0 0 0 7 18z"/>'),
    width: 560,
    height: 386,
    mount,
    update: (kind, payload) => {
      if (kind !== 'weather') return
      data = payload
      render()
    },
    shown: () => I.pump(200),
  })
})()
