import * as THREE from 'three';
import { createObstacle, ObstacleType, SPECS, VARIANTS } from './ObstacleMeshes';
import { applyBend } from '../render/curve';
import { LANE_WIDTH, PLAYER, WORLD, laneX } from '../config';
import { clamp, pick } from '../core/rng';
import { Path, Zone, J } from './Path';
import { GeoBuilder, mat, UNIT } from '../render/GeoBuilder';

// Generation procedurale du parcours, pieces, bonus et collisions.
// Coordonnee de piste s : distance depuis le depart. z monde = dist - s.

export type PowerUpType = 'magnet' | 'sneakers' | 'double';
export type DossierPiece = 'stamp' | 'copy' | 'signature';
export type BonusType = PowerUpType | 'diploma' | DossierPiece;

interface Obstacle {
  type: ObstacleType;
  lane: number;
  x: number;
  s: number;
  prevS: number;
  len: number;
  vel: number;
  obj: THREE.Object3D;
  key: string;
  hit: boolean;
}

interface Coin {
  x: number;
  y: number;
  s: number;
  alive: boolean;
  flying: boolean;
  fx: number; fy: number; fz: number; // position monde en vol (aimant)
}

interface PowerUp {
  type: BonusType;
  x: number;
  y: number;
  s: number;
  obj: THREE.Object3D;
  alive: boolean;
}

export interface PlayerProbe {
  x: number;
  prevX: number;
  y: number;
  height: number;
  dist: number;
  prevDist: number;
}

export type HitResult = { kind: 'none' } | { kind: 'crash'; type: ObstacleType } | { kind: 'stumble'; type: ObstacleType; fromX: number } | { kind: 'fall' };

const MAX_COINS = 260;

// Obstacles coherents avec chaque lieu : la rue de Lome (vehicules, chantier,
// kiosques), les couloirs (mobilier scolaire), le campus (estrade de remise
// des diplomes, voitures garees, chaises d'amphi).
interface ZoneSet { low: ObstacleType[]; high: ObstacleType[]; full: ObstacleType[]; stage: boolean; moto: boolean; ditch: boolean }
const ZONE_SET: Record<Zone, ZoneSet> = {
  street: { low: ['barrier', 'barrier', 'bench'], high: ['gate'], full: ['kiosk', 'car'], stage: false, moto: true, ditch: true },
  corridor: { low: ['books', 'chairs', 'bench'], high: ['gate'], full: ['board', 'copier'], stage: false, moto: false, ditch: false },
  court: { low: ['bench', 'chairs', 'books', 'barrier'], high: ['gate', 'branch'], full: ['car', 'kiosk', 'copier'], stage: true, moto: false, ditch: true },
};

// Couleurs des cahiers : bandes du logo EPL.
const NOTEBOOK_COLORS = ['#e41f26', '#f5c400', '#0b9185', '#1455b8', '#c3199b'].map((c) => new THREE.Color(c));
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const yAxis = new THREE.Vector3(0, 1, 0);

export class Track {
  readonly group = new THREE.Group();
  private pools = new Map<string, THREE.Object3D[]>();
  private obstacles: Obstacle[] = [];
  private coins: Coin[] = [];
  private powerups: PowerUp[] = [];
  private coinMesh: THREE.InstancedMesh;
  private pageMesh: THREE.InstancedMesh;
  private puPools = new Map<BonusType, THREE.Object3D[]>();
  private nextS = 0;
  private fullUntil = [0, 0, 0];
  private lastPowerS = 0;
  private time = 0;
  // Piece du dossier que le joueur doit encore trouver (fixee par le jeu).
  dossierNeed: DossierPiece | null = null;
  onCoin: ((x: number, y: number, z: number) => void) | null = null;
  onPowerUp: ((t: BonusType, x: number, y: number, z: number) => void) | null = null;

