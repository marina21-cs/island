const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFile } = require('child_process')
const { dialog, shell } = require('electron')

const OUT = path.join(os.homedir(), 'Documents', 'Island')

const MODES = {
  'image-pdf': {
    label: 'Image → PDF',
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'tif', 'tiff', 'bmp'] }],
    multi: true,
  },
  'doc-pdf': {
    label: 'Word → PDF',
    filters: [{ name: 'Documents', extensions: ['doc', 'docx', 'odt', 'rtf', 'txt'] }],
    multi: false,
  },
  'pdf-doc': {
    label: 'PDF → Word',
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
    multi: false,
  },
}

const run = (cmd, args, timeout = 120000) =>
  new Promise((resolve) => {
    execFile(cmd, args, { timeout }, (err, stdout, stderr) =>
      resolve({ ok: !err, out: stdout, err: err ? String(stderr || err.message) : '' })
    )
  })

function ensureOut() {
  fs.mkdirSync(OUT, { recursive: true })
  return OUT
}

async function pick(mode) {
  const spec = MODES[mode]
  if (!spec) return []
  const res = await dialog.showOpenDialog({
    title: spec.label,
    filters: spec.filters,
    properties: spec.multi ? ['openFile', 'multiSelections'] : ['openFile'],
  })
  return res.canceled ? [] : res.filePaths
}

async function convert(mode, files) {
  const spec = MODES[mode]
  if (!spec) return { ok: false, error: 'Unknown conversion' }
  if (!files || !files.length) return { ok: false, error: 'Nothing selected' }
  const dir = ensureOut()

  if (mode === 'image-pdf') {
    const base = path.basename(files[0], path.extname(files[0]))
    const out = path.join(dir, `${base}.pdf`)
    // ImageMagick delegates multi-page PDF writing to ghostscript, which is
    // present; each image becomes one page in the order given.
    const r = await run('magick', [...files, out])
    if (!r.ok || !fs.existsSync(out)) return { ok: false, error: r.err.split('\n')[0] || 'Conversion failed' }
    return { ok: true, file: out }
  }

  const target = mode === 'doc-pdf' ? 'pdf' : 'docx'
  const args = ['--headless', '--norestore']
  // Reading a PDF back into a document needs the PDF import filter named
  // explicitly; LibreOffice will not infer it.
  if (mode === 'pdf-doc') args.push('--infilter=writer_pdf_import')
  args.push('--convert-to', target, '--outdir', dir, files[0])

  const r = await run('soffice', args)
  const out = path.join(dir, `${path.basename(files[0], path.extname(files[0]))}.${target}`)
  if (!fs.existsSync(out)) return { ok: false, error: r.err.split('\n')[0] || 'Conversion failed' }
  return { ok: true, file: out }
}

function reveal(file) {
  if (file && fs.existsSync(file)) shell.showItemInFolder(file)
}

module.exports = { pick, convert, reveal, MODES }
