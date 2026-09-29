import * as THREE from 'three';
import { GeoBuilder, mat, UNIT } from '../render/GeoBuilder';
import { Rng, pick, range } from '../core/rng';

// Generateurs de decor urbain facon Lome : maisons pastel, boutiques a auvents,
// immeubles, palmiers, bougainvilliers, lampadaires, etals.

export const ROAD_HALF = 4.5;
export const SIDEWALK_OUT = 7.6;
export const SIDEWALK_Y = 0.2;

const WALLS = ['#e9c46a', '#f4a261', '#e07a5f', '#f2e8cf', '#9ed2d4', '#e5989b', '#a7c957', '#ffd6a5', '#cdb4db', '#f6f0d8', '#ffb4a2', '#bde0fe'];
const SHUTTERS = ['#2a9d8f', '#264653', '#1d3557', '#8d2f23', '#3a5a40', '#6d597a', '#1b6ca8'];
const AWNINGS: [string, string][] = [
  ['#d62828', '#f1faee'], ['#1d4ed8', '#fef3c7'], ['#15803d', '#fef9c3'], ['#f59e0b', '#7c2d12'], ['#7c3aed', '#fde68a'], ['#0e7490', '#ecfeff'],
];
const TRIM = '#f7f3ea';
const GLASS = '#26364a';
const LIT = '#ffc27a';

let frond: THREE.BufferGeometry | null = null;

function frondGeometry(): THREE.BufferGeometry {
  if (frond) return frond;
  const segs = 14;
  const L = 3.3;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const cBase = new THREE.Color('#3f6b22');
  const cTip = new THREE.Color('#9bbf3a');
  const c = new THREE.Color();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const y = 0.75 * t - 1.7 * t * t;
    const z = L * t;
    const w = 0.62 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.08)), 0.65) * (i % 2 ? 0.62 : 1);
    const droop = 0.18 * (w / 0.62);
    c.copy(cBase).lerp(cTip, t);
    pos.push(-w, y - droop, z, 0, y + 0.03, z, w, y - droop, z);
    for (let k = 0; k < 3; k++) col.push(c.r * (k === 1 ? 0.8 : 1), c.g * (k === 1 ? 0.85 : 1), c.b);
  }
  for (let i = 0; i < segs; i++) {
    const a = i * 3;
    const b = (i + 1) * 3;
    idx.push(a, b, a + 1, a + 1, b, b + 1, a + 1, b + 1, a + 2, a + 2, b + 1, b + 2);
  }
  // Face arriere.
  const n = pos.length / 3;
  const back = idx.slice();
  for (let i = 0; i < back.length; i += 3) idx.push(back[i] + n, back[i + 2] + n, back[i + 1] + n);
  pos.push(...pos.slice(0, n * 3));
  col.push(...col.slice(0, n * 3));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Normales orientees vers le haut pour un eclairage doux du feuillage.
  const N = g.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < N.count; i++) {
    const ny = Math.abs(N.getY(i)) * 0.6 + 0.5;
    N.setXYZ(i, N.getX(i) * 0.5, ny, N.getZ(i) * 0.5);
  }
  frond = g;
  return g;
}

export function addPalm(b: GeoBuilder, x: number, y: number, z: number, h: number, r: Rng) {
  const lean = range(r, -0.22, 0.22);
  const leanZ = range(r, -0.15, 0.15);
  const segs = 7;
  let px = x, py = y, pz = z;
  for (let i = 0; i < segs; i++) {
    const t = i / segs;
    const sh = h / segs;
    const rad = 0.22 - t * 0.07;
    const dx = Math.sin(lean) * sh * (0.4 + t * 1.2);
    const dz = Math.sin(leanZ) * sh * (0.4 + t * 1.2);
    const ang = Math.atan2(Math.hypot(dx, dz), sh);
    const yaw = Math.atan2(dx, dz);
    const m = mat(px + dx / 2, py + sh / 2, pz + dz / 2, 0, 0, 0, 1, 1, 1);
    const rot = new THREE.Matrix4().makeRotationY(yaw).multiply(new THREE.Matrix4().makeRotationX(ang));
    const final = new THREE.Matrix4().makeTranslation(m.elements[12], m.elements[13], m.elements[14])
      .multiply(rot).multiply(new THREE.Matrix4().makeScale(rad * 2, sh * 1.02, rad * 2));
    b.add(UNIT.cylLow, final, i % 2 ? '#8a6a4a' : '#7a5c3e', { r: 0.95 });
    // Anneau d'ecorce.
    const ring = new THREE.Matrix4().makeTranslation(px + dx, py + sh, pz + dz).multiply(new THREE.Matrix4().makeScale(rad * 2.3, 0.08, rad * 2.3));
    b.add(UNIT.cylLow, ring, '#5e4630', { r: 1 });
    px += dx; py += sh; pz += dz;
  }
  // Noix de coco.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + r();
    b.add(UNIT.sphereLow, mat(px + Math.cos(a) * 0.2, py - 0.2, pz + Math.sin(a) * 0.2, 0, 0, 0, 0.26, 0.28, 0.26), '#5b4a1c', { r: 0.6 });
  }
  const fg = frondGeometry();
  const count = 11;
  for (let i = 0; i < count; i++) {
    const yaw = (i / count) * Math.PI * 2 + range(r, -0.2, 0.2);
    const tilt = range(r, -0.35, 0.25) + (i % 2 ? 0.15 : -0.1);
    const s = range(r, 0.8, 1.1);
    const m = new THREE.Matrix4().makeTranslation(px, py, pz)
      .multiply(new THREE.Matrix4().makeRotationY(yaw))
      .multiply(new THREE.Matrix4().makeRotationX(tilt))
      .multiply(new THREE.Matrix4().makeScale(s, s, s));
    b.add(fg, m, i % 3 === 0 ? '#c9d88a' : '#ffffff', { r: 0.7 });
  }
}

