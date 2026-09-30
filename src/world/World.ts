import * as THREE from 'three';
import { GeoBuilder, enableCulling } from '../render/GeoBuilder';
import { createUberMaterial } from '../render/uber';
import { applyBend } from '../render/curve';
import { makePaverTextures, makeRoadTextures } from '../render/textures';
import { mulberry, range, Rng } from '../core/rng';
import { buildCorridor, buildCourt, ZoneImages } from './Zones';
import { buildJunction, JUNCTION_WALKS } from './Junction';
import { J, L, Path, Segment } from './Path';
import { WORLD } from '../config';
import {
  addBuilding, addBush, addCurb, addLamp, addPalm, addStall, addStreetBits,
  ROAD_HALF, SIDEWALK_OUT, SIDEWALK_Y, BuildingKind,
} from './Scenery';

// Blocs de facades pre-generes (rue), recycles le long du chemin.

export const TRIM_LEN = 16;

function buildBlock(r: Rng, trimSide = 0): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const z0 = L / 2, z1 = -L / 2;
  for (const side of [-1, 1]) {
    addCurb(b, side, z0, z1);
    // Facades (cote interieur d'un virage : degage au debut du bloc).
    let z = side === trimSide ? z0 - TRIM_LEN : z0;
    let lastKind: BuildingKind | null = null;
    while (z > z1 + 0.5) {
      let len = range(r, 6, 12);
      if (z - len < z1 + 3) len = z - z1;
      const kinds: BuildingKind[] = ['pastel', 'pastel', 'shop', 'shop', 'tower', 'compound'];
      let kind = kinds[Math.floor(r() * kinds.length)];
      if (kind === lastKind && kind !== 'pastel') kind = 'pastel';
      addBuilding(b, side, z, len, r, kind);
      lastKind = kind;
      z -= len;
    }
    // Mobilier de trottoir.
    for (let zz = (side === trimSide ? z0 - TRIM_LEN : z0) - 3; zz > z1; zz -= range(r, 5, 9)) {
      const t = r();
      if (t < 0.18) addPalm(b, side * (ROAD_HALF + 1.6), SIDEWALK_Y, zz, range(r, 6, 8.5), r);
      else if (t < 0.34) addStall(b, side, zz, r);
      else if (t < 0.58) addStreetBits(b, side, zz, r);
      else if (t < 0.72) addBush(b, side * (SIDEWALK_OUT - 0.6), SIDEWALK_Y, zz, 0.8, r);
    }
  }
  // Lampadaires en quinconce.
  addLamp(b, -1, z0 - 6);
  addLamp(b, 1, z0 - 24);
  return b.build();
}

type Kind = string;

interface Piece {
  obj: THREE.Object3D;
  kind: Kind;
  sEnd: number;
}

// Decor pose le long du chemin : blocs de 36 m par troncon et carrefours.
// Les objets sont recycles (pools) et places en coordonnees monde.
export class World {
  readonly group = new THREE.Group();
  private pools = new Map<Kind, THREE.Object3D[]>();
  private active: Piece[] = [];
  private cursor = { seg: 0, block: 0, s: 0 };
  private ground: THREE.Mesh;

