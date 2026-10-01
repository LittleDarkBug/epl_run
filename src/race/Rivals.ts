import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Player, type PlayerClips } from '../actors/Player';
import { PLAYER, SPEED, laneX } from '../config';
import { clamp, damp } from '../core/rng';
import type { Path } from '../world/Path';
import type { ObstacleView, Track } from '../world/Track';
import { SPECS, STAGE_H } from '../world/ObstacleMeshes';

// D'autres etudiants (d'autres ecoles, chacun dans sa propre fuite) sur le
// meme parcours. Chacun reprend le modele d'Afi dans sa tenue d'origine
// (memes animations), differencie par la couleur de ses vetements, de ses
// accessoires, sa carnation et sa taille.
// Une IA simple esquive les obstacles (voie, saut, glissade) et se trompe
// parfois ; leur vitesse s'ajuste pour garder le peloton groupe.

export interface RivalLook {
  color: string; // vetements (pantalon)
  accent: string; // lunettes et casque
  skin: number; // multiplicateur de luminosite de la peau
  scale: number;
  skill: number; // ecart de vitesse moyen
  mistakes: number; // probabilite de rater un obstacle
}

// Deux rivaux : en format vertical, plus de coureurs encombrerait l'ecran.
export const RIVAL_LOOKS: RivalLook[] = [
  { color: '#d8452f', accent: '#2f7bff', skin: 0.82, scale: 1.06, skill: 0.012, mistakes: 0.07 },
  { color: '#2e9e5b', accent: '#ffd23a', skin: 1.12, scale: 0.97, skill: 0.006, mistakes: 0.06 },
];

const baseSpeed = (s: number) => SPEED.start + (SPEED.max - SPEED.start) * (1 - Math.exp(-Math.max(0, s) / SPEED.rampDistance));
const tmp = new THREE.Vector3();

export class Rival {
  readonly look: RivalLook;
  readonly actor: Player;
  s = 0;
  prevS = 0;
  x = 0;
  prevX = 0;
  lane = 0;
  private laneFrom = 0;
  private laneT = 1;
  y = 0;
  vy = 0;
  private slide = 0;
  stun = 0;
  private hitCool = 0;
  boost = 0;
  speed = 0;
  leaving = false; // fin du defi : il decroche et disparait
  hold = 0; // vitesse imposee pendant le compte a rebours (0 = libre)
  private segI = 0;
  private turnAt = 3;
  private phase = Math.random() * 10;
  private judged = new WeakSet<object>();
  private failing = new WeakSet<object>();
  readonly pos = new THREE.Vector3();
  private yaw = 0;
  private placed = false;
  visible = false;

  constructor(look: RivalLook, actor: Player) {
    this.look = look;
    this.actor = actor;
    this.actor.root.scale.setScalar(look.scale);
  }

  get grounded() {
    return this.vy === 0;
  }

  reset(s: number, lane: number, path: Path) {
    this.segI = path.segIndexAt(s);
    this.turnAt = 1.5 + Math.random() * 2.7;
    this.s = this.prevS = s;
    this.lane = lane;
    this.x = this.prevX = this.laneFrom = laneX(lane);
    this.laneT = 1;
    this.y = this.vy = 0;
    this.slide = this.stun = this.hitCool = this.boost = 0;
    this.leaving = false;
    this.placed = false;
    this.actor.play('idle');
  }

  private moveTo(lane: number) {
    if (lane === this.lane || lane < -1 || lane > 1) return;
    this.laneFrom = this.x;
    this.lane = lane;
    this.laneT = 0;
  }

  private jump() {
    if (this.vy !== 0 || this.y > 0.05 && this.slide <= 0) return;
    this.vy = PLAYER.jumpVelocity;
    this.slide = 0;
    this.actor.play('jump');
  }

  private duck() {
    if (this.vy !== 0) return;
    this.slide = PLAYER.slideTime;
    this.actor.play('slide');
  }

  // Esquive d'une attaque : bascule sur une voie voisine libre.
  sidestep(track: Track) {
    const opts = [this.lane - 1, this.lane + 1].filter((l) => l >= -1 && l <= 1 && track.laneClear(l, this.s + 10, 8));
    if (opts.length) this.moveTo(opts[Math.floor(Math.random() * opts.length)]);
  }

