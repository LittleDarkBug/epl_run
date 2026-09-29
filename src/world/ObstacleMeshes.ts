import * as THREE from 'three';
import { GeoBuilder, mat, UNIT } from '../render/GeoBuilder';
import { createUberMaterial } from '../render/uber';
import { applyBend } from '../render/curve';
import { makeBannerTexture, makeChalkboardTexture } from '../render/textures';
import { BUS_HEIGHT } from '../config';
import { addCar, CAR_COLORS } from './Scenery';

// Fabriques des obstacles. Chaque type est une geometrie fusionnee (1 appel
// de rendu) avec quelques variantes de couleur.

export type ObstacleType = 'barrier' | 'bench' | 'gate' | 'kiosk' | 'bus' | 'ramp' | 'moto' | 'books' | 'board' | 'car';

export interface ObstacleSpec {
  len: number; // profondeur en z
  halfW: number;
  y0: number; // bas de la partie solide
  y1: number; // haut de la partie solide
  top?: number; // surface praticable
  ramp?: boolean;
  low?: boolean; // se franchit en sautant
  high?: boolean; // se franchit en glissant
}

export const SPECS: Record<ObstacleType, ObstacleSpec> = {
  barrier: { len: 0.5, halfW: 1.05, y0: 0, y1: 1.15, low: true },
  bench: { len: 1.3, halfW: 1.0, y0: 0, y1: 1.05, low: true },
  gate: { len: 0.4, halfW: 1.15, y0: 1.2, y1: 3.6, high: true },
  kiosk: { len: 2.4, halfW: 1.05, y0: 0, y1: 2.7, top: 2.7 },
  bus: { len: 10.5, halfW: 1.12, y0: 0, y1: BUS_HEIGHT, top: BUS_HEIGHT },
  ramp: { len: 6.5, halfW: 1.12, y0: 0, y1: BUS_HEIGHT, ramp: true, top: BUS_HEIGHT },
  moto: { len: 1.9, halfW: 0.55, y0: 0, y1: 1.5, low: true },
  books: { len: 0.9, halfW: 1.05, y0: 0, y1: 1.1, low: true },
  board: { len: 0.7, halfW: 1.1, y0: 0, y1: 2.6, top: 2.6 },
  car: { len: 4.3, halfW: 0.95, y0: 0, y1: 1.55, top: 1.55 },
};

const uber = createUberMaterial({ grime: 0.12 });