export function addBush(b: GeoBuilder, x: number, y: number, z: number, s: number, r: Rng, flowers = true) {
  const leaf = pick(r, ['#2f6b2c', '#3d7a2a', '#2b5d33']);
  for (let i = 0; i < 5; i++) {
    const ox = range(r, -0.5, 0.5) * s, oz = range(r, -0.5, 0.5) * s, oy = range(r, 0, 0.35) * s;
    const sc = range(r, 0.55, 0.9) * s;
    b.add(UNIT.sphereLow, mat(x + ox, y + oy + sc * 0.4, z + oz, r(), r(), 0, sc, sc * 0.8, sc), leaf, { r: 0.85 });
  }
  if (!flowers) return;
  const fc = pick(r, ['#e0218a', '#ff3d9a', '#c2185b', '#ff7ab6', '#f5f5f5']);
  for (let i = 0; i < 9; i++) {
    const ox = range(r, -0.6, 0.6) * s, oz = range(r, -0.6, 0.6) * s, oy = range(r, 0.35, 0.8) * s;
    const sc = range(r, 0.2, 0.36) * s;
    b.add(UNIT.sphereLow, mat(x + ox, y + oy, z + oz, 0, 0, 0, sc, sc, sc), fc, { r: 0.6, e: 0.08 });
  }
}

export function addLamp(b: GeoBuilder, side: number, z: number) {
  const x = side * (ROAD_HALF + 0.55);
  const H = 6.6;
  b.add(UNIT.cylLow, mat(x, SIDEWALK_Y + 0.3, z, 0, 0, 0, 0.34, 0.6, 0.34), '#3b4148', { r: 0.5, m: 0.6 });
  b.add(UNIT.cylLow, mat(x, SIDEWALK_Y + H / 2, z, 0, 0, 0, 0.14, H, 0.14), '#4a525c', { r: 0.45, m: 0.7 });
  const armLen = 1.6;
  b.add(UNIT.box, mat(x - side * armLen / 2, SIDEWALK_Y + H - 0.05, z, 0, 0, side * 0.12, armLen, 0.08, 0.1), '#4a525c', { r: 0.45, m: 0.7 });
  b.add(UNIT.rbox, mat(x - side * armLen, SIDEWALK_Y + H - 0.2, z, 0, 0, 0, 0.7, 0.16, 0.34), '#2d3238', { r: 0.4, m: 0.6 });
  b.add(UNIT.box, mat(x - side * armLen, SIDEWALK_Y + H - 0.3, z, 0, 0, 0, 0.56, 0.05, 0.24), '#ffd9a0', { e: 5.5, r: 0.3 });
}

export function addCurb(b: GeoBuilder, side: number, z0: number, z1: number) {
  const x = side * (ROAD_HALF + 0.12);
  const seg = 1.2;
  let i = 0;
  for (let z = z0; z > z1 + 0.01; z -= seg, i++) {
    const zc = z - seg / 2;
    b.add(UNIT.box, mat(x, SIDEWALK_Y / 2 + 0.02, zc, 0, 0, 0, 0.26, SIDEWALK_Y + 0.04, seg * 0.98), i % 2 ? '#1c1c1c' : '#ecebe6', { r: 0.8 });
  }
}

interface Facade {
  b: GeoBuilder;
  side: number;
  xf: number; // x de la facade (cote route)
  z0: number; // debut (proche)
  len: number;
  r: Rng;
}

// Fenetre sur la facade cote route.
function window_(f: Facade, zc: number, y: number, w: number, h: number, shutter: string | null, lit: boolean) {
  const { b, side, xf } = f;
  const out = -side;
  b.add(UNIT.box, mat(xf + out * 0.03, y, zc, 0, 0, 0, 0.08, h + 0.16, w + 0.16), TRIM, { r: 0.7 });
  b.add(UNIT.box, mat(xf + out * 0.06, y, zc, 0, 0, 0, 0.06, h, w), lit ? LIT : GLASS, lit ? { e: 1.6, r: 0.4 } : { r: 0.08, m: 0.4 });
  // Croisillon.
  b.add(UNIT.box, mat(xf + out * 0.1, y, zc, 0, 0, 0, 0.03, h, 0.05), TRIM, { r: 0.7 });
  b.add(UNIT.box, mat(xf + out * 0.12, y - h / 2 - 0.1, zc, 0, 0, 0, 0.2, 0.08, w + 0.3), TRIM, { r: 0.7 });
  if (shutter) {
    for (const s of [-1, 1]) {
      b.add(UNIT.box, mat(xf + out * 0.08, y, zc + s * (w / 2 + 0.3), 0, 0, 0, 0.06, h + 0.1, 0.5), shutter, { r: 0.6 });
    }
  }
}

function roofTank(b: GeoBuilder, x: number, y: number, z: number) {
  b.add(UNIT.cyl, mat(x, y + 0.65, z, 0, 0, 0, 1.1, 1.3, 1.1), '#1d1d1f', { r: 0.4 });
  b.add(UNIT.cyl, mat(x, y + 1.33, z, 0, 0, 0, 0.5, 0.1, 0.5), '#1d1d1f', { r: 0.4 });
  b.add(UNIT.box, mat(x, y + 0.05, z, 0, 0, 0, 1.3, 0.1, 1.3), '#6b6b6b', { r: 0.9 });
}