  // Coup recu (obstacle, objet, attaque) : ralenti et titube.
  hit(time = 1.1) {
    if (this.hitCool > 0) return false;
    this.stun = time;
    this.hitCool = time + 0.4;
    this.actor.play('stumble');
    return true;
  }

  // Voie libre d'obstacles sur [a, b] ?
  private laneFree(obs: ObstacleView[], lane: number, a: number, b: number) {
    const lx = laneX(lane);
    for (const o of obs) {
      if (o.s > b || o.s + o.len < a) continue;
      const spec = SPECS[o.type];
      if (spec.pit) continue;
      if (Math.abs(lx - o.x) < spec.halfW + 0.35) return false;
    }
    return true;
  }

  think(obs: ObstacleView[], playerS: number, playerLane: number) {
    const v = Math.max(this.speed, 8);
    const look = v * 0.75 + 5;
    const lx = laneX(this.lane);
    let next: ObstacleView | null = null;
    for (const o of obs) {
      if (o.s + o.len < this.s || o.s > this.s + look) continue;
      const spec = SPECS[o.type];
      if (!spec.pit && Math.abs(lx - o.x) >= spec.halfW + 0.3) continue;
      if (!next || o.s < next.s) next = o;
    }
    // Eviter de foncer dans le joueur quand il est juste devant.
    const ds = playerS - this.s;
    if (ds > -1 && ds < 4 && playerLane === this.lane && this.laneT >= 1) {
      const opts = [this.lane - 1, this.lane + 1].filter((l) => l >= -1 && l <= 1 && this.laneFree(obs, l, this.s, this.s + 8));
      if (opts.length) this.moveTo(opts[Math.floor(Math.random() * opts.length)]);
    }
    if (!next) return;
    if (!this.judged.has(next)) {
      this.judged.add(next);
      if (Math.random() < this.look.mistakes) this.failing.add(next);
    }
    if (this.failing.has(next)) return;
    const d = next.s - this.s;
    const spec = SPECS[next.type];
    if (spec.pit) {
      if (d < v * 0.1 + 0.8) this.jump();
      return;
    }
    if (spec.ramp || next.type === 'stage') {
      // L'estrade se gravit par les marches : on reste si on est dessus.
      if (next.type === 'stage' && this.y < STAGE_H - 0.4 && this.laneT >= 1) this.dodge(obs, next);
      return;
    }
    if (spec.high) {
      if (d < v * 0.14 + 1.1) this.duck();
      return;
    }
    if (spec.low && spec.top === undefined) {
      if (d < v * 0.09 + 0.9) this.jump();
      return;
    }
    // Obstacle plein : changer de voie, sinon sauter dessus.
    if (this.laneT >= 1 && !this.dodge(obs, next) && d < v * 0.1 + 0.9) this.jump();
  }

  private dodge(obs: ObstacleView[], o: ObstacleView): boolean {
    const opts = [this.lane - 1, this.lane + 1, this.lane - 2, this.lane + 2]
      .filter((l) => l >= -1 && l <= 1 && this.laneFree(obs, l, this.s, o.s + o.len + 4));
    if (!opts.length) return false;
    this.moveTo(opts[0]);
    return true;
  }

  // Virage comme le joueur : bascule sur la rue suivante en entrant dans le
  // carrefour (meme raccourci), position exprimee dans le nouveau repere.
  private corner(path: Path) {
    const seg = path.segs[this.segI];
    if (!path.segs[this.segI + 1] || this.s < seg.s1 - this.turnAt) return;
    const [s, lat] = path.crossCorner(this.segI, this.s, this.x);
    this.segI++;
    this.s = this.prevS = s;
    this.x = this.prevX = this.laneFrom = lat;
    this.lane = clamp(Math.round(lat / laneX(1)), -1, 1);
    this.laneT = 0;
    this.turnAt = 1.5 + Math.random() * 2.7;
  }

