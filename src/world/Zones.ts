import * as THREE from 'three';
import { GeoBuilder, mat, UNIT } from '../render/GeoBuilder';
import { applyBend } from '../render/curve';
import { makeLogoPlate, makeSignTexture } from '../render/textures';
import { Rng, pick, range } from '../core/rng';
import { WORLD } from '../config';
import { addBush, addCurb, addLamp, addPalm, ROAD_HALF, SIDEWALK_OUT, SIDEWALK_Y } from './Scenery';

// Zones scolaires : couloir de batiment (interieur) et cour de l'universite.

const L = WORLD.blockLength;
export const CORRIDOR_HALF = 4.6;
export const CORRIDOR_CEIL = 5.0;

const WALL = '#efe6d2';
const WAINSCOT = '#1d4f9e';
const TRIM = '#f7f3ea';

export interface ZoneImages {
  logoFull: HTMLImageElement;
  wordmark: HTMLImageElement;
}

let decalCache: {
  poster: THREE.Material;
  sign: THREE.Material[];
  arch: THREE.Material;
  amphi: THREE.Material;
} | null = null;

function decals(img: ZoneImages) {
  if (decalCache) return decalCache;
  const m = (t: THREE.Texture, e = 0.05) => applyBend(new THREE.MeshStandardMaterial({ map: t, roughness: 0.6, emissive: '#ffffff', emissiveMap: t, emissiveIntensity: e }));
  decalCache = {
    poster: m(makeLogoPlate(img.wordmark, 512, 360, { bg: '#fbfaf6', pad: 0.08, stripes: true }), 0.12),
    sign: [
      m(makeSignTexture(['BÂTIMENT B', 'GÉNIE CIVIL'], '#1446a0', '#ffffff', 1024, 300, '#f5d10d'), 0.3),
      m(makeSignTexture(['BÂTIMENT A', 'INFORMATIQUE'], '#1446a0', '#ffffff', 1024, 300, '#f5d10d'), 0.3),
      m(makeSignTexture(['BÂTIMENT C', 'GÉNIE ÉLECTRIQUE'], '#1446a0', '#ffffff', 1024, 300, '#f5d10d'), 0.3),
    ],
    arch: m(makeLogoPlate(img.logoFull, 2048, 460, { bg: '#fbfaf6', pad: 0.05 }), 0.06),
    amphi: m(makeSignTexture(['AMPHI 600'], '#f7f3ea', '#1446a0', 1024, 220, '#e41f26'), 0.1),
  };
  return decalCache;
}

function plane(material: THREE.Material, w: number, h: number, x: number, y: number, z: number, ry: number): THREE.Mesh {
  const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
  p.position.set(x, y, z);
  p.rotation.y = ry;
  return p;
}

// ---------------- Couloir ----------------

export type CorridorPart = 'body' | 'in' | 'out';

