import * as THREE from 'three';
import { GLTFLoader, GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { captureRest, makeRig, restoreRest, retargetClip } from './retarget';
import type { PlayerClips } from './Player';
import type { ChaserClips } from './Chaser';

// Chargement des personnages riggés et preparation des animations.
// Source des captures de mouvement : X Bot (Mixamo). Afi (Michelle, Mixamo)
// recoit ces animations par retargeting ; le Gardien les utilise directement
// et recoit la samba d'Afi pour sa danse de victoire.

export interface Characters {
  student: GLTF;
  guardian: GLTF;
  android: GLTF;
  uniform: GLTF;
  backpack: GLTF;
  afiBody: THREE.Texture;
  afiRough: THREE.Texture;
  playerClips: PlayerClips;
  chaserClips: ChaserClips;
}

// Supprime le deplacement horizontal du bassin (animations sur place).
function inPlace(clip: THREE.AnimationClip, hips = 'mixamorigHips'): THREE.AnimationClip {
  const c = clip.clone();
  for (const t of c.tracks) {
    if (t.name === `${hips}.position`) {
      const v = t.values;
      const x0 = v[0], z0 = v[2];
      for (let i = 0; i < v.length; i += 3) {
        v[i] = x0;
        v[i + 2] = z0;
      }
    }
  }
  return c;
}

export async function loadCharacters(base: string, onProgress?: (p: number) => void): Promise<Characters> {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const prog = [0, 0, 0, 0, 0];
  const track = (i: number) => (e: ProgressEvent) => {
    if (!e.total) return;
    prog[i] = e.loaded / e.total;
    onProgress?.(prog.reduce((a, b) => a + b, 0) / prog.length);
  };
  const [student, guardian, android, uniform, afiBody, afiRough, backpack] = await Promise.all([
    loader.loadAsync(`${base}models/student.glb`, track(0)),
    loader.loadAsync(`${base}models/guardian.glb`, track(1)),
    loader.loadAsync(`${base}models/android.glb`, track(2)),
    loader.loadAsync(`${base}models/uniform.glb`, track(3)),
    new THREE.TextureLoader().loadAsync(`${base}models/afi_body.jpg`),
    new THREE.TextureLoader().loadAsync(`${base}models/afi_rough.jpg`),
    loader.loadAsync(`${base}models/backpack.glb`, track(4)),
  ]);
  afiRough.flipY = false;
  // Texture du corps d'Afi reteinte (pantalon bleu nuit de la tenue EPL).
  afiBody.flipY = false;
  afiBody.colorSpace = THREE.SRGBColorSpace;

  const get = (g: GLTF, n: string) => {
    const c = g.animations.find((x) => x.name === n);
    if (!c) throw new Error('Animation manquante : ' + n);
    return c;
  };

  // Poses de repos : T-pose de liaison pour le X Bot, clip "TPose" pour Afi.
  const gRig = makeRig(guardian.scene);
  const gRest = captureRest(gRig);
  const sRig = makeRig(student.scene);
  const tMixer = new THREE.AnimationMixer(student.scene);
  tMixer.clipAction(get(student, 'TPose')).play();
  tMixer.setTime(0);
  const sRest = captureRest(sRig);
  tMixer.stopAllAction();
  tMixer.uncacheRoot(student.scene);

  const toStudent = (n: string) => retargetClip(get(guardian, n), gRig, gRest, sRig, sRest, { inPlace: true });
  const playerClips: PlayerClips = {
    idle: toStudent('idle'),
    run: toStudent('run'),
    sad: toStudent('sad_pose'),
    no: toStudent('headShake'),
    yes: toStudent('agree'),
    dance: inPlace(get(student, 'SambaDance')),
  };
  const dance = retargetClip(get(student, 'SambaDance'), sRig, sRest, gRig, gRest, { inPlace: true });
  restoreRest(gRig, gRest);
  restoreRest(sRig, sRest);
  const chaserClips: ChaserClips = {
    idle: get(guardian, 'idle'),
    run: inPlace(get(guardian, 'run')),
    yes: get(guardian, 'agree'),
    no: get(guardian, 'headShake'),
    dance,
  };
  return { student, guardian, android, uniform, afiBody, afiRough, backpack, playerClips, chaserClips };
}
