/* eslint-env browser */
'use strict'

;(function () {
  const I = window.Island
  const { h, svg, api } = I

  const COLUMNS = [
    { id: 'backlog', name: 'Backlog' },
    { id: 'todo', name: 'To Do' },
    { id: 'doing', name: 'In Progress' },
    { id: 'done', name: 'Done' },
  ]

  const ui = {}
  let cards = []
  let notes = []
  let activeNote = null
  let seq = 1

  const save = () => api.storeSet('board', { cards, seq })
  const saveNotes = () => api.storeSet('notes', notes)

  function mount(pane) {
    ui.seg = I.segmented(
      [
        { id: 'board', label: 'Board' },
        { id: 'notes', label: 'Notes' },
      ],
      (id) => show(id)
    )

    ui.cols = h('div.bd-cols')
    ui.boardView = h('div.mo-view', {}, ui.cols)

    ui.noteList = h('div.list.nt-list')
    ui.noteTitle = h('input.field.nt-title', {
      type: 'text',
      placeholder: 'Title',
      spellcheck: 'false',
      oninput: () => {
        if (!activeNote) return
        activeNote.title = ui.noteTitle.value
        activeNote.at = Date.now()
        saveNotes()
        renderNoteList()
      },
    })
    ui.noteBody = h('textarea.field.nt-body', {
      placeholder: 'Write something…',
      spellcheck: 'false',
      oninput: () => {
        if (!activeNote) return
        activeNote.body = ui.noteBody.value
        activeNote.at = Date.now()
        saveNotes()
        renderNoteList()
      },
    })
    ui.noteDelete = h(
      'button.tr-edit',
      {
        onclick: (e) => {
          e.stopPropagation()
          if (!activeNote) return
          notes = notes.filter((n) => n.id !== activeNote.id)
          activeNote = notes[0] || null
          saveNotes()
          renderNotes()
        },
      },
      'Delete'
    )
    ui.notesView = h(
      'div.mo-view.nt-view',
      {},
      h(
        'div.nt-left',
        {},
        h(
          'button.nt-new',
          {
            onclick: (e) => {
              e.stopPropagation()
              const note = { id: `n${Date.now()}`, title: '', body: '', at: Date.now() }
              notes.unshift(note)
              activeNote = note
              saveNotes()
              renderNotes()
              ui.noteTitle.focus()
            },
          },
          '+ New note'
        ),
        ui.noteList
      ),
      h('div.nt-right', {}, h('div.mo-row', {}, ui.noteTitle, ui.noteDelete), ui.noteBody)
    )

    pane.append(h('div.mo-head', {}, ui.seg.el), ui.boardView, ui.notesView)
    show('board')
  }

  function show(id) {
    ui.boardView.classList.toggle('on', id === 'board')
    ui.notesView.classList.toggle('on', id === 'notes')
    I.pump(150)
  }

  /* --- kanban ------------------------------------------------------------ */

  function move(id, delta) {
    const card = cards.find((c) => c.id === id)
    if (!card) return
    const idx = COLUMNS.findIndex((c) => c.id === card.col)
    const next = Math.max(0, Math.min(COLUMNS.length - 1, idx + delta))
    card.col = COLUMNS[next].id
    save()
    renderBoard()
  }

  function moveTo(id, colId) {
    const card = cards.find((c) => c.id === id)
    if (!card || card.col === colId) return
    card.col = colId
    save()
    renderBoard()
  }

  function renderBoard() {
    ui.cols.textContent = ''
    for (const col of COLUMNS) {
      const mine = cards.filter((c) => c.col === col.id)
      const list = h('div.bd-cards')

      for (const card of mine) {
        const node = h(
          'div.bd-card',
          {
            draggable: 'true',
            title: 'Click to advance · drag to move',
            ondragstart: (e) => e.dataTransfer.setData('text/plain', card.id),
            onclick: (e) => {
              e.stopPropagation()
              move(card.id, e.shiftKey ? -1 : 1)
            },
          },
          h('span.bd-text', { text: card.title }),
          h(
            'button.x',
            {
              title: 'Delete',
              onclick: (e) => {
                e.stopPropagation()
                cards = cards.filter((c) => c.id !== card.id)
                save()
                renderBoard()
              },
            },
            '×'
          )
        )
        list.append(node)
      }

      const add = h('input.bd-add', {
        type: 'text',
        placeholder: '+ Add',
        spellcheck: 'false',
        onkeydown: (e) => {
          if (e.key !== 'Enter') return
          const title = add.value.trim()
          if (!title) return
          cards.push({ id: `c${seq++}`, title, col: col.id, at: Date.now() })
          add.value = ''
          save()
          renderBoard()
        },
      })

      const column = h(
        'div.bd-col',
        {
          ondragover: (e) => {
            e.preventDefault()
            column.classList.add('over')
          },
          ondragleave: () => column.classList.remove('over'),
          ondrop: (e) => {
            e.preventDefault()
            column.classList.remove('over')
            moveTo(e.dataTransfer.getData('text/plain'), col.id)
          },
        },
        h(
          'div.bd-head',
          {},
          h('span.kicker', { text: col.name }),
          h('span.bd-count', { text: String(mine.length) })
        ),
        list,
        add
      )
      ui.cols.append(column)
    }
    I.pump(120)
  }

  /* --- notes ------------------------------------------------------------- */

  function renderNoteList() {
    ui.noteList.textContent = ''
    if (!notes.length) {
      ui.noteList.append(h('div.empty', { text: 'No notes.' }))
      return
    }
    for (const n of notes) {
      const node = h(
        `div.nt-item${activeNote && activeNote.id === n.id ? '.on' : ''}`,
        {
          onclick: (e) => {
            e.stopPropagation()
            activeNote = n
            renderNotes()
          },
        },
        h('span.nt-name', { text: n.title || 'Untitled note' }),
        h('span.nt-prev.tiny', { text: (n.body || '').replace(/\s+/g, ' ').slice(0, 40) || '—' })
      )
      ui.noteList.append(node)
    }
  }

  function renderNotes() {
    renderNoteList()
    const has = !!activeNote
    ui.noteTitle.value = has ? activeNote.title : ''
    ui.noteBody.value = has ? activeNote.body : ''
    ui.noteTitle.disabled = !has
    ui.noteBody.disabled = !has
    ui.noteDelete.style.display = has ? '' : 'none'
    I.pump(120)
  }

  async function ready() {
    const saved = await api.storeGet('board', { cards: [], seq: 1 })
    cards = Array.isArray(saved.cards) ? saved.cards : []
    seq = saved.seq || cards.length + 1
    notes = (await api.storeGet('notes', [])) || []
    activeNote = notes[0] || null
    renderBoard()
    renderNotes()
  }

  I.registerTab({
    id: 'board',
    label: 'Board',
    icon: svg('<rect x="3.5" y="4.5" width="4.5" height="15" rx="1.4"/><rect x="9.8" y="4.5" width="4.5" height="10" rx="1.4"/><rect x="16.1" y="4.5" width="4.5" height="13" rx="1.4"/>'),
    width: 668,
    height: 372,
    mount,
    ready,
    shown: () => I.pump(200),
  })
})()