  constructor(private path: Path) {
    // Cahier a spirale : couverture teintee par instance + pages et spirale.
    const cover = new GeoBuilder();
    cover.add(UNIT.rbox, mat(0, 0, 0, 0, 0, 0, 0.52, 0.66, 0.09), '#ffffff', { r: 0.45 });
    const pages = new GeoBuilder();
    pages.add(UNIT.box, mat(0.03, 0, 0, 0, 0, 0, 0.5, 0.62, 0.066), '#fbf8ee', { r: 0.9 });
    pages.add(UNIT.box, mat(0.03, 0.12, 0.047, 0, 0, 0, 0.3, 0.12, 0.004), '#fbf8ee', { r: 0.8 });
    pages.add(UNIT.box, mat(0.03, 0.12, -0.047, 0, 0, 0, 0.3, 0.12, 0.004), '#fbf8ee', { r: 0.8 });
    for (let i = 0; i < 7; i++) {
      pages.add(UNIT.torus, mat(-0.26, -0.27 + i * 0.09, 0, 0, Math.PI / 2, 0, 0.1, 0.1, 0.25), '#d1d5db', { r: 0.25, m: 1 });
    }
    const coverMat = new THREE.MeshStandardMaterial({ vertexColors: false, roughness: 0.45, metalness: 0.05 });
    coverMat.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * 0.55;',
      );
    };
    coverMat.customProgramCacheKey = () => 'notebook';
    applyBend(coverMat);
    const pagesMat = applyBend(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, emissive: '#fff4d8', emissiveIntensity: 0.25 }));
    const cg = cover.build();
    cg.deleteAttribute('color');
    this.coinMesh = new THREE.InstancedMesh(cg, coverMat, MAX_COINS);
    this.pageMesh = new THREE.InstancedMesh(pages.build(), pagesMat, MAX_COINS);
    for (const m of [this.coinMesh, this.pageMesh]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.castShadow = true;
      m.frustumCulled = false;
      m.count = 0;
      this.group.add(m);
    }
    for (let i = 0; i < MAX_COINS; i++) this.coinMesh.setColorAt(i, NOTEBOOK_COLORS[0]);

    // Pre-remplissage des pools pour eviter les saccades en jeu.
    const warm: [ObstacleType, number][] = [['barrier', 6], ['bench', 4], ['gate', 3], ['kiosk', 4], ['moto', 2], ['ditch', 3], ['branch', 3], ['books', 4], ['board', 3], ['car', 7], ['steps', 2], ['stage', 2], ['copier', 3], ['chairs', 3]];
    for (const [t, n] of warm) {
      for (let v = 0; v < VARIANTS[t]; v++) {
        const key = `${t}:${v}`;
        const arr: THREE.Object3D[] = [];
        const count = Math.max(1, Math.ceil(n / VARIANTS[t]) + 1);
        for (let i = 0; i < count; i++) arr.push(createObstacle(t, v));
        this.pools.set(key, arr);
      }
    }
    for (const t of ['magnet', 'sneakers', 'double', 'diploma', 'stamp', 'copy', 'signature'] as BonusType[]) {
      this.puPools.set(t, [createPowerUp(t), createPowerUp(t)]);
    }
  }

  reset(dist = 0) {
    for (const o of this.obstacles) this.release(o);
    this.obstacles = [];
    this.coins = [];
    for (const p of this.powerups) {
      this.group.remove(p.obj);
      this.puPools.get(p.type)!.push(p.obj);
    }
    this.powerups = [];
    this.nextS = dist + 60;
    this.fullUntil = [0, 0, 0];
    this.lastPowerS = dist;
    // Premiers cahiers pour accrocher le joueur.
    this.coinLine(0, dist + 14, 12, 3, () => 1);
  }

  private acquire(type: ObstacleType, variant: number): { obj: THREE.Object3D; key: string } {
    const key = `${type}:${variant}`;
    let arr = this.pools.get(key);
    if (!arr) {
      arr = [];
      this.pools.set(key, arr);
    }
    const obj = arr.pop() ?? createObstacle(type, variant);
    this.group.add(obj);
    return { obj, key };
  }

  private release(o: Obstacle) {
    this.group.remove(o.obj);
    this.pools.get(o.key)!.push(o.obj);
  }

  private add(type: ObstacleType, lane: number, s: number, vel = 0): Obstacle {
    const variant = Math.floor(Math.random() * VARIANTS[type]);
    const { obj, key } = this.acquire(type, variant);
    const spec = SPECS[type];
    const o: Obstacle = { type, lane, x: laneX(lane), s, prevS: s, len: spec.len, vel, obj, key, hit: false };
    obj.visible = true;
    this.obstacles.push(o);
    if (!spec.low && !spec.high) this.fullUntil[lane + 1] = Math.max(this.fullUntil[lane + 1], s + spec.len + 2);
    return o;
  }

  private coinLine(lane: number, s: number, count: number, spacing: number, yFn: (i: number) => number) {
    for (let i = 0; i < count; i++) {
      if (this.coins.length >= MAX_COINS * 3) break;
      this.coins.push({ x: laneX(lane), y: yFn(i), s: s + i * spacing, alive: true, flying: false, fx: 0, fy: 0, fz: 0 });
    }
  }

  private laneFree(lane: number, s: number): boolean {
    return this.fullUntil[lane + 1] < s;
  }

  // Genere une rangee d'obstacles a partir de s. Retourne la longueur utilisee.
  private generateRow(s: number, dist: number): number {
    const d = clamp(dist / 3500, 0, 1);
    const lanes = [-1, 0, 1];
    const free = lanes.filter((l) => this.laneFree(l, s));
    const Z = ZONE_SET[this.path.zoneAt(s)];
    const zoneEnd = ZONE_SET[this.path.zoneAt(s + 32)];
    const smallTypes: ObstacleType[] = [...Z.low, ...Z.high, ...Z.high, ...Z.full];
    const hop: ObstacleType[] = [...Z.low, ...Z.high];
    const r = Math.random();

    if (free.length === 0) return 6;

    // Estrade de remise des diplomes : on monte les marches (ou on saute
    // directement dessus) et on court sur la scene.
    if (r < 0.2 && Z.stage && zoneEnd.stage && free.length >= 2) {
      const l = pick(Math.random, free);
      const sl = SPECS.steps.len, gl = SPECS.stage.len, h = SPECS.stage.top!;
      this.add('steps', l, s);
      this.add('stage', l, s + sl);
      this.coinLine(l, s + 0.3, 3, 0.6, (i) => 1 + ((i + 1) / 3) * h);
      this.coinLine(l, s + sl + 1, 7, 1.4, () => h + 1);
      if (Math.random() < 0.45) this.placeBonus('diploma', l, s + sl + gl - 1.5, h + 1.3);
      const rest = free.filter((x) => x !== l);
      for (const x of rest) {
        if (Math.random() < 0.55 + d * 0.3) this.add(pick(Math.random, hop), x, s + 3 + Math.random() * 5);
        else this.coinLine(x, s, 8, 2.2, () => 1);
      }
      return sl + gl;
    }

    // Caniveau ouvert en travers de la route : a sauter, sinon on tombe.
    if (r < 0.34 && Z.ditch && free.length === 3 && d > 0.03) {
      this.add('ditch', 0, s);
      const l = pick(Math.random, lanes);
      this.coinArc(l, s + SPECS.ditch.len / 2);
      return SPECS.ditch.len + 4;
    }

    // Moto-taxi en contresens.
    if (r < 0.36 && d > 0.08 && Z.moto) {
      const l = pick(Math.random, free);
      const clear = !this.obstacles.some((o) => o.lane === l && o.s + o.len > dist - 5 && o.s < s + 40);
      if (clear) {
        this.add('moto', l, s + 30, 9 + d * 6);
        return 8;
      }
    }

    // Mur de trois obstacles franchissables.
    if (r < 0.48 && free.length === 3 && d > 0.05) {
      const types: ObstacleType[] = [];
      for (const l of lanes) {
        const t = pick(Math.random, hop);
        types.push(t);
        this.add(t, l, s);
      }
      const li = Math.floor(Math.random() * 3);
      if (types[li] !== 'gate') this.coinArc(lanes[li], s);
      else this.coinLine(lanes[li], s - 6, 5, 2.2, () => 0.7);
      return SPECS.bench.len;
    }

    // Deux obstacles, une voie libre avec pieces.
    if (r < 0.78 && free.length >= 2) {
      const n = Math.min(free.length - 1, 2);
      const chosen = shuffle(free.slice()).slice(0, n);
      for (const l of chosen) this.add(pick(Math.random, smallTypes), l, s);
      const open = free.filter((l) => !chosen.includes(l));
      if (open.length) this.coinLine(pick(Math.random, open), s - 8, 8, 2.2, () => 1);
      return 3;
    }

    // Obstacle seul.
    const l = pick(Math.random, free);
    const t = pick(Math.random, smallTypes);
    this.add(t, l, s);
    if (SPECS[t].low) this.coinArc(l, s);
    else {
      const other = free.filter((x) => x !== l);
      if (other.length) this.coinLine(pick(Math.random, other), s - 6, 7, 2.2, () => 1);
    }
    return 3;
  }

  // Arc de pieces suivant la trajectoire du saut.
  private coinArc(lane: number, s: number) {
    const v = PLAYER.jumpVelocity, g = PLAYER.gravity;
    const air = (2 * v) / g;
    const speedGuess = 20;
    const span = air * speedGuess;
    const n = 7;
    for (let i = 0; i < n; i++) {
      const t = (i / (n - 1)) * air;
      const y = v * t - 0.5 * g * t * t + 0.9;
      this.coins.push({ x: laneX(lane), y, s: s - span / 2 + (i / (n - 1)) * span, alive: true, flying: false, fx: 0, fy: 0, fz: 0 });
    }
  }

  private maybePowerUp(s: number) {
    if (s - this.lastPowerS < 240 + Math.random() * 200) return;
    const lanes = [-1, 0, 1].filter((l) => this.laneFree(l, s) && !this.obstacles.some((o) => o.lane === l && Math.abs(o.s - s) < 8));
    if (!lanes.length) return;
    this.lastPowerS = s;
    const type: BonusType = this.dossierNeed && Math.random() < 0.5
      ? this.dossierNeed
      : pick(Math.random, ['magnet', 'sneakers', 'double', 'diploma'] as BonusType[]);
    this.placeBonus(type, pick(Math.random, lanes), s, 1.2);
  }

  private placeBonus(type: BonusType, lane: number, s: number, y: number) {
    const pool = this.puPools.get(type)!;
    const obj = pool.pop() ?? createPowerUp(type);
    this.group.add(obj);
    this.powerups.push({ type, x: laneX(lane), y, s, obj, alive: true });
  }

  update(dt: number, dist: number, speed: number) {
    this.time += dt;
    // Generation.
    while (this.nextS < dist + WORLD.spawnAhead) {
      const seg = this.path.segAt(this.nextS);
      if (this.nextS > seg.s1 - 34) {
        // Carrefour : on reprend apres le virage.
        this.nextS = seg.s1 + J + 26;
        continue;
      }
      const used = this.generateRow(this.nextS, dist);
      const gap = clamp(30 - speed * 0.42, 15, 26) + Math.random() * 8;
      this.maybePowerUp(this.nextS + used + gap * 0.5);
      this.nextS += used + gap;
    }

    // Obstacles.
    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const o = this.obstacles[i];
      o.prevS = o.s;
      if (o.vel) o.s -= o.vel * dt;
      if (o.s + o.len < dist - WORLD.keepBehind) {
        this.release(o);
        this.obstacles.splice(i, 1);
        continue;
      }
      const sc = o.s + o.len / 2;
      this.path.pos(sc, o.x, o.obj.position);
      o.obj.rotation.set(0, this.path.yawAt(sc), 0);
      if (o.type === 'moto') {
        o.obj.rotation.z = Math.sin(this.time * 7 + o.s) * 0.03;
        o.obj.position.y = Math.abs(Math.sin(this.time * 20)) * 0.02;
      }
    }

    // Bonus.
    for (let i = this.powerups.length - 1; i >= 0; i--) {
      const p = this.powerups[i];
      if (p.s < dist - WORLD.keepBehind || !p.alive) {
        this.group.remove(p.obj);
        this.puPools.get(p.type)!.push(p.obj);
        this.powerups.splice(i, 1);
        continue;
      }
      this.path.pos(p.s, p.x, p.obj.position, p.y + Math.sin(this.time * 3 + p.s) * 0.15);
      p.obj.rotation.y = this.time * 2;
    }
  }

  // Pieces : aimantation, collecte, rendu instancie.
  // Cahiers : aimantation (en coordonnees monde), collecte, rendu instancie.
  // (px, py) : position laterale et hauteur du joueur ; pw : sa position monde.
  updateCoins(dt: number, dist: number, px: number, py: number, magnet: boolean, pw: THREE.Vector3) {
    let n = 0;
    const spin = this.time * 4;
    for (let i = this.coins.length - 1; i >= 0; i--) {
      const c = this.coins[i];
      if (!c.alive) {
        this.coins.splice(i, 1);
        continue;
      }
      const ahead = c.s - dist;
      if (ahead < -12) {
        this.coins.splice(i, 1);
        continue;
      }
      if (ahead > WORLD.visibleAhead) continue;
      if (magnet && !c.flying && ahead < 30 && ahead > -1) {
        this.path.pos(c.s, c.x, tmpP, c.y);
        c.flying = true;
        c.fx = tmpP.x; c.fy = tmpP.y; c.fz = tmpP.z;
      }
      if (c.flying) {
        const k = 1 - Math.exp(-dt * 14);
        c.fx += (pw.x - c.fx) * k;
        c.fy += (py + 1 - c.fy) * k;
        c.fz += (pw.z - c.fz) * k;
        tmpP.set(c.fx, c.fy, c.fz);
        if (Math.hypot(c.fx - pw.x, c.fz - pw.z) < 0.8) {
          c.alive = false;
          this.onCoin?.(c.fx, c.fy, c.fz);
          continue;
        }
      } else {
        this.path.pos(c.s, c.x, tmpP, c.y + Math.sin(this.time * 3 + c.s) * 0.06);
        if (Math.abs(ahead) < 0.9 && Math.abs(c.x - px) < 1.0 && c.y > py - 0.4 && c.y < py + PLAYER.height + 0.4) {
          c.alive = false;
          this.onCoin?.(tmpP.x, tmpP.y, tmpP.z);
          continue;
        }
      }
      if (n >= MAX_COINS) continue;
      tmpQ.setFromAxisAngle(yAxis, spin + c.s * 0.3);
      tmpS.setScalar(1);
      tmpM.compose(tmpP, tmpQ, tmpS);
      this.coinMesh.setMatrixAt(n, tmpM);
      this.pageMesh.setMatrixAt(n, tmpM);
      this.coinMesh.setColorAt(n, NOTEBOOK_COLORS[Math.abs(Math.floor(c.s * 0.37)) % NOTEBOOK_COLORS.length]);
      n++;
    }
    this.coinMesh.count = n;
    this.pageMesh.count = n;
    this.coinMesh.instanceMatrix.needsUpdate = true;
    this.pageMesh.instanceMatrix.needsUpdate = true;
    if (this.coinMesh.instanceColor) this.coinMesh.instanceColor.needsUpdate = true;
  }

  checkPowerUps(dist: number, px: number, py: number) {
    for (const p of this.powerups) {
      if (!p.alive) continue;
      const ahead = p.s - dist;
      if (Math.abs(ahead) < 1.0 && Math.abs(p.x - px) < 1.1 && p.y > py - 0.5 && p.y < py + PLAYER.height + 0.5) {
        p.alive = false;
        this.onPowerUp?.(p.type, p.obj.position.x, p.obj.position.y, p.obj.position.z);
      }
    }
  }

  // Hauteur du sol praticable sous le joueur.
  groundAt(x: number, dist: number, y: number): number {
    let g = 0;
    const hd = PLAYER.halfDepth;
    for (const o of this.obstacles) {
      const spec = SPECS[o.type];
      if (spec.top === undefined && !spec.low) continue;
      if (Math.abs(x - o.x) > spec.halfW + 0.05) continue;
      if (dist + hd < o.s || dist - hd > o.s + o.len) continue;
      let top: number;
      if (spec.ramp) top = spec.top! * clamp((dist - o.s) / o.len, 0, 1);
      else top = spec.top ?? spec.y1;
      const tol = spec.ramp ? 0.9 : 0.4;
      if (y >= top - tol && top > g) g = top;
    }
    return g;
  }

  // Collisions laterales et frontales.
  collide(p: PlayerProbe): HitResult {
    const hd = PLAYER.halfDepth, hw = PLAYER.halfWidth;
    for (const o of this.obstacles) {
      if (o.hit) continue;
      const spec = SPECS[o.type];
      if (spec.pit) {
        // Au-dessus du vide et au sol : chute.
        if (p.dist > o.s + 0.3 && p.dist < o.s + o.len - 0.3 && p.y < 0.05) {
          o.hit = true;
          return { kind: 'fall' };
        }
        continue;
      }
      const nowZ = p.dist + hd > o.s && p.prevDist - hd < o.s + o.len;
      if (!nowZ) continue;
      const xNow = Math.abs(p.x - o.x) < spec.halfW + hw;
      if (!xNow) continue;
      // Test vertical.
      let solidTop = spec.y1;
      if (spec.ramp) solidTop = spec.top! * clamp((p.dist - o.s) / o.len, 0, 1);
      const standTol = spec.ramp ? 0.9 : 0.4;
      const onTop = (spec.top !== undefined || spec.low) && p.y >= solidTop - standTol;
      if (onTop) continue;
      const yOverlap = p.y < solidTop && p.y + p.height > spec.y0;
      if (!yOverlap) continue;
      if (spec.ramp) {
        // Rampe prise par le cote.
        const prevX = Math.abs(p.prevX - o.x) < spec.halfW + hw;
        if (!prevX) {
          o.hit = true;
          return { kind: 'stumble', type: o.type, fromX: p.prevX };
        }
        continue;
      }
      const wasZ = p.prevDist + hd > o.prevS && p.prevDist - hd < o.prevS + o.len;
      const wasX = Math.abs(p.prevX - o.x) < spec.halfW + hw;
      if (!wasZ || wasX) {
        o.hit = true;
        return { kind: 'crash', type: o.type };
      }
      o.hit = true;
      return { kind: 'stumble', type: o.type, fromX: p.prevX };
    }
    return { kind: 'none' };
  }

  // Aucune obstacle dans la voie autour de s (a range metres pres).
  laneClear(lane: number, s: number, range: number): boolean {
    return !this.obstacles.some((o) => o.lane === lane && o.s - range < s && o.s + o.len + range > s);
  }

  // Pour les indices visuels : distance du prochain obstacle dans la voie.
  nearestAhead(lane: number, dist: number): number {
    let best = Infinity;
    for (const o of this.obstacles) if (o.lane === lane && o.s > dist) best = Math.min(best, o.s - dist);
    return best;
  }

  get laneWidth() {
    return LANE_WIDTH;
  }
}

