import * as THREE from 'three';
import { GeoBuilder, mat, UNIT } from '../render/GeoBuilder';
import { Rng, range } from '../core/rng';
import { addBuilding, addEplWing, addLamp, addPalm, addSlimLamp, BuildingKind, ROAD_HALF, SIDEWALK_Y } from './Scenery';
import { J } from './Path';

// Carrefour en angle droit, construit pour un virage a droite (le virage a
// gauche est son miroir). Repere local : origine au coin, le joueur arrive
// de +z et avance vers -z ; la route repart vers +x. Le cote -z (en face)
// est un cul-de-sac : facades et panneaux a chevrons.

// Constructeur qui applique une transformation a tout ce qu'on lui ajoute.
class XBuilder extends GeoBuilder {
  constructor(private target: GeoBuilder, private base: THREE.Matrix4) {
    super();
  }

  override add(geo: THREE.BufferGeometry, matrix: THREE.Matrix4, color: THREE.ColorRepresentation, p = {}): this {
    this.target.add(geo, this.base.clone().multiply(matrix), color, p);
    return this;
  }
}

function buildingRow(b: GeoBuilder, side: number, z0: number, len: number, r: Rng) {
  let z = z0;
  const kinds: BuildingKind[] = ['pastel', 'shop', 'pastel', 'tower'];
  while (z > z0 - len + 0.5) {
    let l = range(r, 7, 12);
    if (z - l < z0 - len + 3) l = z - (z0 - len);
    addBuilding(b, side, z, l, r, kinds[Math.floor(r() * kinds.length)]);
    z -= l;
  }
}

function curbLine(b: GeoBuilder, x0: number, z0: number, x1: number, z1: number) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.max(1, Math.round(len / 1.2));
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
    const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
    b.add(UNIT.box, mat(x, SIDEWALK_Y / 2 + 0.02, z, 0, 0, 0, alongX ? len / n * 0.98 : 0.26, SIDEWALK_Y + 0.04, alongX ? 0.26 : len / n * 0.98), i % 2 ? '#1c1c1c' : '#ecebe6', { r: 0.8 });
  }
}

// Panneau de virage : chevrons jaunes sur fond noir (pointent vers +x).
function chevronBoard(b: GeoBuilder, x: number, y: number, z: number, w: number) {
  b.add(UNIT.box, mat(x, y, z, 0, 0, 0, w, 1.3, 0.1), '#15171b', { r: 0.6 });
  const n = 3;
  for (let i = 0; i < n; i++) {
    const cx = x - w / 2 + (i + 0.5) * (w / n);
    for (const s of [-1, 1]) b.add(UNIT.box, mat(cx, y + s * 0.26, z + 0.07, 0, 0, -s * 0.78, 0.75, 0.2, 0.04), '#ffd21f', { r: 0.5, e: 0.8 });
  }
  for (const dx of [-w / 2 + 0.3, w / 2 - 0.3]) b.add(UNIT.box, mat(x + dx, y / 2, z, 0, 0, 0, 0.12, y, 0.12), '#6b7280', { r: 0.4, m: 0.7 });
}

export function buildJunction(r: Rng, style: 'street' | 'court'): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const H = ROAD_HALF;

  // Bordures du cul-de-sac, du cote gauche et du coin interieur.
  curbLine(b, -H, -H, J, -H);
  curbLine(b, -H, -H, -H, J);
  curbLine(b, H, H, J, H);
  curbLine(b, H, H, H, J);

  // Passage pieton a l'entree de la nouvelle route.
  for (let k = 0; k < 8; k++) b.add(UNIT.box, mat(J - 1.4, 0.012, -H + 0.55 + k * 1.12, 0, 0, 0, 2.2, 0.02, 0.55), '#e8e6dc', { r: 0.7 });

  if (style === 'street') {
    // Facades en face (cul-de-sac) et a gauche.
    const front = new XBuilder(b, new THREE.Matrix4().makeRotationY(Math.PI / 2));
    buildingRow(front, 1, J, 2 * J + 16, r);
    buildingRow(b, -1, J, 2 * J, r);
    addPalm(b, -J + 1.2, SIDEWALK_Y, -J + 1.2, range(r, 6.5, 8), r);
    addLamp(b, -1, -H - 1);
  } else {
    const front = new THREE.Matrix4().makeTranslation(J, 0, -J - 0.4).multiply(new THREE.Matrix4().makeRotationY(Math.PI));
    addEplWing(b, front, 2 * J + 16, r);
    const left = new THREE.Matrix4().makeTranslation(-J - 0.4, 0, -J).multiply(new THREE.Matrix4().makeRotationY(-Math.PI / 2));
    addEplWing(b, left, 2 * J, r, 1);
    addSlimLamp(b, -1, -H - 1);
  }
  // Panneaux de virage bien visibles en arrivant.
  chevronBoard(b, 0.5, 2.6, -J + 0.6, 5.5);
  chevronBoard(b, -J + 2.2, 2.2, -J + 0.9, 2.2);
  return b.build();
}

// Sol du carrefour : trottoirs (zones non routieres) en rectangles.
export const JUNCTION_WALKS: [number, number, number, number][] = [
  [-J, J, -J, -ROAD_HALF], // en face
  [-J, -ROAD_HALF, -ROAD_HALF, J], // a gauche
  [ROAD_HALF, J, ROAD_HALF, J], // coin interieur
];
