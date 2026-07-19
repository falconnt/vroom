// rpmModel.js
// De virtuele aandrijflijn als realistische "automaat": zet snelheid (km/h) om
// in toerental (rpm) en kiest de versnelling als een echte auto.
//
// Kernidee (op basis van normale schakelpunten):
//   - Toerental in een versnelling: rpm = idle + snelheid * k[gear].
//     Hogere versnelling => kleinere k => toeren lopen langzamer op.
//   - Schakelpunt hangt af van MOMENTUM (gaspedaal, afgeleid uit acceleratie):
//       * rustig/constant/uitrollen  -> vroeg opschakelen (~economy-rpm), zodat
//         het toerental NOOIT hoog blijft hangen bij constante snelheid.
//       * vol gas                    -> doortrekken tot vlak onder redline,
//         daarna opschakelen (mag heel even het rode gebied in).
//   - Terugschakelen: soepel als de toeren te laag zakken; agressiever (eerder,
//     voor motorrem) als je flink remt.
//   - Per versnelling een realistische max-snelheid (cap), zodat een lage
//     versnelling niet eindeloos doortrekt bij vol gas.
//
// Referentie-schakelsnelheden (economy, bij kalibratie ~250 km/h topsnelheid):
//   1->2 ~18, 2->3 ~35, 3->4 ~60, 4->5 ~90, 5->6 ~120 km/h.

function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }
function lerp(a, b, t) { return a + (b - a) * clamp(t, 0, 1); }

// Basisinstellingen bij referentie-topsnelheid 250 km/h (schalen mee met slider).
const UE = [22, 44, 67, 88, 116];      // economy-opschakelsnelheden (in km/h)
const UF = [55, 100, 145, 185, 225];   // max-snelheid per versnelling (vol gas cap)
const REF_TOP = 250;

const ECO_FRAC = 0.33;   // opschakel-rpm (fractie van toerenbereik) bij rustig rijden
const SPORT_FRAC = 0.93; // opschakel-rpm bij vol gas (net onder redline)
const DOWN_ECO = 0.12;   // terugschakelen als toeren hieronder zakken (rustig)
const DOWN_BRAKE = 0.30; // terugschakel-drempel bij stevig remmen (motorrem)
const TOP6_TALL = 0.68;  // 6e is "overdrive": nog wat langer/rustiger
const DWELL_MS = 320;    // minimale tijd tussen schakelmomenten

export class RpmModel {
  constructor(profile, maxSpeedKmh) {
    this.setProfile(profile, maxSpeedKmh);
  }

  setProfile(profile, maxSpeedKmh) {
    this.profile = profile;
    this.maxSpeed = maxSpeedKmh;
    this._recalc();
    this.gear = 0;
    this.rpm = profile.idleRpm;
    this.lastShift = 9999;
  }

  setMaxSpeed(kmh) {
    this.maxSpeed = Math.max(40, kmh);
    this._recalc();
  }

  _recalc() {
    const p = this.profile;
    this.range = p.redline - p.idleRpm;
    // sc>1 = langere gearing (schakelt op hogere snelheden) bij hogere topsnelheid.
    this.sc = clamp(this.maxSpeed / REF_TOP, 0.4, 1.8);
    this.ue = UE.map((v) => v * this.sc);
    this.uf = UF.map((v) => v * this.sc);
    // k = rpm per km/h per versnelling; afgeleid zodat het economy-schakelpunt
    // (ECO_FRAC van het bereik) precies op ue[g] valt. Schaalt met de motor.
    this.k = this.ue.map((ue) => (ECO_FRAC * this.range) / ue);
    this.k.push(this.k[4] * TOP6_TALL); // 6e versnelling
  }

  rpmForGear(gear, speed) {
    return clamp(this.profile.idleRpm + speed * this.k[gear], this.profile.idleRpm, this.profile.redline);
  }

  /**
   * @param {number} speedKmh   gefilterde snelheid
   * @param {number} accel      m/s^2 (afgeleide van snelheid) -> momentum/gas
   * @param {number} dtMs
   */
  update(speedKmh, accel, dtMs) {
    const p = this.profile;
    const speed = Math.max(0, speedKmh);
    const load = clamp(accel / 2.0, -1, 1);
    const loadPos = Math.max(0, load);
    const loadNeg = Math.max(0, -load);

    if (p.linear) {
      const frac = clamp(speed / this.maxSpeed, 0, 1);
      this.rpm = p.idleRpm + frac * this.range;
      this.gear = 0;
      return { rpm: this.rpm, gear: 1, load, shifted: false, shiftDir: null, limiter: false };
    }

    this.lastShift += dtMs;

    // Bij (bijna) stilstand: stationair in de 1e.
    if (speed < 2) {
      this.gear = 0;
      this.rpm = p.idleRpm;
      return { rpm: this.rpm, gear: 1, load, shifted: false, shiftDir: null, limiter: false };
    }

    // Drempels schuiven met het momentum: vol gas -> laat opschakelen (hoog toeren);
    // rustig/uitrollen -> vroeg opschakelen (laag toeren, nooit blijven hangen).
    const upRpm = p.idleRpm + lerp(ECO_FRAC, SPORT_FRAC, loadPos) * this.range;
    const downRpm = p.idleRpm + lerp(DOWN_ECO, DOWN_BRAKE, loadNeg) * this.range;

    let shifted = false;
    let shiftDir = null;
    const prev = this.gear;
    const canShift = this.lastShift > DWELL_MS;

    const curRpm = this.rpmForGear(this.gear, speed);

    if (canShift && this.gear < 5 && (curRpm > upRpm || speed > this.uf[this.gear])) {
      // Opschakelen — maar alleen als de nieuwe versnelling niet gaat "luggen".
      const nextRpm = this.rpmForGear(this.gear + 1, speed);
      if (nextRpm > downRpm || speed > this.uf[this.gear]) {
        this.gear++;
        shifted = true;
        shiftDir = 'up';
        this.lastShift = 0;
      }
    } else if (canShift && this.gear > 0) {
      // Terugschakelen als de toeren te laag zakken (of bij remmen: eerder).
      const downFloor = this.gear >= 1 ? this.ue[this.gear - 1] * 0.6 : 0;
      if (curRpm < downRpm || speed < downFloor) {
        this.gear--;
        shifted = true;
        shiftDir = 'down';
        this.lastShift = 0;
      }
    }

    let rpm = this.rpmForGear(this.gear, speed);

    // Toerenbegrenzer in de hoogste versnelling.
    let limiter = false;
    if (this.gear === 5 && rpm >= p.redline * 0.985) limiter = true;
    rpm = Math.min(rpm, p.redline);

    this.rpm = rpm;
    return { rpm, gear: this.gear + 1, load, shifted, shiftDir, limiter };
  }
}
