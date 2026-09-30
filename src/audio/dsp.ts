// Synthese hors ligne : chaque instrument et chaque bruitage est calcule une
// fois en JavaScript dans un tampon (Float32Array), puis rejoue par WebAudio.
// Lecture tres economique sur mobile, et spectre pense pour les petits
// haut-parleurs : les sons graves portent toujours des harmoniques (saturation)
// dans les mediums, la ou un telephone restitue reellement le son.

export type Mono = Float32Array;

let seed = 1234567;
export function rnd(): number {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return ((seed >>> 0) / 4294967296) * 2 - 1;
}

export const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

// Filtre biquad (formules RBJ), coefficients recalculables en cours de route.
export class Biquad {
  private b0 = 1; private b1 = 0; private b2 = 0; private a1 = 0; private a2 = 0;
  private x1 = 0; private x2 = 0; private y1 = 0; private y2 = 0;
  constructor(private sr: number, private type: 'lp' | 'hp' | 'bp', f = 1000, q = 0.707) {
    this.set(f, q);
  }
  set(f: number, q = 0.707) {
    const w = (2 * Math.PI * Math.min(f, this.sr * 0.45)) / this.sr;
    const cs = Math.cos(w), al = Math.sin(w) / (2 * q);
    let b0: number, b1: number, b2: number;
    if (this.type === 'lp') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; }
    else if (this.type === 'hp') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; }
    else { b0 = al; b1 = 0; b2 = -al; }
    const a0 = 1 + al;
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0;
    this.a1 = (-2 * cs) / a0; this.a2 = (1 - al) / a0;
  }
  run(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

export function buf(sr: number, dur: number): Mono {
  return new Float32Array(Math.max(1, Math.ceil(dur * sr)));
}

// Normalise au crete voulue et adoucit les extremites (pas de clic).
export function finish(d: Mono, peak = 0.9, sr = 44100, fadeOut = 0.01): Mono {
  let m = 0;
  for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]));
  const k = m > 0 ? peak / m : 0;
  const fo = Math.min(d.length, Math.floor(fadeOut * sr));
  for (let i = 0; i < d.length; i++) {
    let g = k;
    const r = d.length - 1 - i;
    if (r < fo) g *= r / fo;
    d[i] *= g;
  }
  return d;
}

export const sat = (x: number, drive = 1) => Math.tanh(x * drive);

// Excitateur harmonique : ajoute une copie saturee et filtree passe-haut.
// Les graves deviennent audibles sur un haut-parleur de telephone (le cerveau
// reconstitue la fondamentale a partir des harmoniques).
export function excite(d: Mono, sr: number, amount: number, from = 350): Mono {
  const hp = new Biquad(sr, 'hp', from, 0.7);
  const hp2 = new Biquad(sr, 'hp', from, 0.7);
  for (let i = 0; i < d.length; i++) d[i] += hp2.run(hp.run(Math.tanh(d[i] * 5))) * amount;
  return d;
}

// Balayage sinusoidal (frequence donnee par une fonction du temps).
function sweep(sr: number, d: Mono, f: (t: number) => number, amp: (t: number) => number, start = 0, type: 'sin' | 'saw' | 'sq' | 'tri' = 'sin') {
  let ph = 0;
  for (let i = Math.floor(start * sr); i < d.length; i++) {
    const t = i / sr - start;
    ph += f(t) / sr;
    ph -= Math.floor(ph);
    let v: number;
    if (type === 'sin') v = Math.sin(2 * Math.PI * ph);
    else if (type === 'saw') v = 2 * ph - 1;
    else if (type === 'sq') v = ph < 0.5 ? 1 : -1;
    else v = 1 - 4 * Math.abs(ph - 0.5);
    d[i] += v * amp(t);
  }
}

function noiseInto(sr: number, d: Mono, filt: Biquad | null, amp: (t: number) => number, start = 0, len = Infinity, fmod?: (t: number, f: Biquad) => void) {
  const i0 = Math.floor(start * sr);
  const i1 = Math.min(d.length, i0 + Math.floor(len * sr));
  for (let i = i0; i < i1; i++) {
    const t = i / sr - start;
    if (fmod && filt && (i & 31) === 0) fmod(t, filt);
    const n = rnd();
    d[i] += (filt ? filt.run(n) : n) * amp(t);
  }
}