  step(dt: number, track: Track, playerS: number, time: number, path: Path) {
    this.prevS = this.s;
    this.prevX = this.x;
    // Vitesse : celle du parcours, rythme propre, peloton groupe.
    const d = this.s - playerS;
    // Legerement sous le rythme du joueur : l'elan des cahiers et les objets
    // permettent de les depasser ; loin derriere, ils recollent au peloton.
    const rubber = d > 0 ? 0.975 - clamp(d / 35, 0, 1) * 0.1 : 0.985 + clamp(-d / 30, 0, 1) * 0.14;
    const pace = 1 + this.look.skill + 0.035 * Math.sin(time * 0.23 + this.phase) + 0.015 * Math.sin(time * 0.71 + this.phase * 2);
    const stunK = this.stun > 0 ? 0.55 : 1;
    const target = baseSpeed(this.s) * (this.leaving ? 0.62 : pace * rubber) * stunK * (1 + this.boost);
    this.speed = this.hold > 0 ? this.hold : damp(this.speed, target, this.stun > 0 ? 8 : 2.5, dt);
    this.s += this.speed * dt;
    this.corner(path);
    if (this.stun > 0) this.stun -= dt;
    if (this.hitCool > 0) this.hitCool -= dt;
    if (this.boost > 0) this.boost = Math.max(0, this.boost - dt * 0.18);

    if (this.laneT < 1) this.laneT = Math.min(1, this.laneT + dt / 0.22);
    const e = 1 - Math.pow(1 - this.laneT, 3);
    this.x = this.laneFrom + (laneX(this.lane) - this.laneFrom) * e;

    const ground = track.groundAt(this.x, this.s, this.y);
    if (this.vy !== 0 || this.y > ground + 0.02) {
      this.vy -= PLAYER.gravity * dt * (this.vy < 0 ? 1.15 : 1);
      this.y += this.vy * dt;
      if (this.y <= ground && this.vy <= 0) {
        this.y = ground;
        this.vy = 0;
        if (this.actor.anim === 'jump') this.actor.play('run');
      }
    } else this.y = ground;
    if (this.slide > 0) {
      this.slide -= dt;
      if (this.slide <= 0 && this.actor.anim === 'slide') this.actor.play('run');
    }
    const h = track.probe({ x: this.x, prevX: this.prevX, y: this.y, height: this.slide > 0 ? PLAYER.slideHeight : PLAYER.height, dist: this.s, prevDist: this.prevS }, 0.3);
    if (h.kind !== 'none' && this.hit(h.kind === 'fall' ? 1.6 : 1.1)) {
      if (h.kind === 'fall') this.vy = PLAYER.jumpVelocity * 0.7;
    }
    if (this.stun <= 0 && this.actor.anim === 'stumble' && this.actor.animTime > 0.55) this.actor.play('run');
    return ground;
  }

  place(dt: number, path: Path, ground: number, running: boolean) {
    const seg = path.segs[this.segI] ?? path.segAt(this.s);
    path.posOn(seg, this.s, this.x, tmp, this.y);
    const yaw = path.yawOf(seg);
    // Position exacte (les virages sont continus) ; seule l'orientation est lissee.
    this.pos.copy(tmp);
    if (!this.placed) {
      this.yaw = yaw;
      this.placed = true;
    } else this.yaw += Math.atan2(Math.sin(yaw - this.yaw), Math.cos(yaw - this.yaw)) * (1 - Math.exp(-dt * 10));
    this.actor.root.position.copy(this.pos);
    this.actor.root.rotation.y = this.yaw;
    const lean = (laneX(this.lane) - this.x) * -0.5;
    this.actor.update(dt, running ? this.speed : 0, this.y, ground, this.vy, lean);
    const sh = this.actor.shadowMesh;
    sh.position.set(this.pos.x, ground + 0.02, this.pos.z);
    sh.visible = this.actor.root.visible;
  }
}

