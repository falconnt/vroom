// rpmModel.js
// De "virtuele aandrijflijn": zet snelheid (km/h) om in toerental (rpm).
//
// Twee modi:
//  - Manueel: een versnellingsbak met gear-ratio's, automatische schakelaar
//    met een korte "throttle cut" bij het schakelen.
//  - Lineair: rpm is een rechte functie van snelheid (geen versnellingen) —
//    voor de sci-fi/whine-profielen.

function clamp(x, lo, hi) {
  return x < lo ? lo : x > hi ? hi : x;
}

export class RpmModel {
  /**
   * @param {import('./audioEngine.js').EngineProfile} profile
   * @param {number} maxSpeedKmh  kalibratie: snelheid waarbij je in de hoogste
   *                              versnelling op redline zit.
   */
  constructor(profile, maxSpeedKmh) {
    this.setProfile(profile, maxSpeedKmh);
  }

  setProfile(profile, maxSpeedKmh) {
    this.profile = profile;
    this.maxSpeed = maxSpeedKmh;
    this.gearRatios = [3.6, 2.1, 1.45, 1.0, 0.82, 0.66];
    this.gear = 0;
    this.rpm = profile.idleRpm;
    this.lastShift = 0;
    this.shiftFlag = false;
  }

  setMaxSpeed(kmh) {
    this.maxSpeed = Math.max(20, kmh);
  }

  // Snelheid (km/h) waarbij een gegeven versnelling op redline zit.
  vMaxInGear(gear) {
    const topRatio = this.gearRatios[this.gearRatios.length - 1];
    // De hoogste versnelling raakt redline bij maxSpeed. Schaal per ratio.
    return (this.maxSpeed * topRatio) / this.gearRatios[gear];
  }

  /**
   * @param {number} speedKmh   gefilterde snelheid
   * @param {number} accel      m/s^2 (afgeleide van snelheid) — voor schakelen/load
   * @param {number} dtMs       tijd sinds vorige update (ms) voor schakel-timing
   * @returns {{rpm:number, gear:number, load:number, shifted:boolean}}
   */
  update(speedKmh, accel, dtMs) {
    const p = this.profile;
    const speed = Math.max(0, speedKmh);

    // Load-schatting uit acceleratie: accel > 0 = gas, < 0 = uitrollen/remmen
    const load = clamp(accel / 2.2, -1, 1);

    if (p.linear) {
      // Lineair: rechte lijn van idle -> redline over 0..maxSpeed
      const frac = clamp(speed / this.maxSpeed, 0, 1);
      this.rpm = p.idleRpm + frac * (p.redline - p.idleRpm);
      this.gear = 0;
      return { rpm: this.rpm, gear: 1, load, shifted: false, shiftDir: null, limiter: false };
    }

    // Manueel: bereken rpm in de huidige versnelling
    const rpmFor = (gear) => {
      const vmax = this.vMaxInGear(gear);
      const frac = clamp(speed / vmax, 0, 1.15);
      return p.idleRpm + frac * (p.redline - p.idleRpm);
    };

    let shifted = false;
    const prevGear = this.gear;
    this.lastShift += dtMs;

    let rpm = rpmFor(this.gear);

    // Schakel omhoog: hoog toerental én accelererend
    if (
      this.gear < this.gearRatios.length - 1 &&
      rpm > p.redline * 0.92 &&
      (load > 0.05 || rpm > p.redline) && // ook opschakelen bij over-rev (constante snelheid)
      this.lastShift > 350
    ) {
      this.gear++;
      this.lastShift = 0;
      shifted = true;
      rpm = rpmFor(this.gear);
    }
    // Schakel omlaag: laag toerental of flink remmen
    else if (
      this.gear > 0 &&
      (rpm < p.idleRpm + (p.redline - p.idleRpm) * 0.28 || load < -0.4) &&
      this.lastShift > 350
    ) {
      this.gear--;
      this.lastShift = 0;
      shifted = true;
      rpm = rpmFor(this.gear);
    }

    // Bij (bijna) stilstand: idle
    if (speed < 1.5) {
      this.gear = 0;
      rpm = p.idleRpm;
    }

    // Toerenbegrenzer: in de hoogste versnelling niet over redline draaien,
    // maar "bouncen" tegen de begrenzer.
    let limiter = false;
    if (this.gear === this.gearRatios.length - 1 && rpm >= p.redline * 0.985) {
      limiter = true;
    }
    // Nooit boven redline weergeven/afspelen (in tussenversnellingen zorgt de
    // schakel-automaat dat het toerental terugvalt).
    rpm = Math.min(rpm, p.redline);

    const shiftDir = shifted ? (this.gear > prevGear ? 'up' : 'down') : null;

    this.rpm = rpm;
    return { rpm, gear: this.gear + 1, load, shifted, shiftDir, limiter };
  }
}