const ex = (t: number, k: number) => Math.exp(-t * k);
const att = (t: number, a: number) => (t < a ? t / a : 1);

// ---------------- Percussions ----------------

export function kick(sr: number): Mono {
  const d = buf(sr, 0.42);
  sweep(sr, d, (t) => 50 + 120 * ex(t, 28), (t) => ex(t, 7) * att(t, 0.002));
  const hp = new Biquad(sr, 'hp', 1800);
  noiseInto(sr, d, hp, (t) => 0.35 * ex(t, 260));
  for (let i = 0; i < d.length; i++) d[i] = sat(d[i], 2.6);
  excite(d, sr, 2.2, 250);
  return finish(d, 0.95, sr);
}

export function rim(sr: number): Mono {
  const d = buf(sr, 0.16);
  sweep(sr, d, () => 430, (t) => 0.8 * ex(t, 38));
  sweep(sr, d, () => 1180, (t) => 0.45 * ex(t, 60));
  noiseInto(sr, d, new Biquad(sr, 'bp', 2400, 1.2), (t) => 0.9 * ex(t, 90));
  return finish(d, 0.8, sr);
}

export function clap(sr: number): Mono {
  const d = buf(sr, 0.32);
  const f = new Biquad(sr, 'bp', 1500, 0.9);
  for (const o of [0, 0.011, 0.023]) noiseInto(sr, d, f, (t) => ex(t, 70), o, 0.05);
  noiseInto(sr, d, new Biquad(sr, 'bp', 1300, 0.7), (t) => 0.5 * ex(t, 16), 0.03);
  return finish(d, 0.8, sr);
}

export function shaker(sr: number, long = false): Mono {
  const d = buf(sr, long ? 0.16 : 0.08);
  noiseInto(sr, d, new Biquad(sr, 'hp', 5500, 0.8), (t) => att(t, long ? 0.02 : 0.006) * ex(t, long ? 26 : 55));
  return finish(d, 0.7, sr);
}

export function bell(sr: number, f: number): Mono {
  const d = buf(sr, 0.5);
  [[1, 1, 11], [2.42, 0.45, 17], [3.87, 0.22, 24], [5.3, 0.1, 30]].forEach(([m, a, k]) =>
    sweep(sr, d, () => f * m, (t) => a * ex(t, k) * att(t, 0.001)));
  return finish(d, 0.8, sr);
}

// Tambour parlant (dondo) : membrane dont la hauteur se plie.
export function talkingDrum(sr: number, f0: number, bend: number): Mono {
  const d = buf(sr, 0.5);
  const f = (t: number) => f0 * (1 + bend * Math.min(1, t / 0.07) * ex(Math.max(0, t - 0.07), 5));
  sweep(sr, d, f, (t) => ex(t, 7.5) * att(t, 0.003));
  sweep(sr, d, (t) => 2 * f(t), (t) => 0.3 * ex(t, 12));
  noiseInto(sr, d, new Biquad(sr, 'lp', 900), (t) => 0.5 * ex(t, 80));
  for (let i = 0; i < d.length; i++) d[i] = sat(d[i], 1.8);
  excite(d, sr, 0.5);
  return finish(d, 0.85, sr);
}

export function tom(sr: number, f0: number): Mono {
  const d = buf(sr, 0.4);
  sweep(sr, d, (t) => f0 * (1 + 0.6 * ex(t, 25)), (t) => ex(t, 9));
  noiseInto(sr, d, new Biquad(sr, 'lp', 1500), (t) => 0.4 * ex(t, 60));
  for (let i = 0; i < d.length; i++) d[i] = sat(d[i], 2);
  excite(d, sr, 0.6);
  return finish(d, 0.85, sr);
}

export function crash(sr: number): Mono {
  const d = buf(sr, 1.8);
  noiseInto(sr, d, new Biquad(sr, 'hp', 4500, 0.6), (t) => att(t, 0.004) * ex(t, 2.6));
  [3120, 4410, 5870, 7210].forEach((f, k) => sweep(sr, d, () => f, (t) => 0.06 * ex(t, 3 + k)));
  return finish(d, 0.7, sr, 0.3);
}

