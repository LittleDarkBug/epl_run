import * as S from '../audio/dsp';
import { CHORDS, recipe } from '../audio/recipes';

// Moteur sonore (WebAudio). Tous les sons sont synthetises une fois dans des
// tampons (src/audio/dsp.ts) puis rejoues : peu couteux sur mobile.
//
// Identite : afro-pop togolaise. Balafon, cloche gankogui, tambour parlant,
// shekere, cuivres, basse ronde. Tempo qui monte avec la vitesse, variations
// par zone (rue, couloirs, cour), couche de tension quand le Gardien approche,
// fanfare robotique quand il gagne.
//
// Mobile : deverrouillage a chaque geste (click, touchend, pointerup,
// keydown), session iOS en mode lecture (le son passe meme avec le bouton
// silencieux), reprise apres mise en arriere-plan, limiteur en sortie.

export type SoundZone = 'street' | 'corridor' | 'court';
type Mode = 'off' | 'menu' | 'run' | 'dance';
type Surface = 'asphalt' | 'tile' | 'dirt';

interface PlayOpts {
  when?: number;
  gain?: number;
  rate?: number;
  pan?: number;
  verb?: number;
  echo?: number;
  bus?: GainNode;
}

// Gamme pentatonique de la mineur (balafon) et grille d'accords.
const SCALE = [57, 60, 62, 64, 67, 69, 72, 74, 76, 79, 81, 84];
const _ = -1;
// Phrases de balafon (2 mesures de 16 doubles-croches, degres de SCALE).
const PHRASES: number[][] = [
  [5, _, 7, _, 6, 5, _, 3, _, 5, _, _, 4, _, 3, _, 2, _, 3, _, _, 5, _, 3, _, 2, _, 0, _, _, _, _],
  [7, _, 7, 8, _, 7, 5, _, 7, _, _, 9, _, 8, 7, _, 5, _, 4, _, 5, _, _, 3, _, _, 2, _, 3, _, 5, _],
  [9, _, 8, _, 7, _, 8, 9, _, 7, _, 5, _, _, 7, _, 8, _, 7, 5, _, _, 4, _, 5, _, 7, _, _, _, _, _],
  [5, _, 5, 7, _, 5, _, 5, _, 7, _, 5, 8, _, 7, _, 5, _, 5, 7, _, 5, _, 5, _, 7, _, 9, 8, _, 7, _],
];
const CORRIDOR_OST = [5, _, _, _, 7, _, _, _, 4, _, _, _, 5, _, _, _, 5, _, _, _, 7, _, _, 8, 7, _, _, _, 4, _, _, _];
const MENU_PHRASE = [5, _, _, 7, _, _, 9, _, _, 8, _, _, 7, _, _, _, 5, _, _, 4, _, _, 3, _, _, _, _, _, _, _, _, _];
const BASS = [0, _, _, 0, _, _, 12, _, 7, _, 10, _, _, 12, 7, _];
const BASS_CHILL = [0, _, _, _, _, _, 7, _, 0, _, _, _, _, _, _, _];