function acUnit(b: GeoBuilder, x: number, y: number, z: number, side: number) {
  b.add(UNIT.rbox, mat(x - side * 0.25, y, z, 0, 0, 0, 0.5, 0.55, 0.8), '#d8d8d4', { r: 0.5, m: 0.1 });
  b.add(UNIT.cyl, mat(x - side * 0.51, y, z, 0, 0, Math.PI / 2, 0.42, 0.02, 0.42), '#555a60', { r: 0.4, m: 0.5 });
}

// Maison pastel a 2-3 niveaux avec balcon.
function housePastel(f: Facade) {
  const { b, side, xf, z0, len, r } = f;
  const floors = 2 + Math.floor(r() * 2);
  const fh = 3.2;
  const H = floors * fh + 0.6;
  const depth = range(r, 7, 10);
  const wall = pick(r, WALLS);
  const shutter = pick(r, SHUTTERS);
  const zc = z0 - len / 2;
  const xc = xf + side * depth / 2;
  b.add(UNIT.box, mat(xc, SIDEWALK_Y + H / 2, zc, 0, 0, 0, depth, H, len - 0.1), wall, { r: 0.92 });
  // Soubassement.
  b.add(UNIT.box, mat(xf - side * 0.05 + side * 0.0, SIDEWALK_Y + 0.45, zc, 0, 0, 0, 0.12, 0.9, len - 0.1), '#8c6b52', { r: 0.95 });
  // Bandeaux d'etage et corniche.
  for (let i = 1; i <= floors; i++) {
    b.add(UNIT.box, mat(xf - side * 0.08, SIDEWALK_Y + i * fh, zc, 0, 0, 0, 0.18, 0.18, len), TRIM, { r: 0.75 });
  }
  b.add(UNIT.box, mat(xc - side * 0.1, SIDEWALK_Y + H + 0.3, zc, 0, 0, 0, depth + 0.3, 0.6, len + 0.1), TRIM, { r: 0.75 });
  // Chainages d'angle.
  for (const e of [z0 - 0.15, z0 - len + 0.15]) {
    b.add(UNIT.box, mat(xf - side * 0.06, SIDEWALK_Y + H / 2, e, 0, 0, 0, 0.14, H, 0.34), TRIM, { r: 0.75 });
  }
  const nWin = Math.max(1, Math.floor(len / 2.6));
  for (let fl = 0; fl < floors; fl++) {
    const y = SIDEWALK_Y + fl * fh + 1.7;
    for (let i = 0; i < nWin; i++) {
      const wz = z0 - (i + 0.5) * (len / nWin);
      if (fl === 0 && i === Math.floor(nWin / 2)) {
        // Porte d'entree.
        b.add(UNIT.box, mat(xf - side * 0.05, SIDEWALK_Y + 1.15, wz, 0, 0, 0, 0.1, 2.3, 1.2), shutter, { r: 0.55 });
        b.add(UNIT.box, mat(xf - side * 0.08, SIDEWALK_Y + 2.4, wz, 0, 0, 0, 0.14, 0.14, 1.5), TRIM, { r: 0.7 });
        continue;
      }
      window_(f, wz, y, 1.0, 1.35, r() < 0.7 ? shutter : null, r() < 0.28);
    }
    // Balcon.
    if (fl >= 1 && r() < 0.55) {
      const bl = Math.min(len - 1.2, range(r, 2.5, 5));
      const bz = z0 - len / 2 + range(r, -1, 1);
      const by = SIDEWALK_Y + fl * fh + 0.05;
      b.add(UNIT.box, mat(xf - side * 0.6, by, bz, 0, 0, 0, 1.2, 0.16, bl), TRIM, { r: 0.7 });
      const rail = pick(r, ['#1f2933', '#f7f3ea', shutter]);
      b.add(UNIT.box, mat(xf - side * 1.17, by + 0.95, bz, 0, 0, 0, 0.06, 0.06, bl), rail, { r: 0.5, m: 0.3 });
      const n = Math.max(2, Math.floor(bl / 0.5));
      for (let k = 0; k <= n; k++) {
        b.add(UNIT.box, mat(xf - side * 1.17, by + 0.5, bz - bl / 2 + k * (bl / n), 0, 0, 0, 0.06, 0.9, 0.06), rail, { r: 0.5, m: 0.3 });
      }
      b.add(UNIT.box, mat(xf - side * 1.17, by + 0.35, bz, 0, 0, 0, 0.05, 0.05, bl), rail, { r: 0.5, m: 0.3 });
      if (r() < 0.6) addBush(b, xf - side * 0.8, by + 0.1, bz - bl / 2 + 0.4, 0.6, r);
    }
  }
  if (r() < 0.7) roofTank(b, xc + side * range(r, -1, 1.5), SIDEWALK_Y + H + 0.6, zc + range(r, -len / 4, len / 4));
  if (r() < 0.5) acUnit(b, xf, SIDEWALK_Y + fh + 1.6, z0 - range(r, 0.6, len - 0.6), side);
}

