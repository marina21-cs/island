/* eslint-env browser */
'use strict'

;(function () {
  const I = window.Island
  const { h, svg, bytes } = I

  const ui = {}
  const cards = {}

  function card(key, label) {
    const value = h('span.st-value', { text: '—' })
    const sub = h('span.st-sub', { text: '' })
    const fill = h('i')
    const node = h(
      'div.st-card',
      { 'data-k': key },
      h('span.kicker', { text: label }),
      value,
      h('span.st-bar', {}, fill),
      sub
    )
    cards[key] = { node, value, sub, fill }
    return node
  }

  function paint(key, { text, sub, pct, level }) {
    const c = cards[key]
    if (!c) return
    c.value.textContent = text
    c.sub.textContent = sub || ''
    c.fill.style.width = `${Math.max(0, Math.min(100, pct || 0))}%`
    c.node.classList.remove('good', 'warn', 'crit')
    if (level) c.node.classList.add(level)
  }

  function mount(pane) {
    ui.grid = h(
      'div.st-grid',
      {},
      card('cpu', 'Processor'),
      card('mem', 'Memory'),
      card('gpu', 'Graphics'),
      card('battery', 'Battery')
    )
    ui.net = h('div.st-net')
    ui.down = h('span.st-netval', { text: '—' })
    ui.up = h('span.st-netval', { text: '—' })
    ui.net.append(
      h('span.kicker', { text: 'Network' }),
      h('span.spacer'),
      h('span.st-netcell', {}, h('span', { html: svg('<path d="M12 5v14m0 0-5-5m5 5 5-5"/>', 12) }), ui.down),
      h('span.st-netcell', {}, h('span', { html: svg('<path d="M12 19V5m0 0-5 5m5-5 5 5"/>', 12) }), ui.up)
    )
    pane.append(ui.grid, ui.net)
  }

  const gib = (kb) => `${(kb / 1024 / 1024).toFixed(1)} GB`

  function update(kind, v) {
    if (kind !== 'vitals' || !v) return

    paint('cpu', {
      text: `${v.cpu}%`,
      sub: v.temp !== null ? `${v.temp}°C package` : 'load, all cores',
      pct: v.cpu,
      level: v.cpu >= 85 ? 'crit' : v.cpu >= 60 ? 'warn' : 'good',
    })

    const memPct = Math.round(v.mem.pct)
    paint('mem', {
      text: `${memPct}%`,
      sub: `${gib(v.mem.usedKb)} of ${gib(v.mem.totalKb)}`,
      pct: memPct,
      level: memPct >= 90 ? 'crit' : memPct >= 75 ? 'warn' : 'good',
    })

    if (v.gpu) {
      const vramPct = v.gpu.memTotalMb ? (v.gpu.memUsedMb / v.gpu.memTotalMb) * 100 : 0
      paint('gpu', {
        text: `${v.gpu.temp}°C`,
        sub: `${v.gpu.util}% · ${(v.gpu.memUsedMb / 1024).toFixed(1)}/${(v.gpu.memTotalMb / 1024).toFixed(1)} GB`,
        pct: Math.max(v.gpu.util, vramPct),
        level: v.gpu.temp >= 85 ? 'crit' : v.gpu.temp >= 72 ? 'warn' : 'good',
      })
    } else {
      // No discrete GPU reachable — say so rather than show a dead meter.
      paint('gpu', { text: '—', sub: 'no nvidia-smi', pct: 0, level: null })
    }

    if (v.battery && v.battery.capacity !== null) {
      const { capacity, status, minutes } = v.battery
      const charging = status === 'Charging' || status === 'Full' || v.ac === true
      const sub = charging
        ? status === 'Full'
          ? 'full'
          : 'charging'
        : minutes
          ? `${Math.floor(minutes / 60)}h ${I.pad(minutes % 60)}m left`
          : status.toLowerCase()
      paint('battery', {
        text: `${capacity}%`,
        sub,
        pct: capacity,
        level: capacity <= 15 && !charging ? 'crit' : capacity <= 30 && !charging ? 'warn' : 'good',
      })
    } else {
      paint('battery', { text: 'AC', sub: 'no battery', pct: 100, level: 'good' })
    }

    ui.down.textContent = bytes(v.net.down)
    ui.up.textContent = bytes(v.net.up)
  }

  I.registerTab({
    id: 'stats',
    label: 'Stats',
    icon: svg('<path d="M4 19V10M9.3 19V5M14.7 19v-6M20 19v-9"/>'),
    width: 470,
    height: 268,
    mount,
    update,
    shown: () => I.pump(200),
  })
})()