export function riser(sr: number, dur: number): Mono {
  const d = buf(sr, dur);
  noiseInto(sr, d, new Biquad(sr, 'bp', 400, 2), (t) => Math.pow(t / dur, 2), 0, dur, (t, f) => f.set(400 * Math.pow(15, t / dur), 2));
  sweep(sr, d, (t) => 220 * Math.pow(4, t / dur), (t) => 0.15 * Math.pow(t / dur, 3), 0, 'saw');
  return finish(d, 0.7, sr, 0.02);
}

// ---------------- Instruments melodiques ----------------

// Balafon : lame de bois accordee (partiels 1, 3.9, 9.4) et resonateur a
// mirliton (legere vibration bourdonnante).
export function balafon(sr: number, m: number): Mono {
  const d = buf(sr, 0.9);
  const f = mtof(m);
  [[1, 1, 7], [3.93, 0.32, 22], [9.4, 0.1, 45]].forEach(([k, a, dk]) =>
    sweep(sr, d, () => f * k, (t) => a * ex(t, dk) * att(t, 0.0015) * (1 + 0.18 * Math.sin(2 * Math.PI * 31 * t) * ex(t, 4))));
  noiseInto(sr, d, new Biquad(sr, 'bp', f * 2.5, 1.5), (t) => 0.4 * ex(t, 140));
  return finish(d, 0.85, sr, 0.05);
}

export function bassNote(sr: number, m: number, dur = 0.34): Mono {
  const d = buf(sr, dur + 0.05);
  const f = mtof(m);
  const lp = new Biquad(sr, 'lp', 1800, 3);
  let ph = 0, ph2 = 0;
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    if ((i & 31) === 0) lp.set(220 + 1700 * ex(t, 14), 3);
    ph = (ph + f / sr) % 1;
    ph2 = (ph2 + (f * 1.005) / sr) % 1;
    const v = (2 * ph - 1) * 0.6 + (2 * ph2 - 1) * 0.4 + Math.sin(2 * Math.PI * ph) * 0.8;
    d[i] = lp.run(v) * att(t, 0.004) * (t < dur ? 1 : ex(t - dur, 60));
  }
  for (let i = 0; i < d.length; i++) d[i] = sat(d[i], 2.2);
  excite(d, sr, 0.35);
  return finish(d, 0.85, sr);
}

export function brass(sr: number, notes: number[]): Mono {
  const d = buf(sr, 0.42);
  const lp = new Biquad(sr, 'lp', 3000, 1.2);
  const ph = notes.flatMap(() => [0, 0, 0]);
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    if ((i & 31) === 0) lp.set(700 + 3200 * ex(t, 9), 1.2);
    let v = 0;
    notes.forEach((m, n) => {
      [-9, 0, 8].forEach((det, k) => {
        const j = n * 3 + k;
        ph[j] = (ph[j] + (mtof(m) * Math.pow(2, det / 1200)) / sr) % 1;
        v += 2 * ph[j] - 1;
      });
    });
    d[i] = lp.run(v / notes.length) * att(t, 0.012) * ex(t, 5.5);
  }
  for (let i = 0; i < d.length; i++) d[i] = sat(d[i], 1.6);
  return finish(d, 0.8, sr);
}

export function pad(sr: number, notes: number[], dur: number): Mono {
  const d = buf(sr, dur);
  const lp = new Biquad(sr, 'lp', 1300, 0.8);
  const ph = notes.flatMap(() => [0, 0]);
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    let v = 0;
    notes.forEach((m, n) => [-7, 7].forEach((det, k) => {
      const j = n * 2 + k;
      ph[j] = (ph[j] + (mtof(m) * Math.pow(2, det / 1200)) / sr) % 1;
      v += 2 * ph[j] - 1;
    }));
    const env = Math.min(1, t / 0.35) * Math.min(1, (dur - t) / 0.5);
    d[i] = lp.run(v / notes.length) * env;
  }
  return finish(d, 0.6, sr);
}

export function arpNote(sr: number, m: number): Mono {
  const d = buf(sr, 0.14);
  const lp = new Biquad(sr, 'lp', 2600, 2);
  sweep(sr, d, () => mtof(m), (t) => ex(t, 22), 0, 'sq');
  for (let i = 0; i < d.length; i++) d[i] = lp.run(d[i]);
  return finish(d, 0.6, sr);
}