// Boutique au rez-de-chaussee avec auvent raye, etage en retrait.
function shopHouse(f: Facade) {
  const { b, side, xf, z0, len, r } = f;
  const floors = 1 + Math.floor(r() * 2);
  const fh = 3.3;
  const H = floors * fh + 0.5;
  const depth = range(r, 7, 9);
  const wall = pick(r, WALLS);
  const zc = z0 - len / 2;
  const xc = xf + side * depth / 2;
  b.add(UNIT.box, mat(xc, SIDEWALK_Y + H / 2, zc, 0, 0, 0, depth, H, len - 0.1), wall, { r: 0.9 });
  b.add(UNIT.box, mat(xc - side * 0.1, SIDEWALK_Y + H + 0.2, zc, 0, 0, 0, depth + 0.2, 0.4, len), TRIM, { r: 0.8 });
  // Vitrine / rideau metallique.
  const open = r() < 0.6;
  const sw = len - 1.2;
  b.add(UNIT.box, mat(xf - side * 0.02, SIDEWALK_Y + 1.35, zc, 0, 0, 0, 0.1, 2.7, sw), open ? '#3a2a1c' : '#9aa0a6', open ? { r: 0.9 } : { r: 0.35, m: 0.8 });
  if (open) {
    // Interieur eclaire et marchandises colorees.
    b.add(UNIT.box, mat(xf + side * 0.02, SIDEWALK_Y + 2.45, zc, 0, 0, 0, 0.06, 0.12, sw - 0.3), '#fff1d6', { e: 3.5, r: 0.5 });
    for (let k = 0; k < 10; k++) {
      const c = pick(r, ['#e63946', '#f1c40f', '#2a9d8f', '#3a86ff', '#ff006e', '#fb8500', '#8338ec']);
      b.add(UNIT.box, mat(xf + side * 0.2, SIDEWALK_Y + 0.4 + (k % 3) * 0.6, zc - sw / 2 + 0.4 + (k * 0.37) % (sw - 0.8), 0, 0, 0, 0.3, 0.45, 0.35), c, { r: 0.6 });
    }
  } else {
    for (let k = 0; k < 6; k++) {
      b.add(UNIT.box, mat(xf - side * 0.08, SIDEWALK_Y + 0.3 + k * 0.42, zc, 0, 0, 0, 0.04, 0.06, sw), '#7d848a', { r: 0.45, m: 0.6 });
    }
  }
  // Enseigne peinte.
  const sign = pick(r, ['#1d4ed8', '#b91c1c', '#047857', '#f59e0b', '#111827', '#7c3aed']);
  b.add(UNIT.rbox, mat(xf - side * 0.1, SIDEWALK_Y + 3.0, zc, 0, 0, 0, 0.12, 0.62, sw * 0.9), sign, { r: 0.5 });
  b.add(UNIT.box, mat(xf - side * 0.17, SIDEWALK_Y + 3.0, zc, 0, 0, 0, 0.02, 0.22, sw * 0.6), '#fefae0', { r: 0.5, e: 0.4 });
  // Auvent raye incline.
  const [ca, cb] = pick(r, AWNINGS);
  const n = Math.max(4, Math.floor(sw / 0.55));
  const aw = 1.7;
  for (let k = 0; k < n; k++) {
    const z = z0 - 0.6 - (k + 0.5) * (sw / n);
    b.add(UNIT.box, mat(xf - side * aw / 2, SIDEWALK_Y + 2.95, z, 0, 0, side * 0.32, aw, 0.05, sw / n), k % 2 ? ca : cb, { r: 0.85 });
  }
  b.add(UNIT.box, mat(xf - side * (aw - 0.02), SIDEWALK_Y + 2.62, zc, 0, 0, 0, 0.04, 0.22, sw), ca, { r: 0.85 });
  for (let fl = 1; fl < floors; fl++) {
    const nWin = Math.max(1, Math.floor(len / 2.6));
    for (let i = 0; i < nWin; i++) {
      window_(f, z0 - (i + 0.5) * (len / nWin), SIDEWALK_Y + fl * fh + 1.7, 1.1, 1.3, r() < 0.5 ? pick(r, SHUTTERS) : null, r() < 0.3);
    }
  }
  if (r() < 0.5) roofTank(b, xc, SIDEWALK_Y + H + 0.4, zc);
}

