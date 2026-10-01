import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { charMat } from './materials';
import { applyBend } from '../render/curve';
import { damp } from '../core/rng';
import { AX, AY, AZ, attachToBone, boneWorldPos, restToModel, rotateBone } from './rigUtil';

// Le Gardien de l'EPL : androide humanoide modele dans Blender
// (tools/blender/build_guardian.py) : visage humain sculpte, carrosserie
// ceramique blanche et bleu EPL, combinaison mecanique. Son maillage est
// recable sur le squelette Mixamo du X Bot, anime par capture de mouvement.
// Accessoires accroches aux os : toque de diplome, plaque logo sur le torse,
// cape au logo dans le dos.

export type ChaserAnim = 'idle' | 'run' | 'roar' | 'grab' | 'victory';

export interface ChaserClips {
  idle: THREE.AnimationClip;
  run: THREE.AnimationClip;
  yes: THREE.AnimationClip;
  no: THREE.AnimationClip;
  dance: THREE.AnimationClip;
}

const SCALE = 1.3;

export class Chaser {
  readonly root = new THREE.Group();
  private model: THREE.Object3D;
  private mixer: THREE.AnimationMixer;
  private actions: Record<string, THREE.AnimationAction> = {};
  private current: THREE.AnimationAction | null = null;
  private bones: Record<string, THREE.Bone> = {};
  private eyeMat: THREE.MeshStandardMaterial;
  private coreMat: THREE.MeshStandardMaterial;
  private capeUniforms = { uTime: { value: 0 }, uSpeed: { value: 1 } };
  private tassel = new THREE.Group();
  private time = 0;
  private lastPhase = 0;
  private roarW = 0;
  private grabW = 0;
  private throwT = -1;
  private orb = new THREE.Group(); // formulaire rejete charge dans la main
  private orbScale = new THREE.Vector3(1, 1, 1);
  private orbMat!: THREE.MeshStandardMaterial;
  private holding = false;
  private windW = 0;
  private angry = 0;
  private dormant = 0;
  private dormantTarget = 0;
  anim: ChaserAnim = 'idle';
  animTime = 0;
  onStomp: (() => void) | null = null;

