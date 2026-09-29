import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { charMat, joint, part } from './materials';
import { applyBend } from '../render/curve';
import { damp } from '../core/rng';

// Le Gardien de l'EPL : un colosse mecanique en livree bleue, coiffe d'une
// toque de diplome, logo sur la poitrine et cape aux couleurs de l'ecole.

export type ChaserAnim = 'idle' | 'run' | 'roar' | 'grab' | 'victory';

const rb = (w: number, h: number, d: number, r = 0.1, s = 3) => new RoundedBoxGeometry(w, h, d, s, Math.min(r, w / 2, h / 2, d / 2));

export class Chaser {
  readonly root = new THREE.Group();
  private body = joint();
  private hips = joint(0, 1.45, 0);
  private torso = joint(0, 0.12, 0);
  private head = joint(0, 1.3, 0);
  private lArm = joint(-0.86, 1.02, 0);
  private rArm = joint(0.86, 1.02, 0);
  private lFore = joint(0, -0.62, 0);
  private rFore = joint(0, -0.62, 0);
  private lThigh = joint(-0.34, -0.1, 0);
  private rThigh = joint(0.34, -0.1, 0);
  private lShin = joint(0, -0.66, 0);
  private rShin = joint(0, -0.66, 0);
  private tassel = joint(0.3, 0.52, 0.3);
  private visorMat: THREE.MeshStandardMaterial;
  private eyeMat: THREE.MeshStandardMaterial;
  private coreMat: THREE.MeshStandardMaterial;
  private capeUniforms = { uTime: { value: 0 }, uSpeed: { value: 1 } };
  private phase = 0;
  private time = 0;
  anim: ChaserAnim = 'idle';
  animTime = 0;
  private shadow: THREE.Mesh;
  onStomp: (() => void) | null = null;
  private lastStep = 1;
  private angry = 0;
  private dormant = 0;
  private dormantTarget = 0;