// Voix de robot : carre ecrase en bits (danse de victoire, bips).
export function robotNote(sr: number, m: number, dur = 0.16): Mono {
  const d = buf(sr, dur);
  sweep(sr, d, (t) => mtof(m) * (1 + 0.02 * Math.sin(2 * Math.PI * 7 * t)), (t) => att(t, 0.005) * (t < dur - 0.03 ? 1 : (dur - t) / 0.03), 0, 'sq');
  const bp = new Biquad(sr, 'bp', mtof(m) * 3, 1.5);
  let hold = 0;
  for (let i = 0; i < d.length; i++) {
    if (i % 4 === 0) hold = Math.round(d[i] * 6) / 6;
    d[i] = hold * 0.5 + bp.run(hold) * 0.8;
  }
  return finish(d, 0.6, sr);
}

// ---------------- Bruitages ----------------

export function coinTing(sr: number, m: number): Mono {
  const d = buf(sr, 0.45);
  const f = mtof(m);
  for (const [off, mul] of [[0, 1], [0.055, 1.5]]) {
    [[1, 1, 16], [2, 0.3, 26], [3.01, 0.18, 34]].forEach(([k, a, dk]) =>
      sweep(sr, d, () => f * mul * k, (t) => a * ex(t, dk) * att(t, 0.001) * (off ? 1 : 0.7), off));
  }
  return finish(d, 0.75, sr);
}

export function whoosh(sr: number, dur: number, f0: number, f1: number, q = 1.4): Mono {
  const d = buf(sr, dur);
  noiseInto(sr, d, new Biquad(sr, 'bp', f0, q), (t) => Math.sin(Math.PI * Math.min(1, t / dur)) ** 1.5, 0, dur, (t, f) => f.set(f0 * Math.pow(f1 / f0, t / dur), q));
  return finish(d, 0.8, sr);
}

export function squeak(sr: number): Mono {
  const d = buf(sr, 0.16);
  sweep(sr, d, (t) => 1900 + 700 * (t / 0.16) + 90 * Math.sin(2 * Math.PI * 34 * t), (t) => att(t, 0.01) * Math.min(1, (0.16 - t) / 0.04), 0, 'tri');
  return finish(d, 0.5, sr);
}

export function thud(sr: number, f0 = 120, grit = 0.4, dur = 0.3): Mono {
  const d = buf(sr, dur);
  sweep(sr, d, (t) => f0 * (0.5 + 0.5 * ex(t, 18)), (t) => ex(t, 14) * att(t, 0.002));
  noiseInto(sr, d, new Biquad(sr, 'lp', 1400), (t) => grit * ex(t, 40));
  noiseInto(sr, d, new Biquad(sr, 'hp', 3000), (t) => grit * 0.4 * ex(t, 90));
  for (let i = 0; i < d.length; i++) d[i] = sat(d[i], 2.5);
  excite(d, sr, 1.8, 250);
  return finish(d, 0.9, sr);
}

export function scrape(sr: number, dur = 0.45): Mono {
  const d = buf(sr, dur);
  const bp = new Biquad(sr, 'bp', 900, 0.8);
  let am = 0;
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    if ((i & 127) === 0) am = 0.6 + 0.4 * Math.abs(rnd());
    d[i] = bp.run(rnd()) * am * att(t, 0.03) * Math.min(1, (dur - t) / 0.12);
  }
  return finish(d, 0.7, sr);
}

export function impact(sr: number, heavy: boolean): Mono {
  const dur = heavy ? 1.1 : 0.5;
  const d = buf(sr, dur);
  sweep(sr, d, (t) => (heavy ? 95 : 150) * (0.45 + 0.55 * ex(t, 12)), (t) => ex(t, heavy ? 5 : 9));
  noiseInto(sr, d, new Biquad(sr, 'lp', heavy ? 2600 : 2000, 0.7), (t) => 0.9 * ex(t, heavy ? 7 : 14));
  [620, 910, 1370, 2050].forEach((f, k) => sweep(sr, d, () => f * (1 + 0.1 * rnd()), (t) => 0.18 * ex(t, 18 + k * 6), 0.01 * k));
  if (heavy) for (let k = 0; k < 14; k++) noiseInto(sr, d, new Biquad(sr, 'bp', 1500 + 2500 * Math.abs(rnd()), 3), (t) => 0.5 * ex(t, 70), 0.06 + Math.abs(rnd()) * 0.5, 0.05);
  for (let i = 0; i < d.length; i++) d[i] = sat(d[i], 2.2);
  excite(d, sr, 1.3, 250);
  return finish(d, 0.95, sr, 0.1);
}

