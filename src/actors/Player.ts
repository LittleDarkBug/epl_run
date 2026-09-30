import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { applyBend } from '../render/curve';
import { charMat, rimUniform } from './materials';
import { damp } from '../core/rng';
import { AX, AZ, graftSkinned, rotateBone } from './rigUtil';
import { tailorTrousers } from './tailor';

// Afi, l'etudiante en fuite : modele riggé (maillage continu, textures de
// peau et de vetements) en tenue de l'EPL (veste et cravate bleu marine,
// tools/blender/build_uniform.py) anime par capture de mouvement retargetee, avec des
// surcouches procedurales pour le saut, la glissade, le faux pas et la chute.

export type PlayerAnim = 'idle' | 'run' | 'jump' | 'slide' | 'stumble' | 'fall' | 'cheer' | 'sad' | 'no' | 'yes';

export interface PlayerClips {
  idle: THREE.AnimationClip;
  run: THREE.AnimationClip;
  sad: THREE.AnimationClip;
  no: THREE.AnimationClip;
  yes: THREE.AnimationClip;
  dance: THREE.AnimationClip;
}

const W = { jump: 0, slide: 0, fall: 0, stumble: 0 };
type Weights = typeof W;

export class Player {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private model: THREE.Object3D;
  private mixer: THREE.AnimationMixer;
  private actions: Record<string, THREE.AnimationAction> = {};
  private current: THREE.AnimationAction | null = null;
  private bones: Record<string, THREE.Bone> = {};
  private shadow: THREE.Mesh;
  private w: Weights = { ...W };
  private glow: THREE.Mesh[] = [];
  private glowMat: THREE.MeshBasicMaterial;
  private flip = 0;
  private flipping = false;
  private lastPhase = 0;
  private time = 0;
  anim: PlayerAnim = 'idle';
  animTime = 0;
  onFootstep: (() => void) | null = null;

  private crestMat: THREE.MeshStandardMaterial;

