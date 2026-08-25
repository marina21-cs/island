const { EventEmitter } = require('events')
const store = require('./store')

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

// Open-Meteo returns the whole day's hours; only the ones still ahead matter.
function sliceHourly(hourly, nowIso) {
  if (!hourly || !Array.isArray(hourly.time)) return []
  let start = hourly.time.findIndex((t) => t >= nowIso)
  if (start < 0) start = 0
  return hourly.time.slice(start, start + 8).map((t, i) => {
    const code = hourly.weather_code[start + i]
    return {
      hour: Number(t.slice(11, 13)),
      temp: Math.round(hourly.temperature_2m[start + i]),
      icon: (CODES[code] || ['', '·'])[1],
    }
  })
}

function sliceDaily(daily) {
  if (!daily || !Array.isArray(daily.time)) return []
  return daily.time.slice(0, 6).map((t, i) => ({
    date: t,
    icon: (CODES[daily.weather_code[i]] || ['', '·'])[1],
    max: Math.round(daily.temperature_2m_max[i]),
    min: Math.round(daily.temperature_2m_min[i]),
  }))
}

class Weather extends EventEmitter {
  constructor() {
    super()
    this.state = {
      available: false,
      city: '',
      temp: null,
      text: '',
      icon: '',
      hourly: [],
      daily: [],
    }
    this.timer = null
    this.retry = null
    this.place = null
    this.pollMs = 15 * 60 * 1000
  }

  async start(city, pollMs = 15 * 60 * 1000, lat = null, lon = null) {
    this.city = city
    this.pollMs = pollMs || 15 * 60 * 1000
    if (lat !== null && lon !== null) this.place = { city, lat, lon, name: city }
    // Geocoding is a one-time answer, so remember it. That host is markedly
    // slower than the forecast one — measured at 7s against well under 1s —
    // and looking the same city up every launch put the whole feature behind
    // its worst day.
    const cached = store.read('weather-place', null)
    if (cached && cached.city === city && cached.lat && cached.lon) this.place = cached
    this.timer = setInterval(() => this.sample(), pollMs)
    await this.sample()
  }

  // Geocoding gets a longer budget than the forecast: it is called once and
  // its host is slow, whereas a slow forecast just means stale numbers.
  async json(url, timeoutMs = 8000) {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
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

  // A single miss should not cost a whole poll interval of blank weather.
  scheduleRetry() {
    if (this.retry) return
    this.retry = setTimeout(() => {
      this.retry = null
      this.sample()
    }, 60 * 1000)
  }

  async sample() {
    if (!this.place) {
      const geo = await this.json(`${GEO}?name=${encodeURIComponent(this.city)}&count=1`, 20000)
      const hit = geo && geo.results && geo.results[0]
      // Offline, unknown city, or that slow host having a bad minute.
      if (!hit) {
        this.scheduleRetry()
        return this.set({ ...this.state, available: false })
      }
      this.place = { city: this.city, lat: hit.latitude, lon: hit.longitude, name: hit.name }
      store.write('weather-place', this.place)
    }
    const data = await this.json(
      `${FORECAST}?latitude=${this.place.lat}&longitude=${this.place.lon}` +
        '&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code' +
        '&hourly=temperature_2m,weather_code' +
        '&daily=weather_code,temperature_2m_max,temperature_2m_min' +
        '&forecast_days=6&timezone=auto'
    )
    const cur = data && data.current
    if (!cur) {
      this.scheduleRetry()
      // Keep the last good reading on screen rather than blanking it out over
      // one failed poll.
      if (this.state.available) return
      return this.set({ ...this.state, available: false })
    }
    const [text, icon] = CODES[cur.weather_code] || ['—', '·']
    this.set({
      available: true,
      city: this.place.name,
      lat: this.place.lat,
      lon: this.place.lon,
      temp: Math.round(cur.temperature_2m),
      humidity: Math.round(cur.relative_humidity_2m),
      wind: Math.round(cur.wind_speed_10m),
      text,
      icon,
      hourly: sliceHourly(data.hourly, cur.time),
      daily: sliceDaily(data.daily),
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
    if (this.retry) clearTimeout(this.retry)
    this.timer = null
    this.retry = null
  }
}

module.exports = new Weather()