function meshFrom(b: GeoBuilder): THREE.Mesh {
  const m = new THREE.Mesh(b.build(), uber);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// Barriere de chantier rayee rouge et blanc.
function barrier(variant: number): THREE.Object3D {
  const b = new GeoBuilder();
  const accent = variant % 2 ? '#e11d2e' : '#f97316';
  for (const s of [-0.95, 0.95]) {
    b.add(UNIT.box, mat(s, 0.55, 0, 0, 0, 0, 0.1, 1.1, 0.1), '#d7d7d2', { r: 0.4, m: 0.6 });
    b.add(UNIT.box, mat(s, 0.03, 0, 0, 0, 0, 0.14, 0.06, 0.8), '#222', { r: 0.7 });
  }
  for (const y of [0.95, 0.55]) {
    const n = 8;
    for (let i = 0; i < n; i++) {
      const x = -1.0 + (i + 0.5) * (2.0 / n);
      b.add(UNIT.box, mat(x, y, 0, 0, 0, 0, 2.0 / n, 0.28, 0.08), i % 2 ? accent : '#f5f5f0', { r: 0.45 });
    }
  }
  // Feux clignotants.
  for (const s of [-0.95, 0.95]) {
    b.add(UNIT.cyl, mat(s, 1.16, 0, 0, 0, 0, 0.16, 0.12, 0.16), '#ffb020', { e: 4, r: 0.3 });
  }
  return meshFrom(b);
}

// Pile de tables-bancs d'ecole.
function bench(variant: number): THREE.Object3D {
  const b = new GeoBuilder();
  const wood = variant % 2 ? '#a0673a' : '#8a5a33';
  const metal = variant % 2 ? '#1f5f99' : '#2d6a4f';
  const unit = (x: number, y: number, z: number, ry: number) => {
    const m = new THREE.Matrix4().makeTranslation(x, y, z).multiply(new THREE.Matrix4().makeRotationY(ry));
    const add = (g: THREE.BufferGeometry, mm: THREE.Matrix4, c: string, p = {}) => b.add(g, m.clone().multiply(mm), c, p);
    add(UNIT.rbox, mat(0, 0.72, -0.18, 0.12, 0, 0, 1.8, 0.06, 0.5), wood, { r: 0.7 });
    add(UNIT.rbox, mat(0, 0.42, 0.34, 0, 0, 0, 1.8, 0.05, 0.3), wood, { r: 0.7 });
    for (const sx of [-0.8, 0.8]) {
      add(UNIT.box, mat(sx, 0.36, -0.2, 0, 0, 0, 0.05, 0.72, 0.05), metal, { r: 0.4, m: 0.6 });
      add(UNIT.box, mat(sx, 0.2, 0.34, 0, 0, 0, 0.05, 0.4, 0.05), metal, { r: 0.4, m: 0.6 });
      add(UNIT.box, mat(sx, 0.05, 0.05, 0, 0, 0, 0.05, 0.05, 0.9), metal, { r: 0.4, m: 0.6 });
    }
  };
  unit(0, 0, 0, 0);
  unit(0.05, 0.5, 0.1, Math.PI + 0.08);
  // Cartables oublies.
  b.add(UNIT.rboxSoft, mat(-0.5, 1.15, -0.1, 0.2, 0.3, 0, 0.45, 0.4, 0.25), '#e63946', { r: 0.7 });
  b.add(UNIT.rbox, mat(0.4, 1.02, 0.05, 0, 0.5, 0, 0.35, 0.08, 0.26), '#f1faee', { r: 0.8 });
  return meshFrom(b);
}

// Portique avec banderole : il faut glisser dessous.
function gate(text: string, colors: [string, string, string]): THREE.Object3D {
  const g = new THREE.Group();
  const b = new GeoBuilder();
  const H = 3.6, w = 2.5;
  for (const s of [-1, 1]) {
    b.add(UNIT.cyl, mat(s * w / 2, H / 2, 0, 0, 0, 0, 0.12, H, 0.12), '#c9ccd1', { r: 0.3, m: 0.85 });
    b.add(UNIT.cyl, mat(s * w / 2, 0.06, 0, 0, 0, 0, 0.4, 0.12, 0.4), '#3a3f45', { r: 0.5, m: 0.6 });
  }
  b.add(UNIT.cyl, mat(0, H, 0, 0, 0, Math.PI / 2, 0.1, w + 0.2, 0.1), '#c9ccd1', { r: 0.3, m: 0.85 });
  // Barre rayee a hauteur de poitrine.
  const n = 10;
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + (i + 0.5) * (w / n);
    b.add(UNIT.box, mat(x, 1.42, 0, 0, 0, 0, w / n, 0.3, 0.14), i % 2 ? '#e11d2e' : '#f5f5f0', { r: 0.45 });
  }
  // Fanions sous la banderole.
  const flags = ['#e41f26', '#f5d10d', '#0b9185', '#1455b8', '#c3199b'];
  for (let i = 0; i < 9; i++) {
    const x = -w / 2 + 0.2 + i * ((w - 0.4) / 8);
    b.add(UNIT.box, mat(x, 1.95, 0, 0, 0, 0, 0.18, 0.5, 0.02), flags[i % flags.length], { r: 0.8 });
  }
  b.add(UNIT.cyl, mat(0, 2.2, 0, 0, 0, Math.PI / 2, 0.03, w, 0.03), '#e5e7eb', { r: 0.5 });
  g.add(meshFrom(b));
  const tex = makeBannerTexture(text, colors[0], colors[1], colors[2]);
  const bannerMat = applyBend(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75, side: THREE.DoubleSide, envMapIntensity: 0.5 }));
  const bw = w - 0.2;
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(bw, bw / 2.4, 8, 2), bannerMat);
  banner.position.set(0, H - 0.12 - bw / 4.8, 0.03);
  banner.castShadow = true;
  g.add(banner);
  return g;
}

