const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')
const { EventEmitter } = require('events')

const read = (p) => {
  try {
    return fs.readFileSync(p, 'utf8').trim()
  } catch {
    return null
  }
}
const readInt = (p) => {
  const v = read(p)
  return v === null ? null : parseInt(v, 10)
}

function findBattery() {
  const base = '/sys/class/power_supply'
  let names = []
  try {
    names = fs.readdirSync(base)
  } catch {
    names = ['BAT0', 'BAT1', 'BATT', 'CMB0']
  }
  for (const n of names) {
    const dir = path.join(base, n)
    if (read(path.join(dir, 'capacity')) !== null) return dir
  }
  return null
}

function findAcOnline() {
  const base = '/sys/class/power_supply'
  let names = []
  try {
    names = fs.readdirSync(base)
  } catch {
    names = ['AC', 'ACAD', 'AC0', 'ADP1']
  }
  for (const n of names) {
    const dir = path.join(base, n)
    if (read(path.join(dir, 'type')) === 'Mains') return path.join(dir, 'online')
  }
  return null
}

function findThermal() {
  const base = '/sys/class/thermal'
  let names = []
  try {
    names = fs.readdirSync(base).filter((n) => n.startsWith('thermal_zone'))
  } catch {
    names = ['thermal_zone0', 'thermal_zone1', 'thermal_zone2']
  }
  // Prefer the package/CPU zone over ambient or battery zones.
  const scored = names
    .map((n) => ({ dir: path.join(base, n), type: read(path.join(base, n, 'type')) || '' }))
    .filter((z) => readInt(path.join(z.dir, 'temp')) !== null)
  const cpu = scored.find((z) => /x86_pkg_temp|cpu|coretemp|k10temp|acpitz/i.test(z.type))
  return (cpu || scored[0])?.dir || null
}

function cpuSample() {
  const line = (read('/proc/stat') || '').split('\n')[0]
  if (!line.startsWith('cpu ')) return null
  const f = line.split(/\s+/).slice(1).map(Number)
  const idle = (f[3] || 0) + (f[4] || 0)
  const total = f.reduce((a, b) => a + (b || 0), 0)
  return { idle, total }
}

function netSample() {
  const txt = read('/proc/net/dev') || ''
  let rx = 0
  let tx = 0
  for (const line of txt.split('\n').slice(2)) {
    const [iface, rest] = line.split(':')
    if (!rest) continue
    const name = iface.trim()
    if (name === 'lo' || name.startsWith('veth') || name.startsWith('docker')) continue
    const f = rest.trim().split(/\s+/).map(Number)
    rx += f[0] || 0
    tx += f[8] || 0
  }
  return { rx, tx }
}

// nvidia-smi costs ~100ms per call, so it runs on its own slower cadence
// rather than blocking the 2s sysfs sample.
function readGpu() {
  return new Promise((resolve) => {
    execFile(
      'nvidia-smi',
      ['--query-gpu=temperature.gpu,utilization.gpu,memory.used,memory.total', '--format=csv,noheader,nounits'],
      { timeout: 4000 },
      (err, stdout) => {
        if (err) return resolve(null)
        const line = (stdout || '').trim().split('\n')[0]
        const f = line.split(',').map((v) => parseInt(v.trim(), 10))
        if (f.some(Number.isNaN)) return resolve(null)
        resolve({ temp: f[0], util: f[1], memUsedMb: f[2], memTotalMb: f[3] })
      }
    )
  })
}

class Vitals extends EventEmitter {
  constructor() {
    super()
    this.timer = null
    this.gpuTimer = null
    this.gpu = null
    this.batDir = null
    this.acPath = null
    this.thermalDir = null
    this.prevCpu = null
    this.prevNet = null
    this.prevAt = 0
    this.state = null
  }

  start(pollMs) {
    this.batDir = findBattery()
    this.acPath = findAcOnline()
    this.thermalDir = findThermal()
    this.prevCpu = cpuSample()
    this.prevNet = netSample()
    this.prevAt = Date.now()
    this.timer = setInterval(() => this.sample(), pollMs)
    this.sample()

    const pollGpu = async () => {
      this.gpu = await readGpu()
    }
    pollGpu()
    this.gpuTimer = setInterval(pollGpu, 4000)
  }

  sample() {
    const now = Date.now()
    const dt = Math.max((now - this.prevAt) / 1000, 0.001)

    let cpu = 0
    const c = cpuSample()
    if (c && this.prevCpu) {
      const dTotal = c.total - this.prevCpu.total
      const dIdle = c.idle - this.prevCpu.idle
      if (dTotal > 0) cpu = Math.min(100, Math.max(0, ((dTotal - dIdle) / dTotal) * 100))
    }
    if (c) this.prevCpu = c

    const meminfo = read('/proc/meminfo') || ''
    const grab = (k) => {
      const m = meminfo.match(new RegExp(`^${k}:\\s+(\\d+) kB`, 'm'))
      return m ? parseInt(m[1], 10) : 0
    }
    const memTotal = grab('MemTotal')
    const memAvail = grab('MemAvailable') || memTotal - grab('MemFree')
    const memUsed = Math.max(memTotal - memAvail, 0)

    let net = { down: 0, up: 0 }
    const n = netSample()
    if (this.prevNet) {
      net = {
        down: Math.max(0, (n.rx - this.prevNet.rx) / dt),
        up: Math.max(0, (n.tx - this.prevNet.tx) / dt),
      }
    }
    this.prevNet = n
    this.prevAt = now

    let battery = null
    if (this.batDir) {
      const capacity = readInt(path.join(this.batDir, 'capacity'))
      const status = read(path.join(this.batDir, 'status')) || 'Unknown'
      // energy_* on most laptops, charge_* on some; both give the same ratio.
      const nowV =
        readInt(path.join(this.batDir, 'energy_now')) ??
        readInt(path.join(this.batDir, 'charge_now'))
      const powerV =
        readInt(path.join(this.batDir, 'power_now')) ??
        readInt(path.join(this.batDir, 'current_now'))
      let minutes = null
      if (nowV && powerV && powerV > 0 && status === 'Discharging') {
        minutes = Math.round((nowV / powerV) * 60)
      }
      battery = { capacity, status, minutes }
    }

    const ac = this.acPath ? readInt(this.acPath) === 1 : null
    const tempRaw = this.thermalDir ? readInt(path.join(this.thermalDir, 'temp')) : null
    const temp = tempRaw === null ? null : Math.round(tempRaw / 1000)

    this.state = {
      cpu: Math.round(cpu),
      temp,
      mem: { usedKb: memUsed, totalKb: memTotal, pct: memTotal ? (memUsed / memTotal) * 100 : 0 },
      net,
      battery,
      ac,
      gpu: this.gpu,
    }
    this.emit('update', this.state)
  }

  current() {
    return this.state
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    if (this.gpuTimer) clearInterval(this.gpuTimer)
    this.timer = null
    this.gpuTimer = null
  }
}

module.exports = new Vitals()