export function buildCorridor(r: Rng, part: CorridorPart, img: ZoneImages): { geo: THREE.BufferGeometry; extras: THREE.Object3D[] } {
  const b = new GeoBuilder();
  const extras: THREE.Object3D[] = [];
  const D = decals(img);
  const z0 = L / 2, z1 = -L / 2;
  const W = CORRIDOR_HALF, H = CORRIDOR_CEIL;

  // Sol en carrelage granito facon damier.
  const tile = 0.9;
  const nx = Math.round((W * 2) / tile);
  const nz = Math.round(L / tile);
  const cA = '#e9e1cf', cB = '#b86a4b';
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const x = -W + (i + 0.5) * tile;
      const z = z0 - (j + 0.5) * tile;
      const a = (i + j) % 2 === 0;
      b.add(UNIT.box, mat(x, 0.02, z, 0, 0, 0, tile * 0.985, 0.04, tile * 0.985), a ? cA : cB, { r: 0.22 });
    }
  }
  // Plinthes (cachent le trottoir exterieur).
  for (const s of [-1, 1]) b.add(UNIT.box, mat(s * (W - 0.18), 0.22, 0, 0, 0, 0, 0.42, 0.44, L), '#3b2f2a', { r: 0.6 });

  // Plafond et neons.
  b.add(UNIT.box, mat(0, H + 0.15, 0, 0, 0, 0, W * 2 + 0.8, 0.3, L), '#f2efe8', { r: 0.9 });
  for (let z = z0 - 2.25; z > z1; z -= 4.5) {
    for (const x of [-1.6, 1.6]) {
      b.add(UNIT.box, mat(x, H - 0.03, z, 0, 0, 0, 0.3, 0.06, 1.8), '#d8dde3', { r: 0.4, m: 0.5 });
      b.add(UNIT.box, mat(x, H - 0.07, z, 0, 0, 0, 0.18, 0.03, 1.7), '#f4fbff', { e: 5, r: 0.3 });
    }
  }
  // Ventilateurs de plafond.
  for (let z = z0 - 9; z > z1; z -= 18) {
    b.add(UNIT.cylLow, mat(0, H - 0.3, z, 0, 0, 0, 0.05, 0.6, 0.05), '#6b7280', { r: 0.4, m: 0.7 });
    b.add(UNIT.cyl, mat(0, H - 0.62, z, 0, 0, 0, 0.3, 0.12, 0.3), '#e5e7eb', { r: 0.4, m: 0.3 });
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + r();
      b.add(UNIT.box, mat(Math.cos(a) * 0.6, H - 0.62, z + Math.sin(a) * 0.6, 0, -a, 0.05, 1.0, 0.02, 0.16), '#8b5e3c', { r: 0.6 });
    }
  }

  // Mur gauche : fenetres ouvertes cote soleil (taches de lumiere au sol).
  const xl = -W - 0.15;
  b.add(UNIT.box, mat(xl, 0.55, 0, 0, 0, 0, 0.3, 1.1, L), WAINSCOT, { r: 0.6 });
  b.add(UNIT.box, mat(xl, 1.13, 0, 0, 0, 0, 0.42, 0.08, L), TRIM, { r: 0.6 });
  b.add(UNIT.box, mat(xl, H - 0.4, 0, 0, 0, 0, 0.3, 0.8, L), WALL, { r: 0.9 });
  const bay = 3;
  for (let z = z0; z >= z1 - 0.01; z -= bay) {
    b.add(UNIT.box, mat(xl, (1.1 + H) / 2, z, 0, 0, 0, 0.34, H - 1.1, 0.5), WALL, { r: 0.9 });
  }
  for (let z = z0 - bay / 2; z > z1; z -= bay) {
    // Claustra : lames horizontales fines typiques des ecoles.
    for (let k = 0; k < 3; k++) b.add(UNIT.box, mat(xl, 1.6 + k * 0.95, z, 0, 0, 0, 0.06, 0.05, bay - 0.5), '#9aa3ad', { r: 0.4, m: 0.6 });
    b.add(UNIT.box, mat(xl, (1.1 + H - 0.8) / 2, z, 0, 0, 0, 0.04, H - 1.9, 0.04), '#9aa3ad', { r: 0.4, m: 0.6 });
  }
  // Exterieur visible par les fenetres.
  b.add(UNIT.box, mat(-W - 6, 0.08, 0, 0, 0, 0, 11, 0.16, L), '#5f8f3a', { r: 1 });
  for (let i = 0; i < 3; i++) addPalm(b, -W - range(r, 3, 8), 0.1, z0 - range(r, 3, L - 3), range(r, 6.5, 9), r);
  for (let i = 0; i < 4; i++) addBush(b, -W - range(r, 1.2, 3), 0.1, z0 - range(r, 1, L - 1), range(r, 0.8, 1.2), r);

  // Mur droit : casiers, portes de salles, panneaux d'affichage.
  const xr = W + 0.15;
  b.add(UNIT.box, mat(xr, H / 2, 0, 0, 0, 0, 0.3, H, L), WALL, { r: 0.9 });
  b.add(UNIT.box, mat(xr - 0.16, 0.6, 0, 0, 0, 0, 0.04, 1.2, L), WAINSCOT, { r: 0.55 });
  b.add(UNIT.box, mat(xr - 0.18, 1.22, 0, 0, 0, 0, 0.06, 0.06, L), TRIM, { r: 0.6 });
  const lockerColor = pick(r, ['#f5c400', '#1d6fd1', '#e0533d', '#18a594']);
  let z = z0 - 0.8;
  let slot = 0;
  while (z > z1 + 1.5) {
    const kind = slot % 3;
    if (kind === 0 || kind === 2) {
      // Rangee de casiers.
      const n = 5 + Math.floor(r() * 3);
      const lw = 0.52;
      for (let k = 0; k < n; k++) {
        const lz = z - k * lw - lw / 2;
        b.add(UNIT.box, mat(xr - 0.38, 1.0, lz, 0, 0, 0, 0.45, 1.95, lw * 0.96), lockerColor, { r: 0.35, m: 0.5 });
        for (let v = 0; v < 3; v++) b.add(UNIT.box, mat(xr - 0.61, 1.65 + v * 0.07, lz, 0, 0, 0, 0.01, 0.025, lw * 0.6), '#222', { r: 0.6 });
        b.add(UNIT.box, mat(xr - 0.62, 1.05, lz + lw * 0.3, 0, 0, 0, 0.03, 0.18, 0.04), '#c0c4c8', { r: 0.2, m: 0.9 });
      }
      b.add(UNIT.box, mat(xr - 0.38, 2.0, z - (n * lw) / 2, 0, 0, 0, 0.47, 0.04, n * lw), '#2b2f36', { r: 0.5 });
      z -= n * lw + 0.8;
    } else {
      // Porte de salle de classe avec imposte vitree.
      const dz = z - 0.7;
      b.add(UNIT.box, mat(xr - 0.2, 1.2, dz, 0, 0, 0, 0.12, 2.4, 1.4), TRIM, { r: 0.6 });
      b.add(UNIT.box, mat(xr - 0.26, 1.15, dz, 0, 0, 0, 0.06, 2.25, 1.15), pick(r, ['#8b5a2b', '#6d4222', '#1d4f9e']), { r: 0.55 });
      b.add(UNIT.box, mat(xr - 0.3, 1.7, dz, 0, 0, 0, 0.03, 0.5, 0.35), r() < 0.5 ? '#ffe2a8' : '#2d4460', { e: 0.8, r: 0.2 });
      b.add(UNIT.box, mat(xr - 0.3, 1.05, dz + 0.42, 0, 0, 0, 0.05, 0.05, 0.16), '#c0c4c8', { r: 0.2, m: 0.9 });
      b.add(UNIT.box, mat(xr - 0.2, 2.65, dz, 0, 0, 0, 0.05, 0.28, 0.7), '#f5d10d', { r: 0.5, e: 0.2 });
      // Tableau d'affichage en liege.
      const bz = dz - 2.1;
      b.add(UNIT.box, mat(xr - 0.18, 1.9, bz, 0, 0, 0, 0.05, 1.1, 1.8), '#b8864b', { r: 0.95 });
      for (let k = 0; k < 7; k++) {
        b.add(UNIT.box, mat(xr - 0.21, 1.6 + r() * 0.6, bz - 0.7 + r() * 1.4, 0, 0, (r() - 0.5) * 0.3, 0.01, 0.3, 0.22), pick(r, ['#fff', '#fef08a', '#bfdbfe', '#fecaca', '#bbf7d0']), { r: 0.8 });
      }
      z -= 3.6;
    }
    slot++;
  }
  // Affiches du logo EPL sur le mur droit, au-dessus des casiers.
  for (let k = 0; k < 2; k++) {
    extras.push(plane(D.poster, 1.6, 1.12, xr - 0.16, 3.4, z0 - 8 - k * 18, -Math.PI / 2));
  }

  if (part === 'in') {
    // Facade d'entree face au joueur, avec enseigne du batiment.
    const fz = z0;
    const fw = 26;
    for (const s of [-1, 1]) {
      b.add(UNIT.box, mat(s * (W + fw / 2), 6, fz, 0, 0, 0, fw, 12, 0.6), WALL, { r: 0.85 });
      b.add(UNIT.box, mat(s * (W + fw / 2), 1.0, fz + 0.32, 0, 0, 0, fw, 2.0, 0.05), WAINSCOT, { r: 0.55 });
      // Masse du batiment.
      b.add(UNIT.box, mat(s * (W + 8), 6, 0, 0, 0, 0, 16, 12, L), WALL, { r: 0.9 });
      for (let f = 0; f < 3; f++) for (let i = 0; i < 6; i++) {
        const lit = r() < 0.35;
        b.add(UNIT.box, mat(s * (W + 2 + i * 3.4), 2.2 + f * 3.4, fz + 0.32, 0, 0, 0, 1.8, 1.8, 0.06), lit ? '#ffc98a' : '#2d4460', lit ? { e: 1.2 } : { r: 0.06, m: 0.5 });
      }
    }
    b.add(UNIT.box, mat(0, (H + 12) / 2, fz, 0, 0, 0, W * 2, 12 - H, 0.6), WALL, { r: 0.85 });
    b.add(UNIT.box, mat(0, 12.2, fz, 0, 0, 0, 60, 0.4, 1.0), WAINSCOT, { r: 0.5 });
    // Encadrement de porte.
    for (const s of [-1, 1]) b.add(UNIT.box, mat(s * (W + 0.2), H / 2, fz + 0.4, 0, 0, 0, 0.4, H, 0.3), '#1446a0', { r: 0.5 });
    b.add(UNIT.box, mat(0, H + 0.2, fz + 0.4, 0, 0, 0, W * 2 + 0.8, 0.4, 0.3), '#1446a0', { r: 0.5 });
    const sign = pick(r, D.sign);
    extras.push(plane(sign, 7.2, 2.1, 0, H + 1.8, fz + 0.32, 0));
    extras.push(plane(D.poster, 3.2, 2.25, -W - 5, 6.5, fz + 0.32, 0));
    extras.push(plane(D.poster, 3.2, 2.25, W + 5, 6.5, fz + 0.32, 0));
  }
  if (part === 'out') {
    // Mur de sortie (vu de l'interieur : ouverture lumineuse).
    const fz = z1;
    b.add(UNIT.box, mat(0, (H + 8) / 2, fz, 0, 0, 0, W * 2 + 1, 8 - H, 0.6), WALL, { r: 0.85 });
    for (const s of [-1, 1]) b.add(UNIT.box, mat(s * (W + 0.2), H / 2, fz - 0.4, 0, 0, 0, 0.4, H, 0.3), '#1446a0', { r: 0.5 });
  }
  return { geo: b.build(), extras };
}

