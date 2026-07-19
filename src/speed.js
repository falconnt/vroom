// speed.js
// Snelheidsinvoer met twee bronnen:
//   - 'demo'  : een handmatige slider (ontwikkelen/testen op de bank)
//   - 'gps'   : navigator.geolocation.watchPosition
//
// GPS-details die ertoe doen:
//   - coords.speed is in m/s maar kan null zijn (o.a. in de Tesla-browser) —
//     dan berekenen we snelheid uit afstand/tijd tussen fixes (haversine).
//   - GPS is traag (~1 Hz) en ruizig. We smoothen exponentieel; de render-loop
//     interpoleert daarna naar 60 fps voor een vloeiend geluid.

const R = 6371000; // aardstraal in meter

function haversine(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export class SpeedSource {
  constructor() {
    this.source = 'demo';
    this.demoKmh = 0;
    this.rawKmh = 0;       // laatste ruwe meting
    this.smoothKmh = 0;    // exponentieel gefilterd
    this.watchId = null;
    this.prevFix = null;
    this.onStatus = () => {};
    this.lastFixTime = 0;
  }

  setSource(src) {
    if (src === this.source) return;
    if (src === 'gps') this.startGps();
    else this.stopGps();
    this.source = src;
  }

  setDemo(kmh) {
    this.demoKmh = Math.max(0, kmh);
  }

  startGps() {
    if (!('geolocation' in navigator)) {
      this.onStatus({ ok: false, msg: 'Geolocation niet beschikbaar in deze browser.' });
      return;
    }
    this.prevFix = null;
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => this._onFix(pos),
      (err) => this.onStatus({ ok: false, msg: 'GPS-fout: ' + err.message }),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
    );
    this.onStatus({ ok: true, msg: 'GPS actief — wachten op eerste fix…' });
  }

  stopGps() {
    if (this.watchId != null && 'geolocation' in navigator) {
      navigator.geolocation.clearWatch(this.watchId);
    }
    this.watchId = null;
  }

  _onFix(pos) {
    const c = pos.coords;
    let v = c.speed; // m/s of null
    const now = pos.timestamp || Date.now();

    if (v == null || Number.isNaN(v)) {
      // Fallback: afstand/tijd tussen twee fixes
      if (this.prevFix) {
        const dt = (now - this.prevFix.t) / 1000;
        if (dt > 0.05) {
          const d = haversine(this.prevFix, { lat: c.latitude, lon: c.longitude });
          v = d / dt;
        } else {
          v = 0;
        }
      } else {
        v = 0;
      }
    }
    this.prevFix = { lat: c.latitude, lon: c.longitude, t: now };
    this.lastFixTime = now;
    this.rawKmh = Math.max(0, v * 3.6);
    this.onStatus({ ok: true, msg: `GPS: ${this.rawKmh.toFixed(0)} km/h` });
  }

  /**
   * Roep elke frame aan; smootht richting de doelsnelheid.
   * @param {number} dtMs frame-delta in ms
   * @returns {number} gefilterde snelheid in km/h
   */
  tick(dtMs) {
    const target = this.source === 'gps' ? this.rawKmh : this.demoKmh;
    // Exponentieel filter; tijdsconstante ~0.35s voor GPS, sneller voor demo
    const tau = this.source === 'gps' ? 350 : 140;
    const alpha = 1 - Math.exp(-dtMs / tau);
    this.smoothKmh += (target - this.smoothKmh) * alpha;
    if (this.smoothKmh < 0.05) this.smoothKmh = 0;
    return this.smoothKmh;
  }
}
