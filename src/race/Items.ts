import * as THREE from 'three';
import { applyBend } from '../render/curve';
import { laneX } from '../config';
import type { Path } from '../world/Path';
import type { Track } from '../world/Track';
import type { Rival } from './Rivals';

// Objets d'attaque. Des plis cachetes (enveloppes kraft a cachet de cire)
// flottent sur la route : surtout pendant les defis, parfois en dehors. Le
// pli donne un objet apres une courte roulette :
//  - craie : lancee tout droit dans la voie, la premiere personne touchee
//    tourne sur elle-meme (on l'esquive en changeant de voie ou en sautant) ;
//  - avion en papier : file vers le coureur juste devant ;
//  - tampon REFUSE : lance en arriere sur le Gardien, qui est sonne ;
//  - turbo : acceleration immediate.
// Les rivaux ramassent aussi des plis et lancent de la craie ou des avions.

export type ItemType = 'chalk' | 'plane' | 'stamp' | 'turbo';
export const ITEM_TYPES: ItemType[] = ['chalk', 'plane', 'stamp', 'turbo'];

// Cible d'un tir : -1 joueur, 0..n rival, -2 Gardien, null aucun (tout droit).
type Target = number | null;

interface Box {
  s: number;
  x: number;
  obj: THREE.Object3D;
  alive: boolean;
  t: number;
}

interface Shot {
  type: ItemType;
  owner: number; // -1 joueur, i rival
  s: number;
  x: number;
  y: number;
  vs: number;
  aimX: number;
  target: Target;
  t: number;
  life: number;
  obj: THREE.Object3D;
  segI: number; // troncon courant (les tirs prennent les virages)
  prev: THREE.Vector3; // position monde a l'image precedente
}

export interface RunnerView {
  s: number;
  x: number;
  y: number;
  lane: number;
  speed: number;
  pos: THREE.Vector3; // position monde (tests d'impact)
}

export interface ItemContext {
  player: RunnerView;
  chaserS: number;
  raceOn: boolean;
  rank: number;
  rivals: Rival[];
}

function kraftTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 180;
  const x = c.getContext('2d')!;
  const g = x.createLinearGradient(0, 0, 256, 180);
  g.addColorStop(0, '#d8b27a');
  g.addColorStop(1, '#b98c52');
  x.fillStyle = g;
  x.fillRect(0, 0, 256, 180);
  // Fibres du papier.
  for (let i = 0; i < 900; i++) {
    x.fillStyle = `rgba(${Math.random() < 0.5 ? '90,60,25' : '255,235,200'},${0.05 + Math.random() * 0.08})`;
    x.fillRect(Math.random() * 256, Math.random() * 180, 1 + Math.random() * 3, 1);
  }
  // Rabat.
  x.strokeStyle = 'rgba(80,50,20,0.55)';
  x.lineWidth = 3;
  x.beginPath();
  x.moveTo(4, 6);
  x.lineTo(128, 100);
  x.lineTo(252, 6);
  x.stroke();
  // Tampon administratif bleu.
  x.save();
  x.translate(62, 140);
  x.rotate(-0.18);
  x.strokeStyle = 'rgba(31,79,201,0.75)';
  x.lineWidth = 3;
  x.strokeRect(-40, -14, 80, 28);
  x.fillStyle = 'rgba(31,79,201,0.75)';
  x.font = '700 18px Oswald, Impact, sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText('URGENT', 0, 1);
  x.restore();
  // Cachet de cire rouge et point d'interrogation.
  const sg = x.createRadialGradient(122, 92, 4, 128, 100, 30);
  sg.addColorStop(0, '#e2483d');
  sg.addColorStop(1, '#8e1610');
  x.fillStyle = sg;
  x.beginPath();
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2;
    const r = 26 + (k % 2 ? 3 : -1);
    x.lineTo(128 + Math.cos(a) * r, 100 + Math.sin(a) * r);
  }
  x.fill();
  x.fillStyle = '#f7d9c4';
  x.font = '700 34px Oswald, Impact, sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText('?', 128, 102);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function glowSprite(color: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  return s;
}