export function fallWhistle(sr: number): Mono {
  const d = buf(sr, 0.75);
  sweep(sr, d, (t) => 1300 * Math.pow(0.18, t / 0.75), (t) => 0.5 * att(t, 0.02) * Math.min(1, (0.75 - t) / 0.1));
  return finish(d, 0.6, sr);
}

export function stampHit(sr: number): Mono {
  const d = buf(sr, 0.28);
  noiseInto(sr, d, new Biquad(sr, 'hp', 2500), (t) => ex(t, 200));
  sweep(sr, d, (t) => 260 * (0.6 + 0.4 * ex(t, 30)), (t) => ex(t, 22));
  noiseInto(sr, d, new Biquad(sr, 'bp', 3200, 0.8), (t) => 0.5 * ex(t, 35), 0.004);
  for (let i = 0; i < d.length; i++) d[i] = sat(d[i], 2.4);
  excite(d, sr, 0.5);
  return finish(d, 0.95, sr);
}

export function copier(sr: number): Mono {
  const d = buf(sr, 0.7);
  sweep(sr, d, () => 118, (t) => 0.35 * Math.sin(Math.PI * Math.min(1, t / 0.7)), 0, 'saw');
  noiseInto(sr, d, new Biquad(sr, 'bp', 700, 2), (t) => 0.7 * Math.sin(Math.PI * Math.min(1, t / 0.7)), 0, 0.7, (t, f) => f.set(600 + 2600 * t, 2));
  const hp = new Biquad(sr, 'hp', 300);
  for (let i = 0; i < d.length; i++) d[i] = hp.run(d[i]);
  return finish(d, 0.75, sr, 0.08);
}

export function scribble(sr: number): Mono {
  const d = buf(sr, 0.5);
  for (let k = 0; k < 5; k++) {
    const f = 2600 + 2200 * Math.abs(rnd());
    noiseInto(sr, d, new Biquad(sr, 'bp', f, 2.5), (t) => Math.sin(Math.PI * Math.min(1, t / 0.07)), k * 0.09 + Math.abs(rnd()) * 0.02, 0.07);
  }
  return finish(d, 0.7, sr);
}

export function shimmer(sr: number, up: boolean): Mono {
  const d = buf(sr, 0.9);
  for (let k = 0; k < 7; k++) {
    const m = 76 + [0, 3, 5, 7, 10, 12, 15][k];
    sweep(sr, d, () => mtof(m), (t) => 0.25 * ex(t, 5) * att(t, 0.004), (up ? k : 6 - k) * 0.045);
  }
  noiseInto(sr, d, new Biquad(sr, 'hp', 7000), (t) => 0.15 * ex(t, 4));
  return finish(d, 0.7, sr, 0.1);
}

export function glass(sr: number): Mono {
  const d = buf(sr, 0.8);
  for (let k = 0; k < 18; k++) {
    const f = 2200 + 5200 * Math.abs(rnd());
    sweep(sr, d, () => f, (t) => 0.12 * ex(t, 12 + 10 * Math.abs(rnd())), Math.abs(rnd()) * 0.12);
  }
  noiseInto(sr, d, new Biquad(sr, 'hp', 3000), (t) => 0.8 * ex(t, 30));
  return finish(d, 0.8, sr, 0.1);
}