// Immeuble moderne : bandeaux vitres, pare-soleil en beton.
function tower(f: Facade) {
  const { b, side, xf, z0, len, r } = f;
  const floors = 4 + Math.floor(r() * 4);
  const fh = 3.1;
  const H = floors * fh + 0.6;
  const depth = range(r, 10, 14);
  const wall = pick(r, ['#e8e4da', '#d9d3c7', '#c9d6df', '#f0e6d2', '#d4c3a8']);
  const zc = z0 - len / 2;
  const xc = xf + side * (depth / 2 + 0.6);
  const xface = xf + side * 0.6;
  b.add(UNIT.box, mat(xc, SIDEWALK_Y + H / 2, zc, 0, 0, 0, depth, H, len - 0.2), wall, { r: 0.85 });
  for (let fl = 0; fl < floors; fl++) {
    const y = SIDEWALK_Y + fl * fh;
    const glassLit = r() < 0.35;
    b.add(UNIT.box, mat(xface - side * 0.02, y + 1.75, zc, 0, 0, 0, 0.06, 1.9, len - 1.4), glassLit ? '#ffc98a' : '#2d4460', glassLit ? { e: 1.1, r: 0.3 } : { r: 0.06, m: 0.55 });
    // Meneaux.
    const nm = Math.floor((len - 1.4) / 1.5);
    for (let k = 0; k <= nm; k++) {
      b.add(UNIT.box, mat(xface - side * 0.07, y + 1.75, zc - (len - 1.4) / 2 + k * ((len - 1.4) / nm), 0, 0, 0, 0.06, 1.9, 0.07), '#30343a', { r: 0.4, m: 0.7 });
    }
    b.add(UNIT.box, mat(xface - side * 0.35, y + 0.5, zc, 0, 0, 0, 0.7, 0.25, len - 0.2), wall, { r: 0.85 });
    if (fl > 0 && r() < 0.4) acUnit(b, xface, y + 0.95, z0 - range(r, 0.8, len - 0.8), side);
  }
  b.add(UNIT.box, mat(xc - side * 0.2, SIDEWALK_Y + H + 0.25, zc, 0, 0, 0, depth + 0.4, 0.5, len), '#b8b2a6', { r: 0.8 });
  // Antenne / enseigne lumineuse sur le toit.
  if (r() < 0.5) {
    b.add(UNIT.cylLow, mat(xc, SIDEWALK_Y + H + 2.5, zc, 0, 0, 0, 0.08, 4.5, 0.08), '#606770', { m: 0.8, r: 0.4 });
    b.add(UNIT.sphereLow, mat(xc, SIDEWALK_Y + H + 4.8, zc, 0, 0, 0, 0.2, 0.2, 0.2), '#ff3b30', { e: 6 });
  }
  // Pilotis au rez-de-chaussee.
  for (let k = 0; k < 3; k++) {
    b.add(UNIT.box, mat(xf + side * 0.3, SIDEWALK_Y + 1.5, z0 - 0.5 - k * ((len - 1) / 2), 0, 0, 0, 0.4, 3, 0.4), wall, { r: 0.85 });
  }
}

// Mur de cloture avec portail, bougainvilliers et palmier.
function compound(f: Facade) {
  const { b, side, xf, z0, len, r } = f;
  const wall = pick(r, ['#f2e8cf', '#e9c46a', '#e07a5f', '#ffd6a5', '#f6f0d8']);
  const zc = z0 - len / 2;
  const H = 2.3;
  b.add(UNIT.box, mat(xf + side * 0.15, SIDEWALK_Y + H / 2, zc, 0, 0, 0, 0.3, H, len - 0.1), wall, { r: 0.92 });
  b.add(UNIT.box, mat(xf + side * 0.15, SIDEWALK_Y + H + 0.06, zc, 0, 0, 0, 0.42, 0.12, len), TRIM, { r: 0.8 });
  // Piliers.
  for (let z = z0 - 0.2; z > z0 - len; z -= 3) {
    b.add(UNIT.box, mat(xf + side * 0.15, SIDEWALK_Y + H / 2 + 0.15, z, 0, 0, 0, 0.5, H + 0.3, 0.5), TRIM, { r: 0.8 });
  }
  // Portail metallique.
  if (len > 6) {
    const gz = zc + range(r, -1, 1);
    b.add(UNIT.box, mat(xf + side * 0.1, SIDEWALK_Y + 1.1, gz, 0, 0, 0, 0.12, 2.2, 2.6), pick(r, SHUTTERS), { r: 0.45, m: 0.6 });
  }
  // Petite maison derriere.
  const hx = xf + side * range(r, 5, 7);
  const hw = range(r, 5, 7);
  b.add(UNIT.box, mat(hx, SIDEWALK_Y + 2.2, zc, 0, 0, 0, hw, 4.4, len * 0.7), pick(r, WALLS), { r: 0.9 });
  // Toit en tole ondulee.
  const roofC = pick(r, ['#9c4a2f', '#7d8a8f', '#a0522d', '#5d6d7e']);
  for (const s of [-1, 1]) {
    b.add(UNIT.box, mat(hx + s * hw / 4, SIDEWALK_Y + 4.8, zc, 0, 0, s * -0.32, hw / 2 + 0.6, 0.08, len * 0.7 + 0.6), roofC, { r: 0.5, m: 0.5 });
  }
  for (let i = 0; i < 3; i++) addBush(b, xf + side * range(r, 0.3, 0.8), SIDEWALK_Y + H - 0.3, z0 - range(r, 0.8, len - 0.8), range(r, 0.8, 1.3), r);
  if (r() < 0.8) addPalm(b, xf + side * range(r, 2, 3.5), SIDEWALK_Y, zc + range(r, -2, 2), range(r, 6.5, 9), r);
}

export type BuildingKind = 'pastel' | 'shop' | 'tower' | 'compound';

export function addBuilding(b: GeoBuilder, side: number, z0: number, len: number, r: Rng, kind?: BuildingKind) {
  const f: Facade = { b, side, xf: side * SIDEWALK_OUT, z0, len, r };
  const k = kind ?? pick(r, ['pastel', 'pastel', 'shop', 'shop', 'tower', 'compound'] as BuildingKind[]);
  if (k === 'pastel') housePastel(f);
  else if (k === 'shop') shopHouse(f);
  else if (k === 'tower') tower(f);
  else compound(f);
}

