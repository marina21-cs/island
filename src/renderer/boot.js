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

  /* --- stat chips -------------------------------------------------------- */

  const chip = (k) => document.querySelector(`.chip[data-k="${k}"]`)

  function paintChip(k, text, level) {
    const node = chip(k)
    if (!node) return
    node.querySelector('span').textContent = text
    node.classList.remove('warn', 'crit')
    if (level) node.classList.add(level)
  }

  /* --- volume ------------------------------------------------------------ */

  const track = $('volTrack')

  function volumeFromEvent(e) {
    const r = track.getBoundingClientRect()
    return Math.round(Math.max(0, Math.min(1, (r.bottom - e.clientY) / r.height)) * 100)
  }

  let dragging = false
  track.addEventListener('mousedown', (e) => {
    e.stopPropagation()
    dragging = true
    api.setVolume(volumeFromEvent(e))
  })
  window.addEventListener('mousemove', (e) => {
    if (dragging) api.setVolume(volumeFromEvent(e))
  })
  window.addEventListener('mouseup', () => (dragging = false))
  track.addEventListener('wheel', (e) => {
    e.preventDefault()
    const cur = (state.feeds.audio && state.feeds.audio.volume) || 0
    api.setVolume(cur + (e.deltaY < 0 ? 4 : -4))
  })
  $('volMute').addEventListener('click', (e) => {
    e.stopPropagation()
    api.toggleMute()
  })

  /* --- recording chip ---------------------------------------------------- */

  $('chipRec').addEventListener('click', (e) => {
    e.stopPropagation()
    api.toggleRecord()
  })

  /* --- feed handling ----------------------------------------------------- */

  I.onFeed((kind, data) => {
    if (kind === 'media') {
      const has = !!(data && data.available && data.title)
      const playing = data && data.status === 'Playing'
      $('ambWave').classList.toggle('playing', !!playing)
      $('idleWave').classList.toggle('playing', !!playing)
      // No point showing a green equaliser when there is no audio at all.
      $('idleWave').classList.toggle('hidden', !has)
      $('ambWave').classList.toggle('hidden', !has)
      $('ambArt').style.backgroundImage = has && data.art ? `url("${data.art}")` : ''
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
      $('idleMeta').textContent = has ? data.title : ''
      I.updateAmbient()
      I.settle()
    }

    if (kind === 'vitals' && data) {
      paintChip('cpu', `${data.cpu}%`, data.cpu >= 85 ? 'crit' : data.cpu >= 60 ? 'warn' : null)
      const memPct = Math.round(data.mem.pct)
      paintChip('ram', `${memPct}%`, memPct >= 90 ? 'crit' : memPct >= 75 ? 'warn' : null)
      if (data.gpu) {
        paintChip('gpu', `${data.gpu.temp}°`, data.gpu.temp >= 85 ? 'crit' : data.gpu.temp >= 72 ? 'warn' : null)
      } else if (data.temp !== null) {
        paintChip('gpu', `${data.temp}°`, null)
      } else {
        paintChip('gpu', '—', null)
      }
      if (data.battery && data.battery.capacity !== null && I.state.mode === 'idle') {
        const charging = data.battery.status === 'Charging' || data.ac === true
        const meta = $('idleMeta')
        if (!meta.textContent) meta.textContent = `${data.battery.capacity}%${charging ? ' ⌁' : ''}`
      }
    }

    if (kind === 'audio' && data) {
      $('volume').classList.toggle('muted', !!data.muted)
      $('volPct').textContent = data.available ? `${data.volume}%` : '—'
      $('volFill').style.height = `${data.muted ? 0 : data.volume}%`
    }

    if (kind === 'capture' && data) {
      const rec = $('chipRec')
      rec.classList.toggle('on', !!data.recording)
      rec.querySelector('.rectime').textContent = data.recording
        ? I.clockText((data.seconds || 0) * 1000)
        : 'REC'
      rec.title = data.recording ? 'Stop recording' : 'Start recording'
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
  api.onNotifications((d) => I.dispatch('notifications', d))
  api.onCapture((d) => I.dispatch('capture', d))
  api.onWeather((d) => I.dispatch('weather', d))

  /* --- boot -------------------------------------------------------------- */

  api.snapshot().then(async (snap) => {
    state.cfg = { ...state.cfg, ...snap.config }
    if (snap.config.shadowPadding > 0) document.documentElement.dataset.shadow = 'on'

    for (const kind of [
      'vitals', 'audio', 'capture', 'weather',
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