// ---------------- Cour de l'universite ----------------

export type CourtPart = 'body' | 'in';

function flamboyant(b: GeoBuilder, x: number, z: number, r: Rng) {
  const h = range(r, 3.2, 4.2);
  b.add(UNIT.cylLow, mat(x, h / 2, z, 0, 0, (r() - 0.5) * 0.2, 0.4, h, 0.4), '#5d4430', { r: 0.95 });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + r();
    b.add(UNIT.cylLow, mat(x + Math.cos(a) * 1.0, h + 0.3, z + Math.sin(a) * 1.0, Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9, 0.18, 2.4, 0.18), '#5d4430', { r: 0.95 });
  }
  // Canopee en parasol, fleurs rouge-orange.
  for (let i = 0; i < 16; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 3.2;
    const s = range(r, 1.0, 1.7);
    const col = r() < 0.72 ? pick(r, ['#e6391e', '#f25a1d', '#d9261c', '#ff7a1a']) : pick(r, ['#3f7a2a', '#4d8a2f']);
    b.add(UNIT.sphereLow, mat(x + Math.cos(a) * d, h + 1.3 + range(r, -0.3, 0.4) - d * 0.12, z + Math.sin(a) * d, 0, 0, 0, s * 1.4, s * 0.7, s * 1.4), col, { r: 0.8, e: 0.06 });
  }
}