  constructor(logoPlate: THREE.Texture, capeTex: THREE.Texture, blobTex: THREE.Texture) {
    const paint = charMat('#1648b0', { r: 0.28, m: 0.55, rim: 0.8 });
    const paintDark = charMat('#0c2a6e', { r: 0.35, m: 0.6, rim: 0.6 });
    const steel = charMat('#9aa4b2', { r: 0.25, m: 0.95, rim: 0.5 });
    const gunmetal = charMat('#2b313b', { r: 0.4, m: 0.85, rim: 0.5 });
    const gold = charMat('#f2c230', { r: 0.25, m: 1.0, rim: 0.5 });
    const black = charMat('#121417', { r: 0.6, m: 0.2, rim: 0.4 });
    this.visorMat = charMat('#111', { r: 0.1, m: 0.2, e: '#ffcf1f', ei: 7 });
    this.eyeMat = charMat('#fff', { e: '#fff3b0', ei: 12 });
    this.coreMat = charMat('#111', { e: '#35e0ff', ei: 5 });
    const plateMat = charMat('#ffffff', { r: 0.45, m: 0.05, map: logoPlate, rim: 0.3 });

    this.root.add(this.body);
    this.body.scale.setScalar(0.76);
    this.body.add(this.hips);

    // Bassin.
    this.hips.add(part(rb(1.0, 0.4, 0.62, 0.15), paintDark));
    this.hips.add(part(rb(0.5, 0.3, 0.2, 0.06), gold, 0, -0.05, -0.32));
    this.hips.add(this.torso);

    // Buste massif en V.
    const chest = part(rb(1.55, 1.05, 0.95, 0.28), paint, 0, 0.72, 0);
    this.torso.add(chest);
    this.torso.add(part(rb(1.1, 0.5, 0.75, 0.18), paintDark, 0, 0.18, 0));
    // Abdominaux mecaniques.
    for (let i = 0; i < 3; i++) this.torso.add(part(rb(0.7 - i * 0.08, 0.1, 0.1, 0.04), steel, 0, 0.1 + i * 0.13, -0.38));
    // Plaque blanche du logo EPL sur la poitrine.
    const plateFrame = part(rb(1.12, 0.62, 0.08, 0.05), gold, 0, 0.82, -0.47);
    this.torso.add(plateFrame);
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.04, 0.54), plateMat);
    plate.position.set(0, 0.82, -0.515);
    plate.rotation.y = Math.PI;
    this.torso.add(plate);
    // Noyau lumineux.
    this.torso.add(part(new THREE.CylinderGeometry(0.1, 0.1, 0.05, 20).rotateX(Math.PI / 2), this.coreMat, 0, 0.36, -0.44));
    // Bandes code-barres lumineuses aux couleurs du logo.
    const barColors = ['#ff2a36', '#ffd21f', '#14c2b0', '#3d8bff', '#e62bc0'];
    for (let i = 0; i < 10; i++) {
      const m = charMat('#111', { e: barColors[i % 5], ei: 3.5 });
      for (const s of [-1, 1]) {
        const bar = part(new THREE.BoxGeometry(0.035, 0.22 + (i % 3) * 0.06, 0.02), m, s * (0.3 + i * 0.045), 1.14, -0.48);
        bar.rotation.z = -0.25 * s;
        this.torso.add(bar);
      }
    }

    // Cape flottante dans le dos (vue pendant toute la poursuite).
    const capeGeo = new THREE.PlaneGeometry(1.5, 2.3, 10, 18);
    capeGeo.translate(0, -1.15, 0);
    const capeMat = new THREE.MeshStandardMaterial({ map: capeTex, roughness: 0.7, side: THREE.DoubleSide, envMapIntensity: 0.6 });
    capeMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.capeUniforms.uTime;
      shader.uniforms.uSpeed = this.capeUniforms.uSpeed;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uSpeed;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          float hang = clamp(-position.y / 2.3, 0.0, 1.0);
          float wave = sin(position.x * 2.5 + uTime * 7.0 + hang * 5.0) * 0.12 + sin(uTime * 4.3 + hang * 3.0) * 0.08;
          transformed.z += (hang * hang) * (0.55 * uSpeed) + wave * hang;
          transformed.y += hang * hang * 0.25 * uSpeed;
          transformed.x += sin(uTime * 3.1 + hang * 4.0) * 0.05 * hang;`,
        );
    };
    applyBend(capeMat);
    const cape = new THREE.Mesh(capeGeo, capeMat);
    cape.position.set(0, 1.18, 0.5);
    cape.castShadow = true;
    this.torso.add(cape);
    this.torso.add(part(new THREE.CylinderGeometry(0.06, 0.06, 1.55, 10).rotateZ(Math.PI / 2), gold, 0, 1.2, 0.48));

    // Tete : casque arrondi, visiere lumineuse, toque de diplome.
    this.torso.add(this.head);
    this.head.add(part(new THREE.CylinderGeometry(0.2, 0.26, 0.2, 14), gunmetal, 0, -0.02, 0));
    const helm = part(rb(0.72, 0.62, 0.66, 0.24), paint, 0, 0.3, 0);
    this.head.add(helm);
    this.head.add(part(rb(0.66, 0.16, 0.1, 0.05), this.visorMat, 0, 0.33, -0.3));
    for (const s of [-1, 1]) this.head.add(part(new THREE.SphereGeometry(0.055, 12, 10), this.eyeMat, s * 0.14, 0.33, -0.35));
    this.head.add(part(rb(0.46, 0.14, 0.12, 0.04), steel, 0, 0.1, -0.31));
    for (const s of [-1, 1]) {
      this.head.add(part(new THREE.CylinderGeometry(0.1, 0.1, 0.08, 14).rotateZ(Math.PI / 2), steel, s * 0.38, 0.3, 0));
      this.head.add(part(new THREE.CylinderGeometry(0.015, 0.015, 0.3, 6), steel, s * 0.38, 0.5, 0.05));
    }
    // Toque.
    this.head.add(part(new THREE.CylinderGeometry(0.3, 0.32, 0.16, 20), black, 0, 0.64, 0));
    const board = part(new THREE.BoxGeometry(0.95, 0.05, 0.95), black, 0, 0.74, 0);
    board.rotation.y = Math.PI / 4;
    this.head.add(board);
    this.head.add(part(new THREE.CylinderGeometry(0.04, 0.04, 0.03, 10), gold, 0, 0.775, 0));
    this.tassel.position.set(0, 0.78, 0);
    this.head.add(this.tassel);
    const cord = part(new THREE.CylinderGeometry(0.012, 0.012, 0.48, 6), gold, 0.24, 0, 0.24);
    cord.rotation.z = Math.PI / 2;
    cord.rotation.y = -Math.PI / 4;
    this.tassel.add(cord);
    const tail = joint(0.44, 0, 0.44);
    this.tassel.add(tail);
    tail.add(part(new THREE.CylinderGeometry(0.03, 0.06, 0.3, 8), gold, 0, -0.15, 0));
    this.tassel.userData.tail = tail;

    // Bras.
    for (const [arm, fore, s] of [[this.lArm, this.lFore, -1], [this.rArm, this.rFore, 1]] as const) {
      this.torso.add(arm);
      const pad = part(rb(0.62, 0.42, 0.66, 0.18), paint, s * 0.1, 0.12, 0);
      pad.rotation.z = s * -0.25;
      arm.add(pad);
      // Galons de l'epaulette.
      for (let i = 0; i < 3; i++) arm.add(part(new THREE.BoxGeometry(0.02, 0.05, 0.6), gold, s * (0.2 + i * 0.06), 0.33 - i * 0.03, 0));
      arm.add(part(new THREE.SphereGeometry(0.2, 14, 12), gunmetal));
      arm.add(part(rb(0.34, 0.6, 0.34, 0.12), paintDark, 0, -0.32, 0));
      arm.add(fore);
      fore.add(part(new THREE.SphereGeometry(0.16, 14, 12), gunmetal));
      fore.add(part(rb(0.4, 0.62, 0.4, 0.14), paint, 0, -0.3, 0));
      fore.add(part(rb(0.42, 0.08, 0.42, 0.03), gold, 0, -0.52, 0));
      const fist = part(rb(0.36, 0.34, 0.38, 0.12), gunmetal, 0, -0.74, -0.02);
      fore.add(fist);
      for (let i = 0; i < 4; i++) fore.add(part(rb(0.075, 0.1, 0.1, 0.03), steel, -0.12 + i * 0.08, -0.84, -0.17));
    }

    // Jambes.
    for (const [thigh, shin] of [[this.lThigh, this.lShin], [this.rThigh, this.rShin]] as const) {
      this.hips.add(thigh);
      thigh.add(part(new THREE.SphereGeometry(0.2, 14, 12), gunmetal));
      thigh.add(part(rb(0.4, 0.66, 0.44, 0.14), paint, 0, -0.34, 0));
      thigh.add(shin);
      shin.add(part(new THREE.SphereGeometry(0.17, 14, 12), gunmetal));
      shin.add(part(rb(0.36, 0.56, 0.4, 0.12), paintDark, 0, -0.3, 0));
      shin.add(part(new THREE.CylinderGeometry(0.04, 0.04, 0.5, 8), steel, 0, -0.3, 0.22));
      shin.add(part(rb(0.44, 0.22, 0.66, 0.08), gunmetal, 0, -0.64, -0.08));
      shin.add(part(rb(0.46, 0.06, 0.2, 0.02), gold, 0, -0.56, -0.34));
    }

    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 2.6).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, opacity: 0.6 }),
    );
    this.shadow.renderOrder = 1;
    this.root.add(this.shadow);
  }

  play(anim: ChaserAnim) {
    if (this.anim === anim) return;
    this.anim = anim;
    this.animTime = 0;
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
    const k = 12;
    let hipY = 1.45, torsoRX = 0, torsoRY = 0, headRX = 0;
    let lT = 0, rT = 0, lS = 0, rS = 0, lA = 0, rA = 0, lAZ = 0.15, rAZ = -0.15, lF = -0.2, rF = -0.2;

    if (a === 'run' || a === 'grab') {
      this.phase += dt * (6.2 + speed * 0.3);
      const s = Math.sin(this.phase), c = Math.cos(this.phase);
      hipY = 1.4 + Math.abs(s) * 0.12;
      torsoRX = -0.32;
      torsoRY = s * 0.12;
      headRX = 0.25;
      lT = s * 0.75; rT = -s * 0.75;
      lS = -(Math.max(0, -c) * 1.2 + 0.2);
      rS = -(Math.max(0, c) * 1.2 + 0.2);
      lA = -s * 0.7; rA = s * 0.7;
      lF = 1.0; rF = 1.0;
      lAZ = 0.25; rAZ = -0.25;
      const sign = s > 0 ? 1 : -1;
      if (sign !== this.lastStep) {
        this.lastStep = sign;
        this.onStomp?.();
      }
      if (a === 'grab' || this.angry > 0.5) {
        // Bras tendus vers le fuyard.
        const g = a === 'grab' ? 1 : this.angry;
        lA = lA * (1 - g) + 1.35 * g + s * 0.15;
        rA = rA * (1 - g) + 1.35 * g - s * 0.15;
        lF = lF * (1 - g) + 0.2 * g;
        rF = rF * (1 - g) + 0.2 * g;
      }
      this.capeUniforms.uSpeed.value = damp(this.capeUniforms.uSpeed.value, 1.0, 3, dt);
    } else if (a === 'roar') {
      const t = this.animTime;
      const k2 = Math.min(1, t / 0.25);
      torsoRX = 0.25 * k2;
      headRX = -0.35 * k2;
      lA = -0.4; rA = -0.4;
      lAZ = 1.2 * k2; rAZ = -1.2 * k2;
      lF = 1.6; rF = 1.6;
      hipY = 1.38;
      lT = 0.25; lS = -0.4; rT = -0.2;
      this.body.position.x = Math.sin(t * 50) * 0.02 * k2;
      this.capeUniforms.uSpeed.value = damp(this.capeUniforms.uSpeed.value, 0.4, 3, dt);
    } else if (a === 'victory') {
      const t = this.animTime;
      lA = -2.9; rA = -2.9;
      lAZ = 0.4 + Math.sin(t * 6) * 0.1; rAZ = -0.4 - Math.sin(t * 6) * 0.1;
      lF = 0.3; rF = 0.3;
      torsoRX = 0.12;
      headRX = -0.25;
      hipY = 1.43 + Math.abs(Math.sin(t * 4)) * 0.05;
      this.capeUniforms.uSpeed.value = damp(this.capeUniforms.uSpeed.value, 0.3, 3, dt);
    } else {
      const br = Math.sin(this.time * 1.6);
      hipY = 1.44 + br * 0.015;
      torsoRX = 0.04 + br * 0.02;
      headRY(this.head, Math.sin(this.time * 0.5) * 0.35, dt);
      lA = 0.08; rA = 0.08;
      lF = 0.35; rF = 0.35;
      lAZ = 0.2; rAZ = -0.2;
      this.capeUniforms.uSpeed.value = damp(this.capeUniforms.uSpeed.value, 0.15, 3, dt);
    }
    if (a !== 'roar') this.body.position.x = 0;
    if (a !== 'idle') headRY(this.head, 0, dt);

    this.hips.position.y = damp(this.hips.position.y, hipY, k, dt);
    this.torso.rotation.x = damp(this.torso.rotation.x, torsoRX, k, dt);
    this.torso.rotation.y = damp(this.torso.rotation.y, torsoRY, k, dt);
    this.head.rotation.x = damp(this.head.rotation.x, headRX, k, dt);
    this.lThigh.rotation.x = damp(this.lThigh.rotation.x, lT, k * 1.5, dt);
    this.rThigh.rotation.x = damp(this.rThigh.rotation.x, rT, k * 1.5, dt);
    this.lShin.rotation.x = damp(this.lShin.rotation.x, lS, k * 1.5, dt);
    this.rShin.rotation.x = damp(this.rShin.rotation.x, rS, k * 1.5, dt);
    this.lArm.rotation.x = damp(this.lArm.rotation.x, lA, k, dt);
    this.rArm.rotation.x = damp(this.rArm.rotation.x, rA, k, dt);
    this.lArm.rotation.z = damp(this.lArm.rotation.z, lAZ, k, dt);
    this.rArm.rotation.z = damp(this.rArm.rotation.z, rAZ, k, dt);
    this.lFore.rotation.x = damp(this.lFore.rotation.x, lF, k, dt);
    this.rFore.rotation.x = damp(this.rFore.rotation.x, rF, k, dt);

    // Pompon de la toque qui se balance.
    const tail = this.tassel.userData.tail as THREE.Object3D;
    tail.rotation.x = Math.sin(this.time * 7) * 0.4 + 0.3;
    tail.rotation.z = Math.cos(this.time * 5.3) * 0.3;

    // Visiere : jaune, vire au rouge quand il se rapproche.
    const heat = Math.max(this.angry, a === 'grab' || a === 'roar' || a === 'victory' ? 1 : 0);
    this.visorMat.emissive.setRGB(1, 0.8 * (1 - heat) + 0.08 * heat, 0.12 * (1 - heat));
    this.visorMat.emissiveIntensity = 6 + Math.sin(this.time * 12) * heat * 2;
    this.eyeMat.emissive.setRGB(1, 0.95 - heat * 0.8, 0.7 - heat * 0.65);
    this.coreMat.emissiveIntensity = 4 + Math.sin(this.time * 5) * 1.5;
    // En veille : visiere eteinte, rallumage avec scintillement.
    this.dormant = damp(this.dormant, this.dormantTarget, 2.5, dt);
    if (this.dormant > 0.01) {
      const flicker = this.dormantTarget === 0 && this.dormant > 0.2 ? (Math.random() < 0.5 ? 0.2 : 1) : 1;
      const k = (1 - this.dormant) * flicker;
      this.visorMat.emissiveIntensity *= k;
      this.eyeMat.emissiveIntensity = 12 * k;
      this.coreMat.emissiveIntensity *= k;
    } else {
      this.eyeMat.emissiveIntensity = 12;
    }
  }
}

function headRY(head: THREE.Object3D, target: number, dt: number) {
  head.rotation.y = damp(head.rotation.y, target, 4, dt);
}