// Petit etal de marche avec parasol.
export function addStall(b: GeoBuilder, side: number, z: number, r: Rng) {
  const x = side * (ROAD_HALF + 1.9);
  b.add(UNIT.box, mat(x, SIDEWALK_Y + 0.8, z, 0, 0, 0, 1.1, 0.08, 1.8), '#8b5a2b', { r: 0.9 });
  for (const dz of [-0.8, 0.8]) for (const dx of [-0.45, 0.45]) {
    b.add(UNIT.box, mat(x + dx, SIDEWALK_Y + 0.4, z + dz, 0, 0, 0, 0.06, 0.8, 0.06), '#5a3a1a', { r: 0.9 });
  }
  const fruits = ['#f4a300', '#e63946', '#7cb518', '#ffb703', '#fb8500'];
  for (let i = 0; i < 12; i++) {
    b.add(UNIT.sphereLow, mat(x + range(r, -0.4, 0.4), SIDEWALK_Y + 0.93, z + range(r, -0.75, 0.75), 0, 0, 0, 0.2, 0.18, 0.2), pick(r, fruits), { r: 0.5 });
  }
  const [ca, cb] = pick(r, AWNINGS);
  b.add(UNIT.cylLow, mat(x, SIDEWALK_Y + 1.5, z, 0, 0, 0, 0.05, 3, 0.05), '#ddd', { r: 0.4, m: 0.5 });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const m = new THREE.Matrix4().makeTranslation(x, SIDEWALK_Y + 2.85, z)
      .multiply(new THREE.Matrix4().makeRotationY(a))
      .multiply(new THREE.Matrix4().makeRotationX(0.35))
      .multiply(new THREE.Matrix4().makeTranslation(0, 0, 0.7))
      .multiply(new THREE.Matrix4().makeScale(0.58, 0.04, 1.4));
    b.add(UNIT.box, m, i % 2 ? ca : cb, { r: 0.85 });
  }
}

// Poubelle, borne, banc.
export function addStreetBits(b: GeoBuilder, side: number, z: number, r: Rng) {
  const x = side * (ROAD_HALF + range(r, 0.8, 2.6));
  const t = r();
  if (t < 0.35) {
    b.add(UNIT.cyl, mat(x, SIDEWALK_Y + 0.45, z, 0, 0, 0, 0.55, 0.9, 0.55), pick(r, ['#2e7d32', '#1565c0', '#ef6c00']), { r: 0.45, m: 0.2 });
  } else if (t < 0.7) {
    b.add(UNIT.box, mat(x, SIDEWALK_Y + 0.45, z, 0, 0, 0, 0.5, 0.08, 1.8), '#8d6e63', { r: 0.8 });
    b.add(UNIT.box, mat(x + side * 0.22, SIDEWALK_Y + 0.75, z, 0, 0, 0, 0.06, 0.5, 1.8), '#8d6e63', { r: 0.8 });
    for (const dz of [-0.75, 0.75]) b.add(UNIT.box, mat(x, SIDEWALK_Y + 0.22, z + dz, 0, 0, 0, 0.45, 0.44, 0.08), '#37474f', { r: 0.4, m: 0.6 });
  } else {
    // Moto garee.
    const c = pick(r, ['#c62828', '#1e1e1e', '#1565c0', '#e0e0e0']);
    for (const dz of [-0.6, 0.6]) b.add(UNIT.torus, mat(x, SIDEWALK_Y + 0.33, z + dz, 0, Math.PI / 2, 0, 0.55, 0.55, 0.55), '#161616', { r: 0.7 });
    b.add(UNIT.rbox, mat(x, SIDEWALK_Y + 0.6, z, 0, 0, 0, 0.3, 0.35, 1.0), c, { r: 0.3, m: 0.4 });
    b.add(UNIT.rbox, mat(x, SIDEWALK_Y + 0.82, z + 0.15, 0, 0, 0, 0.3, 0.12, 0.7), '#222', { r: 0.6 });
    b.add(UNIT.box, mat(x, SIDEWALK_Y + 1.0, z - 0.55, 0, 0, 0, 0.7, 0.04, 0.04), '#999', { r: 0.3, m: 0.9 });
  }
}

// ---------------- Elements inspires du vrai campus de l'UL / EPL ----------------

export const EPL_YELLOW = '#e2bd57';
export const EPL_YELLOW_D = '#c9a444';
export const EPL_GREYBLUE = '#aeb9c8';
export const EPL_TEAL = '#2f8fc7';

// Applique une matrice de base a chaque ajout (repere local).
function local(b: GeoBuilder, base: THREE.Matrix4) {
  return (g: THREE.BufferGeometry, m: THREE.Matrix4, c: THREE.ColorRepresentation, p = {}) => b.add(g, base.clone().multiply(m), c, p);
}