// Kiosque de telephonie / buvette : bloquant, changer de voie.
function kiosk(variant: number): THREE.Object3D {
  const b = new GeoBuilder();
  const body = ['#f5c400', '#e11d48', '#0ea5e9', '#16a34a'][variant % 4];
  const dark = '#1f2937';
  b.add(UNIT.rbox, mat(0, 1.2, 0, 0, 0, 0, 2.0, 2.3, 2.2), body, { r: 0.45, m: 0.1 });
  b.add(UNIT.box, mat(0, 1.35, 1.11, 0, 0, 0, 1.6, 0.9, 0.04), '#101820', { r: 0.1, m: 0.4 });
  b.add(UNIT.box, mat(0, 1.35, 1.14, 0, 0, 0, 1.5, 0.06, 0.02), '#fff2c6', { e: 3, r: 0.4 });
  b.add(UNIT.box, mat(0, 0.8, 1.35, 0, 0, 0, 1.9, 0.08, 0.5), dark, { r: 0.6 });
  b.add(UNIT.rbox, mat(0, 2.5, 0.1, 0, 0, 0, 2.3, 0.3, 2.6), '#f8fafc', { r: 0.5 });
  b.add(UNIT.box, mat(0, 2.5, 1.41, 0, 0, 0, 2.0, 0.2, 0.02), body, { r: 0.4, e: 0.6 });
  for (const s of [-0.7, 0.7]) b.add(UNIT.box, mat(s, 0.06, 0, 0, 0, 0, 0.3, 0.12, 2.1), dark, { r: 0.7 });
  // Bidons et caisses.
  b.add(UNIT.cyl, mat(-0.75, 0.35, 1.35, 0, 0, 0, 0.45, 0.7, 0.45), '#facc15', { r: 0.4 });
  b.add(UNIT.box, mat(0.6, 0.25, 1.4, 0, 0.3, 0, 0.6, 0.5, 0.5), '#b45309', { r: 0.8 });
  return meshFrom(b);
}