  constructor(maxAniso: number, img: ZoneImages, private path: Path) {
    const uber = createUberMaterial({ grime: 0.14, groundAO: true });
    const uberIn = createUberMaterial({ grime: 0.12, groundAO: false });
    const r = mulberry(1234);

    // Route, asphalte nu (carrefours) et trottoirs : maillages partages.
    const rt = makeRoadTextures(maxAniso);
    const plain = makeRoadTextures(maxAniso, false);
    const pv = makePaverTextures(maxAniso);
    const roadMat = (t: RoadTexturesT) => applyBend(new THREE.MeshStandardMaterial({
      map: t.map, roughnessMap: t.roughnessMap, normalMap: t.normalMap,
      normalScale: new THREE.Vector2(0.45, 0.45), roughness: 1, metalness: 0, envMapIntensity: 0.9,
    }));
    const road = roadMat(rt);
    const plainMat = roadMat(plain);
    for (const t of [plain.map, plain.roughnessMap, plain.normalMap]) t.wrapS = THREE.RepeatWrapping;
    const walk = applyBend(new THREE.MeshStandardMaterial({ map: pv.map, normalMap: pv.normalMap, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.9, envMapIntensity: 0.6 }));

    const roadGeo = new THREE.PlaneGeometry(ROAD_HALF * 2, L).rotateX(-Math.PI / 2);
    scaleUv(roadGeo, 1, L / 18);
    const walkW = SIDEWALK_OUT - ROAD_HALF + 0.35;
    const walkGeo = new THREE.PlaneGeometry(walkW, L).rotateX(-Math.PI / 2);
    scaleUv(walkGeo, walkW / 1.6, L / 1.6);
    const withRoad = (m: THREE.Object3D) => {
      const rd = new THREE.Mesh(roadGeo, road);
      rd.receiveShadow = true;
      m.add(rd);
      for (const side of [-1, 1]) {
        const w = new THREE.Mesh(walkGeo, walk);
        w.position.set(side * (ROAD_HALF + walkW / 2 - 0.2), SIDEWALK_Y, 0);
        w.receiveShadow = true;
        m.add(w);
      }
    };
    const junctionFloor = (m: THREE.Object3D) => {
      const g = new THREE.PlaneGeometry(2 * J, 2 * J).rotateX(-Math.PI / 2);
      scaleUv(g, (2 * J) / 9, (2 * J) / 18);
      const f = new THREE.Mesh(g, plainMat);
      f.receiveShadow = true;
      m.add(f);
      for (const [x0, x1, z0, z1] of JUNCTION_WALKS) {
        const wg = new THREE.PlaneGeometry(x1 - x0, z1 - z0).rotateX(-Math.PI / 2);
        scaleUv(wg, (x1 - x0) / 1.6, (z1 - z0) / 1.6);
        const w = new THREE.Mesh(wg, walk);
        w.position.set((x0 + x1) / 2, SIDEWALK_Y + 0.005, (z0 + z1) / 2);
        w.receiveShadow = true;
        m.add(w);
      }
    };

    const make = (kind: Kind, n: number, fn: () => { geo: THREE.BufferGeometry; extras: THREE.Object3D[] }, m: THREE.Material, deco?: (o: THREE.Object3D) => void) => {
      const arr: THREE.Object3D[] = [];
      for (let i = 0; i < n; i++) {
        const { geo, extras } = fn();
        const mesh = new THREE.Mesh(geo, m);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        const holder = new THREE.Group();
        holder.add(mesh);
        for (const e of extras) holder.add(e);
        deco?.(holder);
        enableCulling(holder);
        arr.push(holder);
      }
      this.pools.set(kind, arr);
    };
    const plainBlock = (fn: () => THREE.BufferGeometry) => () => ({ geo: fn(), extras: [] });
    make('street', 12, plainBlock(() => buildBlock(r)), uber, withRoad);
    for (const t of [-1, 1]) {
      make('street' + t, 2, plainBlock(() => buildBlock(r, t)), uber, withRoad);
      make('corridorIn' + t, 2, () => buildCorridor(r, 'in', img, t), uberIn);
      make('courtIn' + t, 2, () => buildCourt(r, 'in', img, t), uber, withRoad);
    }
    make('corridorIn', 1, () => buildCorridor(r, 'in', img), uberIn);
    make('courtIn', 1, () => buildCourt(r, 'in', img), uber, withRoad);
    make('corridor', 6, () => buildCorridor(r, 'body', img), uberIn);
    make('corridorOut', 2, () => buildCorridor(r, 'out', img), uberIn);
    make('court', 8, () => buildCourt(r, 'body', img), uber, withRoad);
    make('jstreet', 3, plainBlock(() => buildJunction(r, 'street')), uber, junctionFloor);
    make('jcourt', 3, plainBlock(() => buildJunction(r, 'court')), uber, junctionFloor);

    // Route d'acces devant le batiment de l'EPL (derriere le depart).
    const start = new THREE.Group();
    const sg = new THREE.PlaneGeometry(ROAD_HALF * 2, 20).rotateX(-Math.PI / 2);
    scaleUv(sg, 1, 20 / 18);
    const sr = new THREE.Mesh(sg, road);
    sr.receiveShadow = true;
    start.add(sr);
    const swg = new THREE.PlaneGeometry(walkW, 20).rotateX(-Math.PI / 2);
    scaleUv(swg, walkW / 1.6, 20 / 1.6);
    for (const side of [-1, 1]) {
      const w = new THREE.Mesh(swg, walk);
      w.position.set(side * (ROAD_HALF + walkW / 2 - 0.2), SIDEWALK_Y, 0);
      w.receiveShadow = true;
      start.add(w);
    }
    start.position.z = 6;
    enableCulling(start);
    this.group.add(start);

    // Sol lointain (laterite) qui suit le joueur.
    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(900, 900).rotateX(-Math.PI / 2),
      applyBend(new THREE.MeshStandardMaterial({ color: '#9a5a3a', roughness: 1 })),
    );
    this.ground.position.y = -0.12;
    this.ground.receiveShadow = true;
    this.ground.frustumCulled = false;
    this.group.add(this.ground);
  }

  reset(dist = 0) {
    for (const p of this.active) {
      this.group.remove(p.obj);
      this.pools.get(p.kind)!.push(p.obj);
    }
    this.active = [];
    this.cursor = { seg: 0, block: 0, s: 0 };
    // Avance le curseur jusqu'a la zone de depart (parametre de debogage).
    this.path.ensure(dist);
    while (true) {
      const g = this.path.segs[this.cursor.seg];
      const end = this.cursor.block < g.nBlocks ? g.blocksFrom + (this.cursor.block + 1) * L : g.s1 + J;
      if (end >= dist - WORLD.keepBehind) break;
      this.advanceCursor();
    }
    this.update(dist, 0, 0);
  }

  private advanceCursor() {
    const c = this.cursor;
    const g = this.path.segs[c.seg];
    if (c.block < g.nBlocks) {
      c.block++;
      c.s = g.blocksFrom + c.block * L;
    } else {
      c.seg++;
      c.block = 0;
      c.s = g.s1 + J;
    }
  }

  private kindFor(g: Segment, block: number): Kind {
    const first = block === 0 && g.prevTurn !== 0;
    const t = first ? String(g.prevTurn) : '';
    if (g.zone === 'corridor') {
      if (block === 0) return 'corridorIn' + t;
      if (block === g.nBlocks - 1) return 'corridorOut';
      return 'corridor';
    }
    if (g.zone === 'court') return block === 0 ? 'courtIn' + t : 'court';
    return 'street' + t;
  }

  private junctionStyle(g: Segment): 'street' | 'court' {
    const next = this.path.segs[g.i + 1];
    const z = next && next.zone !== 'corridor' ? next.zone : g.zone !== 'corridor' ? g.zone : 'street';
    return z === 'court' ? 'court' : 'street';
  }

  private take(kind: Kind): THREE.Object3D {
    const pool = this.pools.get(kind)!;
    const idx = Math.floor(Math.random() * pool.length);
    return pool.splice(idx, 1)[0];
  }

  private spawnNext() {
    const c = this.cursor;
    this.path.ensure(c.s + L);
    const g = this.path.segs[c.seg];
    let obj: THREE.Object3D;
    let kind: Kind;
    let sEnd: number;
    if (c.block < g.nBlocks) {
      kind = this.kindFor(g, c.block);
      obj = this.take(kind);
      const sc = g.blocksFrom + (c.block + 0.5) * L;
      this.path.posOn(g, sc, 0, obj.position);
      obj.rotation.set(0, this.path.yawOf(g), 0);
      // Miroir aleatoire des blocs symetriques pour multiplier les variantes.
      obj.scale.set(kind === 'street' || kind === 'court' ? (Math.random() < 0.5 ? 1 : -1) : 1, 1, 1);
      sEnd = sc + L / 2;
    } else {
      kind = 'j' + this.junctionStyle(g);
      obj = this.take(kind);
      this.path.posOn(g, g.s1, 0, obj.position);
      obj.rotation.set(0, this.path.yawOf(g), 0);
      obj.scale.set(g.turn, 1, 1); // virage a gauche = miroir
      sEnd = g.s1 + J;
    }
    this.active.push({ obj, kind, sEnd });
    this.group.add(obj);
    this.advanceCursor();
  }

  // dist : abscisse du joueur ; (px, pz) : sa position monde.
  update(dist: number, px: number, pz: number) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      if (p.sEnd < dist - WORLD.keepBehind) {
        this.group.remove(p.obj);
        this.pools.get(p.kind)!.push(p.obj);
        this.active.splice(i, 1);
      }
    }
    while (this.cursor.s < dist + WORLD.visibleAhead) this.spawnNext();
    this.ground.position.set(Math.round(px / 50) * 50, -0.12, Math.round(pz / 50) * 50);
  }
}

type RoadTexturesT = ReturnType<typeof makeRoadTextures>;

function scaleUv(g: THREE.BufferGeometry, su: number, sv: number) {
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  uv.needsUpdate = true;
}