export function step(sr: number, surface: 'asphalt' | 'tile' | 'dirt'): Mono {
  const d = buf(sr, 0.12);
  if (surface === 'asphalt') {
    noiseInto(sr, d, new Biquad(sr, 'bp', 900, 0.9), (t) => ex(t, 60));
    noiseInto(sr, d, new Biquad(sr, 'hp', 4000), (t) => 0.3 * ex(t, 120));
    sweep(sr, d, () => 170, (t) => 0.4 * ex(t, 50));
  } else if (surface === 'tile') {
    noiseInto(sr, d, new Biquad(sr, 'bp', 2600, 1.4), (t) => ex(t, 90));
    sweep(sr, d, () => 330, (t) => 0.5 * ex(t, 45));
  } else {
    for (let k = 0; k < 6; k++) noiseInto(sr, d, new Biquad(sr, 'bp', 1400 + 1500 * Math.abs(rnd()), 2), (t) => 0.7 * ex(t, 120), Math.abs(rnd()) * 0.05, 0.03);
    sweep(sr, d, () => 150, (t) => 0.35 * ex(t, 45));
  }
  for (let i = 0; i < d.length; i++) d[i] = sat(d[i], 1.6);
  excite(d, sr, 0.5);
  return finish(d, 0.8, sr);
}

// Pas du Gardien : impact lourd, cliquetis metalliques, hydraulique, servo.
export function robotStep(sr: number): Mono {
  const d = buf(sr, 0.45);
  sweep(sr, d, (t) => 85 * (0.5 + 0.5 * ex(t, 20)), (t) => ex(t, 10));
  [310, 745, 1215, 1830, 2610].forEach((f, k) => sweep(sr, d, () => f, (t) => (0.2 - k * 0.025) * ex(t, 14 + k * 5)));
  noiseInto(sr, d, new Biquad(sr, 'hp', 3200), (t) => 0.25 * Math.sin(Math.PI * Math.min(1, t / 0.22)), 0.05, 0.22);
  sweep(sr, d, (t) => 620 + 900 * t, (t) => 0.1 * Math.sin(Math.PI * Math.min(1, t / 0.14)), 0.02, 'saw');
  for (let i = 0; i < d.length; i++) d[i] = sat(d[i], 2.4);
  excite(d, sr, 0.8);
  return finish(d, 0.95, sr, 0.05);
}

// Rugissement de l'androide : voix formantee, modulee en anneau, ecrasee.
export function robotRoar(sr: number): Mono {
  const dur = 1.35;
  const d = buf(sr, dur);
  const f1 = new Biquad(sr, 'bp', 800, 5), f2 = new Biquad(sr, 'bp', 1200, 6), f3 = new Biquad(sr, 'bp', 2500, 6);
  let ph = 0, hold = 0;
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    const u = t / dur;
    if ((i & 31) === 0) {
      f1.set(820 - 380 * u, 5);
      f2.set(1250 - 450 * u, 6);
    }
    const f = 105 - 30 * u + 14 * Math.sin(2 * Math.PI * 27 * t);
    ph = (ph + f / sr) % 1;
    const src = 2 * ph - 1 + 0.3 * rnd();
    let v = f1.run(src) * 1.2 + f2.run(src) * 0.9 + f3.run(src) * 0.4;
    v *= 0.6 + 0.4 * Math.sin(2 * Math.PI * 58 * t);
    v += Math.sin(2 * Math.PI * ph) * 0.2;
    if (i % 3 === 0) hold = Math.round(v * 10) / 10;
    d[i] = sat(hold * 1.6, 1.5) * att(t, 0.06) * Math.min(1, (dur - t) / 0.35);
  }
  excite(d, sr, 0.6);
  return finish(d, 0.95, sr, 0.05);
}

export function whistle(sr: number): Mono {
  const d = buf(sr, 0.62);
  sweep(sr, d, (t) => 2900 + 180 * Math.sin(2 * Math.PI * 38 * t), (t) => att(t, 0.02) * Math.min(1, (0.62 - t) / 0.08));
  noiseInto(sr, d, new Biquad(sr, 'bp', 2900, 3), (t) => 0.2 * Math.min(1, (0.62 - t) / 0.08));
  return finish(d, 0.6, sr);
}

// Bips de l'androide (provocations).
export function robotChatter(sr: number): Mono {
  const d = buf(sr, 0.55);
  let t0 = 0;
  while (t0 < 0.45) {
    const f = 500 + 900 * Math.abs(rnd());
    const len = 0.04 + Math.abs(rnd()) * 0.05;
    sweep(sr, d, (t) => f * (1 + 0.3 * t / len), (t) => (t < len ? 0.5 : 0), t0, 'sq');
    t0 += len + 0.015;
  }
  const bp = new Biquad(sr, 'bp', 1400, 0.9);
  for (let i = 0; i < d.length; i++) d[i] = bp.run(d[i]) + d[i] * 0.2;
  return finish(d, 0.55, sr);
}