// Minibus type taxi-brousse, vu de l'arriere, avec galerie chargee.
function bus(variant: number): THREE.Object3D {
  const b = new GeoBuilder();
  const palettes: [string, string][] = [['#f6c90e', '#1f2937'], ['#f8fafc', '#1d4ed8'], ['#e63946', '#f1faee'], ['#2a9d8f', '#f4a261']];
  const [body, stripe] = palettes[variant % palettes.length];
  const len = SPECS.bus.len, W = 2.2, H = 2.45;
  const zc = 0;
  b.add(UNIT.rboxSoft, mat(0, 0.45 + H / 2, zc, 0, 0, 0, W, H, len), body, { r: 0.28, m: 0.35 });
  // Vitres laterales et arriere.
  for (const s of [-1, 1]) {
    b.add(UNIT.box, mat(s * (W / 2 + 0.005), 0.45 + H * 0.72, zc - 0.5, 0, 0, 0, 0.02, 0.75, len - 2.2), '#1b2735', { r: 0.05, m: 0.6 });
    b.add(UNIT.box, mat(s * (W / 2 + 0.01), 0.45 + H * 0.32, zc, 0, 0, 0, 0.02, 0.22, len - 0.6), stripe, { r: 0.35 });
  }
  b.add(UNIT.box, mat(0, 0.45 + H * 0.7, len / 2 + 0.005, 0, 0, 0, W - 0.4, 0.8, 0.02), '#1b2735', { r: 0.05, m: 0.6 });
  // Feux arriere et plaque.
  for (const s of [-1, 1]) {
    b.add(UNIT.box, mat(s * (W / 2 - 0.2), 0.95, len / 2 + 0.01, 0, 0, 0, 0.26, 0.4, 0.04), '#ff2a2a', { e: 3.2, r: 0.3 });
    b.add(UNIT.box, mat(s * (W / 2 - 0.2), 0.68, len / 2 + 0.01, 0, 0, 0, 0.26, 0.12, 0.04), '#ffae00', { e: 2.5, r: 0.3 });
  }
  b.add(UNIT.box, mat(0, 0.75, len / 2 + 0.01, 0, 0, 0, 0.7, 0.2, 0.03), '#f8f8f8', { r: 0.5 });
  b.add(UNIT.box, mat(0, 0.42, len / 2 + 0.05, 0, 0, 0, W + 0.05, 0.22, 0.2), '#2b2f36', { r: 0.5, m: 0.4 });
  // Roues.
  for (const s of [-1, 1]) for (const z of [-len / 2 + 1.6, len / 2 - 1.6]) {
    b.add(UNIT.cyl, mat(s * (W / 2 - 0.12), 0.42, z, 0, 0, Math.PI / 2, 0.84, 0.3, 0.84), '#141414', { r: 0.8 });
    b.add(UNIT.cyl, mat(s * (W / 2 - 0.02), 0.42, z, 0, 0, Math.PI / 2, 0.44, 0.12, 0.44), '#9ca3af', { r: 0.3, m: 0.9 });
  }
  // Galerie de toit et bagages (surface praticable).
  const topY = 0.45 + H;
  for (const s of [-1, 1]) b.add(UNIT.box, mat(s * (W / 2 - 0.08), topY + 0.2, zc, 0, 0, 0, 0.06, 0.06, len - 0.6), '#4b5563', { r: 0.4, m: 0.8 });
  for (let z = -len / 2 + 0.6; z < len / 2 - 0.3; z += 0.9) {
    b.add(UNIT.box, mat(0, topY + 0.2, z, 0, 0, 0, W - 0.1, 0.05, 0.05), '#4b5563', { r: 0.4, m: 0.8 });
  }
  const bags = ['#7c3aed', '#16a34a', '#dc2626', '#0ea5e9', '#f59e0b', '#a16207', '#be185d'];
  for (let i = 0; i < 5; i++) {
    const z = -len / 2 + 1.2 + i * 1.9 + ((i * 37) % 5) * 0.1;
    const x = ((i * 53) % 3 - 1) * 0.5;
    b.add(UNIT.rboxSoft, mat(x, topY + 0.28, z, 0, i * 0.4, 0, 0.8, 0.36, 0.9), bags[(i + variant) % bags.length], { r: 0.8 });
  }
  return meshFrom(b);
}

// Rampe en planches pour monter sur les bus.
function ramp(): THREE.Object3D {
  const b = new GeoBuilder();
  const len = SPECS.ramp.len, H = BUS_HEIGHT, W = 2.2;
  const ang = Math.atan2(H, len);
  const hyp = Math.hypot(H, len);
  const planks = 14;
  for (let i = 0; i < planks; i++) {
    const t = (i + 0.5) / planks;
    const z = len / 2 - t * len;
    const y = t * H;
    b.add(UNIT.box, mat(0, y - 0.04, z, ang, 0, 0, W, 0.08, hyp / planks * 0.94), i % 2 ? '#b07845' : '#9c6a3c', { r: 0.85 });
  }
  for (const s of [-1, 1]) {
    b.add(UNIT.box, mat(s * (W / 2 - 0.05), H / 2 - 0.1, 0, ang, 0, 0, 0.14, 0.2, hyp), '#6b4423', { r: 0.9 });
    // Bord raye de securite.
    b.add(UNIT.box, mat(s * (W / 2 + 0.02), H / 2 - 0.02, 0, ang, 0, 0, 0.04, 0.08, hyp), '#facc15', { r: 0.5, e: 0.3 });
  }
  for (let i = 1; i < 4; i++) {
    const t = i / 4;
    const z = len / 2 - t * len;
    for (const s of [-1, 1]) b.add(UNIT.box, mat(s * (W / 2 - 0.15), (t * H) / 2, z, 0, 0, 0, 0.12, t * H, 0.12), '#5b3a1e', { r: 0.9 });
  }
  return meshFrom(b);
}

