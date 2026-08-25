/* eslint-env browser */
'use strict'

;(function () {
  const I = window.Island
  const { h, svg, api } = I

  const ui = {}

  /* --- calculator --------------------------------------------------------- */

  const calc = { entry: '0', acc: null, op: null, fresh: true }

  const KEYS = [
    ['AC', 'act'], ['⌫', 'act'], ['%', 'act'], ['÷', 'op'],
    ['7', 'num'], ['8', 'num'], ['9', 'num'], ['×', 'op'],
    ['4', 'num'], ['5', 'num'], ['6', 'num'], ['−', 'op'],
    ['1', 'num'], ['2', 'num'], ['3', 'num'], ['+', 'op'],
    ['0', 'num wide'], ['.', 'num'], ['=', 'eq'],
  ]

  const OPS = {
    '+': (a, b) => a + b,
    '−': (a, b) => a - b,
    '×': (a, b) => a * b,
    '÷': (a, b) => (b === 0 ? NaN : a / b),
  }

  function show(value) {
    if (Number.isNaN(value)) return 'Error'
    const n = Number(value)
    if (!Number.isFinite(n)) return 'Error'
    // Keep it readable without dragging in float noise like 0.30000000000000004.
    const rounded = Math.abs(n) < 1e15 ? parseFloat(n.toPrecision(12)) : n
    return String(rounded)
  }

  function press(key, kind) {
    if (kind === 'num' || kind === 'num wide') {
      if (key === '.') {
        if (calc.fresh) {
          calc.entry = '0.'
          calc.fresh = false
        } else if (!calc.entry.includes('.')) calc.entry += '.'
      } else if (calc.fresh) {
        calc.entry = key
        calc.fresh = false
      } else {
        calc.entry = calc.entry === '0' ? key : calc.entry + key
      }
    } else if (kind === 'op') {
      resolve()
      calc.acc = parseFloat(calc.entry)
      calc.op = key
      calc.fresh = true
    } else if (kind === 'eq') {
      resolve()
      calc.op = null
      calc.fresh = true
    } else if (key === 'AC') {
      calc.entry = '0'
      calc.acc = null
      calc.op = null
      calc.fresh = true
    } else if (key === '⌫') {
      calc.entry = calc.entry.length > 1 ? calc.entry.slice(0, -1) : '0'
      if (calc.entry === '0') calc.fresh = true
    } else if (key === '%') {
      calc.entry = show(parseFloat(calc.entry) / 100)
    }
    ui.display.textContent = calc.entry
    ui.formula.textContent = calc.op ? `${show(calc.acc)} ${calc.op}` : ''
  }

  function resolve() {
    if (calc.op === null || calc.acc === null) return
    const result = OPS[calc.op](calc.acc, parseFloat(calc.entry))
    calc.entry = show(result)
    calc.acc = Number.isFinite(result) ? result : null
  }

  function buildCalc() {
    ui.formula = h('div.cl-formula.tiny.muted')
    ui.display = h('div.cl-display', { text: '0' })
    const pad = h('div.cl-pad')
    for (const [key, kind] of KEYS) {
      pad.append(
        h(
          `button.cl-key.${kind.split(' ').join('.')}`,
          {
            onclick: (e) => {
              e.stopPropagation()
              press(key, kind)
            },
          },
          key
        )
      )
    }
    return h('div.mo-view.cl-view', {}, h('div.cl-out', {}, ui.formula, ui.display), pad)
  }

  /* --- converter ---------------------------------------------------------- */

  const MODES = [
    { id: 'image-pdf', label: 'Image → PDF' },
    { id: 'doc-pdf', label: 'Word → PDF' },
    { id: 'pdf-doc', label: 'PDF → Word' },
  ]
  let mode = 'image-pdf'
  let files = []
  let lastOut = null

  function setFiles(next) {
    files = next
    ui.drop.classList.toggle('has', files.length > 0)
    ui.dropText.textContent = files.length
      ? files.map((f) => f.split('/').pop()).join(', ').slice(0, 90)
      : 'Choose or drop a file here'
    ui.go.disabled = !files.length
    I.pump(120)
  }

  function buildConvert() {
    ui.modeRow = h('div.cv-modes')
    for (const m of MODES) {
      ui.modeRow.append(
        h(
          `button.cv-mode${m.id === mode ? '.on' : ''}`,
          {
            'data-mode': m.id,
            onclick: (e) => {
              e.stopPropagation()
              mode = m.id
              for (const b of ui.modeRow.children) b.classList.toggle('on', b.dataset.mode === mode)
              setFiles([])
            },
          },
          m.label
        )
      )
    }

    ui.dropText = h('span.cv-droptext', { text: 'Choose or drop a file here' })
    ui.drop = h(
      'div.cv-drop',
      {
        onclick: async (e) => {
          e.stopPropagation()
          const picked = await api.pickForConvert(mode)
          if (picked.length) setFiles(picked)
        },
        ondragover: (e) => {
          e.preventDefault()
          ui.drop.classList.add('over')
        },
        ondragleave: () => ui.drop.classList.remove('over'),
        ondrop: (e) => {
          e.preventDefault()
          ui.drop.classList.remove('over')
          const paths = [...e.dataTransfer.files].map((f) => api.pathForFile(f)).filter(Boolean)
          if (paths.length) setFiles(paths)
        },
      },
      h('span.cv-dropicon', { html: svg('<path d="M12 16V4m0 0L8 8m4-4 4 4"/><path d="M4 16v3.5h16V16"/>', 18) }),
      ui.dropText
    )

    ui.result = h('div.cv-result.tiny')
    ui.go = h(
      'button.cv-go',
      {
        disabled: true,
        onclick: async (e) => {
          e.stopPropagation()
          ui.go.disabled = true
          ui.result.textContent = 'Converting…'
          const res = await api.convert(mode, files)
          if (res && res.ok) {
            lastOut = res.file
            ui.result.textContent = ''
            ui.result.append(
              h('span.ok', { text: '✓ ' + res.file.split('/').pop() }),
              h(
                'button.tr-edit',
                {
                  onclick: (ev) => {
                    ev.stopPropagation()
                    api.revealConverted(lastOut)
                  },
                },
                'Show'
              )
            )
            I.toast('📄', 'Converted')
          } else {
            ui.result.textContent = (res && res.error) || 'Conversion failed'
          }
          ui.go.disabled = false
          I.pump(150)
        },
      },
      'Convert now'
    )

    return h('div.mo-view.cv-view', {}, ui.modeRow, ui.drop, h('div.cv-foot', {}, ui.result, h('span.spacer'), ui.go))
  }

  /* --- budget ------------------------------------------------------------- */

  let budget = { wallets: [], selected: null }
  const peso = (n) => `₱${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const saveBudget = () => api.storeSet('budget', budget)

  function buildBudget() {
    ui.total = h('div.bg-total', { text: '₱0.00' })
    ui.wallets = h('div.bg-wallets')
    ui.amount = h('input.field.bg-amount', {
      type: 'text',
      placeholder: 'Amount',
      spellcheck: 'false',
      onkeydown: (e) => {
        if (e.key === 'Enter') adjust(1)
      },
    })
    const btn = (label, sign, cls) =>
      h(
        `button.bg-btn${cls}`,
        {
          onclick: (e) => {
            e.stopPropagation()
            adjust(sign)
          },
        },
        label
      )
    ui.newWallet = h(
      'button.tr-edit',
      {
        onclick: (e) => {
          e.stopPropagation()
          const name = `Wallet ${budget.wallets.length + 1}`
          const w = { id: `w${Date.now()}`, name, balance: 0 }
          budget.wallets.push(w)
          budget.selected = w.id
          saveBudget()
          renderBudget()
        },
      },
      '+ Wallet'
    )

    return h(
      'div.mo-view.bg-view',
      {},
      h('div.bg-head', {}, h('span.kicker', { text: 'Total balance' }), h('span.spacer'), ui.newWallet),
      ui.total,
      ui.wallets,
      h('div.bg-row', {}, ui.amount, btn('−', -1, '.minus'), btn('+', 1, '.plus'))
    )
  }

  function adjust(sign) {
    const value = parseFloat(ui.amount.value.replace(/[^\d.-]/g, ''))
    const wallet = budget.wallets.find((w) => w.id === budget.selected)
    if (!wallet || !Number.isFinite(value) || value <= 0) {
      ui.amount.classList.remove('shake')
      void ui.amount.offsetWidth
      ui.amount.classList.add('shake')
      return
    }
    wallet.balance = Math.round((wallet.balance + sign * value) * 100) / 100
    ui.amount.value = ''
    saveBudget()
    renderBudget()
  }

  function renderBudget() {
    const total = budget.wallets.reduce((a, w) => a + w.balance, 0)
    ui.total.textContent = peso(total)
    ui.wallets.textContent = ''
    if (!budget.wallets.length) {
      ui.wallets.append(h('div.empty', { text: 'No wallets yet — add one.' }))
    }
    for (const w of budget.wallets) {
      const name = h('input.bg-name', {
        type: 'text',
        value: w.name,
        spellcheck: 'false',
        oninput: (e) => {
          w.name = e.target.value
          saveBudget()
        },
        onclick: (e) => e.stopPropagation(),
      })
      const card = h(
        `div.bg-wallet${budget.selected === w.id ? '.on' : ''}`,
        {
          onclick: (e) => {
            e.stopPropagation()
            budget.selected = w.id
            renderBudget()
          },
        },
        name,
        h('span.bg-bal', { text: peso(w.balance) }),
        h(
          'button.x',
          {
            title: 'Remove wallet',
            onclick: (e) => {
              e.stopPropagation()
              budget.wallets = budget.wallets.filter((x) => x.id !== w.id)
              if (budget.selected === w.id) budget.selected = (budget.wallets[0] || {}).id || null
              saveBudget()
              renderBudget()
            },
          },
          '×'
        )
      )
      ui.wallets.append(card)
    }
    I.pump(120)
  }

  /* --- shell -------------------------------------------------------------- */

  function mount(pane) {
    ui.seg = I.segmented(
      [
        { id: 'calc', label: 'Calculator' },
        { id: 'convert', label: 'Convert' },
        { id: 'budget', label: 'Budget' },
      ],
      (id) => switchView(id)
    )
    ui.calcView = buildCalc()
    ui.convertView = buildConvert()
    ui.budgetView = buildBudget()
    pane.append(h('div.mo-head', {}, ui.seg.el), ui.calcView, ui.convertView, ui.budgetView)
    switchView('calc')
  }

  function switchView(id) {
    ui.calcView.classList.toggle('on', id === 'calc')
    ui.convertView.classList.toggle('on', id === 'convert')
    ui.budgetView.classList.toggle('on', id === 'budget')
    I.pump(150)
  }

  async function ready() {
    const saved = await api.storeGet('budget', null)
    budget = saved && Array.isArray(saved.wallets) ? saved : { wallets: [], selected: null }
    if (!budget.selected && budget.wallets.length) budget.selected = budget.wallets[0].id
    renderBudget()
  }

  I.registerTab({
    id: 'tools',
    label: 'Tools',
    icon: svg('<rect x="4.5" y="3.5" width="15" height="17" rx="2.4"/><path d="M8 8h8M8 12h3M8 16h3M15 12v4"/>'),
    width: 524,
    height: 384,
    mount,
    ready,
    shown: () => I.pump(200),
  })
})()