const BONUS_COLOR: Record<BonusType, string> = { magnet: '#ff3355', sneakers: '#18e0c8', double: '#b36bff', diploma: '#ffc629', stamp: '#ff5a2c', copy: '#f5f5f0', signature: '#3d8bff' };

function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Bonus : bulle irisee contenant une icone.
function createPowerUp(type: BonusType): THREE.Object3D {
  const g = new THREE.Group();
  const bubbleMat = applyBend(new THREE.MeshStandardMaterial({
    color: '#ffffff', transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0.3,
    emissive: BONUS_COLOR[type], emissiveIntensity: 0.9,
    depthWrite: false,
  }));
  const bubble = new THREE.Mesh(new THREE.SphereGeometry(0.62, 24, 18), bubbleMat);
  g.add(bubble);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.03, 8, 40), applyBend(new THREE.MeshStandardMaterial({
    color: '#fff', emissive: BONUS_COLOR[type], emissiveIntensity: 3,
  })));
  ring.rotation.x = Math.PI / 2;
  g.add(ring);
  const icon = new THREE.Group();
  if (type === 'magnet') {
    const red = applyBend(new THREE.MeshStandardMaterial({ color: '#e11d48', roughness: 0.3, metalness: 0.4 }));
    const steel = applyBend(new THREE.MeshStandardMaterial({ color: '#e5e7eb', roughness: 0.2, metalness: 1 }));
    const u = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.09, 12, 24, Math.PI), red);
    u.rotation.z = Math.PI;
    u.position.y = 0.05;
    icon.add(u);
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.2, 12), red);
      leg.position.set(s * 0.22, 0.15, 0);
      icon.add(leg);
      const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.1, 12), steel);
      tip.position.set(s * 0.22, 0.3, 0);
      icon.add(tip);
    }
    icon.position.y = -0.1;
  } else if (type === 'sneakers') {
    const white = applyBend(new THREE.MeshStandardMaterial({ color: '#fff', roughness: 0.4 }));
    const teal = applyBend(new THREE.MeshStandardMaterial({ color: '#18c9b4', emissive: '#18e0c8', emissiveIntensity: 1.2 }));
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.2, 0.5), white);
    shoe.position.set(0, 0, 0);
    icon.add(shoe);
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.2, 0.22), white);
    top.position.set(0, 0.18, 0.12);
    icon.add(top);
    const sole = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.07, 0.52), teal);
    sole.position.y = -0.12;
    icon.add(sole);
    for (const s of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.18, 0.34), teal);
      wing.position.set(s * 0.14, 0.14, 0.18);
      wing.rotation.x = -0.5;
      icon.add(wing);
    }
    icon.rotation.y = Math.PI / 2;
  } else if (type === 'stamp') {
    // Tampon encreur : manche en bois, semelle, encre rouge.
    const wood = applyBend(new THREE.MeshStandardMaterial({ color: '#8b5a2b', roughness: 0.6 }));
    const base = applyBend(new THREE.MeshStandardMaterial({ color: '#2b2f36', roughness: 0.4, metalness: 0.5 }));
    const ink = applyBend(new THREE.MeshStandardMaterial({ color: '#d61f2c', roughness: 0.5, emissive: '#d61f2c', emissiveIntensity: 0.4 }));
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), wood);
    knob.position.y = 0.28;
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.3, 12), wood);
    handle.position.y = 0.08;
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.1, 0.28), base);
    plate.position.y = -0.12;
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.04, 0.26), ink);
    pad.position.y = -0.19;
    icon.add(knob, handle, plate, pad);
  } else if (type === 'copy' || type === 'signature') {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 340;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fbf8ee';
    ctx.fillRect(0, 0, 256, 340);
    ctx.fillStyle = '#9aa3b5';
    for (let i = 0; i < 12; i++) ctx.fillRect(28, 60 + i * 18, 150 + ((i * 37) % 50), 5);
    ctx.fillStyle = '#1446a0';
    ctx.font = '22px "Archivo Black", sans-serif';
    ctx.textAlign = 'center';
    if (type === 'copy') {
      ctx.fillText('COPIE', 128, 34);
      ctx.strokeStyle = '#1446a0';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(170, 280, 44, 0, Math.PI * 2);
      ctx.stroke();
      ctx.font = '14px "Archivo Black", sans-serif';
      ctx.fillText('CERTIFIÉE', 170, 276);
      ctx.fillText('CONFORME', 170, 294);
    } else {
      ctx.fillText('SIGNATURE', 128, 34);
      ctx.strokeStyle = '#1d3fbf';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(40, 290);
      for (let i = 0; i < 9; i++) ctx.quadraticCurveTo(60 + i * 20, 240 + (i % 2) * 70, 70 + i * 20, 280 - (i % 3) * 12);
      ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const m = applyBend(new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.8, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.35 }));
    const sheet = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.82), m);
    sheet.rotation.z = 0.12;
    icon.add(sheet);
  } else if (type === 'diploma') {
    // Diplome roule avec ruban rouge et sceau dore.
    const paper = applyBend(new THREE.MeshStandardMaterial({ color: '#fff6dc', roughness: 0.7, emissive: '#fff1c4', emissiveIntensity: 0.35 }));
    const red = applyBend(new THREE.MeshStandardMaterial({ color: '#d61f2c', roughness: 0.5 }));
    const gold = applyBend(new THREE.MeshStandardMaterial({ color: '#ffcc33', metalness: 1, roughness: 0.25, emissive: '#ff9d00', emissiveIntensity: 0.6 }));
    const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.8, 20), paper);
    roll.rotation.z = Math.PI / 2 + 0.25;
    icon.add(roll);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.1, 20), red);
    band.rotation.z = Math.PI / 2 + 0.25;
    icon.add(band);
    const seal = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.04, 18), gold);
    seal.rotation.x = Math.PI / 2;
    seal.position.set(0, -0.05, 0.16);
    icon.add(seal);
    for (const sgn of [-1, 1]) {
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.25, 0.01), red);
      tail.position.set(sgn * 0.05, -0.2, 0.15);
      tail.rotation.z = sgn * 0.3;
      icon.add(tail);
    }
  } else {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#ffd21f';
    ctx.font = '88px "Archivo Black", "Arial Black", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('x2', 64, 70);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const m = applyBend(new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, color: new THREE.Color(2.2, 2.0, 1.2) }));
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.8), m);
    icon.add(plane);
  }
  g.add(icon);
  return g;
}
