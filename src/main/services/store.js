const fs = require('fs')
const path = require('path')
const { app } = require('electron')

// Small JSON document store: one file per key under userData. Used by the
// notes, board and budget panels, which just need somewhere durable to sit.
const cache = new Map()

function file(key) {
  return path.join(app.getPath('userData'), `${key}.json`)
}

function read(key, fallback) {
  if (cache.has(key)) return cache.get(key)
  let value = fallback
  try {
    value = JSON.parse(fs.readFileSync(file(key), 'utf8'))
  } catch {
    value = fallback
  }
  cache.set(key, value)
  return value
}

function write(key, value) {
  cache.set(key, value)
  try {
    fs.writeFileSync(file(key), JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

module.exports = { read, write }