// Aile de batiment de l'EPL : deux niveaux, poteaux clairs, fenetres a
// barreaux, auvents jaunes inclines. Repere local : facade le long de +x
// (de 0 a len), tournee vers -z, profondeur vers +z.
export function addEplWing(b: GeoBuilder, base: THREE.Matrix4, len: number, r: Rng, floors = 2) {
  const add = local(b, base);
  const fh = 3.6;
  const depth = 11;
  const H = floors * fh;
  // Mur de fond en retrait de 35 cm : les ouvertures a barreaux ont de la profondeur.
  add(UNIT.box, mat(len / 2, H / 2, depth / 2 + 0.35, 0, 0, 0, len, H, depth - 0.7), EPL_YELLOW, { r: 0.9 });
  // Toiture en tole.
  add(UNIT.box, mat(len / 2, H + 0.25, depth / 2, 0, 0, 0, len + 0.8, 0.3, depth + 1.6), '#8f969e', { r: 0.45, m: 0.6 });
  add(UNIT.box, mat(len / 2, H + 0.05, -0.1, 0, 0, 0, len + 0.8, 0.35, 0.3), EPL_YELLOW_D, { r: 0.8 });
  const bay = 4;
  const nb = Math.max(1, Math.round(len / bay));
  const bw = len / nb;
  for (let f = 0; f < floors; f++) {
    const y0 = f * fh;
    // Bandeau de plancher.
    add(UNIT.box, mat(len / 2, y0 + 0.5, -0.12, 0, 0, 0, len, 1.0, 0.24), EPL_YELLOW, { r: 0.85 });
    for (let i = 0; i < nb; i++) {
      const x0 = i * bw;
      // Ouverture a barreaux avec interieur sombre ou bache bleue.
      const inside = r() < 0.35 ? '#2553a8' : '#252c36';
      add(UNIT.box, mat(x0 + bw / 2, y0 + 2.05, 0.36, 0, 0, 0, bw - 0.1, 2.1, 0.02), inside, { r: 0.7 });
      // Allege pleine sous l'ouverture.
      add(UNIT.box, mat(x0 + bw / 2, y0 + 0.5, 0.15, 0, 0, 0, bw, 1.0, 0.3), EPL_YELLOW, { r: 0.9 });
      const nbar = Math.max(3, Math.round((bw - 0.4) / 0.42));
      for (let k = 1; k < nbar; k++) {
        add(UNIT.box, mat(x0 + 0.2 + k * ((bw - 0.4) / nbar), y0 + 2.05, 0.02, 0, 0, 0, 0.05, 2.1, 0.05), '#3b3f45', { r: 0.45, m: 0.6 });
      }
      for (const yy of [y0 + 1.05, y0 + 3.08]) add(UNIT.box, mat(x0 + bw / 2, yy, 0.02, 0, 0, 0, bw - 0.3, 0.06, 0.06), '#3b3f45', { r: 0.45, m: 0.6 });
      // Dessous de la travee (plafond de l'ouverture).
      add(UNIT.box, mat(x0 + bw / 2, y0 + 3.2, 0.18, 0, 0, 0, bw, 0.2, 0.36), EPL_YELLOW_D, { r: 0.9 });
      // Auvent jaune incline au-dessus de chaque travee.
      add(UNIT.box, mat(x0 + bw / 2, y0 + 3.35, -0.55, -0.42, 0, 0, bw - 0.1, 0.07, 1.25), EPL_YELLOW, { r: 0.75 });
      add(UNIT.box, mat(x0 + bw / 2, y0 + 3.1, -1.12, 0, 0, 0, bw - 0.1, 0.12, 0.05), EPL_YELLOW_D, { r: 0.75 });
    }
    // Poteaux clairs.
    for (let i = 0; i <= nb; i++) add(UNIT.box, mat(i * bw, y0 + fh / 2, -0.2, 0, 0, 0, 0.36, fh, 0.36), '#d8d8d4', { r: 0.8 });
  }
  // Rives bleues aux extremites.
  for (const x of [0.1, len - 0.1]) add(UNIT.box, mat(x, H / 2, -0.25, 0, 0, 0, 0.25, H, 0.2), EPL_TEAL, { r: 0.6 });
}

// Grand arbre d'ombrage (neem, cailcedrat) au houppier large et irregulier.
export function addShadeTree(b: GeoBuilder, x: number, y: number, z: number, r: Rng, scale = 1) {
  const h = range(r, 4, 6) * scale;
  const lean = range(r, -0.12, 0.12);
  b.add(UNIT.cylLow, mat(x, y + h / 2, z, 0, 0, lean, 0.55 * scale, h, 0.55 * scale), '#6b4a36', { r: 0.95 });
  const top = new THREE.Vector3(x - Math.sin(lean) * h, y + h, z);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + r();
    b.add(UNIT.cylLow, mat(top.x + Math.cos(a) * 0.9 * scale, top.y + 0.7 * scale, top.z + Math.sin(a) * 0.9 * scale, Math.sin(a) * 0.7, 0, -Math.cos(a) * 0.7, 0.22 * scale, 2.2 * scale, 0.22 * scale), '#5e4230', { r: 0.95 });
  }
  const greens = ['#2f5e27', '#3b6f2c', '#467d31', '#2a5423', '#55883a'];
  const n = 22;
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 3.6 * scale;
    const s = range(r, 1.3, 2.3) * scale;
    b.add(UNIT.sphereLow, mat(top.x + Math.cos(a) * d, top.y + 1.6 * scale + range(r, -0.6, 1.2) * scale - d * 0.15, top.z + Math.sin(a) * d, r(), r(), 0, s, s * 0.75, s), pick(r, greens), { r: 0.85 });
  }
}