export class Audio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private musicFilter!: BiquadFilterNode;
  private sfxBus!: GainNode;
  private ambBus!: GainNode;
  private verbSend!: GainNode;
  private verbReturn!: GainNode;
  private echoSend!: GainNode;
  private bufs = new Map<string, AudioBuffer>();
  private unlockEl: HTMLAudioElement | null = null;
  muted = false;

  // Sequenceur.
  private timer: number | null = null;
  private mode: Mode = 'off';
  private nextTime = 0;
  private step = 0;
  private bpm = 108;
  private speedK = 0;
  private zone: SoundZone = 'street';
  private pendingZone: SoundZone | null = null;
  private intensity = 0;
  private riserFired = false;

  // Ambiance.
  private ambLoops: Partial<Record<SoundZone | 'wind', { src: AudioBufferSourceNode; g: GainNode }>> = {};
  private ambOn = false;
  private nextEvent = 0;
  private coinStep = 0;
  private coinTime = 0;
  private stepAlt = 0;

  constructor() {
    try {
      this.muted = localStorage.getItem('eplrun.muted') === '1';
    } catch {
      this.muted = false;
    }
    // Deverrouillage a chaque geste : iOS et Android n'autorisent le son
    // qu'apres une interaction, et le suspendent en arriere-plan.
    const gesture = () => this.unlock();
    for (const ev of ['pointerup', 'touchend', 'click', 'keydown']) window.addEventListener(ev, gesture, { capture: true, passive: true });
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) {
        void this.ctx.suspend();
        this.unlockEl?.pause();
      } else this.unlock();
    });
  }

  // ---------------- Moteur ----------------

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      // iOS 17+ : categorie "lecture" (ignore le bouton silencieux).
      const nav = navigator as Navigator & { audioSession?: { type: string } };
      try {
        if (nav.audioSession) nav.audioSession.type = 'playback';
      } catch { /* non supporte */ }
      this.ctx = new AC({ latencyHint: 'interactive' });
      this.build();
    }
    const ctx = this.ctx;
    if (ctx.state !== 'running') void ctx.resume().catch(() => undefined);
    // Tampon muet joue dans le geste (anciens iOS).
    const b = ctx.createBufferSource();
    b.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    b.connect(ctx.destination);
    b.start(0);
    // Element <audio> muet en boucle : bascule la session iOS en lecture.
    if (!this.unlockEl) {
      const el = document.createElement('audio');
      el.src = silentWav();
      el.loop = true;
      el.setAttribute('playsinline', '');
      el.setAttribute('x-webkit-airplay', 'deny');
      this.unlockEl = el;
    }
    if (this.unlockEl.paused && !document.hidden) void this.unlockEl.play().catch(() => undefined);
  }

  private build() {
    const ctx = this.ctx!;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 1;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 38;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 8;
    comp.ratio.value = 5;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    const limit = ctx.createDynamicsCompressor();
    limit.threshold.value = -2;
    limit.knee.value = 0;
    limit.ratio.value = 20;
    limit.attack.value = 0.001;
    limit.release.value = 0.08;
    const makeup = ctx.createGain();
    makeup.gain.value = 1.5;
    this.master.connect(hp).connect(comp).connect(makeup).connect(limit).connect(ctx.destination);
    this.out = limit;

    this.musicFilter = ctx.createBiquadFilter();
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = 20000;
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0.5;
    this.musicBus.connect(this.musicFilter).connect(this.master);
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.95;
    this.sfxBus.connect(this.master);
    this.ambBus = ctx.createGain();
    this.ambBus.gain.value = 0.3;
    this.ambBus.connect(this.master);

    // Reverberation (convolution) et echo ping-pong.
    const sr = ctx.sampleRate;
    const verb = ctx.createConvolver();
    const [l, r] = S.impulse(sr, 1.8, 3.2);
    const ir = ctx.createBuffer(2, l.length, sr);
    ir.copyToChannel(l as Float32Array<ArrayBuffer>, 0);
    ir.copyToChannel(r as Float32Array<ArrayBuffer>, 1);
    verb.buffer = ir;
    this.verbSend = ctx.createGain();
    this.verbReturn = ctx.createGain();
    this.verbReturn.gain.value = 0.35;
    this.verbSend.connect(verb).connect(this.verbReturn).connect(this.master);

    this.echoSend = ctx.createGain();
    const dl = ctx.createDelay(1), dr = ctx.createDelay(1);
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 3000;
    const pl = ctx.createStereoPanner(), pr = ctx.createStereoPanner();
    pl.pan.value = -0.7;
    pr.pan.value = 0.7;
    const echoOut = ctx.createGain();
    echoOut.gain.value = 0.4;
    this.echoSend.connect(dl);
    dl.connect(dr).connect(tone).connect(fb).connect(dl);
    dl.connect(pl).connect(echoOut);
    dr.connect(pr).connect(echoOut);
    echoOut.connect(this.musicBus);
    this.echoDelays = [dl, dr];
    this.setEchoTime();
    this.prewarm();
  }

  private echoDelays: DelayNode[] = [];
  // Sortie finale (enregistrement de demonstration en mode debogage).
  out: AudioNode | null = null;

  private setEchoTime() {
    const t = (60 / this.bpm) * 0.75; // croche pointee
    for (const d of this.echoDelays) d.delayTime.setTargetAtTime(t, this.ctx!.currentTime, 0.3);
  }

  // Tampon synthetise a la demande (ou en tache de fond) et mis en cache.
  private b(key: string): AudioBuffer {
    let b = this.bufs.get(key);
    if (!b) {
      const ctx = this.ctx!;
      const [make, div] = recipe(key);
      const sr = ctx.sampleRate / div;
      const d = make(sr);
      b = ctx.createBuffer(1, d.length, sr);
      b.copyToChannel(d as Float32Array<ArrayBuffer>, 0);
      this.bufs.set(key, b);
    }
    return b;
  }

  // Precalcul progressif des sons (evite les a-coups a la premiere lecture).
  private prewarm() {
    const keys = [
      'kick', 'shk', 'shkL', 'bellhi', 'belllo', 'rim', 'clap', 'crash', 'mpad0', 'mpad1', 'mpad2', 'mpad3',
      ...SCALE.map((m) => `bal${m}`), ...SCALE.slice(4).map((m) => `bal${m + 12}`),
      ...CHORDS.flatMap((c) => [0, 7, 10, 12].map((o) => `bass${c.root + o}`)), ...CHORDS.map((c) => `lbass${c.root}`), ...CHORDS.map((c) => `lbass${c.root + 7}`),
      'uitick', 'swish', 'jump', 'land', 'slide', 'slidew', 'turnw', 'squeak', 'stumble', 'crashfx', 'rstep', 'roar',
      'stepasphalt0', 'stepasphalt1', 'stepasphalt2', 'steptile0', 'steptile1', 'steptile2', 'stepdirt0', 'stepdirt1', 'stepdirt2',
      'ambstreet', 'ambcorridor', 'ambcourt', 'ambwind', 'moto', 'horn', 'bird0', 'bird1', 'bird2', 'schoolbell',
      ...[0, 1, 2, 3].map((i) => `brass${i}`), ...[0, 1, 2, 3].map((i) => `pad${i}`),
      'td1600.25', 'td1900.55', 'td1500.25', 'td2100.55', 'td1600.55', 'td1900.25', 'td1500.55', 'td2100.25',
      ...[9, 11, 13, 15].map((i) => `tom${i}`), 'riser', 'stamp', 'copier', 'scribble', 'shimup', 'glass', 'whistle',
      ...[0, 1, 2].map((i) => `chat${i}`), 'charge', 'launch', 'flyby', 'boom', 'fallw', 'beep0', 'beep1',
      ...SCALE.slice(4).map((m) => `coin${m + 12}`), ...CHORDS.flatMap((c) => c.notes.map((n) => `arp${n + 12}`)), ...SCALE.map((m) => `rob${m}`),
    ];
    const ctx = this.ctx!;
    try {
      // Synthese dans un worker : aucun cout pour le rendu graphique.
      const w = new Worker(new URL('../audio/worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<{ key: string; data: Float32Array<ArrayBuffer>; sr: number }>) => {
        const { key, data, sr } = e.data;
        if (this.bufs.has(key)) return;
        const b = ctx.createBuffer(1, data.length, sr);
        b.copyToChannel(data, 0);
        this.bufs.set(key, b);
      };
      w.postMessage({ keys, sr: ctx.sampleRate });
    } catch {
      // Sans worker : petites tranches en tache de fond.
      let i = 0;
      const tick = () => {
        const t0 = performance.now();
        while (i < keys.length && performance.now() - t0 < 3) this.b(keys[i++]);
        if (i < keys.length) window.setTimeout(tick, 40);
      };
      window.setTimeout(tick, 200);
    }
  }

  private play(b: AudioBuffer, o: PlayOpts = {}): AudioBufferSourceNode | null {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return null;
    const src = ctx.createBufferSource();
    src.buffer = b;
    if (o.rate) src.playbackRate.value = o.rate;
    const g = ctx.createGain();
    g.gain.value = o.gain ?? 1;
    let out: AudioNode = src.connect(g);
    if (o.pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = o.pan;
      out = out.connect(p);
    }
    out.connect(o.bus ?? this.sfxBus);
    if (o.verb) {
      const s = ctx.createGain();
      s.gain.value = o.verb;
      out.connect(s).connect(this.verbSend);
    }
    if (o.echo) {
      const s = ctx.createGain();
      s.gain.value = o.echo;
      out.connect(s).connect(this.echoSend);
    }
    src.start(Math.max(o.when ?? 0, ctx.currentTime));
    return src;
  }

  setMuted(m: boolean) {
    this.muted = m;
    try {
      localStorage.setItem('eplrun.muted', m ? '1' : '0');
    } catch {
      /* stockage indisponible */
    }
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.05);
  }

  private vibrate(pattern: number | number[]) {
    if (this.muted) return;
    try {
      navigator.vibrate?.(pattern);
    } catch { /* non supporte */ }
  }

  // ---------------- Musique ----------------

  // Musique calme du menu (lancee au premier geste).
  startMenuMusic() {
    this.setMode('menu');
    this.duckMusic(false);
  }

  startMusic() {
    this.setMode('run');
  }

  stopMusic() {
    this.setMode('off');
  }

  private setMode(m: Mode) {
    if (!this.ctx) return;
    if (this.mode === m && this.timer !== null) return;
    const wasOff = this.mode === 'off' || this.timer === null;
    this.mode = m;
    if (m === 'off') {
      if (this.timer !== null) clearInterval(this.timer);
      this.timer = null;
      return;
    }
    if (wasOff) {
      this.nextTime = this.ctx.currentTime + 0.08;
      this.step = 0;
      this.timer = window.setInterval(() => this.schedule(), 25);
    } else {
      // Nouveau mode : on repart au debut de la mesure suivante.
      this.step = Math.ceil(this.step / 16) * 16;
    }
    if (m === 'run' || m === 'dance') this.play(this.b('crash'), { bus: this.musicBus, gain: 0.5, when: this.nextTime, verb: 0.3 });
  }

  // Filtre passe-bas sur la musique (pause, cinematique).
  duckMusic(on: boolean) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.musicFilter.frequency.setTargetAtTime(on ? 900 : 20000, t, on ? 0.12 : 0.3);
    this.musicBus.gain.setTargetAtTime(on ? 0.34 : 0.5, t, 0.2);
  }

  // Intensite 0..1 : couches de tension quand le Gardien est proche.
  setIntensity(v: number) {
    this.intensity = v;
  }

  // Vitesse normalisee 0..1 : tempo, vent.
  setSpeed(k: number) {
    this.speedK = k;
    if (this.ctx && this.ambLoops.wind) this.ambLoops.wind.g.gain.setTargetAtTime(0.05 + 0.5 * k * k, this.ctx.currentTime, 0.3);
  }

  setZone(z: SoundZone) {
    if (z === this.zone && this.pendingZone === null) return;
    this.pendingZone = z;
    this.riserFired = false;
    this.ambience(this.ambOn, z);
  }

  private schedule() {
    const ctx = this.ctx!;
    if (ctx.state !== 'running') {
      this.nextTime = ctx.currentTime + 0.05;
      return;
    }
    const target = this.mode === 'menu' ? 100 : this.mode === 'dance' ? 118 : 110 + 14 * this.speedK;
    if (Math.abs(target - this.bpm) > 0.5) {
      this.bpm += Math.sign(target - this.bpm) * 0.5;
      this.setEchoTime();
    }
    const spb = 60 / this.bpm / 4;
    while (this.nextTime < ctx.currentTime + 0.14) {
      const swing = this.step % 2 ? spb * 0.14 : 0;
      this.playStep(this.step, this.nextTime + swing);
      this.nextTime += spb;
      this.step++;
      if (this.step % 16 === 0 && this.pendingZone && this.step % 64 === 0) {
        this.zone = this.pendingZone;
        this.pendingZone = null;
        this.play(this.b('crash'), { bus: this.musicBus, gain: 0.45, when: this.nextTime, verb: 0.3 });
      }
    }
    this.ambienceEvents();
  }

  private note(key: string, t: number, gain: number, o: PlayOpts = {}) {
    this.play(this.b(key), { bus: this.musicBus, when: t, gain, ...o });
  }

  private playStep(i: number, t: number) {
    const s = i % 16;
    const bar = Math.floor(i / 16);
    const bar8 = bar % 8;
    const section = Math.floor(bar / 8) % 2; // 0 : A, 1 : B
    const chord = CHORDS[bar % 4];
    const m = this.mode;
    const z = this.zone;
    const inside = m === 'run' && z === 'corridor';
    const verb = inside ? 0.45 : 0.12;
    const fill = m !== 'menu' && bar8 === 7 && s >= 8;

    if (m === 'menu') {
      if (s === 0) this.note(`mpad${bar % 4}`, t, 0.28, { verb: 0.4 });
      if (s % 8 === 0) this.note('kick', t, 0.45);
      if (s % 2 === 0) this.note('shk', t, s % 4 === 2 ? 0.2 : 0.09, { pan: 0.3 });
      if ([0, 3, 6, 10].includes(s)) this.note('bellhi', t, 0.08, { pan: -0.4, verb: 0.3 });
      const bn = BASS_CHILL[s];
      if (bn >= 0) this.note(`lbass${chord.root + bn}`, t, 0.5);
      const deg = MENU_PHRASE[(bar % 2) * 16 + s];
      if (deg >= 0) this.note(`bal${SCALE[deg]}`, t, 0.42, { echo: 0.5, verb: 0.3, pan: 0.15 });
      return;
    }

    // Batterie.
    const kickPat = m === 'dance' ? [0, 4, 8, 12] : [0, 7, 10, ...(bar % 2 ? [14] : [])];
    const tense = this.intensity > 0.5 && m === 'run';
    if (kickPat.includes(s) || (tense && s % 4 === 0)) this.note('kick', t, inside ? 0.62 : 0.8);
    if (s === 4 || s === 12) {
      if (inside) this.note('rim', t, 0.5, { verb: 0.5 });
      else this.note('clap', t, 0.55, { verb: 0.2 });
    }
    if ((s === 3 || s === 11 || s === 14) && !fill) this.note('rim', t, 0.22, { pan: -0.25, verb });
    // Shekere : accents sur les contretemps.
    const acc = [0.12, 0.2, 0.34, 0.2][s % 4];
    this.note(s % 4 === 2 ? 'shkL' : 'shk', t, acc, { pan: 0.35 });
    // Gankogui (cloche double).
    if (z !== 'corridor' || m === 'dance') {
      if ([0, 3, 6, 8, 10, 13].includes(s)) this.note(s === 0 || s === 8 ? 'belllo' : 'bellhi', t, z === 'court' ? 0.16 : 0.1, { pan: -0.45, verb: 0.15 });
    }
    // Tambour parlant : appels et roulements de fin de phrase.
    const tdCall = z === 'court' || m === 'dance' ? [6, 7, 13, 15] : [13, 15];
    if ((bar % 2 === 1 && tdCall.includes(s)) || (fill && s % 2 === 0)) {
      const bend = s % 4 === 3 ? 0.55 : 0.25;
      const f0 = [160, 190, 150, 210][s % 4];
      this.note(`td${f0}${bend}`, t, 0.5, { pan: 0.2, verb });
    }
    if (fill && s % 2 === 1) this.note(`tom${s}`, t, 0.45, { pan: (s - 12) / 8 });

    // Basse.
    const bn = BASS[s];
    if (bn >= 0 && !(fill && s > 11)) this.note(`bass${chord.root + bn}`, t, 0.6);

    // Balafon : phrases selon la section et la zone.
    let deg = -1;
    if (m === 'dance') deg = -1;
    else if (inside) deg = CORRIDOR_OST[(bar % 2) * 16 + s];
    else {
      const set = section === 0 ? [0, 0, 1, 0] : [2, 1, 2, 3];
      deg = PHRASES[set[Math.floor(bar8 / 2) % 4]][(bar % 2) * 16 + s];
    }
    if (deg >= 0 && !fill) this.note(`bal${SCALE[deg]}`, t, 0.5, { echo: inside ? 0.55 : 0.25, verb, pan: 0.18 });
    // Doublure a l'octave dans la cour (plus lumineux).
    if (deg >= 0 && !fill && z === 'court' && m === 'run') this.note(`bal${SCALE[deg] + 12}`, t, 0.18, { pan: -0.3 });

    // Cuivres : section B dans la rue, et pendant la danse.
    if ((m === 'dance' || (section === 1 && z === 'street')) && (s === 6 || s === 14) && bar % 2 === 0) {
      this.note(`brass${bar % 4}`, t, 0.36, { verb: 0.2 });
    }
    if (inside && s === 0) this.note(`pad${bar % 4}`, t, 0.2, { verb: 0.5 });

    // Couche de tension : arpege pulse.
    if (this.intensity > 0.3 && m === 'run') {
      const n = chord.notes[(s >> 1) % 4] + 12;
      this.note(`arp${n}`, t, 0.2 * this.intensity, { pan: s % 2 ? 0.5 : -0.5 });
    }
    // Danse du robot : melodie a la voix synthetique.
    if (m === 'dance') {
      const d = PHRASES[1][(bar % 2) * 16 + s];
      if (d >= 0) this.note(`rob${SCALE[d]}`, t, 0.32, { echo: 0.3, pan: -0.1 });
    }
    // Montee avant un changement de zone.
    if (this.pendingZone && !this.riserFired && i % 64 === 32) {
      this.riserFired = true;
      this.note('riser', t, 0.4, { verb: 0.3 });
    }
  }

  // ---------------- Ambiances ----------------

  // Boucles d'ambiance par zone et vent de vitesse.
  ambience(on: boolean, zone: SoundZone = this.zone) {
    if (!this.ctx) return;
    this.ambOn = on;
    const t = this.ctx.currentTime;
    for (const k of ['street', 'corridor', 'court', 'wind'] as const) {
      let l = this.ambLoops[k];
      const want = on ? (k === 'wind' ? 0.05 + 0.5 * this.speedK ** 2 : k === zone ? (k === 'corridor' ? 0.8 : 0.9) : 0) : 0;
      if (!l && want > 0) {
        const src = this.ctx.createBufferSource();
        src.buffer = this.b(`amb${k}`);
        src.loop = true;
        const g = this.ctx.createGain();
        g.gain.value = 0;
        src.connect(g).connect(this.ambBus);
        src.start();
        l = this.ambLoops[k] = { src, g };
      }
      l?.g.gain.setTargetAtTime(want, t, 0.6);
    }
  }

  private ambienceEvents() {
    const ctx = this.ctx!;
    if (!this.ambOn || ctx.currentTime < this.nextEvent) return;
    this.nextEvent = ctx.currentTime + 3 + Math.random() * 5;
    const pan = Math.random() * 1.6 - 0.8;
    const z = this.pendingZone ?? this.zone;
    const r = Math.random();
    if (z === 'street') {
      if (r < 0.45) this.play(this.b('moto'), { bus: this.ambBus, gain: 0.9, pan, rate: 0.9 + Math.random() * 0.25 });
      else this.play(this.b('horn'), { bus: this.ambBus, gain: 0.55, pan, rate: 0.9 + Math.random() * 0.2, verb: 0.2 });
    } else if (z === 'corridor') {
      if (r < 0.2) this.play(this.b('schoolbell'), { bus: this.ambBus, gain: 0.5, pan, verb: 0.6 });
    } else if (r < 0.8) {
      this.play(this.b(`bird${Math.floor(Math.random() * 3)}`), { bus: this.ambBus, gain: 0.8, pan, rate: 0.85 + Math.random() * 0.3, verb: 0.2 });
    }
  }

  // ---------------- Bruitages ----------------

  coin() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.coinStep = now - this.coinTime < 0.4 ? (this.coinStep + 1) % 8 : 0;
    this.coinTime = now;
    const m = SCALE[4 + this.coinStep] + 12;
    this.play(this.b(`coin${m}`), { gain: 0.42, pan: 0.1, verb: 0.12 });
  }

  footstep(surface: Surface) {
    this.stepAlt = (this.stepAlt + 1) % 3;
    const b = this.b(`step${surface}${this.stepAlt}`);
    this.play(b, { gain: surface === 'tile' ? 0.3 : 0.26, rate: 0.9 + Math.random() * 0.2, pan: this.stepAlt % 2 ? 0.12 : -0.12, verb: surface === 'tile' ? 0.35 : 0 });
  }

  jump() {
    this.play(this.b('jump'), { gain: 0.5 });
    this.play(this.b('stepasphalt0'), { gain: 0.3 });
  }

  superJump() {
    this.play(this.b('sjump'), { gain: 0.6 });
    this.play(this.b('shimup'), { gain: 0.35 });
  }

  land() {
    this.play(this.b('land'), { gain: 0.5, rate: 0.95 + Math.random() * 0.1 });
  }

  slide() {
    this.play(this.b('slide'), { gain: 0.5 });
    this.play(this.b('slidew'), { gain: 0.3 });
  }

  swish() {
    this.play(this.b('swish'), { gain: 0.36, rate: 0.9 + Math.random() * 0.2 });
  }

  // Virage : grand souffle et crissement de baskets.
  turn(dir: number) {
    this.play(this.b('turnw'), { gain: 0.5, pan: dir * 0.4 });
    this.play(this.b('squeak'), { gain: 0.3, rate: 0.95 + Math.random() * 0.1, pan: dir * 0.3 });
  }

  // Annonce d'un virage (double cloche).
  cornerCue() {
    const b = this.b('bellhi');
    this.play(b, { gain: 0.3, verb: 0.2 });
    if (this.ctx) this.play(b, { gain: 0.3, verb: 0.2, when: this.ctx.currentTime + 0.12, rate: 1.335 });
  }

  stumble() {
    this.play(this.b('stumble'), { gain: 0.75 });
    this.vibrate(60);
  }

  crash() {
    this.play(this.b('crashfx'), { gain: 0.95, verb: 0.25 });
    this.vibrate([90, 40, 140]);
  }

  fall() {
    this.play(this.b('fallw'), { gain: 0.5 });
    if (this.ctx) this.play(this.b('crashfx'), { gain: 0.6, when: this.ctx.currentTime + 0.6, verb: 0.4 });
    this.vibrate([40, 560, 160]);
  }

  powerUp() {
    this.play(this.b('shimup'), { gain: 0.5, verb: 0.3 });
    if (!this.ctx) return;
    [5, 7, 9, 11].forEach((d, k) => this.play(this.b(`bal${SCALE[d]}`), { gain: 0.45, when: this.ctx!.currentTime + k * 0.06, echo: 0.3 }));
  }

  // Pieces du dossier.
  stamp() {
    this.play(this.b('stamp'), { gain: 0.85, verb: 0.2 });
    this.vibrate(25);
  }

  copy() {
    this.play(this.b('copier'), { gain: 0.55 });
    this.play(this.b('uitick'), { gain: 0.3 });
  }

  signature() {
    this.play(this.b('scribble'), { gain: 0.6 });
  }

  shieldUp() {
    this.play(this.b('shimup'), { gain: 0.6, verb: 0.4 });
    this.play(this.b('brass0'), { gain: 0.45, verb: 0.3 });
  }

  shieldBreak() {
    this.play(this.b('glass'), { gain: 0.7, verb: 0.3 });
    this.vibrate(50);
  }

  // Gardien.
  stomp(vol: number) {
    if (vol < 0.03) return;
    this.play(this.b('rstep'), { gain: 0.8 * vol, rate: 0.92 + Math.random() * 0.12 });
  }

  roar() {
    this.play(this.b('roar'), { gain: 0.9, verb: 0.3 });
    this.vibrate(120);
  }

  taunt() {
    this.play(this.b(`chat${Math.floor(Math.random() * 3)}`), { gain: 0.5, verb: 0.2 });
  }

  whistle() {
    this.play(this.b('whistle'), { gain: 0.45 });
  }

  // Projectiles du Gardien.
  projCharge() {
    this.play(this.b('charge'), { gain: 0.5 });
  }

  projLaunch() {
    this.play(this.b('launch'), { gain: 0.7 });
    if (this.ctx) this.play(this.b('flyby'), { gain: 0.55, when: this.ctx.currentTime + 0.1 });
  }

  projImpact(near: number) {
    this.play(this.b('boom'), { gain: 0.35 + 0.55 * near, verb: 0.35 });
    if (near > 0.6) this.vibrate(70);
  }

  // Objets : pli ramasse, lancers, Gardien sonne.
  itemPickup() {
    this.play(this.b('shimup'), { gain: 0.35, rate: 1.3 });
    this.play(this.b('scribble'), { gain: 0.3, rate: 1.6 });
  }

  itemThrow(type: string) {
    if (type === 'turbo') {
      this.superJump();
      return;
    }
    this.play(this.b(type === 'plane' ? 'flyby' : 'swish'), { gain: type === 'plane' ? 0.5 : 0.55, rate: type === 'stamp' ? 0.8 : 1.1 });
  }

  itemHit() {
    this.play(this.b('stumble'), { gain: 0.6, rate: 1.15 });
    this.play(this.b('scribble'), { gain: 0.35 });
  }

  robotBonk() {
    this.play(this.b('stamp'), { gain: 0.9 });
    this.play(this.b('rstep'), { gain: 0.8, rate: 1.4 });
    if (this.ctx) this.play(this.b('chat0'), { gain: 0.4, rate: 0.7, when: this.ctx.currentTime + 0.15 });
  }

  // Debut de defi : coup de sifflet et cuivres.
  raceStart() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.play(this.b('whistle'), { gain: 0.4 });
    [0, 3].forEach((c, k) => this.play(this.b(`brass${c}`), { gain: 0.45, when: t + 0.35 + k * 0.18, verb: 0.3 }));
  }

  raceEnd(win: boolean) {
    if (win) this.newRecord();
    else this.rankChange(false);
  }

  // Depassement (montee) ou perte d'une place.
  rankChange(up: boolean) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (up) {
      [7, 9].forEach((d, k) => this.play(this.b(`bal${SCALE[d]}`), { gain: 0.5, when: t + k * 0.07, echo: 0.2 }));
    } else {
      this.play(this.b('tom13'), { gain: 0.45 });
      this.play(this.b(`bal${SCALE[2]}`), { gain: 0.3, when: t + 0.05 });
    }
  }

  // Interface.
  tick() {
    this.play(this.b('uitick'), { gain: 0.4 });
  }

  countdown(n: number) {
    this.play(this.b(`beep${n > 0 ? 1 : 0}`), { gain: 0.45 });
  }

  // Capture : la musique s'arrete sur une chute, puis le robot danse.
  caught() {
    this.setMode('off');
    this.ambience(false);
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [9, 7, 5, 4, 2, 0].forEach((d, k) => this.play(this.b(`bal${SCALE[d]}`), { gain: 0.5, when: t + 0.15 + k * 0.09, echo: 0.3 }));
    this.play(this.b('crashfx'), { gain: 0.5, when: t + 0.75, verb: 0.5 });
    window.setTimeout(() => {
      if (this.mode === 'off') {
        this.duckMusic(false);
        this.setMode('dance');
      }
    }, 1300);
  }

  newRecord() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [0, 2, 3].forEach((c, k) => this.play(this.b(`brass${c}`), { gain: 0.45, when: t + k * 0.16, verb: 0.3 }));
    this.play(this.b('shimup'), { gain: 0.5, when: t + 0.4 });
  }
}

// WAV muet (1 s, 8 kHz) en data URI, pour l'element <audio> de deverrouillage.
function silentWav(): string {
  const n = 8000;
  const b = new DataView(new ArrayBuffer(44 + n));
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) b.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); b.setUint32(4, 36 + n, true); w(8, 'WAVE'); w(12, 'fmt ');
  b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 1, true);
  b.setUint32(24, 8000, true); b.setUint32(28, 8000, true); b.setUint16(32, 1, true); b.setUint16(34, 8, true);
  w(36, 'data'); b.setUint32(40, n, true);
  for (let i = 0; i < n; i++) b.setUint8(44 + i, 128);
  let s = '';
  const u = new Uint8Array(b.buffer);
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return 'data:audio/wav;base64,' + btoa(s);
}
