import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { charMat, joint, part } from './materials';
import { damp } from '../core/rng';

// Etudiant fugitif : personnage procedural articule, anime par poses
// melangees (course, saut, glissade, chute, attente).

export type PlayerAnim = 'idle' | 'run' | 'jump' | 'slide' | 'stumble' | 'fall' | 'cheer';

interface Pose {
  hipY: number; bodyRX: number; bodyRZ: number; torsoRX: number; torsoRY: number; headRX: number; headRY: number;
  lThigh: number; rThigh: number; lShin: number; rShin: number; lFoot: number; rFoot: number;
  lArm: number; rArm: number; lArmZ: number; rArmZ: number; lFore: number; rFore: number;
}

const KEYS: (keyof Pose)[] = ['hipY', 'bodyRX', 'bodyRZ', 'torsoRX', 'torsoRY', 'headRX', 'headRY', 'lThigh', 'rThigh', 'lShin', 'rShin', 'lFoot', 'rFoot', 'lArm', 'rArm', 'lArmZ', 'rArmZ', 'lFore', 'rFore'];

function basePose(): Pose {
  return { hipY: 0.98, bodyRX: 0, bodyRZ: 0, torsoRX: 0, torsoRY: 0, headRX: 0, headRY: 0, lThigh: 0, rThigh: 0, lShin: 0, rShin: 0, lFoot: 0, rFoot: 0, lArm: 0, rArm: 0, lArmZ: 0.12, rArmZ: -0.12, lFore: 0.2, rFore: 0.2 };
}

const capsule = (r: number, len: number) => new THREE.CapsuleGeometry(r, Math.max(0.001, len - 2 * r), 6, 12);

export class Player {
  readonly root = new THREE.Group();
  private body = joint();
  private hips = joint(0, 0.98, 0);
  private torso = joint(0, 0.06, 0);
  private head = joint(0, 0.62, 0);
  private lArm = joint(-0.25, 0.5, 0);
  private rArm = joint(0.25, 0.5, 0);
  private lFore = joint(0, -0.29, 0);
  private rFore = joint(0, -0.29, 0);
  private lThigh = joint(-0.1, -0.04, 0);
  private rThigh = joint(0.1, -0.04, 0);
  private lShin = joint(0, -0.44, 0);
  private rShin = joint(0, -0.44, 0);
  private lFoot = joint(0, -0.43, 0);
  private rFoot = joint(0, -0.43, 0);
  private sneakerMat: THREE.MeshStandardMaterial;
  private shadow: THREE.Mesh;
  private pose = basePose();
  private phase = 0;
  private time = 0;
  private flip = 0;
  private flipping = false;
  anim: PlayerAnim = 'idle';
  animTime = 0;
  onFootstep: (() => void) | null = null;
  private lastStepSign = 1;