// Zemidjan : moto-taxi qui arrive en sens inverse, conducteur en chemise jaune.
function moto(variant: number): THREE.Object3D {
  const b = new GeoBuilder();
  const body = ['#b91c1c', '#111827', '#1d4ed8'][variant % 3];
  for (const z of [-0.7, 0.7]) {
    b.add(UNIT.torus, mat(0, 0.36, z, 0, Math.PI / 2, 0, 0.62, 0.62, 0.9), '#121212', { r: 0.8 });
    b.add(UNIT.cyl, mat(0, 0.36, z, 0, 0, Math.PI / 2, 0.3, 0.1, 0.3), '#9ca3af', { r: 0.3, m: 0.9 });
  }
  b.add(UNIT.rbox, mat(0, 0.66, 0, 0, 0, 0, 0.34, 0.36, 1.2), body, { r: 0.25, m: 0.4 });
  b.add(UNIT.rbox, mat(0, 0.9, 0.15, 0, 0, 0, 0.36, 0.14, 0.85), '#1a1a1a', { r: 0.6 });
  b.add(UNIT.box, mat(0, 1.12, -0.62, 0, 0, 0, 0.8, 0.05, 0.05), '#aaa', { r: 0.3, m: 0.9 });
  b.add(UNIT.rbox, mat(0, 0.95, -0.75, 0, 0, 0, 0.3, 0.3, 0.22), body, { r: 0.3, m: 0.4 });
  // Phare avant (face au joueur).
  b.add(UNIT.cyl, mat(0, 0.95, -0.87, Math.PI / 2, 0, 0, 0.2, 0.04, 0.2), '#fff6d8', { e: 8, r: 0.2 });
  // Conducteur.
  const skin = '#5a3825';
  b.add(UNIT.rboxSoft, mat(0, 1.35, 0.05, -0.25, 0, 0, 0.52, 0.62, 0.32), '#f7c600', { r: 0.8 });
  b.add(UNIT.sphere, mat(0, 1.82, -0.08, 0, 0, 0, 0.3, 0.33, 0.3), skin, { r: 0.6 });
  b.add(UNIT.sphere, mat(0, 1.88, -0.08, 0, 0, 0, 0.34, 0.26, 0.34), '#e5e7eb', { r: 0.3, m: 0.1 });
  b.add(UNIT.box, mat(0, 1.82, -0.25, 0, 0, 0, 0.3, 0.1, 0.04), '#111', { r: 0.1 });
  for (const s of [-1, 1]) {
    b.add(UNIT.rbox, mat(s * 0.3, 1.3, -0.3, -1.0, 0, s * 0.2, 0.13, 0.55, 0.13), '#f7c600', { r: 0.8 });
    b.add(UNIT.rbox, mat(s * 0.2, 0.82, -0.1, -1.2, 0, 0, 0.16, 0.6, 0.16), '#374151', { r: 0.9 });
  }
  return meshFrom(b);
}

// Piles de livres et de cahiers : a sauter.
function books(variant: number): THREE.Object3D {
  const b = new GeoBuilder();
  const cols = ['#b91c1c', '#1d4ed8', '#047857', '#f59e0b', '#7c3aed', '#0f766e', '#be185d', '#f5d10d', '#1446a0'];
  for (const px of [-0.52, 0.52]) {
    let y = 0;
    let k = variant * 3 + (px > 0 ? 5 : 0);
    while (y < 1.0) {
      const h = 0.1 + ((k * 37) % 5) * 0.025;
      const w = 0.75 + ((k * 13) % 4) * 0.06;
      const d = 0.55 + ((k * 7) % 3) * 0.06;
      const rot = (((k * 29) % 7) - 3) * 0.06;
      const c = cols[k % cols.length];
      b.add(UNIT.rbox, mat(px + (((k * 17) % 5) - 2) * 0.02, y + h / 2, 0, 0, rot, 0, w, h, d), c, { r: 0.6 });
      // Tranche des pages.
      b.add(UNIT.box, mat(px + (((k * 17) % 5) - 2) * 0.02, y + h / 2, 0, 0, rot, 0, w * 0.96, h * 0.7, d + 0.01), '#f3eee0', { r: 0.9 });
      y += h;
      k++;
    }
  }
  // Cahier ouvert au sommet.
  b.add(UNIT.box, mat(-0.2, 1.08, 0.05, 0, 0.4, -0.15, 0.5, 0.02, 0.36), '#fdfdf8', { r: 0.9 });
  b.add(UNIT.box, mat(0.3, 1.1, -0.05, 0, -0.3, 0.12, 0.5, 0.02, 0.36), '#fdfdf8', { r: 0.9 });
  return meshFrom(b);
}

