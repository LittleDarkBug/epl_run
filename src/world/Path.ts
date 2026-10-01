import * as THREE from 'three';
import { WORLD } from '../config';

// Chemin sinueux facon Temple Run : suite de troncons rectilignes relies par
// des carrefours a angle droit. Coordonnee de piste s = abscisse curviligne.
// Chaque troncon a une zone (rue, couloir, campus) et se termine par un
// virage a gauche (-1) ou a droite (+1).

export type Zone = 'street' | 'corridor' | 'court';

export const L = WORLD.blockLength;
export const J = 7.6; // demi-largeur d'un carrefour (bord des facades)
export const START_S = 4;

export interface Segment {
  i: number;
  s0: number; // debut (coin du carrefour precedent, ou depart)
  s1: number; // coin du carrefour de fin
  ox: number; // position monde a s0
  oz: number;
  dx: number; // direction unitaire (axe x ou z)
  dz: number;
  zone: Zone;
  turn: -1 | 1;
  blocksFrom: number; // s du debut du premier bloc
  nBlocks: number;
  prevTurn: -1 | 1 | 0; // virage du carrefour d'entree (0 au depart)
}

// Enchainement des zones (le depart est une rue, face au campus).
const SCHEDULE: [Zone, number][] = [
  ['street', 5], ['corridor', 4], ['court', 5], ['street', 4], ['corridor', 5], ['court', 4], ['street', 5], ['court', 5],
];

const _c = new THREE.Vector3();
const _p = new THREE.Vector3();

export class Path {
  readonly segs: Segment[] = [];
  private rng: () => number;

  constructor(seed = 1) {
    let s = seed >>> 0;
    this.rng = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
    this.reset();
  }

  reset() {
    this.segs.length = 0;
    const n = 6;
    this.segs.push({
      i: 0, s0: 0, s1: START_S + n * L + J, ox: 0, oz: 0, dx: 0, dz: -1,
      zone: 'street', turn: this.pickTurn(0, -1), blocksFrom: START_S, nBlocks: n, prevTurn: 0,
    });
  }

  // Jamais de retour vers le campus de depart (+z) : pas de boucle possible.
  private pickTurn(dx: number, dz: number): -1 | 1 {
    let t: -1 | 1 = this.rng() < 0.5 ? -1 : 1;
    const nd = turnDir(dx, dz, t);
    if (nd.dz > 0.5) t = (-t) as -1 | 1;
    return t;
  }

  private extend() {
    const p = this.segs[this.segs.length - 1];
    const i = p.i + 1;
    const [zone, n] = SCHEDULE[(i - 1) % SCHEDULE.length];
    const d = turnDir(p.dx, p.dz, p.turn);
    const len = p.s1 - p.s0;
    const seg: Segment = {
      i, s0: p.s1, s1: p.s1 + J + n * L + J,
      ox: p.ox + p.dx * len, oz: p.oz + p.dz * len,
      dx: d.dx, dz: d.dz, zone, turn: this.pickTurn(d.dx, d.dz),
      blocksFrom: p.s1 + J, nBlocks: n, prevTurn: p.turn,
    };
    this.segs.push(seg);
  }

  ensure(s: number) {
    while (this.segs[this.segs.length - 1].s0 < s + WORLD.visibleAhead + 200) this.extend();
  }

  segIndexAt(s: number): number {
    this.ensure(s);
    // Recherche lineaire depuis la fin (peu de troncons actifs).
    for (let k = this.segs.length - 1; k >= 0; k--) if (s >= this.segs[k].s0) return k;
    return 0;
  }

  segAt(s: number): Segment {
    return this.segs[this.segIndexAt(s)];
  }

  zoneAt(s: number): Zone {
    const g = this.segAt(s);
    // Dans un carrefour, on est dehors (zone du troncon exterieur).
    if (g.zone === 'corridor' && (s < g.blocksFrom || s > g.s1 - J)) return this.outdoorNear(g);
    return g.zone;
  }

  // Zone exterieure utilisee pour un carrefour voisin d'un couloir.
  outdoorNear(g: Segment): Zone {
    const n = this.segs[g.i + 1];
    if (n && n.zone !== 'corridor') return n.zone;
    const p = this.segs[g.i - 1];
    return p && p.zone !== 'corridor' ? p.zone : 'street';
  }

  // Position monde (x, z) a l'abscisse s et au decalage lateral lat,
  // sur un troncon donne (prolonge en ligne droite au-dela de ses bornes).
  posOn(seg: Segment, s: number, lat: number, out: THREE.Vector3, y = 0): THREE.Vector3 {
    const t = s - seg.s0;
    // Droite = (-dz, dx).
    return out.set(seg.ox + seg.dx * t - seg.dz * lat, y, seg.oz + seg.dz * t + seg.dx * lat);
  }

  pos(s: number, lat: number, out: THREE.Vector3, y = 0): THREE.Vector3 {
    return this.posOn(this.segAt(s), s, lat, out, y);
  }

  // Passage du troncon i au suivant : (s, lat) exprimes dans le repere du
  // troncon suivant, sans saut de position (virage pris a l'entree du carrefour).
  crossCorner(i: number, s: number, lat: number): [number, number] {
    const seg = this.segs[i], next = this.segs[i + 1];
    const c = this.posOn(seg, seg.s1, 0, _c);
    const p = this.posOn(seg, s, lat, _p);
    const rx = p.x - c.x, rz = p.z - c.z;
    return [next.s0 + next.dx * rx + next.dz * rz, -next.dz * rx + next.dx * rz];
  }

  yawOf(seg: Segment): number {
    return Math.atan2(-seg.dx, -seg.dz);
  }

  yawAt(s: number): number {
    return this.yawOf(this.segAt(s));
  }

  // Vrai si s tombe dans la zone d'un carrefour (avant/apres le coin).
  nearCorner(s: number, before: number, after: number): boolean {
    this.ensure(s + before);
    for (const g of this.segs) {
      if (s >= g.s1 - before && s <= g.s1 + after) return true;
      if (g.s0 > s + before + 50) break;
    }
    return false;
  }
}

export function turnDir(dx: number, dz: number, t: -1 | 1): { dx: number; dz: number } {
  // Droite de (dx, dz) = (-dz, dx) ; gauche = (dz, -dx).
  return t > 0 ? { dx: -dz, dz: dx } : { dx: dz, dz: -dx };
}