  constructor(blobTex: THREE.Texture) {
    const skin = charMat('#6e4127', { r: 0.55, e: '#3a1408', ei: 0.12 });
    const hoodie = charMat('#ff5a2c', { r: 0.82 });
    const hoodieDark = charMat('#d9431c', { r: 0.85 });
    const pants = charMat('#26324d', { r: 0.8 });
    const hair = charMat('#15100d', { r: 0.95, rim: 0.6 });
    const cap = charMat('#f5d10d', { r: 0.6 });
    const white = charMat('#f4f4f0', { r: 0.5 });
    const pack = charMat('#14a89a', { r: 0.6 });
    const strap = charMat('#1d2a33', { r: 0.7 });
    const dark = charMat('#161616', { r: 0.4, m: 0.3 });
    this.sneakerMat = charMat('#ffffff', { r: 0.45, e: '#18e0c8', ei: 0 });
    const sole = charMat('#18c9b4', { r: 0.5 });

    this.root.add(this.body);
    this.body.add(this.hips);
    this.hips.add(part(new RoundedBoxGeometry(0.36, 0.22, 0.24, 2, 0.08), pants, 0, 0.02, 0));
    // Ceinture.
    this.hips.add(part(new THREE.BoxGeometry(0.37, 0.05, 0.25), dark, 0, 0.11, 0));
    this.hips.add(this.torso);

    // Buste (sweat a capuche).
    const chest = part(new RoundedBoxGeometry(0.46, 0.58, 0.28, 3, 0.12), hoodie, 0, 0.3, 0);
    this.torso.add(chest);
    this.torso.add(part(new RoundedBoxGeometry(0.44, 0.12, 0.27, 2, 0.05), hoodieDark, 0, 0.04, 0));
    this.torso.add(part(new RoundedBoxGeometry(0.28, 0.14, 0.04, 2, 0.02), hoodieDark, 0, 0.16, -0.14));
    const hood = part(new THREE.TorusGeometry(0.13, 0.055, 8, 16), hoodie, 0, 0.58, 0.07);
    hood.rotation.x = Math.PI / 2 - 0.3;
    this.torso.add(hood);
    for (const s of [-1, 1]) this.torso.add(part(new THREE.CylinderGeometry(0.008, 0.008, 0.2), white, s * 0.05, 0.47, -0.145));
    // Sac a dos.
    this.torso.add(part(new RoundedBoxGeometry(0.38, 0.44, 0.2, 3, 0.07), pack, 0, 0.3, 0.23));
    this.torso.add(part(new RoundedBoxGeometry(0.3, 0.16, 0.08, 2, 0.04), pack, 0, 0.17, 0.35));
    this.torso.add(part(new THREE.BoxGeometry(0.32, 0.03, 0.02), charMat('#f5d10d', { r: 0.4, e: '#f5d10d', ei: 0.4 }), 0, 0.42, 0.335));
    for (const s of [-1, 1]) this.torso.add(part(new THREE.BoxGeometry(0.05, 0.5, 0.3), strap, s * 0.15, 0.32, 0.03));
    // Casque audio autour du cou.
    const phones = part(new THREE.TorusGeometry(0.11, 0.022, 6, 16, Math.PI * 1.3), dark, 0, 0.6, 0);
    phones.rotation.set(Math.PI / 2, 0, Math.PI * 0.85);
    this.torso.add(phones);
    for (const s of [-1, 1]) this.torso.add(part(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 12).rotateZ(Math.PI / 2), charMat('#ff5a2c', { r: 0.4, m: 0.2 }), s * 0.11, 0.6, -0.04));

    // Tete.
    this.torso.add(this.head);
    this.head.add(part(new THREE.CylinderGeometry(0.06, 0.07, 0.12, 10), skin, 0, 0.0, 0));
    const skull = part(new THREE.SphereGeometry(0.135, 20, 16), skin, 0, 0.15, 0);
    skull.scale.set(0.95, 1.1, 1.0);
    this.head.add(skull);
    this.head.add(part(new THREE.SphereGeometry(0.03, 8, 6), skin, 0, 0.13, -0.135));
    for (const s of [-1, 1]) {
      this.head.add(part(new THREE.SphereGeometry(0.028, 8, 6), skin, s * 0.13, 0.15, 0));
      const eye = part(new THREE.SphereGeometry(0.022, 10, 8), white, s * 0.048, 0.18, -0.118);
      this.head.add(eye);
      this.head.add(part(new THREE.SphereGeometry(0.012, 8, 6), dark, s * 0.048, 0.18, -0.136));
      this.head.add(part(new THREE.BoxGeometry(0.05, 0.012, 0.02), hair, s * 0.05, 0.215, -0.125));
    }
    const hairTop = part(new THREE.SphereGeometry(0.145, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), hair, 0, 0.17, 0.01);
    this.head.add(hairTop);
    // Casquette a l'envers.
    const capTop = part(new THREE.SphereGeometry(0.15, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.45), cap, 0, 0.2, 0.005);
    this.head.add(capTop);
    const visor = part(new THREE.CylinderGeometry(0.11, 0.11, 0.015, 16, 1, false, 0, Math.PI), cap, 0, 0.22, 0.12);
    visor.rotation.y = -Math.PI / 2;
    visor.scale.set(1, 1, 0.9);
    this.head.add(visor);

    // Bras.
    for (const [arm, fore, s] of [[this.lArm, this.lFore, -1], [this.rArm, this.rFore, 1]] as const) {
      this.torso.add(arm);
      arm.add(part(new THREE.SphereGeometry(0.085, 12, 10), hoodie, 0, 0, 0));
      arm.add(part(capsule(0.07, 0.32), hoodie, 0, -0.14, 0));
      arm.add(fore);
      fore.add(part(capsule(0.06, 0.26), hoodie, 0, -0.1, 0));
      fore.add(part(new THREE.CylinderGeometry(0.065, 0.065, 0.05, 10), hoodieDark, 0, -0.21, 0));
      const hand = part(new THREE.SphereGeometry(0.058, 12, 10), skin, 0, -0.27, 0);
      hand.scale.set(0.9, 1.1, 1);
      fore.add(hand);
      void s;
    }