// Tableau noir mobile : bloquant, changer de voie.
function board(variant: number): THREE.Object3D {
  const g = new THREE.Group();
  const b = new GeoBuilder();
  const frame = variant % 2 ? '#8b5a2b' : '#9ca3af';
  const metal = { r: 0.35, m: variant % 2 ? 0 : 0.8 };
  b.add(UNIT.box, mat(0, 1.55, 0, 0, 0, 0, 2.2, 1.35, 0.12), '#1f3a2c', { r: 0.85 });
  for (const y of [0.85, 2.25]) b.add(UNIT.box, mat(0, y, 0, 0, 0, 0, 2.3, 0.1, 0.16), frame, metal);
  for (const s of [-1, 1]) {
    b.add(UNIT.box, mat(s * 1.15, 1.3, 0, 0, 0, 0, 0.1, 2.6, 0.16), frame, metal);
    b.add(UNIT.box, mat(s * 1.0, 0.12, 0, 0, 0, 0, 0.12, 0.08, 0.9), '#374151', { r: 0.4, m: 0.7 });
    for (const dz of [-0.4, 0.4]) b.add(UNIT.cyl, mat(s * 1.0, 0.07, dz, 0, 0, Math.PI / 2, 0.12, 0.06, 0.12), '#111', { r: 0.7 });
  }
  // Auget a craie.
  b.add(UNIT.box, mat(0, 0.9, 0.12, 0, 0, 0, 2.0, 0.05, 0.12), frame, metal);
  b.add(UNIT.box, mat(-0.5, 0.94, 0.12, 0, 0.2, 0, 0.14, 0.03, 0.03), '#ffffff', { r: 0.9 });
  b.add(UNIT.box, mat(0.3, 0.95, 0.12, 0, 0, 0, 0.22, 0.06, 0.08), '#5b3a1e', { r: 0.9 });
  g.add(meshFrom(b));
  const tex = makeChalkboardTexture(variant);
  const m = applyBend(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.12 }));
  const face = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 1.25), m);
  face.position.set(0, 1.55, 0.065);
  g.add(face);
  return g;
}

export const BANNERS: [string, [string, string, string]][] = [
  ['EXAMENS', ['#1446a0', '#ffffff', '#f5d10d']],
  ['PARTIELS', ['#c1121f', '#fff8e7', '#1d3557']],
  ['RATTRAPAGE', ['#0b7a75', '#ffffff', '#f5d10d']],
  ['TP NOTE', ['#5b21b6', '#fef3c7', '#f97316']],
  ['SOUTENANCE', ['#111827', '#f5d10d', '#e41f26']],
  ['CONCOURS', ['#b45309', '#ffffff', '#1446a0']],
];

export function createObstacle(type: ObstacleType, variant: number): THREE.Object3D {
  switch (type) {
    case 'barrier': return barrier(variant);
    case 'bench': return bench(variant);
    case 'gate': {
      const [t, c] = BANNERS[variant % BANNERS.length];
      return gate(t, c);
    }
    case 'kiosk': return kiosk(variant);
    case 'bus': return bus(variant);
    case 'ramp': return ramp();
    case 'moto': return moto(variant);
    case 'books': return books(variant);
    case 'board': return board(variant);
    case 'car': {
      const b = new GeoBuilder();
      addCar(b, new THREE.Matrix4(), CAR_COLORS[variant % CAR_COLORS.length]);
      return meshFrom(b);
    }
  }
}

export const VARIANTS: Record<ObstacleType, number> = {
  barrier: 2, bench: 2, gate: BANNERS.length, kiosk: 4, bus: 4, ramp: 1, moto: 3, books: 3, board: 4, car: 7,
};