  constructor(gltf: GLTF, clips: PlayerClips, blobTex: THREE.Texture, uniform?: GLTF, bodyTex?: THREE.Texture, roughTex?: THREE.Texture) {
    this.model = gltf.scene;
    this.model.rotation.y = Math.PI; // le modele regarde +z, le joueur court vers -z
    this.root.add(this.body);
    this.body.add(this.model);
    this.model.traverse((o) => {
      const m = o as THREE.Mesh;
      if ((o as THREE.Bone).isBone) this.bones[o.name] = o as THREE.Bone;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
        m.frustumCulled = false;
        const src = m.material as THREE.MeshStandardMaterial;
        const mat = src.clone();
        if (bodyTex && mat.map) mat.map = bodyTex;
        if (roughTex && mat.roughnessMap) mat.roughnessMap = roughTex;
        if (roughTex && mat.metalnessMap) mat.metalnessMap = roughTex;
        // Filtrage anisotrope : textures nettes meme vues de biais.
        for (const t of [mat.map, mat.normalMap, mat.roughnessMap, mat.metalnessMap]) if (t) t.anisotropy = 8;
        mat.envMapIntensity = 0.9;
        mat.onBeforeCompile = (shader) => {
          shader.uniforms.uRim = rimUniform;
          shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', '#include <common>\nuniform vec3 uRim;')
            .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
              { vec3 vd = normalize(vViewPosition); float rim = pow(1.0 - clamp(dot(normal, vd), 0.0, 1.0), 4.0); totalEmissiveRadiance += uRim * rim * 0.8; }`);
        };
        mat.customProgramCacheKey = () => 'afi';
        m.material = applyBend(mat);
      }
    });

    // Tenue EPL greffee sur le squelette d'Afi.
    this.crestMat = charMat('#ffffff', { r: 0.6, rim: 0.3 });
    let body: THREE.SkinnedMesh | null = null;
    this.model.traverse((o) => { if (!body && (o as THREE.SkinnedMesh).isSkinnedMesh) body = o as THREE.SkinnedMesh; });
    if (uniform && body) {
      // Pantalon de costume (coupe droite) a partir du sarouel d'origine.
      const rest = new Map<string, THREE.Object3D>();
      uniform.scene.updateMatrixWorld(true);
      uniform.scene.traverse((o) => { if ((o as THREE.Bone).isBone) rest.set(o.name, o); });
      tailorTrousers(body, rest);
      const mats: Record<string, THREE.Material> = {
        navy: charMat('#1a2544', { r: 0.78, rim: 0.7 }),
        shirt: charMat('#eef0f3', { r: 0.7, rim: 0.4 }),
        tie: charMat('#121a33', { r: 0.42, rim: 0.6 }),
        gold: charMat('#d9a441', { r: 0.3, m: 1, rim: 0.4 }),
        crest: this.crestMat,
      };
      for (const m of graftSkinned(body, uniform.scene)) {
        m.material = mats[(m.material as THREE.Material).name] ?? mats.navy;
        m.castShadow = true;
        m.receiveShadow = true;
      }
    }

    this.mixer = new THREE.AnimationMixer(this.model);
    for (const [k, c] of Object.entries(clips)) {
      const a = this.mixer.clipAction(c);
      if (k === 'sad' || k === 'yes' || k === 'no') {
        a.setLoop(k === 'sad' ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
        a.clampWhenFinished = true;
      }
      this.actions[k] = a;
    }
    this.fade('idle', 0);

    // Semelles lumineuses (super baskets).
    this.glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 2.6, 2.2), transparent: true, opacity: 0.9 });
    for (const name of ['mixamorigLeftFoot', 'mixamorigRightFoot']) {
      const bone = this.bones[name];
      if (!bone) continue;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.018, 8, 20), applyBend(this.glowMat));
      ring.visible = false;
      this.body.add(ring);
      ring.userData.bone = bone;
      this.glow.push(ring);
    }

    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.0, 1.0).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, opacity: 0.55 }),
    );
    this.shadow.renderOrder = 1;
  }

  get shadowMesh(): THREE.Mesh {
    return this.shadow;
  }

  // Ecusson de l'EPL sur la poche de poitrine.
  setCrest(tex: THREE.Texture) {
    this.crestMat.map = tex;
    this.crestMat.needsUpdate = true;
  }

  setSuperSneakers(on: boolean) {
    for (const g of this.glow) g.visible = on;
  }

  private fade(name: string, time = 0.2) {
    const next = this.actions[name];
    if (!next || next === this.current) return;
    next.reset();
    next.enabled = true;
    next.setEffectiveWeight(1);
    next.play();
    if (this.current) next.crossFadeFrom(this.current, time, false);
    this.current = next;
  }

  play(anim: PlayerAnim) {
    if (this.anim === anim) return;
    this.anim = anim;
    this.animTime = 0;
    // Les poses de saut / glissade / chute se posent sur la course.
    const base: Record<PlayerAnim, string> = {
      idle: 'idle', run: 'run', jump: 'run', slide: 'run', stumble: 'run', fall: 'run', cheer: 'dance', sad: 'sad', no: 'no', yes: 'yes',
    };
    this.fade(base[anim], anim === 'run' ? 0.15 : 0.25);
  }

  startFlip() {
    this.flipping = true;
    this.flip = 0;
  }

  update(dt: number, speed: number, height: number, groundY: number, vy: number, lean: number) {
    this.time += dt;
    this.animTime += dt;
    const a = this.anim;
    const run = this.actions.run;
    run.timeScale = 0.95 + Math.max(0, speed - 12) * 0.022;
    if (a === 'jump' || a === 'fall') run.timeScale *= a === 'fall' ? 0.2 : 0.35;
    this.mixer.update(dt);

    // Pas : deux appuis par cycle de course.
    if (this.current === run && run.getClip().duration > 0) {
      const ph = (run.time / run.getClip().duration) % 1;
      const crossed = (this.lastPhase < 0.25 && ph >= 0.25) || (this.lastPhase < 0.75 && ph >= 0.75);
      if (crossed && height - groundY < 0.05 && a === 'run') this.onFootstep?.();
      this.lastPhase = ph;
    }

    // Poids des surcouches.
    const target: Weights = { jump: a === 'jump' ? 1 : 0, slide: a === 'slide' ? 1 : 0, fall: a === 'fall' ? 1 : 0, stumble: a === 'stumble' ? Math.max(0, 1 - this.animTime / 0.55) : 0 };
    for (const k of Object.keys(target) as (keyof Weights)[]) this.w[k] = damp(this.w[k], target[k], k === 'fall' ? 6 : 16, dt);
    this.applyOverlays(vy, lean);

    // Salto (super baskets) et affaissement de glissade.
    this.body.position.y = -0.52 * this.w.slide - 0.35 * this.w.fall;
    if (this.flipping) {
      this.flip += dt * 9.5;
      if (this.flip >= Math.PI * 2) {
        this.flip = 0;
        this.flipping = false;
      }
      this.body.rotation.x = -this.flip;
      this.body.position.y += Math.sin(this.flip / 2) * 0.5;
    } else {
      this.body.rotation.x = 0;
    }

    for (const g of this.glow) {
      if (!g.visible) continue;
      const b = g.userData.bone as THREE.Bone;
      b.getWorldPosition(g.position);
      this.body.worldToLocal(g.position);
      g.rotation.x = Math.PI / 2;
    }
    this.glowMat.opacity = 0.6 + Math.sin(this.time * 20) * 0.3;

    const h = Math.max(0, height - groundY);
    this.shadow.position.set(this.root.position.x, groundY + 0.03, this.root.position.z);
    const s = Math.max(0.35, 1 - h * 0.18);
    this.shadow.scale.set(s, 1, s);
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.5 * s;
  }

  // Surcouches exprimees dans le repere du personnage : +x vers sa droite
  // vue de dos, rotation positive autour de +x = vers l'avant (-z).
  private applyOverlays(vy: number, lean: number) {
    const B = this.bones;
    const r = this.root;
    const hips = B.mixamorigHips, spine = B.mixamorigSpine1, head = B.mixamorigHead;
    const lUp = B.mixamorigLeftUpLeg, rUp = B.mixamorigRightUpLeg, lLeg = B.mixamorigLeftLeg, rLeg = B.mixamorigRightLeg;
    const lArm = B.mixamorigLeftArm, rArm = B.mixamorigRightArm, lFore = B.mixamorigLeftForeArm, rFore = B.mixamorigRightForeArm;
    if (!hips) return;
    const { jump, slide, fall, stumble } = this.w;

    // Inclinaison dans les virages.
    rotateBone(hips, r, AZ, -lean * 0.25);

    if (jump > 0.01) {
      const up = vy > 0 ? 1 : 0.5;
      rotateBone(lUp, r, AX, 1.1 * jump * up);
      rotateBone(rUp, r, AX, 0.25 * jump);
      rotateBone(lLeg, r, AX, -1.5 * jump * up);
      rotateBone(rLeg, r, AX, -1.0 * jump);
      rotateBone(lArm, r, AZ, -0.6 * jump);
      rotateBone(rArm, r, AZ, 0.6 * jump);
      rotateBone(spine, r, AX, -0.15 * jump);
    }
    if (slide > 0.01) {
      // Glissade de baseball : buste en arriere, jambes tendues devant.
      rotateBone(hips, r, AX, 0.95 * slide);
      rotateBone(lUp, r, AX, 0.15 * slide);
      rotateBone(rUp, r, AX, 0.55 * slide);
      rotateBone(lLeg, r, AX, -1.2 * slide);
      rotateBone(rLeg, r, AX, -0.1 * slide);
      rotateBone(spine, r, AX, -0.35 * slide);
      rotateBone(head, r, AX, -0.35 * slide);
      rotateBone(rArm, r, AX, 1.0 * slide);
      rotateBone(lArm, r, AZ, -0.9 * slide);
    }
    if (stumble > 0.01) {
      const s = Math.sin(this.animTime * 26);
      rotateBone(spine, r, AZ, s * 0.35 * stumble);
      rotateBone(head, r, AX, -0.4 * stumble);
      rotateBone(lArm, r, AZ, -1.1 * stumble);
      rotateBone(rArm, r, AZ, 1.1 * stumble);
    }
    if (fall > 0.01) {
      // Chute en arriere, bras leves.
      rotateBone(hips, r, AX, 1.35 * fall);
      rotateBone(lUp, r, AX, 0.5 * fall);
      rotateBone(rUp, r, AX, 0.2 * fall);
      rotateBone(lLeg, r, AX, -0.6 * fall);
      rotateBone(lArm, r, AX, 2.3 * fall);
      rotateBone(rArm, r, AX, 2.0 * fall);
      rotateBone(lFore, r, AX, 0.5 * fall);
      rotateBone(rFore, r, AX, 0.5 * fall);
      rotateBone(head, r, AX, -0.3 * fall);
    }
  }
}