    // Jambes.
    for (const [thigh, shin, foot] of [[this.lThigh, this.lShin, this.lFoot], [this.rThigh, this.rShin, this.rFoot]] as const) {
      this.hips.add(thigh);
      thigh.add(part(capsule(0.092, 0.46), pants, 0, -0.21, 0));
      thigh.add(shin);
      shin.add(part(capsule(0.08, 0.44), pants, 0, -0.2, 0));
      shin.add(part(new THREE.CylinderGeometry(0.085, 0.08, 0.06, 10), pants, 0, -0.38, 0));
      shin.add(foot);
      foot.add(part(new RoundedBoxGeometry(0.14, 0.11, 0.3, 2, 0.045), this.sneakerMat, 0, 0.0, -0.05));
      foot.add(part(new RoundedBoxGeometry(0.15, 0.04, 0.31, 2, 0.015), sole, 0, -0.055, -0.05));
      foot.add(part(new THREE.BoxGeometry(0.145, 0.02, 0.1), charMat('#ff5a2c', { r: 0.5 }), 0, 0.03, 0.02));
    }

    // Ombre de contact.
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.1, 1.1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, opacity: 0.55 }),
    );
    this.shadow.renderOrder = 1;
  }

  get shadowMesh(): THREE.Mesh {
    return this.shadow;
  }

  setSuperSneakers(on: boolean) {
    this.sneakerMat.emissiveIntensity = on ? 2.4 : 0;
  }

  play(anim: PlayerAnim) {
    if (this.anim === anim) return;
    this.anim = anim;
    this.animTime = 0;
  }

  startFlip() {
    this.flipping = true;
    this.flip = 0;
  }

  // groundY : hauteur du sol sous le joueur. vy : vitesse verticale.
  update(dt: number, speed: number, height: number, groundY: number, vy: number, lean: number) {
    this.time += dt;
    this.animTime += dt;
    const t = basePose();
    const a = this.anim;

    if (a === 'run' || a === 'stumble') {
      this.phase += dt * (8.5 + speed * 0.42);
      const p = this.phase;
      const s = Math.sin(p), c = Math.cos(p);
      t.hipY = 0.93 + Math.abs(Math.sin(p)) * 0.07;
      t.torsoRX = -0.28;
      t.torsoRY = s * 0.18;
      t.headRX = 0.18;
      t.lThigh = s * 0.95 + 0.1;
      t.rThigh = -s * 0.95 + 0.1;
      t.lShin = -(Math.max(0, -c) * 1.5 + 0.25);
      t.rShin = -(Math.max(0, c) * 1.5 + 0.25);
      t.lFoot = Math.max(0, s) * 0.3;
      t.rFoot = Math.max(0, -s) * 0.3;
      t.lArm = -s * 0.85;
      t.rArm = s * 0.85;
      t.lFore = 1.35 + Math.max(0, s) * 0.4;
      t.rFore = 1.35 + Math.max(0, -s) * 0.4;
      t.lArmZ = 0.18;
      t.rArmZ = -0.18;
      const sign = s > 0 ? 1 : -1;
      if (sign !== this.lastStepSign) {
        this.lastStepSign = sign;
        if (height - groundY < 0.05) this.onFootstep?.();
      }
      if (a === 'stumble') {
        const k = Math.max(0, 1 - this.animTime / 0.55);
        t.torsoRY += Math.sin(this.animTime * 30) * 0.4 * k;
        t.bodyRZ = Math.sin(this.animTime * 18) * 0.25 * k;
        t.lArmZ += 1.2 * k;
        t.rArmZ -= 1.2 * k;
        t.headRX -= 0.4 * k;
      }
    } else if (a === 'jump') {
      const up = vy > 0;
      t.hipY = 0.95;
      t.torsoRX = up ? -0.35 : -0.15;
      t.lThigh = up ? 1.2 : 0.5;
      t.rThigh = up ? -0.2 : 0.1;
      t.lShin = up ? -1.6 : -0.6;
      t.rShin = up ? -1.1 : -0.4;
      t.lArm = up ? -1.0 : -0.4;
      t.rArm = up ? 1.4 : 0.5;
      t.lArmZ = 0.7;
      t.rArmZ = -0.7;
      t.lFore = 0.8;
      t.rFore = 0.9;
      t.headRX = 0.15;
    } else if (a === 'slide') {
      t.hipY = 0.42;
      t.bodyRX = 1.0;
      t.torsoRX = -0.35;
      t.headRX = -0.55;
      t.lThigh = 0.55;
      t.rThigh = 0.95;
      t.lShin = -1.3;
      t.rShin = -0.15;
      t.rFoot = -0.3;
      t.lArm = 0.5;
      t.rArm = -1.8;
      t.lArmZ = 0.9;
      t.rArmZ = -0.4;
      t.lFore = 0.6;
      t.rFore = 0.4;
    } else if (a === 'fall') {
      const k = Math.min(1, this.animTime / 0.45);
      t.hipY = 0.98 - k * 0.8;
      t.bodyRX = k * 1.45;
      t.torsoRX = 0.2;
      t.headRX = -0.3;
      t.lThigh = 0.9 * k;
      t.rThigh = 0.4 * k;
      t.lShin = -0.6;
      t.rShin = -0.2;
      t.lArm = -2.6 * k;
      t.rArm = -2.2 * k;
      t.lArmZ = 0.6;
      t.rArmZ = -0.6;
    } else if (a === 'cheer') {
      t.lArm = -2.8;
      t.rArm = -2.8;
      t.lArmZ = 0.3 + Math.sin(this.time * 10) * 0.2;
      t.rArmZ = -0.3 - Math.sin(this.time * 10) * 0.2;
      t.hipY = 0.98 + Math.abs(Math.sin(this.time * 6)) * 0.1;
    } else {
      // Attente nerveuse : respiration, regard par-dessus l'epaule.
      const br = Math.sin(this.time * 2.2);
      t.hipY = 0.97 + br * 0.008;
      t.torsoRX = -0.05 + br * 0.02;
      t.headRY = Math.sin(this.time * 0.7) * 0.5 + 0.2;
      t.headRX = 0.05;
      t.lThigh = 0.12; t.lShin = -0.25; t.rThigh = -0.05;
      t.lArm = 0.1; t.rArm = -0.1;
      t.lFore = 0.35; t.rFore = 0.5;
      t.lArmZ = 0.14; t.rArmZ = -0.14;
    }

    // Inclinaison dans les virages.
    t.bodyRZ += lean * 0.35;
    t.torsoRY += lean * 0.2;

    const k = a === 'run' ? 26 : 16;
    for (const key of KEYS) this.pose[key] = damp(this.pose[key], t[key], k, dt);
    this.applyPose();

    // Salto avec les super baskets.
    if (this.flipping) {
      this.flip += dt * 9.5;
      if (this.flip >= Math.PI * 2) {
        this.flip = 0;
        this.flipping = false;
      }
      this.body.rotation.x = this.pose.bodyRX - this.flip;
      this.body.position.y = Math.sin(this.flip / 2) * 0.5;
    } else {
      this.body.position.y = 0;
    }

    // Ombre de contact.
    const h = Math.max(0, height - groundY);
    this.shadow.position.set(this.root.position.x, groundY + 0.03, this.root.position.z);
    const s = Math.max(0.35, 1 - h * 0.18);
    this.shadow.scale.set(s, 1, s);
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.5 * s;
  }

  private applyPose() {
    const p = this.pose;
    this.hips.position.y = p.hipY;
    this.body.rotation.x = p.bodyRX;
    this.body.rotation.z = p.bodyRZ;
    this.torso.rotation.x = p.torsoRX;
    this.torso.rotation.y = p.torsoRY;
    this.head.rotation.x = p.headRX;
    this.head.rotation.y = p.headRY;
    this.lThigh.rotation.x = p.lThigh;
    this.rThigh.rotation.x = p.rThigh;
    this.lShin.rotation.x = p.lShin;
    this.rShin.rotation.x = p.rShin;
    this.lFoot.rotation.x = p.lFoot;
    this.rFoot.rotation.x = p.rFoot;
    this.lArm.rotation.x = p.lArm;
    this.rArm.rotation.x = p.rArm;
    this.lArm.rotation.z = p.lArmZ;
    this.rArm.rotation.z = p.rArmZ;
    this.lFore.rotation.x = p.lFore;
    this.rFore.rotation.x = p.rFore;
  }
}