function uniBuilding(b: GeoBuilder, side: number, z: number, len: number, r: Rng) {
  const x0 = side * 15;
  const floors = 2 + Math.floor(r() * 2);
  const H = floors * 3.6 + 0.6;
  const depth = 12;
  const xc = x0 + side * depth / 2;
  b.add(UNIT.box, mat(xc, H / 2, z, 0, 0, 0, depth, H, len), '#f4f1ea', { r: 0.85 });
  b.add(UNIT.box, mat(xc, H + 0.25, z, 0, 0, 0, depth + 0.6, 0.5, len + 0.4), '#1446a0', { r: 0.5, m: 0.2 });
  // Galeries a arcades.
  const face = x0 - side * 1.6;
  b.add(UNIT.box, mat(x0 - side * 0.8, 3.6, z, 0, 0, 0, 1.6, 0.35, len), '#f4f1ea', { r: 0.85 });
  for (let k = 0; k <= Math.floor(len / 3); k++) {
    b.add(UNIT.box, mat(face, 1.8, z + len / 2 - k * 3, 0, 0, 0, 0.4, 3.6, 0.4), '#f4f1ea', { r: 0.85 });
  }
  for (let f = 0; f < floors; f++) {
    for (let k = 0; k < Math.floor(len / 2.4); k++) {
      const lit = r() < 0.3;
      b.add(UNIT.box, mat(x0 - side * 0.02, 1.9 + f * 3.6, z + len / 2 - 1.2 - k * 2.4, 0, 0, 0, 0.06, 1.7, 1.5), lit ? '#ffc98a' : '#2d4460', lit ? { e: 1.1 } : { r: 0.06, m: 0.5 });
    }
    b.add(UNIT.box, mat(x0 - side * 0.1, 0.9 + f * 3.6 + 3.6, z, 0, 0, 0, 0.2, 0.12, len), '#e41f26', { r: 0.5 });
  }
}

