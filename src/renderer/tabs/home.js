/* eslint-env browser */
'use strict'

;(function () {
  const I = window.Island
  const { h, svg, api, pad } = I

  const ICONS = {
    prev: '<path d="M7 6v12M19 6l-9 6 9 6z"/>',
    next: '<path d="M17 6v12M5 6l9 6-9 6z"/>',
    play: '<path d="M8 5l11 7-11 7z"/>',
    pause: '<path d="M9 5v14M15 5v14"/>',
    shot: '<path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h2L8 5h8l1.5 2h2A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z"/><circle cx="12" cy="13" r="3.4"/>',
    rec: '<rect x="3" y="6" width="12" height="12" rx="2.5"/><path d="M15 10.5 21 7v10l-6-3.5z"/>',
    stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/>',
    cloud: '<path d="M7 18h9.5a3.5 3.5 0 0 0 .3-7 5 5 0 0 0-9.6-1.2A4 4 0 0 0 7 18z"/>',
  }

  const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
  const DOW_LONG = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

  const ui = {}

  function mount(pane) {
    ui.art = h('div.hm-art.empty')
    ui.badgeImg = h('img', { alt: '' })
    ui.badge = h('span.hm-badge', {}, ui.badgeImg)
    const artwrap = h('div.hm-artwrap', {}, ui.art, ui.badge)

    ui.title = h('div.hm-title', { text: 'Nothing playing' })
    ui.album = h('div.hm-album', { text: '' })
    ui.artist = h('div.hm-artist', { text: '' })
    ui.time = h('span.hm-time', { text: '' })

    const btn = (act, icon) =>
      h(
        'button.iconbtn',
        {
          onclick: (e) => {
            e.stopPropagation()
            api.media(act)
          },
        },
        h('span', { html: svg(icon, 13) })
      )

    ui.prev = btn('prev', ICONS.prev)
    ui.playIcon = h('span', { html: svg(ICONS.play, 15) })
    ui.play = h(
      'button.iconbtn',
      {
        onclick: (e) => {
          e.stopPropagation()
          api.media('playpause')
        },
      },
      ui.playIcon
    )
    ui.next = btn('next', ICONS.next)

    const media = h(
      'div.hm-media',
      {},
      artwrap,
      h(
        'div.hm-meta',
        {},
        ui.title,
        ui.album,
        ui.artist,
        h('div.hm-ctl', {}, ui.prev, ui.play, ui.next, ui.time)
      )
    )

    ui.month = h('div.hm-month', { text: MONTHS[new Date().getMonth()] })
    ui.week = h('div.hm-week')
    ui.eventIcon = h('span', { html: svg(ICONS.cloud, 12) })
    ui.eventText = h('span', { text: '—' })
    ui.event = h('div.hm-event', {}, ui.eventIcon, ui.eventText)
    const cal = h('div.hm-cal', {}, h('div.hm-caltop', {}, ui.month, ui.week), ui.event)

    ui.shotBtn = h(
      'button.roundbtn',
      {
        title: 'Screenshot a region',
        onclick: async (e) => {
          e.stopPropagation()
          const res = await api.screenshot('region')
          if (res && res.ok) I.toast('📸', 'Screenshot saved')
        },
      },
      h('span', { html: svg(ICONS.shot, 17) })
    )
    ui.recIcon = h('span', { html: svg(ICONS.rec, 17) })
    ui.recBtn = h(
      'button.roundbtn.danger',
      {
        title: 'Record the screen',
        onclick: (e) => {
          e.stopPropagation()
          api.toggleRecord()
        },
      },
      ui.recIcon
    )
    ui.recLabel = h('span.hm-blabel', { text: 'Record' })

    const actions = h(
      'div.hm-actions',
      {},
      h('div.hm-action', {}, ui.shotBtn, h('span.hm-blabel', { text: 'Screenshot' })),
      h('div.hm-action', {}, ui.recBtn, ui.recLabel)
    )

    pane.append(h('div.hm-grid', {}, media, h('div.hm-calwrap', {}, h('span.hm-sep'), cal), actions))
    renderCalendar()
    setInterval(renderClock, 10000)
    renderClock()
  }

  function renderCalendar() {
    const now = new Date()
    ui.month.textContent = MONTHS[now.getMonth()]
    ui.week.textContent = ''
    // A week centred on today, so yesterday and tomorrow are both in view.
    const start = new Date(now)
    start.setDate(now.getDate() - 3)
    for (let i = 0; i < 7; i++) {
      const d = new Date(start)
      d.setDate(start.getDate() + i)
      const isToday = d.toDateString() === now.toDateString()
      const weekend = d.getDay() === 0 || d.getDay() === 6
      ui.week.append(
        h(
          `div.hm-day${isToday ? '.today' : ''}${weekend ? '.weekend' : ''}`,
          {},
          // Today spells its weekday out; the rest stay single letters, so the
          // eye lands on today without needing the colour alone to say so.
          h('span.hm-dow', { text: isToday ? DOW_LONG[d.getDay()] : DOW[d.getDay()] }),
          h('span.hm-datebox', { text: String(d.getDate()) })
        )
      )
    }
  }

  let lastDay = new Date().getDate()

  function renderClock() {
    const now = new Date()
    if (now.getDate() !== lastDay) {
      lastDay = now.getDate()
      renderCalendar()
    }
    const w = I.state.feeds.weather
    const time = `${now.getHours()}:${pad(now.getMinutes())}`
    // This slot holds weather rather than a calendar summary: the panel has no
    // calendar access, and "Nothing for today" would be a claim it cannot make.
    ui.eventText.textContent = w && w.available ? `${w.temp}°C ${w.city} · ${time}` : time
  }

  function update(kind, data) {
    if (kind === 'media') {
      const has = !!(data && data.available && data.title)
      ui.art.style.backgroundImage = has && data.art ? `url("${data.art}")` : ''
      ui.art.classList.toggle('empty', !(has && data.art))

      const icon = has ? data.sourceIcon : null
      if (icon) ui.badgeImg.src = icon
      ui.badge.classList.toggle('on', !!icon)
      ui.badge.title = has ? data.sourceName || data.source || '' : ''

      ui.title.textContent = has ? data.title : 'Nothing playing'
      ui.album.textContent = has ? data.album || '' : ''
      ui.artist.textContent = has ? data.artist || '' : ''
      ui.time.textContent =
        has && data.lengthMs > 0 ? `${I.clockText(data.positionMs)} / ${I.clockText(data.lengthMs)}` : ''
      ui.playIcon.innerHTML = svg(data && data.status === 'Playing' ? ICONS.pause : ICONS.play, 15)
      ui.prev.disabled = !has || !data.canPrev
      ui.next.disabled = !has || !data.canNext
      ui.play.disabled = !has
    }
    if (kind === 'weather') renderClock()
    if (kind === 'capture') {
      const on = !!(data && data.recording)
      ui.recIcon.innerHTML = svg(on ? ICONS.stop : ICONS.rec, 17)
      ui.recLabel.textContent = on ? I.clockText((data.seconds || 0) * 1000) : 'Record'
      ui.recBtn.classList.toggle('on', on)
      if (data && data.record === false) ui.recBtn.disabled = true
      if (data && data.screenshot === false) ui.shotBtn.disabled = true
    }
  }

  I.registerTab({
    id: 'home',
    label: 'Home',
    icon: svg('<path d="M4 10.5 12 4l8 6.5V20H4z"/>'),
    width: 760,
    height: 198,
    mount,
    update,
  })
})()
