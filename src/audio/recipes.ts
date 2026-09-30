import * as S from './dsp';
import type { Mono } from './dsp';

// Table des sons : chaque cle donne sa fabrique de synthese. Partagee entre le
// moteur audio et le worker qui precalcule les tampons hors du fil principal.

export const CHORDS = [
  { root: 45, notes: [57, 60, 64, 67] }, // Am7
  { root: 41, notes: [57, 60, 64, 65] }, // Fmaj7
  { root: 48, notes: [55, 60, 64, 67] }, // C
  { root: 43, notes: [55, 59, 62, 65] }, // G7
];

// Recette de chaque son a partir de sa cle : [fabrique, diviseur de frequence
// d'echantillonnage (les nappes et ambiances sont calculees a mi-resolution)].
export function recipe(key: string): [(sr: number) => Mono, number] {
  const num = (p: string) => Number(key.slice(p.length));
  const chord = (p: string) => CHORDS[num(p)].notes;
  const fixed: Record<string, (sr: number) => Mono> = {
    kick: S.kick, rim: S.rim, clap: S.clap, crash: S.crash,
    shk: (sr) => S.shaker(sr), shkL: (sr) => S.shaker(sr, true),
    bellhi: (sr) => S.bell(sr, 1560), belllo: (sr) => S.bell(sr, 1040),
    riser: (sr) => S.riser(sr, 4.2),
    uitick: (sr) => S.uiTick(sr), swish: (sr) => S.whoosh(sr, 0.15, 800, 3200, 1.6),
    jump: (sr) => S.whoosh(sr, 0.24, 500, 2600), sjump: (sr) => S.whoosh(sr, 0.5, 300, 4000, 1),
    land: (sr) => S.thud(sr, 130, 0.5, 0.25), slide: (sr) => S.scrape(sr, 0.5), slidew: (sr) => S.whoosh(sr, 0.2, 1200, 400),
    turnw: (sr) => S.whoosh(sr, 0.35, 400, 2400, 1.1), squeak: S.squeak,
    stumble: (sr) => S.impact(sr, false), crashfx: (sr) => S.impact(sr, true), fallw: S.fallWhistle,
    shimup: (sr) => S.shimmer(sr, true), stamp: S.stampHit, copier: S.copier, scribble: S.scribble, glass: S.glass,
    rstep: S.robotStep, roar: S.robotRoar, whistle: S.whistle,
    charge: S.charge, launch: S.launch, flyby: S.flyby, boom: S.explosion,
    beep0: (sr) => S.beep(sr, 1320, 0.3), beep1: (sr) => S.beep(sr, 880, 0.12),
    schoolbell: S.schoolBell, horn: S.horn, moto: S.moto,
  };
  if (fixed[key]) return [fixed[key], 1];
  if (key.startsWith('mpad')) return [(sr) => S.pad(sr, chord('mpad'), 2.7), 2];
  if (key.startsWith('pad')) return [(sr) => S.pad(sr, chord('pad'), 2.5), 2];
  if (key.startsWith('brass')) return [(sr) => S.brass(sr, chord('brass').map((n) => n + 12)), 1];
  if (key.startsWith('amb')) return [(sr) => S.ambience(sr, key.slice(3) as 'street'), 2];
  if (key.startsWith('lbass')) return [(sr) => S.bassNote(sr, num('lbass'), 0.5), 1];
  if (key.startsWith('bass')) return [(sr) => S.bassNote(sr, num('bass')), 1];
  if (key.startsWith('bal')) return [(sr) => S.balafon(sr, num('bal')), 1];
  if (key.startsWith('arp')) return [(sr) => S.arpNote(sr, num('arp')), 1];
  if (key.startsWith('rob')) return [(sr) => S.robotNote(sr, num('rob')), 1];
  if (key.startsWith('coin')) return [(sr) => S.coinTing(sr, num('coin')), 1];
  if (key.startsWith('tom')) return [(sr) => S.tom(sr, 180 - num('tom') * 5), 1];
  if (key.startsWith('chat')) return [S.robotChatter, 1];
  if (key.startsWith('bird')) return [S.bird, 1];
  if (key.startsWith('td')) {
    const f0 = Number(key.slice(2, 5));
    return [(sr) => S.talkingDrum(sr, f0, Number(key.slice(5))), 1];
  }
  if (key.startsWith('step')) {
    const surf = (['asphalt', 'tile', 'dirt'] as const).find((x) => key.startsWith('step' + x))!;
    return [(sr) => S.step(sr, surf), 1];
  }
  throw new Error('Son inconnu : ' + key);
}