export class Items {
  readonly group = new THREE.Group();
  private boxes: Box[] = [];
  private shots: Shot[] = [];
  private kraft = kraftTexture();
  private nextBoxS = 0;
  private time = 0;
  // Objet du joueur : roulette puis objet pret.
  playerItem: ItemType | null = null;
  roll = 0;
  private rollPick: ItemType = 'chalk';
  private rivalItem: (ItemType | null)[] = [];
  private rivalUseAt: number[] = [];
  // Tir dirige vers le joueur (indicateur a l'ecran) : decalage lateral.
  incoming: number | null = null;

  onPickup: ((who: number, x: number, y: number, z: number) => void) | null = null;
  onUse: ((who: number, type: ItemType) => void) | null = null;
  onHitRival: ((r: Rival, type: ItemType, p: THREE.Vector3, owner: number) => void) | null = null;
  onHitPlayer: ((type: ItemType) => void) | null = null;
  onHitRobot: (() => void) | null = null;
  onTrail: ((p: THREE.Vector3, type: ItemType) => void) | null = null;
  onRollTick: (() => void) | null = null;

  constructor(private path: Path, private track: Track) {}

  reset(s: number) {
    for (const b of this.boxes) this.group.remove(b.obj);
    for (const sh of this.shots) this.group.remove(sh.obj);
    this.boxes = [];
    this.shots = [];
    this.playerItem = null;
    this.roll = 0;
    this.rivalItem = [];
    this.rivalUseAt = [];
    this.incoming = null;
    this.nextBoxS = s + 260;
  }

  // ---------- Modeles ----------

