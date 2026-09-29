// Son procedural (WebAudio) : musique afro-electro en boucle et effets.

export class Audio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private noiseBuf!: AudioBuffer;
  private timer: number | null = null;
  private nextNote = 0;
  private step = 0;
  private tempo = 112;
  private intensity = 0;
  muted = false;
  private coinPitch = 0;
  private coinTime = 0;

  constructor() {
    try {
      this.muted = localStorage.getItem('eplrun.muted') === '1';
    } catch {
      this.muted = false;
    }
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.8;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      this.master.connect(comp).connect(this.ctx.destination);
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = 0.42;
      this.musicBus.connect(this.master);
      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = 0.8;
      this.sfxBus.connect(this.master);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setMuted(m: boolean) {
    this.muted = m;
    try {
      localStorage.setItem('eplrun.muted', m ? '1' : '0');
    } catch {
      /* stockage indisponible */
    }
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  // Intensite musicale 0..1 (ajoute des couches quand le gardien approche).
  setIntensity(v: number) {
    this.intensity = v;
  }

  startMusic() {
    if (!this.ctx || this.timer !== null) return;
    this.nextNote = this.ctx.currentTime + 0.1;
    this.step = 0;
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  stopMusic() {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  duckMusic(on: boolean) {
    if (!this.ctx) return;
    this.musicBus.gain.setTargetAtTime(on ? 0.12 : 0.42, this.ctx.currentTime, 0.2);
  }

  private schedule() {
    const ctx = this.ctx!;
    const spb = 60 / this.tempo / 4; // double-croche
    while (this.nextNote < ctx.currentTime + 0.12) {
      this.playStep(this.step, this.nextNote);
      this.nextNote += spb;
      this.step = (this.step + 1) % 64;
    }
  }

  private playStep(i: number, t: number) {
    const s = i % 16;
    const bar = Math.floor(i / 16);
    // Grosse caisse syncopee.
    if (s === 0 || s === 6 || s === 10 || (s === 14 && bar % 2)) this.kick(t);
    // Clap sur 2 et 4.
    if (s === 4 || s === 12) this.clap(t);
    // Shaker.
    this.hat(t, s % 4 === 2 ? 0.16 : 0.06, s % 2 ? 0.03 : 0.05);
    // Cloche type gankogui (motif 12/8 adapte).
    if ([0, 3, 6, 8, 10, 13].includes(s)) this.bell(t, s === 0 ? 1244 : 932, 0.07);
    // Basse.
    const roots = [45, 45, 41, 43];
    const root = roots[bar % 4];
    const bassPat = [0, -1, -1, 0, -1, -1, 12, -1, 0, -1, 7, -1, -1, 10, -1, 12];
    if (bassPat[s] >= 0) this.bass(t, root + bassPat[s], 0.16);
    // Nappe d'accords a chaque mesure.
    if (s === 0) this.pad(t, root + 12, 60 / this.tempo * 4);
    // Couche de tension quand le gardien est proche.
    if (this.intensity > 0.3 && s % 2 === 0) this.stab(t, root + 24 + ([0, 3, 7, 10][(s / 2) % 4]), 0.07 * this.intensity);
  }

  private env(g: GainNode, t: number, a: number, peak: number, d: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  private kick(t: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    this.env(g, t, 0.003, 0.9, 0.28);
    o.connect(g).connect(this.musicBus);
    o.start(t);
    o.stop(t + 0.35);
  }

  private noise(t: number, dur: number, type: BiquadFilterType, freq: number, q: number, peak: number, bus: GainNode, a = 0.002) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    this.env(g, t, a, peak, dur);
    src.connect(f).connect(g).connect(bus);
    src.start(t, Math.random() * 0.5);
    src.stop(t + a + dur + 0.05);
    return f;
  }

  private clap(t: number) {
    for (let k = 0; k < 3; k++) this.noise(t + k * 0.012, 0.12, 'bandpass', 1600, 0.8, 0.35, this.musicBus);
  }

  private hat(t: number, peak: number, dur: number) {
    this.noise(t, dur, 'highpass', 7000, 0.5, peak, this.musicBus);
  }

  private bell(t: number, f: number, peak: number) {
    const ctx = this.ctx!;
    for (const [mult, amp] of [[1, 1], [2.76, 0.4]]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * mult;
      const g = ctx.createGain();
      this.env(g, t, 0.002, peak * amp, 0.18);
      o.connect(g).connect(this.musicBus);
      o.start(t);
      o.stop(t + 0.25);
    }
  }

  private mtof(m: number) {
    return 440 * Math.pow(2, (m - 69) / 12);
  }

  private bass(t: number, note: number, dur: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = this.mtof(note);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(900, t);
    f.frequency.exponentialRampToValueAtTime(180, t + dur);
    f.Q.value = 6;
    const g = ctx.createGain();
    this.env(g, t, 0.005, 0.35, dur);
    o.connect(f).connect(g).connect(this.musicBus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private pad(t: number, root: number, dur: number) {
    const ctx = this.ctx!;
    for (const iv of [0, 3, 7, 10]) {
      for (const det of [-6, 6]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = this.mtof(root + iv);
        o.detune.value = det;
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 1100;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.018, t + 0.4);
        g.gain.linearRampToValueAtTime(0.0001, t + dur);
        o.connect(f).connect(g).connect(this.musicBus);
        o.start(t);
        o.stop(t + dur + 0.05);
      }
    }
  }

  private stab(t: number, note: number, peak: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = this.mtof(note);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 2400;
    const g = ctx.createGain();
    this.env(g, t, 0.003, peak, 0.1);
    o.connect(f).connect(g).connect(this.musicBus);
    o.start(t);
    o.stop(t + 0.15);
  }

  // Effets.
  private tone(type: OscillatorType, f0: number, f1: number, dur: number, peak: number, delay = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = this.ctx.createGain();
    this.env(g, t, 0.004, peak, dur);
    o.connect(g).connect(this.sfxBus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  coin() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.coinPitch = now - this.coinTime < 0.35 ? Math.min(this.coinPitch + 1, 12) : 0;
    this.coinTime = now;
    const base = 1318 * Math.pow(2, (this.coinPitch % 8) / 24);
    this.tone('square', base, base, 0.05, 0.08);
    this.tone('sine', base * 1.5, base * 1.5, 0.16, 0.14, 0.05);
  }

  jump() {
    this.tone('sine', 300, 720, 0.18, 0.18);
    if (this.ctx) this.noise(this.ctx.currentTime, 0.18, 'bandpass', 1200, 1, 0.12, this.sfxBus, 0.02);
  }

  superJump() {
    this.tone('triangle', 260, 1400, 0.35, 0.2);
    if (this.ctx) this.noise(this.ctx.currentTime, 0.35, 'bandpass', 2000, 0.8, 0.14, this.sfxBus, 0.04);
  }

  slide() {
    if (this.ctx) this.noise(this.ctx.currentTime, 0.35, 'lowpass', 900, 0.7, 0.3, this.sfxBus, 0.03);
  }

  swish() {
    if (this.ctx) {
      const f = this.noise(this.ctx.currentTime, 0.12, 'bandpass', 900, 1.5, 0.16, this.sfxBus, 0.01);
      f.frequency.exponentialRampToValueAtTime(2600, this.ctx.currentTime + 0.12);
    }
  }

  land() {
    this.tone('sine', 140, 60, 0.12, 0.25);
  }

  stumble() {
    this.tone('square', 180, 90, 0.2, 0.18);
    if (this.ctx) this.noise(this.ctx.currentTime, 0.25, 'lowpass', 600, 1, 0.4, this.sfxBus);
  }

  crash() {
    if (!this.ctx) return;
    this.tone('sine', 120, 35, 0.6, 0.6);
    this.noise(this.ctx.currentTime, 0.7, 'lowpass', 1400, 0.6, 0.6, this.sfxBus);
  }

  powerUp() {
    [0, 4, 7, 12].forEach((n, i) => this.tone('triangle', 660 * Math.pow(2, n / 12), 660 * Math.pow(2, n / 12), 0.12, 0.16, i * 0.06));
  }

  stomp(vol: number) {
    if (vol < 0.02) return;
    this.tone('sine', 90, 40, 0.18, 0.5 * vol);
  }

  roar() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(95, t);
    o.frequency.linearRampToValueAtTime(70, t + 1.1);
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 28;
    const lg = this.ctx.createGain();
    lg.gain.value = 18;
    lfo.connect(lg).connect(o.frequency);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 700;
    f.Q.value = 4;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    o.connect(f).connect(g).connect(this.sfxBus);
    o.start(t);
    lfo.start(t);
    o.stop(t + 1.25);
    lfo.stop(t + 1.25);
    this.noise(t, 1.0, 'bandpass', 500, 0.7, 0.3, this.sfxBus, 0.05);
  }

  stamp() {
    if (!this.ctx) return;
    this.tone('sine', 160, 50, 0.16, 0.6);
    this.noise(this.ctx.currentTime, 0.08, 'lowpass', 2200, 0.8, 0.5, this.sfxBus);
  }

  whistle() {
    // Sifflet du gardien.
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = 2900;
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 38;
    const lg = this.ctx.createGain();
    lg.gain.value = 180;
    lfo.connect(lg).connect(o.frequency);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.02);
    g.gain.setValueAtTime(0.16, t + 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    o.connect(g).connect(this.sfxBus);
    o.start(t);
    lfo.start(t);
    o.stop(t + 0.65);
    lfo.stop(t + 0.65);
  }
}
