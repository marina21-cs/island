const { EventEmitter } = require('events')

const MATCH = "interface='org.freedesktop.Notifications',member='Notify',type='method_call'"
const MAX = 100

// Reading the desktop's notifications means watching the bus, not owning the
// name — claiming org.freedesktop.Notifications would fight Plasma for it and
// break the user's real notifications. A monitor connection is read-only, but
// it can do nothing else, so it gets its own bus.
class Notifications extends EventEmitter {
  constructor() {
    super()
    this.items = []
    this.bus = null
    this.unread = 0
    this.seq = 1
  }

  async start() {
    let dbus
    try {
      dbus = require('dbus-next')
    } catch {
      return
    }
    try {
      this.bus = dbus.sessionBus()
      this.bus.on('error', () => {})
      const { Message } = dbus
      await this.bus.call(
        new Message({
          destination: 'org.freedesktop.DBus',
          path: '/org/freedesktop/DBus',
          interface: 'org.freedesktop.DBus.Monitoring',
          member: 'BecomeMonitor',
          signature: 'asu',
          body: [[MATCH], 0],
        })
      )
      this.bus.on('message', (msg) => this.onMessage(msg))
    } catch (err) {
      console.warn('[island] notification monitor unavailable:', err.message)
      this.bus = null
    }
    this.emitState()
  }

  onMessage(msg) {
    if (msg.member !== 'Notify' || msg.interface !== 'org.freedesktop.Notifications') return
    const [appName, , appIcon, summary, body] = msg.body || []
    if (!summary && !body) return
    const item = {
      id: this.seq++,
      app: String(appName || 'System'),
      icon: String(appIcon || ''),
      summary: String(summary || ''),
      body: String(body || '').replace(/<[^>]+>/g, ''),
      at: Date.now(),
    }
    this.items.unshift(item)
    if (this.items.length > MAX) this.items.length = MAX
    this.unread++
    this.emit('arrived', item)
    this.emitState()
  }

  markRead() {
    if (!this.unread) return
    this.unread = 0
    this.emitState()
  }

  clear() {
    this.items = []
    this.unread = 0
    this.emitState()
  }

  remove(id) {
    this.items = this.items.filter((i) => i.id !== id)
    this.emitState()
  }

  current() {
    return { items: this.items, unread: this.unread, available: !!this.bus }
  }

  emitState() {
    this.emit('update', this.current())
  }

  stop() {
    try {
      this.bus?.disconnect()
    } catch {}
    this.bus = null
  }
}

module.exports = new Notifications()