  private makeBox(): THREE.Object3D {
    const g = new THREE.Group();
    const face = applyBend(new THREE.MeshStandardMaterial({ map: this.kraft, roughness: 0.85, emissive: '#5a3a10', emissiveIntensity: 0.25 }));
    const edge = applyBend(new THREE.MeshStandardMaterial({ color: '#a77a42', roughness: 0.9 }));
    const env = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.44, 0.05), [edge, edge, edge, edge, face, face]);
    env.castShadow = true;
    const glow = glowSprite('rgba(255,214,120,0.55)');
    glow.scale.set(1.5, 1.2, 1);
    g.add(glow, env);
    g.userData.env = env;
    return g;
  }

  private makeShot(type: ItemType): THREE.Object3D {
    const g = new THREE.Group();
    if (type === 'chalk') {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.22, 10).rotateX(Math.PI / 2), applyBend(new THREE.MeshStandardMaterial({ color: '#f6f4ec', roughness: 0.95, emissive: '#ffffff', emissiveIntensity: 0.25 })));
      g.add(m);
    } else if (type === 'plane') {
      // Avion en papier : deux ailes et une quille pliees.
      const v = new Float32Array([
        0, 0, -0.32, -0.2, 0.01, 0.16, 0, -0.01, 0.16,
        0, 0, -0.32, 0, -0.01, 0.16, 0.2, 0.01, 0.16,
        0, 0, -0.32, 0, -0.01, 0.16, 0, -0.09, 0.16,
      ]);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(v, 3));
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, applyBend(new THREE.MeshStandardMaterial({ color: '#fbfaf3', roughness: 0.8, side: THREE.DoubleSide, emissive: '#ffffff', emissiveIntensity: 0.2 })));
      m.scale.setScalar(1.3);
      g.add(m);
    } else if (type === 'stamp') {
      // Tampon : manche en bois, semelle et caoutchouc rouge.
      const wood = applyBend(new THREE.MeshStandardMaterial({ color: '#8a5a2b', roughness: 0.6 }));
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.16, 12), wood);
      handle.position.y = 0.1;
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.06, 14, 10), wood);
      knob.position.y = 0.2;
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.12), applyBend(new THREE.MeshStandardMaterial({ color: '#2a2d36', roughness: 0.5 })));
      const rubber = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.02, 0.11), applyBend(new THREE.MeshStandardMaterial({ color: '#d42a32', roughness: 0.7, emissive: '#d42a32', emissiveIntensity: 0.4 })));
      rubber.position.y = -0.035;
      g.add(handle, knob, base, rubber);
    }
    for (const o of g.children) o.castShadow = true;
    const glow = glowSprite(type === 'stamp' ? 'rgba(255,80,60,0.6)' : 'rgba(255,255,240,0.5)');
    glow.scale.setScalar(0.7);
    g.add(glow);
    return g;
  }

  // ---------- Plis sur la route ----------

  private spawnBoxes(ctx: ItemContext) {
    const s = ctx.player.s + 120;
    if (s < this.nextBoxS) return;
    if (this.path.nearCorner(s, 14, 16)) {
      this.nextBoxS = s + 15;
      return;
    }
    const lanes = [-1, 0, 1].filter((l) => this.track.laneClear(l, s, 3.5));
    const n = ctx.raceOn ? Math.min(lanes.length, 2 + (Math.random() < 0.4 ? 1 : 0)) : Math.min(lanes.length, 1);
    lanes.sort(() => Math.random() - 0.5);
    for (let i = 0; i < n; i++) {
      const obj = this.makeBox();
      const b: Box = { s, x: laneX(lanes[i]), obj, alive: true, t: Math.random() * 6 };
      this.boxes.push(b);
      this.group.add(obj);
    }
    this.nextBoxS = s + (ctx.raceOn ? 85 + Math.random() * 45 : 420 + Math.random() * 220);
  }

  // Objet tire au sort selon la situation (meilleurs objets derriere).
  private draw(raceOn: boolean, rank: number, rival = false): ItemType {
    const table: [ItemType, number][] = !raceOn ? [['stamp', 0.6], ['turbo', 0.4]]
      : rank <= 1 ? [['stamp', 0.35], ['chalk', 0.4], ['turbo', 0.25]]
        : rank === 2 ? [['chalk', 0.35], ['plane', 0.3], ['turbo', 0.2], ['stamp', 0.15]]
          : [['plane', 0.45], ['turbo', 0.35], ['chalk', 0.2]];
    const t = rival ? table.filter(([k]) => k !== 'stamp') : table;
    const sum = t.reduce((a, [, w]) => a + w, 0);
    let r = Math.random() * sum;
    for (const [k, w] of t) {
      r -= w;
      if (r <= 0) return k;
    }
    return t[0][0];
  }

  // ---------- Utilisation ----------

  // Le joueur utilise son objet. Retourne le type utilise.
  usePlayer(ctx: ItemContext): ItemType | null {
    if (!this.playerItem || this.roll > 0) return null;
    const type = this.playerItem;
    this.playerItem = null;
    this.fire(-1, type, ctx);
    return type;
  }

  private fire(owner: number, type: ItemType, ctx: ItemContext) {
    const me = owner === -1 ? ctx.player : ctx.rivals[owner];
    this.onUse?.(owner, type);
    if (type === 'turbo') return;
    // Cible : coureur juste devant (avion), Gardien (tampon), sinon tout droit.
    let target: Target = null;
    if (type === 'stamp') target = -2;
    if (type === 'plane') {
      let best = Infinity;
      const runners: [number, RunnerView][] = [[-1, ctx.player], ...ctx.rivals.map((r, i) => [i, r] as [number, RunnerView])];
      for (const [id, r] of runners) {
        const d = r.s - me.s;
        if (id !== owner && d > 0.5 && d < 70 && d < best) {
          best = d;
          target = id;
        }
      }
    }
    // Craie d'un rival : visee sur la voie du joueur devant lui.
    let aimX = me.x;
    if (type === 'chalk' && owner >= 0) aimX = laneX(ctx.player.lane);
    const back = type === 'stamp';
    const sh: Shot = {
      type, owner, target, aimX,
      s: me.s + (back ? -0.6 : 0.9),
      x: me.x,
      y: 1.35,
      vs: back ? me.speed - 26 : me.speed + (type === 'plane' ? 16 : 24),
      t: 0,
      life: back ? 0.9 : 2.4,
      obj: this.makeShot(type),
      segI: 0,
      prev: new THREE.Vector3(),
    };
    sh.segI = this.path.segIndexAt(sh.s);
    this.path.posOn(this.path.segs[sh.segI], sh.s, sh.x, sh.prev, sh.y);
    this.shots.push(sh);
    this.group.add(sh.obj);
  }

  // ---------- Mise a jour ----------

  update(dt: number, ctx: ItemContext) {
    this.time += dt;
    this.spawnBoxes(ctx);
    const P = ctx.player;
    // Roulette du joueur.
    if (this.roll > 0) {
      this.roll -= dt;
      if (Math.floor(this.roll * 12) !== Math.floor((this.roll + dt) * 12)) this.onRollTick?.();
      if (this.roll <= 0) {
        this.roll = 0;
        this.playerItem = this.rollPick;
      }
    }
    // Plis : animation, ramassage, nettoyage.
    for (let i = this.boxes.length - 1; i >= 0; i--) {
      const b = this.boxes[i];
      b.t += dt;
      if (!b.alive || b.s < P.s - 30) {
        this.group.remove(b.obj);
        this.boxes.splice(i, 1);
        continue;
      }
      this.path.pos(b.s, b.x, b.obj.position, 1.05 + Math.sin(b.t * 2.4) * 0.12);
      const env = b.obj.userData.env as THREE.Mesh;
      env.rotation.y = b.t * 1.6;
      env.rotation.z = Math.sin(b.t * 1.3) * 0.15;
      // Joueur.
      if (Math.abs(P.s - b.s) < 1.1 && Math.abs(P.x - b.x) < 1.0 && P.y < 2.2) {
        b.alive = false;
        if (!this.playerItem && this.roll <= 0) {
          this.rollPick = this.draw(ctx.raceOn, ctx.rank);
          this.roll = 1.1;
        }
        this.onPickup?.(-1, b.obj.position.x, b.obj.position.y, b.obj.position.z);
        continue;
      }
      // Rivaux.
      ctx.rivals.forEach((r, k) => {
        if (!b.alive || !r.visible) return;
        if (Math.abs(r.s - b.s) < 1.1 && Math.abs(r.x - b.x) < 1.0 && r.y < 2.2) {
          b.alive = false;
          if (!this.rivalItem[k]) {
            this.rivalItem[k] = this.draw(true, 2, true);
            this.rivalUseAt[k] = this.time + 1.5 + Math.random() * 4;
          }
          this.onPickup?.(k, b.obj.position.x, b.obj.position.y, b.obj.position.z);
        }
      });
    }
    // Utilisation par les rivaux.
    ctx.rivals.forEach((r, k) => {
      const it = this.rivalItem[k];
      if (!it || this.time < this.rivalUseAt[k] || !r.visible || r.leaving) return;
      if (it === 'chalk') {
        // Seulement si le joueur est devant, a portee.
        const d = P.s - r.s;
        if (d < 4 || d > 28) {
          this.rivalUseAt[k] = this.time + 0.8;
          return;
        }
      }
      this.rivalItem[k] = null;
      r.actor.throwAnim();
      this.fire(k, it, ctx);
      if (it === 'turbo') r.boost = 0.22;
    });
    // Tirs.
    this.incoming = null;
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const sh = this.shots[i];
      sh.t += dt;
      // Avion : suit sa cible ; craie de rival : rejoint la voie visee.
      if (sh.type === 'plane' && sh.target !== null && sh.target >= -1) {
        const tg = sh.target === -1 ? P : ctx.rivals[sh.target];
        if (tg) {
          sh.x += Math.sign(tg.x - sh.x) * Math.min(Math.abs(tg.x - sh.x), 7 * dt);
          sh.vs = Math.max(sh.vs, tg.speed + 10);
        }
      } else if (sh.type === 'chalk') {
        sh.x += (sh.aimX - sh.x) * Math.min(1, dt * 9);
      }
      sh.s += sh.vs * dt;
      // Virage : meme bascule que les coureurs.
      const seg = this.path.segs[sh.segI];
      if (sh.vs > 0 && this.path.segs[sh.segI + 1] && sh.s >= seg.s1 - 3) {
        const [ns, nx] = this.path.crossCorner(sh.segI, sh.s, sh.x);
        const d = nx - sh.x;
        sh.segI++;
        sh.s = ns;
        sh.x = nx;
        sh.aimX += d;
      }
      if (sh.type === 'stamp') sh.y = 1.35 + Math.sin(Math.min(1, sh.t / sh.life) * Math.PI) * 1.4;
      else sh.y = sh.type === 'plane' ? 1.4 + Math.sin(sh.t * 9) * 0.08 : 1.3;
      // Rendu.
      const cur = sh.s >= this.path.segs[sh.segI].s0 ? this.path.segs[sh.segI] : this.path.segAt(sh.s);
      this.path.posOn(cur, sh.s, sh.x, sh.obj.position, sh.y);
      const yaw = this.path.yawOf(cur);
      sh.obj.rotation.set(0, yaw, 0);
      const body = sh.obj.children[0];
      if (sh.type === 'chalk') body.rotation.x += dt * 20;
      if (sh.type === 'stamp') {
        body.parent!.rotation.x = sh.t * 14;
      }
      if (sh.type === 'plane') sh.obj.rotation.z = Math.sin(sh.t * 6) * 0.3;
      this.onTrail?.(sh.obj.position, sh.type);

      let done = sh.t > sh.life;
      // Tampon : atteint le Gardien.
      if (sh.type === 'stamp' && (sh.s <= ctx.chaserS + 0.5 || sh.t > sh.life)) {
        this.onHitRobot?.();
        done = true;
      }
      // Craie / avion : touche un coureur (sauf le lanceur).
      if (!done && sh.type !== 'stamp') {
        // Impact en espace monde : segment parcouru pendant l'image contre la
        // position du coureur (fiable meme pendant un virage).
        const a = sh.prev, b = sh.obj.position;
        const hit = (r: RunnerView) => {
          if (r.y > 1.3) return false;
          const abx = b.x - a.x, abz = b.z - a.z;
          const l2 = abx * abx + abz * abz || 1e-6;
          const t = Math.max(0, Math.min(1, ((r.pos.x - a.x) * abx + (r.pos.z - a.z) * abz) / l2));
          const dx = a.x + abx * t - r.pos.x, dz = a.z + abz * t - r.pos.z;
          return dx * dx + dz * dz < 0.95 * 0.95;
        };
        if (sh.owner !== -1 && hit(P)) {
          this.onHitPlayer?.(sh.type);
          done = true;
        } else {
          for (let k = 0; k < ctx.rivals.length && !done; k++) {
            const r = ctx.rivals[k];
            if (k === sh.owner || !r.visible) continue;
            if (hit(r)) {
              this.onHitRival?.(r, sh.type, sh.obj.position.clone(), sh.owner);
              done = true;
            }
          }
        }
        // Tir vers le joueur : indicateur tant qu'il arrive de derriere.
        if (!done && sh.owner !== -1 && sh.s < P.s && P.s - sh.s < 30) this.incoming = sh.x;
      }
      sh.prev.copy(sh.obj.position);
      if (done) {
        this.group.remove(sh.obj);
        this.shots.splice(i, 1);
      }
    }
  }

  get rolling(): ItemType | null {
    return this.roll > 0 ? ITEM_TYPES[Math.floor(this.time * 12) % ITEM_TYPES.length] : null;
  }
}