// Voiture garee (vue de l'arriere dans le sens de la course).
export function addCar(b: GeoBuilder, base: THREE.Matrix4, color: string) {
  const add = local(b, base);
  const glass = '#1b2430';
  add(UNIT.rboxSoft, mat(0, 0.72, 0, 0, 0, 0, 1.8, 0.72, 4.3), color, { r: 0.22, m: 0.55 });
  add(UNIT.rboxSoft, mat(0, 1.28, 0.1, 0, 0, 0, 1.56, 0.62, 2.3), color, { r: 0.22, m: 0.55 });
  add(UNIT.box, mat(0, 1.3, 0.1, 0, 0, 0, 1.6, 0.44, 2.0), glass, { r: 0.05, m: 0.6 });
  add(UNIT.box, mat(0, 1.25, 1.2, -0.5, 0, 0, 1.4, 0.5, 0.05), glass, { r: 0.05, m: 0.6 });
  for (const s of [-1, 1]) {
    add(UNIT.box, mat(s * 0.7, 0.88, 2.14, 0, 0, 0, 0.34, 0.16, 0.04), '#ff2a2a', { e: 2.5, r: 0.3 });
    add(UNIT.box, mat(s * 0.7, 0.86, -2.14, 0, 0, 0, 0.34, 0.14, 0.04), '#fff4d6', { e: 1.5, r: 0.3 });
    for (const zz of [-1.35, 1.35]) {
      add(UNIT.cyl, mat(s * 0.82, 0.36, zz, 0, 0, Math.PI / 2, 0.7, 0.24, 0.7), '#141414', { r: 0.8 });
      add(UNIT.cyl, mat(s * 0.9, 0.36, zz, 0, 0, Math.PI / 2, 0.38, 0.1, 0.38), '#b8bec6', { r: 0.3, m: 0.9 });
    }
  }
  add(UNIT.box, mat(0, 0.66, 2.16, 0, 0, 0, 0.55, 0.14, 0.03), '#f5f5f0', { r: 0.5 });
  add(UNIT.box, mat(0, 0.42, 2.12, 0, 0, 0, 1.82, 0.2, 0.14), '#2b2f36', { r: 0.5 });
}

export const CAR_COLORS = ['#b9bec4', '#f2f2ef', '#1e3a8a', '#1b1d22', '#8a8f96', '#a61e22', '#3c4450'];

// Moto (zemidjan) garee, orientation libre.
export function addMoto(b: GeoBuilder, base: THREE.Matrix4, color: string, withHelmet = false) {
  const add = local(b, base);
  for (const dz of [-0.62, 0.62]) add(UNIT.torus, mat(0, 0.33, dz, 0, Math.PI / 2, 0, 0.55, 0.55, 0.7), '#161616', { r: 0.7 });
  add(UNIT.rbox, mat(0, 0.6, 0, 0, 0, 0, 0.3, 0.35, 1.0), color, { r: 0.3, m: 0.4 });
  add(UNIT.rbox, mat(0, 0.82, 0.15, 0, 0, 0, 0.3, 0.12, 0.7), '#222', { r: 0.6 });
  add(UNIT.box, mat(0, 1.0, -0.55, 0, 0, 0, 0.7, 0.04, 0.04), '#999', { r: 0.3, m: 0.9 });
  if (withHelmet) add(UNIT.sphere, mat(0.2, 1.08, -0.5, 0, 0, 0, 0.3, 0.28, 0.3), '#c81e1e', { r: 0.3 });
}

// Bordure de campus : blocs rouges et blancs espaces.
export function addCampusCurb(b: GeoBuilder, side: number, z0: number, z1: number) {
  const x = side * (ROAD_HALF + 0.2);
  let i = 0;
  for (let z = z0 - 0.3; z > z1 + 0.6; z -= 1.9, i++) {
    b.add(UNIT.rbox, mat(x, SIDEWALK_Y + 0.12, z - 0.6, 0, 0, 0, 0.42, 0.26, 1.2), i % 2 ? '#c8323a' : '#f1efe9', { r: 0.8 });
  }
}

// Lampadaire blanc fin du campus.
export function addSlimLamp(b: GeoBuilder, side: number, z: number) {
  const x = side * (ROAD_HALF + 1.2);
  b.add(UNIT.cylLow, mat(x, SIDEWALK_Y + 3.6, z, 0, 0, 0, 0.12, 7.2, 0.12), '#eef0f2', { r: 0.4, m: 0.3 });
  b.add(UNIT.box, mat(x - side * 0.35, SIDEWALK_Y + 7.15, z, 0, 0, 0, 0.8, 0.12, 0.3), '#eef0f2', { r: 0.4, m: 0.3 });
  b.add(UNIT.box, mat(x - side * 0.5, SIDEWALK_Y + 7.07, z, 0, 0, 0, 0.45, 0.04, 0.22), '#fff1d0', { e: 4, r: 0.3 });
}

// Panneau de limitation a 30.
export function addSpeedSign(b: GeoBuilder, side: number, z: number) {
  const x = side * (ROAD_HALF + 0.9);
  b.add(UNIT.cylLow, mat(x, SIDEWALK_Y + 1.2, z, 0, 0, 0, 0.07, 2.4, 0.07), '#9aa0a6', { r: 0.4, m: 0.7 });
  b.add(UNIT.cyl, mat(x, SIDEWALK_Y + 2.6, z, Math.PI / 2, 0, 0, 0.8, 0.04, 0.8), '#d7262e', { r: 0.5 });
  b.add(UNIT.cyl, mat(x, SIDEWALK_Y + 2.6, z + 0.025, Math.PI / 2, 0, 0, 0.6, 0.02, 0.6), '#f8f8f5', { r: 0.5 });
  // "30" en blocs.
  const dz = z + 0.04;
  const px = (dx: number, dy: number, w: number, h: number) => b.add(UNIT.box, mat(x + dx, SIDEWALK_Y + 2.6 + dy, dz, 0, 0, 0, w, h, 0.01), '#111', { r: 0.6 });
  px(-0.1, 0.12, 0.14, 0.035); px(-0.1, 0, 0.14, 0.035); px(-0.1, -0.12, 0.14, 0.035); px(-0.04, 0.06, 0.035, 0.12); px(-0.04, -0.06, 0.035, 0.12);
  px(0.1, 0.12, 0.13, 0.035); px(0.1, -0.12, 0.13, 0.035); px(0.05, 0, 0.035, 0.26); px(0.16, 0, 0.035, 0.26);
}
