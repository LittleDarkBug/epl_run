import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { charMat } from './materials';
import { applyBend } from '../render/curve';
import { damp } from '../core/rng';
import { AX, AZ, attachToBone, boneWorldPos, rotateBone } from './rigUtil';

// Le Gardien de l'EPL : androide humanoide riggé (X Bot) repeint aux couleurs
// de l'ecole, anime par capture de mouvement. Accessoires accroches aux os :
// toque de diplome, visiere lumineuse, plaque logo sur le torse, cape au logo
// dans le dos, bandes code-barres lumineuses.

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
  private visorMat: THREE.MeshStandardMaterial;
  private eyeMat: THREE.MeshStandardMaterial;
  private coreMat: THREE.MeshStandardMaterial;
  private capeUniforms = { uTime: { value: 0 }, uSpeed: { value: 1 } };
  private tassel = new THREE.Group();
  private time = 0;
  private lastPhase = 0;
  private roarW = 0;
  private grabW = 0;
  private angry = 0;
  private dormant = 0;
  private dormantTarget = 0;
  anim: ChaserAnim = 'idle';
  animTime = 0;
  onStomp: (() => void) | null = null;

  constructor(gltf: GLTF, clips: ChaserClips, logoPlate: THREE.Texture, capeTex: THREE.Texture, blobTex: THREE.Texture) {
    this.model = gltf.scene;
    const paint = charMat('#1648b0', { r: 0.26, m: 0.6, rim: 0.8 });
    const joints = charMat('#23282f', { r: 0.35, m: 0.9, rim: 0.5 });
    this.model.traverse((o) => {
      if ((o as THREE.Bone).isBone) this.bones[o.name] = o as THREE.Bone;
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        const name = (m.material as THREE.Material).name;
        m.material = name.includes('Joints') ? joints : paint;
        m.castShadow = true;
        m.receiveShadow = true;
        m.frustumCulled = false;
      }
    });

    // Accessoires, poses en repos (T-pose) dans le repere du modele.
    const gold = charMat('#f2c230', { r: 0.25, m: 1.0, rim: 0.5 });
    const black = charMat('#121417', { r: 0.6, m: 0.2, rim: 0.4 });
    this.visorMat = charMat('#111', { r: 0.1, m: 0.2, e: '#ffcf1f', ei: 7 });
    this.eyeMat = charMat('#fff', { e: '#fff3b0', ei: 12 });
    this.coreMat = charMat('#111', { e: '#35e0ff', ei: 5 });
    const B = this.bones;
    const head = B.mixamorigHead, spine2 = B.mixamorigSpine2;
    // Repere de travail : le modele seul, non tourne, a l'echelle 1.
    const tmp = new THREE.Group();
    tmp.add(this.model);
    const top = boneWorldPos(B.mixamorigHeadTop_End ?? head, tmp);
    const hp = boneWorldPos(head, tmp);
    const sp = boneWorldPos(spine2, tmp);
    const headH = top.y - hp.y;

    // Toque.
    const cap = new THREE.Group();
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.025, 0.42), black);
    board.rotation.y = Math.PI / 4;
    board.position.y = 0.06;
    cap.add(board, new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.14, 0.08, 20), black));
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
    attachToBone(cap, head, tmp, new THREE.Vector3(0, top.y - 0.09, hp.z - 0.01), -0.12);

    // Visiere lumineuse et yeux.
    const visor = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.105, 0.045, 24, 1, true, -Math.PI * 0.42, Math.PI * 0.84), this.visorMat);
    attachToBone(visor, head, tmp, new THREE.Vector3(0, hp.y + headH * 0.55, hp.z + 0.005));
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.014, 10, 8), this.eyeMat);
      attachToBone(eye, head, tmp, new THREE.Vector3(s * 0.04, hp.y + headH * 0.55, hp.z + 0.105));
    }

    // Plaque logo sur le torse, cadre dore, noyau lumineux.
    const plateGroup = new THREE.Group();
    plateGroup.add(new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.2, 0.02, 2, 0.01), gold));
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.315, 0.175), charMat('#ffffff', { r: 0.45, map: logoPlate, rim: 0.2 }));
    plate.position.z = 0.011;
    plateGroup.add(plate);
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 18).rotateX(Math.PI / 2), this.coreMat);
    core.position.set(0, -0.15, -0.01);
    plateGroup.add(core);
    attachToBone(plateGroup, spine2, tmp, new THREE.Vector3(0, sp.y + 0.05, sp.z + 0.13));
    // Bandes code-barres sur les epaules.
    const barColors = ['#ff2a36', '#ffd21f', '#14c2b0', '#3d8bff', '#e62bc0'];
    for (const [name, s] of [['mixamorigLeftArm', 1], ['mixamorigRightArm', -1]] as const) {
      const bone = B[name];
      if (!bone) continue;
      const ap = boneWorldPos(bone, tmp);
      for (let i = 0; i < 5; i++) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.06, 0.07), charMat('#111', { e: barColors[i], ei: 3.5 }));
        attachToBone(bar, bone, tmp, new THREE.Vector3(ap.x + s * (0.05 + i * 0.022), ap.y + 0.055, ap.z));
      }
    }

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
    attachToBone(cape, spine2, tmp, new THREE.Vector3(0, sp.y + 0.14, sp.z - 0.12), Math.PI);
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.48, 8).rotateZ(Math.PI / 2), gold);
    attachToBone(bar, spine2, tmp, new THREE.Vector3(0, sp.y + 0.14, sp.z - 0.11));

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

    // Pompon.
    this.tassel.rotation.z = Math.sin(this.time * 7) * 0.35;
    this.tassel.rotation.x = Math.cos(this.time * 5.3) * 0.25;

    // Visiere : jaune, vire au rouge quand il se rapproche.
    const heat = Math.max(this.angry, a === 'grab' || a === 'roar' || a === 'victory' ? 1 : 0);
    this.visorMat.emissive.setRGB(1, 0.8 * (1 - heat) + 0.08 * heat, 0.12 * (1 - heat));
    this.visorMat.emissiveIntensity = 6 + Math.sin(this.time * 12) * heat * 2;
    this.eyeMat.emissive.setRGB(1, 0.95 - heat * 0.8, 0.7 - heat * 0.65);
    this.eyeMat.emissiveIntensity = 12;
    this.coreMat.emissiveIntensity = 4 + Math.sin(this.time * 5) * 1.5;
    this.dormant = damp(this.dormant, this.dormantTarget, 2.5, dt);
    if (this.dormant > 0.01) {
      const flicker = this.dormantTarget === 0 && this.dormant > 0.2 ? (Math.random() < 0.5 ? 0.2 : 1) : 1;
      const k = (1 - this.dormant) * flicker;
      this.visorMat.emissiveIntensity *= k;
      this.eyeMat.emissiveIntensity *= k;
      this.coreMat.emissiveIntensity *= k;
    }
  }
}