// Projectile : charge, tir, sifflement, explosion.
export function charge(sr: number): Mono {
  const d = buf(sr, 0.8);
  sweep(sr, d, (t) => 180 * Math.pow(8, t / 0.8), (t) => 0.3 * (t / 0.8) * (1 + 0.5 * Math.sin(2 * Math.PI * (20 + 40 * t) * t)), 0, 'saw');
  noiseInto(sr, d, new Biquad(sr, 'hp', 5000), (t) => 0.3 * (t / 0.8) * (Math.abs(rnd()) > 0.9 ? 1 : 0.2));
  const bp = new Biquad(sr, 'bp', 1500, 0.7);
  for (let i = 0; i < d.length; i++) d[i] = bp.run(d[i]) * 1.5 + d[i] * 0.3;
  return finish(d, 0.7, sr, 0.02);
}

export function launch(sr: number): Mono {
  const d = buf(sr, 0.5);
  sweep(sr, d, (t) => 180 * (0.3 + 0.7 * ex(t, 10)), (t) => ex(t, 8));
  noiseInto(sr, d, new Biquad(sr, 'bp', 1800, 1), (t) => 0.7 * ex(t, 12), 0, 0.5, (t, f) => f.set(2500 * ex(t, 4) + 300, 1));
  for (let i = 0; i < d.length; i++) d[i] = sat(d[i], 2);
  excite(d, sr, 1.3, 250);
  return finish(d, 0.9, sr);
}

export function flyby(sr: number): Mono {
  const dur = 1.1;
  const d = buf(sr, dur);
  const env = (t: number) => Math.exp(-((t - 0.55) ** 2) / 0.05);
  noiseInto(sr, d, new Biquad(sr, 'bp', 1600, 2.5), env, 0, dur, (t, f) => f.set(2200 * (t < 0.55 ? 1 : 0.7), 2.5));
  sweep(sr, d, (t) => (t < 0.55 ? 880 : 620) + 40 * Math.sin(2 * Math.PI * 12 * t), (t) => 0.25 * env(t), 0, 'tri');
  return finish(d, 0.7, sr);
}

export function explosion(sr: number): Mono {
  const d = buf(sr, 1.2);
  sweep(sr, d, (t) => 75 * (0.45 + 0.55 * ex(t, 8)), (t) => ex(t, 4));
  noiseInto(sr, d, new Biquad(sr, 'lp', 4000, 0.7), (t) => ex(t, 4.5) * att(t, 0.003), 0, 1.2, (t, f) => f.set(300 + 4000 * ex(t, 5), 0.7));
  for (let k = 0; k < 20; k++) noiseInto(sr, d, new Biquad(sr, 'bp', 2000 + 3000 * Math.abs(rnd()), 4), (t) => 0.4 * ex(t, 60), 0.05 + Math.abs(rnd()) * 0.7, 0.04);
  for (let i = 0; i < d.length; i++) d[i] = sat(d[i], 2.4);
  excite(d, sr, 1.3, 250);
  return finish(d, 0.95, sr, 0.2);
}

export function uiTick(sr: number, f = 1500): Mono {
  const d = buf(sr, 0.08);
  sweep(sr, d, () => f, (t) => ex(t, 60));
  noiseInto(sr, d, new Biquad(sr, 'hp', 4000), (t) => 0.3 * ex(t, 200));
  return finish(d, 0.6, sr);
}

export function beep(sr: number, f: number, dur: number): Mono {
  const d = buf(sr, dur);
  sweep(sr, d, () => f, (t) => att(t, 0.005) * Math.min(1, (dur - t) / 0.05));
  sweep(sr, d, () => f * 2, (t) => 0.25 * att(t, 0.005) * Math.min(1, (dur - t) / 0.05));
  return finish(d, 0.6, sr);
}

// Sonnerie electrique de l'ecole.
export function schoolBell(sr: number): Mono {
  const d = buf(sr, 1.3);
  sweep(sr, d, () => 980, (t) => (0.55 + 0.45 * Math.sign(Math.sin(2 * Math.PI * 24 * t))) * Math.min(1, t / 0.02) * Math.min(1, (1.3 - t) / 0.1), 0, 'sq');
  const bp = new Biquad(sr, 'bp', 2000, 1.2);
  for (let i = 0; i < d.length; i++) d[i] = bp.run(d[i]);
  return finish(d, 0.5, sr);
}

