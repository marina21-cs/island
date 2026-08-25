/* eslint-env browser */
'use strict'

;(function () {
  const I = window.Island
  const { api, $, state } = I

  I.buildTabs()

  /* --- collapsed pill ---------------------------------------------------- */

  function tickClock() {
    const now = new Date()
    $('clock').textContent = `${now.getHours()}:${I.pad(now.getMinutes())}`
  }
  tickClock()
  setInterval(tickClock, 5000)

  function setMarquee() {
    const box = $('ambText').parentElement
    const overflow = $('ambText').scrollWidth - box.clientWidth
    if (overflow > 6) {
      $('ambText').style.setProperty('--shift', `-${overflow + 12}px`)
      $('ambText').classList.add('scroll')
    } else {
      $('ambText').classList.remove('scroll')
      $('ambText').style.removeProperty('--shift')
    }
  }

  /* --- the gear menu ------------------------------------------------------ */

  // Horizontal now that the sliders live in a menu rather than a side column.
  function wireSlider(track, apply, read) {
    const valueAt = (e) => {
      const r = track.getBoundingClientRect()
      return Math.round(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * 100)
    }
    let dragging = false
    track.addEventListener('mousedown', (e) => {
      e.stopPropagation()
      dragging = true
      apply(valueAt(e))
    })
    window.addEventListener('mousemove', (e) => {
      if (dragging) apply(valueAt(e))
    })
    window.addEventListener('mouseup', () => (dragging = false))
    track.addEventListener('wheel', (e) => {
      e.preventDefault()
      apply(read() + (e.deltaY < 0 ? 4 : -4))
    })
  }

  wireSlider(
    $('mnVolTrack'),
    (v) => api.setVolume(v),
    () => (state.feeds.audio && state.feeds.audio.volume) || 0
  )
  wireSlider(
    $('mnBriTrack'),
    (v) => api.setBrightness(v),
    () => (state.feeds.brightness && state.feeds.brightness.value) || 0
  )

  $('mnMute').addEventListener('click', (e) => {
    e.stopPropagation()
    api.toggleMute()
  })

  const mnAutostart = $('mnAutostart')
  const mnClipPause = $('mnClipPause')

  mnAutostart.addEventListener('click', async (e) => {
    e.stopPropagation()
    const next = !mnAutostart.classList.contains('on')
    const now = await api.setAutostart(next)
    mnAutostart.classList.toggle('on', !!now)
    I.toast(now ? '✓' : '·', now ? 'Starts at login' : 'Login start off')
  })

  mnClipPause.addEventListener('click', (e) => {
    e.stopPropagation()
    api.pauseClips(!mnClipPause.classList.contains('on'))
  })

  $('mnHide').addEventListener('click', (e) => {
    e.stopPropagation()
    api.hidePanel()
  })
  $('mnReload').addEventListener('click', (e) => {
    e.stopPropagation()
    api.reloadPanel()
  })
  $('mnQuit').addEventListener('click', (e) => {
    e.stopPropagation()
    api.quitApp()
  })

  // Autostart is owned by a file on disk, so read it back each time the menu
  // opens rather than trusting a cached flag.
  I.onMenuOpen(async () => {
    const s = await api.settings()
    mnAutostart.classList.toggle('on', !!s.autostart)
    mnClipPause.classList.toggle('on', !!s.clipboardPaused)
  })

  /* --- feed handling ----------------------------------------------------- */

  // Announce a track once. Keyed on player+title so a pause/resume or a
  // position tick does not re-trigger the card.
  let lastTrack = ''

  I.onFeed((kind, data) => {
    if (kind === 'media') {
      const has = !!(data && data.available && data.title)
      const playing = data && data.status === 'Playing'
      $('ambWave').classList.toggle('playing', !!playing)
      $('idleWave').classList.toggle('playing', !!playing)
      // No point showing a green equaliser when there is no audio at all.
      $('idleWave').classList.toggle('hidden', !has)
      $('ambWave').classList.toggle('hidden', !has)
      // The orb wears the cover art while something plays, and falls back to
      // its own gradient when nothing does.
      $('orbArt').style.backgroundImage = has && data.art ? `url("${data.art}")` : ''
      $('orb').classList.toggle('playing', !!playing)
      // No cover for a video clip, so fall back to the app's own icon: the
      // point of the pill here is just "this app is making sound".
      const ambImage = has ? data.art || data.sourceIcon : null
      $('ambArt').style.backgroundImage = ambImage ? `url("${ambImage}")` : ''
      $('ambArt').classList.toggle('icon', !!(has && !data.art && data.sourceIcon))
      if (has) {
        $('ambText').textContent = ''
        $('ambText').append(document.createTextNode(data.title))
        if (data.artist) {
          const dim = document.createElement('span')
          dim.className = 'dim'
          dim.textContent = `  ·  ${data.artist}`
          $('ambText').append(dim)
        }
        requestAnimationFrame(setMarquee)
      }
      if (has) {
        $('laArt').style.backgroundImage = data.art ? `url("${data.art}")` : ''
        $('laTitle').textContent = data.title
        $('laSub').textContent =
          [data.artist, data.album].filter(Boolean).join(' · ') || data.sourceName || ''
        const pct = data.lengthMs > 0 ? Math.min(100, (data.positionMs / data.lengthMs) * 100) : 0
        $('laFill').style.width = `${pct}%`
        $('laElapsed').textContent = I.clockText(data.positionMs)
        $('laRemain').textContent =
          data.lengthMs > 0 ? `-${I.clockText(Math.max(0, data.lengthMs - data.positionMs))}` : ''
        // The glow takes the cover's own colour, falling back to a cool
        // neutral when the art has none to give.
        $('laGlow').style.setProperty(
          '--glow',
          data.artColour ? `rgba(${data.artColour.join(',')}, 0.45)` : 'rgba(88, 108, 158, 0.3)'
        )
        $('laBadge').classList.toggle('off', !data.sourceIcon)
        if (data.sourceIcon) $('laBadgeImg').src = data.sourceIcon
      }

      const track = has ? `${data.player}|${data.title}` : ''
      // Only real music announces itself. Scrolling a feed of clips would
      // otherwise throw the card up on every single one.
      if (has && playing && data.isMusic && track !== lastTrack) {
        lastTrack = track
        I.showActivity()
      }
      if (!has) lastTrack = ''

      I.updateAmbient()
      I.settle()
    }

    // Machine stats live in the Stats panel now, not scattered across the
    // desktop. The collapsed pill only speaks up for battery worth acting on.
    if (kind === 'vitals' && data && data.battery && data.battery.capacity !== null) {
      const { capacity, status } = data.battery
      const charging = status === 'Charging' || data.ac === true
      const notable = charging || capacity <= 20
      $('idleMeta').textContent = notable ? `${capacity}%${charging ? ' ⌁' : ''}` : ''
    }

    if (kind === 'brightness' && data) {
      $('mnBriVal').textContent = data.available ? `${data.value}%` : '—'
      $('mnBriFill').style.width = `${data.available ? data.value : 0}%`
      $('mnBriRow').style.opacity = data.available ? '' : '0.45'
      // Say plainly which kind of brightness this is.
      $('mnBriNote').textContent =
        data.mode === 'software' ? 'Software dim — README has the hardware rule' : ''
    }

    if (kind === 'audio' && data) {
      $('menu').classList.toggle('muted', !!data.muted)
      $('mnVolVal').textContent = data.available ? `${data.volume}%` : '—'
      $('mnVolFill').style.width = `${data.muted ? 0 : data.volume}%`
    }

    if (kind === 'clipboard' && data) mnClipPause.classList.toggle('on', !!data.paused)

    if (kind === 'capture' && data) {
      $('idleRec').classList.toggle('on', !!data.recording)
    }

    if (kind === 'timers') {
      I.updateAmbient()
      I.settle()
    }

    if (kind === 'notifications' && data) I.setBadge('alerts', data.unread || 0)
  })

  /* --- commands from main ------------------------------------------------ */

  api.onCommand((cmd) => {
    if (cmd.type === 'toggle') {
      I.setPinned(!state.pinned)
    } else if (cmd.type === 'menu') {
      I.setPinned(true)
      I.setMenu(true)
    } else if (cmd.type === 'open') {
      I.setTab(cmd.tab)
      I.setPinned(true)
    } else if (cmd.type === 'timer-fired') {
      I.toast('⏱', `${cmd.timer.label} finished`, 4000)
    } else if (cmd.type === 'notification') {
      I.toast('🔔', cmd.item.summary || cmd.item.app, 3200)
    } else if (cmd.type === 'shot') {
      I.toast('📸', 'Screenshot saved')
    } else if (cmd.type === 'recorded') {
      I.toast('⏹', 'Recording saved')
    } else if (cmd.type === 'capture-error') {
      I.toast('⚠', cmd.message || 'Capture failed', 4000)
    }
  })

  api.onMedia((d) => I.dispatch('media', d))
  api.onVitals((d) => I.dispatch('vitals', d))
  api.onTimers((d) => I.dispatch('timers', d))
  api.onClipboard((d) => I.dispatch('clipboard', d))
  api.onAudio((d) => I.dispatch('audio', d))
  api.onBrightness((d) => I.dispatch('brightness', d))
  api.onNotifications((d) => I.dispatch('notifications', d))
  api.onCapture((d) => I.dispatch('capture', d))
  api.onWeather((d) => I.dispatch('weather', d))

  /* --- boot -------------------------------------------------------------- */

  api.snapshot().then(async (snap) => {
    state.cfg = { ...state.cfg, ...snap.config }
    if (snap.config.shadowPadding > 0) document.documentElement.dataset.shadow = 'on'

    for (const kind of [
      'vitals', 'audio', 'brightness', 'capture', 'weather',
      'timers', 'clipboard', 'notifications', 'media',
    ]) {
      if (snap[kind] !== undefined) I.dispatch(kind, snap[kind])
    }

    for (const def of I.tabs.values()) {
      if (def.ready) await def.ready()
    }

    I.setMode(I.baseMode())
    I.syncShape()
    I.pump(300)

  })
})()