// Variante de la texture d'origine : pantalon (jaune chez Afi) a la couleur
// du rival, lunettes et casque (rouge-orange) a sa couleur d'accent, carnation.
function lookTexture(src: THREE.Texture, look: RivalLook): THREE.Texture {
  const img = src.image as HTMLImageElement | ImageBitmap;
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const x = c.getContext('2d')!;
  x.drawImage(img, 0, 0);
  const id = x.getImageData(0, 0, c.width, c.height);
  const d = id.data;
  const tint = new THREE.Color(look.accent);
  const cloth = new THREE.Color(look.color);
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const sat = mx > 0 ? (mx - mn) / mx : 0;
    // Pantalon jaune.
    if (r > 0.45 && g > 0.35 && b < 0.45 * g && r - b > 0.3) {
      const l = Math.min(1.25, (0.3 * r + 0.59 * g + 0.11 * b) / 0.78);
      d[i] = Math.min(255, cloth.r * 255 * l);
      d[i + 1] = Math.min(255, cloth.g * 255 * l);
      d[i + 2] = Math.min(255, cloth.b * 255 * l);
      continue;
    }
    // Accessoires rouge-orange vif.
    if (r > 0.6 && g < 0.5 * r && b < 0.45 * r && sat > 0.55) {
      const l = 0.35 + 0.75 * mx;
      d[i] = Math.min(255, tint.r * 255 * l);
      d[i + 1] = Math.min(255, tint.g * 255 * l);
      d[i + 2] = Math.min(255, tint.b * 255 * l);
      continue;
    }
    // Peau : brun, saturation moyenne.
    if (r > g && g > b && sat > 0.25 && sat < 0.75 && mx > 0.15 && mx < 0.85 && r - b > 0.1) {
      d[i] = Math.min(255, d[i] * look.skin);
      d[i + 1] = Math.min(255, d[i + 1] * look.skin);
      d[i + 2] = Math.min(255, d[i + 2] * look.skin);
    }
  }
  x.putImageData(id, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.flipY = src.flipY;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export class Rivals {
  readonly list: Rival[] = [];
  readonly group = new THREE.Group();
  private obs: ObstacleView[] = [];
  private time = 0;

  // `base` : copie intacte du modele d'Afi (avant uniforme et retouches).
  constructor(base: THREE.Object3D, clips: PlayerClips, blob: THREE.Texture, private path: Path, private track: Track) {
    let bodyTex: THREE.Texture | null = null;
    base.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (!bodyTex && m && /Body/.test(m.name) && m.map) bodyTex = m.map;
    });
    for (const look of RIVAL_LOOKS) {
      const scene = cloneSkinned(base);
      const actor = new Player({ scene } as GLTF, clips, blob, undefined, bodyTex ? lookTexture(bodyTex, look) : undefined);
      const r = new Rival(look, actor);
      this.list.push(r);
      this.group.add(actor.root, actor.shadowMesh);
    }
  }

  // Les rivaux ne courent que pendant les defis (portions temporaires).
  active = false;

  // Debut d'un defi : ils apparaissent devant, bien dans le champ, sur les
  // voies laterales, et tiennent l'allure du joueur jusqu'au depart.
  enter(s: number, speed: number) {
    const slots: [number, number][] = [[5, -1], [0.6, 1]];
    this.list.forEach((r, i) => {
      r.reset(s + slots[i][0], slots[i][1], this.path);
      r.speed = speed;
      r.hold = speed;
      r.actor.play('run');
    });
    this.active = true;
  }

  // Compte a rebours : meme allure que le joueur.
  holdAt(speed: number) {
    for (const r of this.list) if (r.hold > 0) r.hold = speed;
  }

  // Depart : chacun reprend son allure, petite accelaration.
  release() {
    for (const r of this.list) {
      r.hold = 0;
      r.boost = 0.06;
    }
  }

  // Fin du defi : ils decrochent puis disparaissent.
  leave() {
    for (const r of this.list) r.leaving = true;
  }

  hide() {
    this.active = false;
    for (const r of this.list) {
      r.leaving = false;
      r.hold = 0;
      r.visible = false;
      r.actor.root.visible = false;
      r.actor.shadowMesh.visible = false;
    }
  }

  update(dt: number, playerS: number, playerLane: number, running: boolean, show: boolean) {
    this.time += dt;
    if (!this.active) return;
    if (this.list.every((r) => r.leaving && r.s - playerS < -30)) {
      this.hide();
      return;
    }
    for (const r of this.list) {
      let ground = 0;
      if (running) {
        this.track.obstaclesIn(r.s, r.s + 45, this.obs);
        r.think(this.obs, playerS, playerLane);
        ground = r.step(dt, this.track, playerS, this.time, this.path);
      }
      // Rendu seulement pres du joueur (le decor n'existe que la).
      const rel = r.s - playerS;
      r.visible = show && rel > -28 && rel < 120;
      r.actor.root.visible = r.visible;
      if (r.visible) r.place(dt, this.path, ground, running);
      else r.actor.shadowMesh.visible = false;
    }
  }

  // Rang du joueur (1 = en tete) parmi tous les coureurs.
  rankOf(playerS: number): number {
    let n = 1;
    for (const r of this.list) if (r.s > playerS) n++;
    return n;
  }
}