// Klaxon (deux tons) et zemidjan qui passe.
export function horn(sr: number): Mono {
  const d = buf(sr, 0.5);
  for (const f of [415, 520]) sweep(sr, d, () => f, (t) => att(t, 0.02) * Math.min(1, (0.5 - t) / 0.05), 0, 'saw');
  const bp = new Biquad(sr, 'bp', 1400, 1.1);
  for (let i = 0; i < d.length; i++) d[i] = sat(bp.run(d[i]) * 2, 1.2);
  return finish(d, 0.5, sr);
}

export function moto(sr: number): Mono {
  const dur = 2.2;
  const d = buf(sr, dur);
  const env = (t: number) => Math.exp(-((t - 1.1) ** 2) / 0.25);
  sweep(sr, d, (t) => 88 * (t < 1.1 ? 1.08 : 0.9), (t) => env(t) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 29 * t)), 0, 'saw');
  const bp = new Biquad(sr, 'bp', 900, 0.8);
  for (let i = 0; i < d.length; i++) d[i] = sat(bp.run(d[i]) * 3, 1.3) + d[i] * 0.2;
  return finish(d, 0.5, sr, 0.1);
}

export function bird(sr: number): Mono {
  const d = buf(sr, 0.5);
  const n = 2 + Math.floor(Math.abs(rnd()) * 3);
  for (let k = 0; k < n; k++) sweep(sr, d, (t) => 2600 + 1800 * (t / 0.07), (t) => (t < 0.07 ? Math.sin((Math.PI * t) / 0.07) : 0), k * 0.1);
  return finish(d, 0.35, sr);
}

// Boucles d'ambiance (bruit colore, stationnaire, bouclable).
export function ambience(sr: number, kind: 'street' | 'corridor' | 'court' | 'wind'): Mono {
  const dur = 4;
  const d = buf(sr, dur);
  const a = new Biquad(sr, 'lp', kind === 'street' ? 350 : 500);
  const b = new Biquad(sr, 'bp', kind === 'corridor' ? 650 : kind === 'court' ? 520 : 1400, kind === 'corridor' ? 1.4 : 0.7);
  const h = new Biquad(sr, 'hp', 1500);
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    const n = rnd();
    // Modulations entieres sur la duree : la boucle se raccorde.
    const m1 = 0.6 + 0.4 * Math.sin(2 * Math.PI * (t / dur) * 3);
    const m2 = 0.5 + 0.5 * Math.sin(2 * Math.PI * (t / dur) * 7 + 1);
    if (kind === 'street') d[i] = a.run(n) * 1.2 + b.run(n) * 0.5 * m1;
    else if (kind === 'corridor') d[i] = a.run(n) * 0.6 + b.run(n) * (0.4 + 0.6 * m2 * m1);
    else if (kind === 'court') d[i] = b.run(n) * m1 * 0.8 + h.run(n) * 0.08 * m2;
    else d[i] = h.run(n) * (0.7 + 0.3 * m1);
  }
  // Fondu croise des extremites pour un bouclage sans clic.
  const x = Math.floor(0.1 * sr);
  for (let i = 0; i < x; i++) {
    const g = i / x;
    d[i] = d[i] * g + d[d.length - x + i] * (1 - g);
  }
  return finish(d.subarray(0, d.length - x), 0.6, sr, 0);
}

// Reponse impulsionnelle stereo de reverberation (salle / couloir).
export function impulse(sr: number, dur: number, decay: number): [Mono, Mono] {
  const out: [Mono, Mono] = [buf(sr, dur), buf(sr, dur)];
  for (const ch of out) {
    let lp = 0;
    for (let i = 0; i < ch.length; i++) {
      const t = i / sr;
      const k = 0.5 * Math.exp(-t * 2.5) + 0.05;
      lp += (rnd() - lp) * k;
      ch[i] = lp * Math.exp(-t * decay) * (t < 0.01 ? t / 0.01 : 1);
    }
    finish(ch, 0.5, sr, 0.05);
  }
  return out;
}
