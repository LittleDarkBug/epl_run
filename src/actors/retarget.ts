import * as THREE from 'three';

// Retargeting d'animations entre deux squelettes humanoides de type Mixamo
// dont les axes d'os different. Principe : on transfere la rotation monde
// relative a la pose de repos (T-pose) de chaque os, puis on reconvertit en
// rotation locale sur le squelette cible. Les deux modeles doivent etre dans
// la meme pose de repos et orientes de la meme facon.

export interface Rig {
  root: THREE.Object3D;
  bones: Map<string, THREE.Bone>;
  order: THREE.Bone[]; // parents avant enfants
  hips: THREE.Bone;
}

export function makeRig(root: THREE.Object3D, hipsName = 'mixamorigHips'): Rig {
  const bones = new Map<string, THREE.Bone>();
  const order: THREE.Bone[] = [];
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone) {
      bones.set(o.name, o as THREE.Bone);
      order.push(o as THREE.Bone);
    }
  });
  const hips = bones.get(hipsName);
  if (!hips) throw new Error('Os du bassin introuvable : ' + hipsName);
  return { root, bones, order, hips };
}

function worldQuats(rig: Rig): Map<string, THREE.Quaternion> {
  rig.root.updateMatrixWorld(true);
  const m = new Map<string, THREE.Quaternion>();
  for (const b of rig.order) m.set(b.name, b.getWorldQuaternion(new THREE.Quaternion()));
  return m;
}

// Capture la pose de repos courante (a appeler quand le rig est en T-pose).
export function captureRest(rig: Rig) {
  rig.root.updateMatrixWorld(true);
  return {
    quats: worldQuats(rig),
    hipsY: rig.hips.getWorldPosition(new THREE.Vector3()).y,
    local: new Map(rig.order.map((b) => [b.name, { q: b.quaternion.clone(), p: b.position.clone() }])),
  };
}

export type Rest = ReturnType<typeof captureRest>;

export function restoreRest(rig: Rig, rest: Rest) {
  for (const b of rig.order) {
    const r = rest.local.get(b.name)!;
    b.quaternion.copy(r.q);
    b.position.copy(r.p);
  }
  rig.root.updateMatrixWorld(true);
}

const qD = new THREE.Quaternion();
const qP = new THREE.Quaternion();
const v = new THREE.Vector3();

export function retargetClip(
  clip: THREE.AnimationClip,
  src: Rig, srcRest: Rest,
  dst: Rig, dstRest: Rest,
  opts: { fps?: number; inPlace?: boolean; hipScale?: number } = {},
): THREE.AnimationClip {
  const fps = opts.fps ?? 30;
  const frames = Math.max(2, Math.round(clip.duration * fps) + 1);
  const mixer = new THREE.AnimationMixer(src.root);
  const action = mixer.clipAction(clip);
  action.play();
  const hipScale = opts.hipScale ?? dstRest.hipsY / srcRest.hipsY;

  const names = dst.order.map((b) => b.name).filter((n) => src.bones.has(n));
  const qValues = new Map<string, number[]>(names.map((n) => [n, []]));
  const hipValues: number[] = [];
  const times: number[] = [];

  for (let f = 0; f < frames; f++) {
    const t = (f / (frames - 1)) * clip.duration;
    times.push(t);
    mixer.setTime(t);
    src.root.updateMatrixWorld(true);
    restoreRest(dst, dstRest);
    for (const b of dst.order) {
      const s = src.bones.get(b.name);
      if (!s) {
        b.updateMatrixWorld(true);
        continue;
      }
      // Rotation monde source relative au repos.
      s.getWorldQuaternion(qD).multiply(srcRest.quats.get(b.name)!.clone().invert());
      // Rotation monde cible = delta * repos cible.
      const wt = qD.clone().multiply(dstRest.quats.get(b.name)!);
      // Conversion en locale.
      if (b.parent) b.parent.getWorldQuaternion(qP);
      else qP.identity();
      b.quaternion.copy(qP.invert().multiply(wt));
      b.updateMatrixWorld(true);
      const arr = qValues.get(b.name)!;
      arr.push(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
    }
    // Bassin : on ne garde que la composante verticale (course sur place).
    const sy = src.hips.getWorldPosition(v).y;
    const dy = (sy - srcRest.hipsY) * hipScale;
    const hp = dst.hips.parent!;
    const world = dst.hips.getWorldPosition(new THREE.Vector3());
    if (!opts.inPlace) {
      const sw = src.hips.getWorldPosition(new THREE.Vector3());
      world.x += sw.x * hipScale;
      world.z += sw.z * hipScale;
    }
    world.y = dstRest.hipsY + dy;
    const local = hp.worldToLocal(world.clone());
    hipValues.push(local.x, local.y, local.z);
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(src.root);
  restoreRest(dst, dstRest);

  const tracks: THREE.KeyframeTrack[] = [];
  for (const n of names) tracks.push(new THREE.QuaternionKeyframeTrack(`${n}.quaternion`, times, qValues.get(n)!));
  tracks.push(new THREE.VectorKeyframeTrack(`${dst.hips.name}.position`, times, hipValues));
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}