export function buildCourt(r: Rng, part: CourtPart, img: ZoneImages): { geo: THREE.BufferGeometry; extras: THREE.Object3D[] } {
  const b = new GeoBuilder();
  const extras: THREE.Object3D[] = [];
  const D = decals(img);
  const z0 = L / 2, z1 = -L / 2;
  for (const side of [-1, 1]) {
    addCurb(b, side, z0, z1);
    // Pelouse et haie basse.
    b.add(UNIT.box, mat(side * (SIDEWALK_OUT + 9), 0.1, 0, 0, 0, 0, 18, 0.2, L), '#5f9a3a', { r: 1 });
    for (let z = z0 - 1; z > z1; z -= 2) b.add(UNIT.rbox, mat(side * (SIDEWALK_OUT + 0.4), 0.5, z - 0.5, 0, 0, 0, 0.7, 0.7, 1.9), '#2f6b2c', { r: 0.9 });
    // Allee transversale en beton.
    b.add(UNIT.box, mat(side * (SIDEWALK_OUT + 6), 0.22, z0 - 10, 0, 0, 0, 12, 0.04, 2.4), '#d6d0c4', { r: 0.9 });
    // Arbres et palmiers.
    flamboyant(b, side * (SIDEWALK_OUT + range(r, 3, 5)), z0 - range(r, 4, 12), r);
    if (r() < 0.8) flamboyant(b, side * (SIDEWALK_OUT + range(r, 3, 6)), z0 - range(r, 22, 32), r);
    addPalm(b, side * (SIDEWALK_OUT + 1.6), 0.2, z0 - range(r, 14, 20), range(r, 7, 9), r);
    // Bancs.
    for (let k = 0; k < 2; k++) {
      const bz = z0 - range(r, 3, L - 3);
      const bx = side * (ROAD_HALF + 2.2);
      b.add(UNIT.box, mat(bx, SIDEWALK_Y + 0.45, bz, 0, 0, 0, 0.5, 0.08, 1.8), '#8d6e63', { r: 0.8 });
      b.add(UNIT.box, mat(bx + side * 0.22, SIDEWALK_Y + 0.75, bz, 0, 0, 0, 0.06, 0.5, 1.8), '#8d6e63', { r: 0.8 });
      for (const dz of [-0.75, 0.75]) b.add(UNIT.box, mat(bx, SIDEWALK_Y + 0.22, bz + dz, 0, 0, 0, 0.45, 0.44, 0.08), '#1446a0', { r: 0.4, m: 0.5 });
    }
    uniBuilding(b, side, 0, L - 4, r);
  }
  addLamp(b, -1, z0 - 6);
  addLamp(b, 1, z0 - 24);

  // Preau couvert au-dessus de la route (jeu d'ombres).
  if (part === 'body' && r() < 0.55) {
    const pz = z0 - range(r, 8, 20);
    const pl = 10;
    for (const s of [-1, 1]) {
      for (let k = 0; k <= 3; k++) {
        b.add(UNIT.cyl, mat(s * (ROAD_HALF + 0.9), 2.4, pz - k * (pl / 3), 0, 0, 0, 0.3, 4.8, 0.3), '#f4f1ea', { r: 0.8 });
      }
    }
    b.add(UNIT.box, mat(0, 4.9, pz - pl / 2, 0, 0, 0, (ROAD_HALF + 1.4) * 2, 0.25, pl + 0.6), '#1446a0', { r: 0.5, m: 0.2 });
    for (let k = 0; k < 8; k++) b.add(UNIT.box, mat(0, 4.72, pz - 0.6 - k * (pl / 7.4), 0, 0, 0, (ROAD_HALF + 1.2) * 2, 0.12, 0.25), '#f4f1ea', { r: 0.8 });
  }

  if (part === 'in') {
    // Arche d'entree de l'universite avec le logo complet.
    const az = z0 - 2;
    const span = (ROAD_HALF + 1.4) * 2;
    for (const s of [-1, 1]) {
      b.add(UNIT.box, mat(s * span / 2, 4.2, az, 0, 0, 0, 1.4, 8.4, 1.4), '#f4f1ea', { r: 0.8 });
      b.add(UNIT.box, mat(s * span / 2, 4.2, az, 0, 0, 0, 1.5, 0.9, 1.5), '#1446a0', { r: 0.5 });
      b.add(UNIT.box, mat(s * span / 2, 8.6, az, 0, 0, 0, 0.5, 0.5, 0.5), '#ffe3a8', { e: 4 });
    }
    b.add(UNIT.box, mat(0, 7.2, az, 0, 0, 0, span + 1.4, 1.8, 1.0), '#f4f1ea', { r: 0.8 });
    b.add(UNIT.box, mat(0, 6.25, az, 0, 0, 0, span + 1.5, 0.16, 1.1), '#1446a0', { r: 0.5 });
    extras.push(plane(D.arch, span + 1.0, (span + 1.0) * 460 / 2048, 0, 7.2, az + 0.52, 0));
  } else if (r() < 0.5) {
    // Amphitheatre en fond de pelouse.
    const side = r() < 0.5 ? -1 : 1;
    const ax = side * (SIDEWALK_OUT + 7.4);
    extras.push(plane(D.amphi, 5, 1.07, ax - side * 0.1, 7.9 + 0.2, 0, side > 0 ? -Math.PI / 2 : Math.PI / 2));
  }
  return { geo: b.build(), extras };
}
