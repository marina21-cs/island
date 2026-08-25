const { EventEmitter } = require('events')

// Open-Meteo needs no API key. Geocoding resolves the configured city once.
const GEO = 'https://geocoding-api.open-meteo.com/v1/search'
const FORECAST = 'https://api.open-meteo.com/v1/forecast'

const CODES = {
  0: ['Clear', '☀'], 1: ['Mostly clear', '🌤'], 2: ['Partly cloudy', '⛅'], 3: ['Overcast', '☁'],
  45: ['Fog', '🌫'], 48: ['Rime fog', '🌫'],
  51: ['Light drizzle', '🌦'], 53: ['Drizzle', '🌦'], 55: ['Heavy drizzle', '🌦'],
  61: ['Light rain', '🌧'], 63: ['Rain', '🌧'], 65: ['Heavy rain', '🌧'],
  71: ['Light snow', '🌨'], 73: ['Snow', '🌨'], 75: ['Heavy snow', '🌨'],
  80: ['Showers', '🌦'], 81: ['Showers', '🌧'], 82: ['Violent showers', '⛈'],
  95: ['Thunderstorm', '⛈'], 96: ['Thunderstorm', '⛈'], 99: ['Thunderstorm', '⛈'],
}

class Weather extends EventEmitter {
  constructor() {
    super()
    this.state = { available: false, city: '', temp: null, text: '', icon: '' }
    this.timer = null
    this.place = null
  }

  async start(city, pollMs = 15 * 60 * 1000) {
    this.city = city
    this.timer = setInterval(() => this.sample(), pollMs)
    await this.sample()
  }

  async json(url) {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 8000)
    try {
      const res = await fetch(url, { signal: ctrl.signal })
      if (!res.ok) return null
      return await res.json()
    } catch {
      return null
    } finally {
      clearTimeout(t)
    }
  }

  async sample() {
    if (!this.place) {
      const geo = await this.json(`${GEO}?name=${encodeURIComponent(this.city)}&count=1`)
      const hit = geo && geo.results && geo.results[0]
      // Offline or unknown city: stay unavailable and try again next tick.
      if (!hit) return this.set({ ...this.state, available: false })
      this.place = { lat: hit.latitude, lon: hit.longitude, name: hit.name }
    }
    const data = await this.json(
      `${FORECAST}?latitude=${this.place.lat}&longitude=${this.place.lon}&current=temperature_2m,weather_code`
    )
    const cur = data && data.current
    if (!cur) return this.set({ ...this.state, available: false })
    const [text, icon] = CODES[cur.weather_code] || ['—', '·']
    this.set({
      available: true,
      city: this.place.name,
      temp: Math.round(cur.temperature_2m),
      text,
      icon,
    })
  }

  set(next) {
    this.state = next
    this.emit('update', this.state)
  }

  current() {
    return this.state
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}

module.exports = new Weather()