  constructor(gltf: GLTF, android: GLTF, clips: ChaserClips, logoPlate: THREE.Texture, capeTex: THREE.Texture, blobTex: THREE.Texture) {
    this.model = gltf.scene;
    this.eyeMat = charMat('#fff', { e: '#fff3b0', ei: 12 });
    this.coreMat = charMat('#111', { e: '#35e0ff', ei: 5 });
    const mats: Record<string, THREE.Material> = {
      suit: charMat('#16191f', { r: 0.5, m: 0.65, rim: 0.5 }),
      metal: charMat('#8d939c', { r: 0.28, m: 1.0, rim: 0.4 }),
      white: charMat('#ebe9e4', { r: 0.26, m: 0.04, rim: 0.55 }),
      blue: charMat('#1648b0', { r: 0.24, m: 0.45, rim: 0.8 }),
      skin: charMat('#e6dfd7', { r: 0.36, m: 0.0, rim: 0.45 }),
      eye: this.eyeMat,
      glow: this.coreMat,
    };
    this.model.traverse((o) => {
      if ((o as THREE.Bone).isBone) this.bones[o.name] = o as THREE.Bone;
    });
    this.rebind(android, mats);

    // Accessoires, poses en repos (T-pose) dans le repere du modele.
    const gold = charMat('#f2c230', { r: 0.25, m: 1.0, rim: 0.5 });
    const black = charMat('#121417', { r: 0.6, m: 0.2, rim: 0.4 });
    const B = this.bones;
    const head = B.mixamorigHead, spine2 = B.mixamorigSpine2;
    // Repere de travail : le modele seul, non tourne, a l'echelle 1.
    const tmp = new THREE.Group();
    tmp.add(this.model);
    const top = boneWorldPos(B.mixamorigHeadTop_End ?? head, tmp);
    const hp = boneWorldPos(head, tmp);
    const sp = boneWorldPos(spine2, tmp);

    // Toque.
    const cap = new THREE.Group();
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.025, 0.42), black);
    board.rotation.y = Math.PI / 4;
    board.position.y = 0.06;
    cap.add(board, new THREE.Mesh(new THREE.CylinderGeometry(0.108, 0.114, 0.08, 24), black));
    const button = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.015, 10), gold);
    button.position.y = 0.08;
    cap.add(button);
    this.tassel.position.set(0, 0.08, 0);
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.2, 6), gold);
    cord.rotation.z = Math.PI / 2;
    cord.position.x = 0.1;
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.028, 0.14, 8), gold);
    tail.position.set(0.2, -0.07, 0);
    this.tassel.add(cord, tail);
    this.tassel.rotation.y = -Math.PI / 4;
    cap.add(this.tassel);
    attachToBone(cap, head, tmp, new THREE.Vector3(0, top.y - 0.005, hp.z - 0.012), -0.1);

    // Plaque logo sur le torse, cadre dore, noyau lumineux.
    const plateGroup = new THREE.Group();
    plateGroup.add(new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.2, 0.02, 2, 0.01), gold));
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.315, 0.175), charMat('#ffffff', { r: 0.45, map: logoPlate, rim: 0.2 }));
    plate.position.z = 0.011;
    plateGroup.add(plate);
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 18).rotateX(Math.PI / 2), this.coreMat);
    core.position.set(0, -0.15, -0.01);
    plateGroup.add(core);
    attachToBone(plateGroup, spine2, tmp, new THREE.Vector3(0, sp.y + 0.03, sp.z + 0.158));
    // Cape au logo dans le dos (visible pendant toute la poursuite).
    const capeGeo = new THREE.PlaneGeometry(0.46, 0.85, 8, 14);
    capeGeo.translate(0, -0.425, 0);
    const capeMat = new THREE.MeshStandardMaterial({ map: capeTex, roughness: 0.7, side: THREE.DoubleSide, envMapIntensity: 0.6 });
    capeMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.capeUniforms.uTime;
      shader.uniforms.uSpeed = this.capeUniforms.uSpeed;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uSpeed;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float hang = clamp(-position.y / 0.85, 0.0, 1.0);
          float wave = sin(position.x * 8.0 + uTime * 7.0 + hang * 5.0) * 0.04 + sin(uTime * 4.3 + hang * 3.0) * 0.03;
          transformed.z += (hang * hang) * (0.22 * uSpeed) + wave * hang;
          transformed.y += hang * hang * 0.08 * uSpeed;`);
    };
    applyBend(capeMat);
    const cape = new THREE.Mesh(capeGeo, capeMat);
    cape.castShadow = true;
    // Plan tourne vers l'arriere du modele (-z en repere modele).
    attachToBone(cape, spine2, tmp, new THREE.Vector3(0, sp.y + 0.1, sp.z - 0.145), Math.PI);
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.48, 8).rotateZ(Math.PI / 2), gold);
    attachToBone(bar, spine2, tmp, new THREE.Vector3(0, sp.y + 0.1, sp.z - 0.137));

    // Formulaire rejete enflamme tenu dans la main droite (attaque).
    const hand = B.mixamorigRightHand;
    if (hand) {
      this.orbMat = charMat('#ffc7a8', { r: 0.8, e: '#ff3a1a', ei: 2 });
      const paper = new THREE.Mesh(new THREE.IcosahedronGeometry(0.11, 1), this.orbMat);
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d')!;
      const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,120,60,0.95)');
      gr.addColorStop(1, 'rgba(255,40,20,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, 64, 64);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      glow.scale.setScalar(0.75);
      this.orb.add(paper, glow);
      const hp = boneWorldPos(hand, tmp);
      attachToBone(this.orb, hand, tmp, new THREE.Vector3(hp.x + (hp.x > 0 ? 0.09 : -0.09), hp.y - 0.02, hp.z + 0.04));
      this.orbScale.copy(this.orb.scale); // compense l'echelle du squelette
      this.orb.visible = false;
    }

    // Retour dans la hierarchie finale.
    this.model.scale.setScalar(SCALE);
    this.model.rotation.y = Math.PI;
    this.root.add(this.model);

    this.mixer = new THREE.AnimationMixer(this.model);
    for (const [k, c] of Object.entries(clips)) {
      const a = this.mixer.clipAction(c);
      if (k === 'yes' || k === 'no') {
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
      }
      this.actions[k] = a;
    }
    this.fade('idle', 0);

    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(2.0, 2.0).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, opacity: 0.6 }),
    );
    shadow.renderOrder = 1;
    shadow.position.y = 0.02;
    this.root.add(shadow);
  }

  // Remplace le corps du X Bot par l'androide, recable sur les os du Gardien
  // (memes noms d'os, meme pose de repos). La geometrie est ramenee dans
  // l'espace du modele au repos et les matrices inverses recalculees.
  private rebind(android: GLTF, mats: Record<string, THREE.Material>) {
    const old: THREE.SkinnedMesh[] = [];
    this.model.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) old.push(o as THREE.SkinnedMesh); });
    const ref = old[0].skeleton;
    const index = new Map(ref.bones.map((b, i) => [b.name, i]));
    for (const m of old) m.removeFromParent();
    this.model.updateMatrixWorld(true);
    android.scene.updateMatrixWorld(true);
    const parts: THREE.SkinnedMesh[] = [];
    android.scene.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) parts.push(o as THREE.SkinnedMesh); });
    for (const m of parts) {
      const skel = new THREE.Skeleton(m.skeleton.bones.map((b) => ref.bones[index.get(b.name)!]));
      restToModel(m);
      m.position.set(0, 0, 0);
      m.quaternion.identity();
      m.scale.setScalar(1);
      this.model.add(m);
      m.updateMatrixWorld(true);
      m.bind(skel, new THREE.Matrix4());
      const src = m.material as THREE.Material;
      m.material = mats[src.name] ?? mats.white;
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
    }
  }

  private fade(name: string, time = 0.25) {
    const next = this.actions[name];
    if (!next || next === this.current) return;
    next.reset();
    next.enabled = true;
    next.setEffectiveWeight(1);
    next.play();
    if (this.current) next.crossFadeFrom(this.current, time, false);
    this.current = next;
  }

  play(anim: ChaserAnim) {
    if (this.anim === anim) return;
    this.anim = anim;
    this.animTime = 0;
    const base: Record<ChaserAnim, string> = { idle: 'idle', run: 'run', roar: 'idle', grab: 'run', victory: 'dance' };
    this.fade(base[anim], anim === 'victory' ? 0.4 : 0.25);
  }

  // Geste de lancer (bras droit arme en arriere puis projete vers l'avant).
  throwAnim() {
    this.throwT = 0;
    this.holding = false;
    this.orb.visible = false;
  }

  // Attaque : il arme le bras avec un formulaire enflamme dans la main.
  holdOrb(on: boolean) {
    this.holding = on;
    this.orb.visible = on;
  }

  // Position monde de la main (depart du projectile).
  handWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.orb.getWorldPosition(out);
  }

  setDormant(v: boolean) {
    this.dormantTarget = v ? 1 : 0;
    if (v) this.dormant = 1;
  }

  setAngry(v: number) {
    this.angry = v;
  }

  update(dt: number, speed: number) {
    this.time += dt;
    this.animTime += dt;
    this.capeUniforms.uTime.value = this.time;
    const a = this.anim;
    const run = this.actions.run;
    run.timeScale = 0.9 + Math.max(0, speed - 12) * 0.018;
    this.mixer.update(dt);

    if (this.current === run) {
      const ph = (run.time / run.getClip().duration) % 1;
      if ((this.lastPhase < 0.25 && ph >= 0.25) || (this.lastPhase < 0.75 && ph >= 0.75)) this.onStomp?.();
      this.lastPhase = ph;
    }
    this.capeUniforms.uSpeed.value = damp(this.capeUniforms.uSpeed.value, a === 'run' || a === 'grab' ? 1 : 0.2, 3, dt);

    // Surcouches : rugissement (bras ecartes, tete en arriere), saisie.
    this.roarW = damp(this.roarW, a === 'roar' ? 1 : 0, 10, dt);
    this.grabW = damp(this.grabW, a === 'grab' || (a === 'run' && this.angry > 0.5) ? 1 : 0, 6, dt);
    const B = this.bones;
    const r = this.root;
    if (this.roarW > 0.01) {
      const w = this.roarW;
      const shake = Math.sin(this.time * 45) * 0.03 * w;
      rotateBone(B.mixamorigSpine1, r, AX, -0.3 * w + shake);
      rotateBone(B.mixamorigHead, r, AX, -0.45 * w);
      rotateBone(B.mixamorigLeftArm, r, AZ, -1.0 * w);
      rotateBone(B.mixamorigRightArm, r, AZ, 1.0 * w);
      rotateBone(B.mixamorigLeftForeArm, r, AX, -1.2 * w);
      rotateBone(B.mixamorigRightForeArm, r, AX, -1.2 * w);
    }
    if (this.grabW > 0.01) {
      const w = this.grabW;
      const s = Math.sin(this.time * 9) * 0.12;
      rotateBone(B.mixamorigLeftArm, r, AX, 1.25 * w + s * w);
      rotateBone(B.mixamorigRightArm, r, AX, 1.25 * w - s * w);
      rotateBone(B.mixamorigLeftForeArm, r, AX, -0.9 * w);
      rotateBone(B.mixamorigRightForeArm, r, AX, -0.9 * w);
    }

    // Bras arme pendant la charge (le lancer prend le relais).
    this.windW = damp(this.windW, this.holding ? 1 : 0, 6, dt);
    if (this.windW > 0.01 && this.throwT < 0) {
      // Bras leve au-dessus de la tete, coude plie vers l'arriere.
      rotateBone(B.mixamorigRightArm, r, AX, -3.0 * this.windW);
      rotateBone(B.mixamorigRightArm, r, AZ, 0.45 * this.windW);
      rotateBone(B.mixamorigRightForeArm, r, AX, -1.3 * this.windW);
      rotateBone(B.mixamorigSpine1, r, AY, 0.4 * this.windW);
      rotateBone(B.mixamorigSpine1, r, AX, -0.15 * this.windW);
    }
    if (this.orb.visible) {
      const k = 1 + Math.sin(this.time * 18) * 0.12;
      this.orb.scale.copy(this.orbScale).multiplyScalar(k);
      this.orbMat.emissiveIntensity = 1.8 + Math.sin(this.time * 14) * 0.7;
    }
    if (this.throwT >= 0) {
      this.throwT += dt;
      const u = this.throwT / 0.7;
      if (u >= 1) this.throwT = -1;
      else {
        const ang = u < 0.45 ? -2.6 * (u / 0.45) : -2.6 + 3.9 * ((u - 0.45) / 0.55);
        const w = Math.min(1, (1 - u) * 4);
        rotateBone(B.mixamorigRightArm, r, AX, ang * w);
        rotateBone(B.mixamorigRightForeArm, r, AX, -0.6 * w);
        rotateBone(B.mixamorigSpine1, r, AY, (u < 0.45 ? 0.35 : -0.3) * w);
      }
    }

    // Pompon.
    this.tassel.rotation.z = Math.sin(this.time * 7) * 0.35;
    this.tassel.rotation.x = Math.cos(this.time * 5.3) * 0.25;

    // Yeux : ambre, virent au rouge quand il se rapproche.
    const heat = Math.max(this.angry, a === 'grab' || a === 'roar' || a === 'victory' ? 1 : 0);
    this.eyeMat.emissive.setRGB(1, 0.8 * (1 - heat) + 0.08 * heat, 0.35 * (1 - heat));
    this.eyeMat.emissiveIntensity = 10 + Math.sin(this.time * 12) * heat * 3;
    this.coreMat.emissiveIntensity = 4 + Math.sin(this.time * 5) * 1.5;
    this.dormant = damp(this.dormant, this.dormantTarget, 2.5, dt);
    if (this.dormant > 0.01) {
      const flicker = this.dormantTarget === 0 && this.dormant > 0.2 ? (Math.random() < 0.5 ? 0.2 : 1) : 1;
      const k = (1 - this.dormant) * flicker;
      this.eyeMat.emissiveIntensity *= k;
      this.coreMat.emissiveIntensity *= k;
    }
  }
}
