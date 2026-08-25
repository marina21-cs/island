/* eslint-env browser */
'use strict'

;(function () {
  const I = window.Island
  const { h, svg } = I

  const ui = {}
  let data = null
  let media = null
  // MPRIS reports position about once a second. Highlighting a line a second
  // late is very noticeable, so the wall clock fills the gap between reports.
  let posBase = 0
  let posAt = 0
  let lineEls = []
  let active = -1

  function mount(pane) {
    ui.title = h('div.ly-title', { text: '' })
    ui.sub = h('div.ly-sub', { text: '' })
    ui.badge = h('span.ly-badge', { text: '' })
    ui.body = h('div.ly-body')
    ui.empty = h('div.ly-empty')

    pane.append(
      h('div.ly-head', {}, h('div.ly-meta', {}, ui.title, ui.sub), h('span.spacer'), ui.badge),
      ui.body,
      ui.empty,
      h('div.ly-credit.tiny', {}, 'Lyrics from lrclib.net')
    )
    render()
    setInterval(tick, 90)
  }

  const nowMs = () =>
    media && media.status === 'Playing' ? posBase + (performance.now() - posAt) : posBase

  function render() {
    const st = (data && data.state) || 'idle'
    const lines = (data && data.synced) || []
    const plain = (data && data.plain) || ''

    ui.title.textContent = (data && data.title) || ''
    ui.sub.textContent = (data && data.artist) || ''
    ui.badge.textContent = st === 'ok' ? (data.hasTiming ? 'synced' : 'unsynced') : ''
    ui.badge.classList.toggle('on', st === 'ok' && data.hasTiming)

    const messages = {
      idle: ['Nothing from Spotify', 'Lyrics are shown for Spotify only — other players report metadata too loose to match a recording against.'],
      loading: ['Looking for lyrics…', ''],
      none: ['No lyrics for this track', 'Nothing found that matches this recording by title, artist and length. Showing nothing beats showing the wrong words.'],
      instrumental: ['Instrumental', 'This recording is marked as having no vocals.'],
      error: ['Could not reach lrclib.net', ''],
    }

    lineEls = []
    active = -1
    ui.body.textContent = ''

    if (st === 'ok' && lines.length) {
      ui.empty.textContent = ''
      ui.empty.style.display = 'none'
      ui.body.style.display = ''
      for (const l of lines) {
        // Blank LRC lines are timing markers, not lyrics; render them as a
        // small gap so the highlight has somewhere to go during a solo.
        const el = l.text
          ? h('div.ly-line', { text: l.text })
          : h('div.ly-line.ly-gap', {}, h('span.ly-dots', { text: '•••' }))
        lineEls.push(el)
        ui.body.append(el)
      }
    } else if (st === 'ok' && plain) {
      ui.empty.textContent = ''
      ui.empty.style.display = 'none'
      ui.body.style.display = ''
      for (const l of plain.split('\n')) {
        ui.body.append(l.trim() ? h('div.ly-line.ly-static', { text: l }) : h('div.ly-spacer'))
      }
    } else {
      const [head, note] = messages[st] || messages.idle
      ui.body.style.display = 'none'
      ui.empty.style.display = ''
      ui.empty.textContent = ''
      ui.empty.append(h('div.ly-emptyhead', { text: head }))
      if (note) ui.empty.append(h('div.ly-emptynote', { text: note }))
    }
    I.pump(150)
  }

  function tick() {
    if (!lineEls.length || !data || !data.hasTiming) return
    if (I.state.tab !== 'lyrics' || I.state.mode !== 'expanded') return

    const t = nowMs() / 1000
    const lines = data.synced
    let idx = -1
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].t <= t) idx = i
      else break
    }
    if (idx === active) return

    if (lineEls[active]) lineEls[active].classList.remove('on')
    active = idx
    const el = lineEls[active]
    if (!el) return
    el.classList.add('on')
    // Keep the sung line near the middle rather than letting it run to the
    // bottom edge.
    const target = el.offsetTop - ui.body.clientHeight / 2 + el.offsetHeight / 2
    ui.body.scrollTo({ top: Math.max(0, target), behavior: 'smooth' })
  }

  I.registerTab({
    id: 'lyrics',
    label: 'Lyrics',
    icon: svg('<path d="M9 18V6l11-2v12"/><circle cx="6.5" cy="18" r="2.6"/><circle cx="17.5" cy="16" r="2.6"/>'),
    width: 560,
    height: 424,
    mount,
    update: (kind, payload) => {
      if (kind === 'lyrics') {
        data = payload
        render()
      }
      if (kind === 'media') {
        media = payload
        // Reset the interpolation clock every time a real position arrives.
        posBase = (payload && payload.positionMs) || 0
        posAt = performance.now()
      }
    },
    shown: () => {
      active = -1
      I.pump(200)
    },
  })
})()
