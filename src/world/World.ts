import * as THREE from 'three';
import { GeoBuilder } from '../render/GeoBuilder';
import { createUberMaterial } from '../render/uber';
import { applyBend } from '../render/curve';
import { makePaverTextures, makeRoadTextures } from '../render/textures';
import { mulberry, range, Rng } from '../core/rng';
import { buildCorridor, buildCourt, ZoneImages } from './Zones';
import { WORLD } from '../config';
import {
  addBuilding, addBush, addCurb, addLamp, addPalm, addStall, addStreetBits,
  ROAD_HALF, SIDEWALK_OUT, SIDEWALK_Y, BuildingKind,
} from './Scenery';

// Decor defilant : route texturee a UV glissantes et blocs de facades
// pre-generes recycles a l'infini.

const L = WORLD.blockLength;

function buildBlock(r: Rng): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const z0 = L / 2, z1 = -L / 2;
  for (const side of [-1, 1]) {
    addCurb(b, side, z0, z1);
    // Facades.
    let z = z0;
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
    for (let zz = z0 - 3; zz > z1; zz -= range(r, 5, 9)) {
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

export type Zone = 'street' | 'corridor' | 'court';
type Kind = 'street' | 'corridor' | 'corridorIn' | 'corridorOut' | 'court' | 'courtIn';

// Enchainement des zones, en nombre de blocs.
const SCHEDULE: [Zone, number][] = [
  ['street', 12], ['corridor', 9], ['street', 7], ['court', 10], ['street', 8], ['corridor', 10], ['court', 9],
];
const START_S = 4;

interface Active {
  mesh: THREE.Mesh;
  kind: Kind;
  s0: number;
}

export function zoneOfBlock(i: number): { zone: Zone; first: boolean; last: boolean } {
  if (i < 0) return { zone: 'street', first: false, last: false };
  let idx = 0, k = i;
  const loopFrom = 1;
  for (;;) {
    const [zone, n] = SCHEDULE[idx];
    if (k < n) return { zone, first: k === 0, last: k === n - 1 };
    k -= n;
    idx++;
    if (idx >= SCHEDULE.length) idx = loopFrom;
  }
}

export function zoneAt(s: number): Zone {
  return zoneOfBlock(Math.floor((s - START_S) / L)).zone;
}

export class World {
  readonly group = new THREE.Group();
  private pools = new Map<Kind, THREE.Mesh[]>();
  private active: Active[] = [];
  private nextIndex = 0;
  private road: THREE.Mesh;
  private walks: THREE.Mesh[] = [];
  private roadTex: THREE.Texture[] = [];
  private walkTex: THREE.Texture[] = [];
  private travelled = 0;

  constructor(maxAniso: number, img: ZoneImages) {
    const uber = createUberMaterial({ grime: 0.14, groundAO: true });
    const uberIn = createUberMaterial({ grime: 0.12, groundAO: false });
    const r = mulberry(1234);
    const make = (kind: Kind, n: number, fn: () => { geo: THREE.BufferGeometry; extras: THREE.Object3D[] }, m = uber) => {
      const arr: THREE.Mesh[] = [];
      for (let i = 0; i < n; i++) {
        const { geo, extras } = fn();
        const mesh = new THREE.Mesh(geo, m);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        for (const e of extras) mesh.add(e);
        arr.push(mesh);
      }
      this.pools.set(kind, arr);
    };
    make('street', 14, () => ({ geo: buildBlock(r), extras: [] }));
    make('corridor', 9, () => buildCorridor(r, 'body', img), uberIn);
    make('corridorIn', 2, () => buildCorridor(r, 'in', img), uberIn);
    make('corridorOut', 2, () => buildCorridor(r, 'out', img), uberIn);
    make('court', 10, () => buildCourt(r, 'body', img));
    make('courtIn', 2, () => buildCourt(r, 'in', img));
    // Route.
    const rt = makeRoadTextures(maxAniso);
    const roadLen = WORLD.visibleAhead + WORLD.keepBehind + 40;
    const roadGeo = new THREE.PlaneGeometry(ROAD_HALF * 2, roadLen, 1, 60);
    roadGeo.rotateX(-Math.PI / 2);
    const repeat = roadLen / 18;
    for (const t of [rt.map, rt.roughnessMap, rt.normalMap]) t.repeat.set(1, repeat);
    const roadMat = applyBend(new THREE.MeshStandardMaterial({
      map: rt.map,
      roughnessMap: rt.roughnessMap,
      normalMap: rt.normalMap,
      normalScale: new THREE.Vector2(0.45, 0.45),
      roughness: 1,
      metalness: 0,
      envMapIntensity: 0.9,
    }));
    this.road = new THREE.Mesh(roadGeo, roadMat);
    this.road.position.z = WORLD.keepBehind - roadLen / 2 + 20;
    this.road.receiveShadow = true;
    this.road.frustumCulled = false;
    this.roadTex = [rt.map, rt.roughnessMap, rt.normalMap];
    this.group.add(this.road);

    // Trottoirs.
    const pv = makePaverTextures(maxAniso);
    const ww = SIDEWALK_OUT - ROAD_HALF + 0.4;
    for (const t of [pv.map, pv.normalMap]) t.repeat.set(ww / 1.6, roadLen / 1.6);
    const walkMat = applyBend(new THREE.MeshStandardMaterial({
      map: pv.map,
      normalMap: pv.normalMap,
      normalScale: new THREE.Vector2(0.6, 0.6),
      roughness: 0.9,
      envMapIntensity: 0.6,
    }));
    this.walkTex = [pv.map, pv.normalMap];
    for (const side of [-1, 1]) {
      const g = new THREE.PlaneGeometry(ww, roadLen, 1, 60);
      g.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, walkMat);
      m.position.set(side * (ROAD_HALF + ww / 2 - 0.2), SIDEWALK_Y, this.road.position.z);
      m.receiveShadow = true;
      m.frustumCulled = false;
      this.walks.push(m);
      this.group.add(m);
    }

    // Sol lointain (laterite) sous les blocs.
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(700, roadLen + 200, 1, 40).rotateX(-Math.PI / 2),
      applyBend(new THREE.MeshStandardMaterial({ color: '#9a5a3a', roughness: 1 })),
    );
    ground.position.set(0, -0.12, this.road.position.z - 100);
    ground.receiveShadow = true;
    ground.frustumCulled = false;
    this.group.add(ground);

    this.reset();
  }

  reset(dist = 0) {
    for (const a of this.active) {
      this.group.remove(a.mesh);
      this.pools.get(a.kind)!.push(a.mesh);
    }
    this.active = [];
    this.travelled = dist;
    this.nextIndex = Math.max(0, Math.floor((dist - WORLD.keepBehind - START_S) / L));
    this.update(dist);
  }

  private kindFor(i: number): Kind {
    const z = zoneOfBlock(i);
    if (z.zone === 'corridor') return z.first ? 'corridorIn' : z.last ? 'corridorOut' : 'corridor';
    if (z.zone === 'court') return z.first ? 'courtIn' : 'court';
    return 'street';
  }

  private spawn(i: number) {
    const kind = this.kindFor(i);
    const pool = this.pools.get(kind)!;
    const idx = Math.floor(Math.random() * pool.length);
    const mesh = pool.splice(idx, 1)[0];
    // Miroir aleatoire (hors couloir, dont les deux murs different).
    mesh.scale.x = kind === 'street' || kind === 'court' ? (Math.random() < 0.5 ? 1 : -1) : 1;
    this.active.push({ mesh, kind, s0: START_S + i * L });
    this.group.add(mesh);
  }

  // dist : distance parcourue par le joueur.
  update(dist: number) {
    this.travelled = dist;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const a = this.active[i];
      const zc = dist - (a.s0 + L / 2);
      if (zc - L / 2 > WORLD.keepBehind) {
        this.group.remove(a.mesh);
        this.pools.get(a.kind)!.push(a.mesh);
        this.active.splice(i, 1);
        continue;
      }
      a.mesh.position.set(0, 0, zc);
    }
    while (START_S + this.nextIndex * L - dist < WORLD.visibleAhead) {
      this.spawn(this.nextIndex);
      const a = this.active[this.active.length - 1];
      a.mesh.position.set(0, 0, dist - (a.s0 + L / 2));
      this.nextIndex++;
    }
    this.scrollTextures();
  }

  private scrollTextures() {
    const off = this.travelled / 18;
    for (const t of this.roadTex) t.offset.y = off;
    const offW = this.travelled / 1.6;
    for (const t of this.walkTex) t.offset.y = offW;
  }
}
