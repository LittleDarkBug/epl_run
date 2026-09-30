import * as THREE from 'three';

// Outils pour personnages riggés : surcouches de rotation en espace monde
// (independantes des axes propres a chaque os) et accroche d'accessoires.

const qW = new THREE.Quaternion();
const qP = new THREE.Quaternion();
const qA = new THREE.Quaternion();
const qR = new THREE.Quaternion();
const vAxis = new THREE.Vector3();

// Tourne un os autour d'un axe exprime dans le repere du personnage (root).
export function rotateBone(bone: THREE.Object3D, root: THREE.Object3D, axis: THREE.Vector3, angle: number) {
  if (Math.abs(angle) < 1e-4) return;
  root.getWorldQuaternion(qA);
  vAxis.copy(axis).applyQuaternion(qA).normalize();
  bone.updateWorldMatrix(true, false);
  bone.getWorldQuaternion(qW);
  qW.premultiply(qR.setFromAxisAngle(vAxis, angle));
  if (bone.parent) bone.parent.getWorldQuaternion(qP);
  else qP.identity();
  bone.quaternion.copy(qP.invert().multiply(qW));
  bone.updateMatrixWorld(true);
}

// Accroche un objet a un os en conservant une pose donnee dans le repere du
// modele (a appeler quand le modele est en pose de repos).
export function attachToBone(obj: THREE.Object3D, bone: THREE.Object3D, modelRoot: THREE.Object3D, pos: THREE.Vector3, rotY = 0) {
  modelRoot.updateMatrixWorld(true);
  const world = new THREE.Matrix4().compose(pos, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY), new THREE.Vector3(1, 1, 1));
  world.premultiply(modelRoot.matrixWorld);
  const local = bone.matrixWorld.clone().invert().multiply(world);
  local.decompose(obj.position, obj.quaternion, obj.scale);
  bone.add(obj);
}

export function boneWorldPos(bone: THREE.Object3D, modelRoot: THREE.Object3D): THREE.Vector3 {
  modelRoot.updateMatrixWorld(true);
  const p = bone.getWorldPosition(new THREE.Vector3());
  return modelRoot.worldToLocal(p);
}

export const AX = new THREE.Vector3(1, 0, 0);
export const AY = new THREE.Vector3(0, 1, 0);
export const AZ = new THREE.Vector3(0, 0, 1);

// Ramene la geometrie d'un maillage skinne dans l'espace de sa scene, en pose
// de repos (skinning calcule une fois sur le CPU).
export function restToModel(m: THREE.SkinnedMesh) {
  const g = m.geometry;
  const pos = g.attributes.position as THREE.BufferAttribute;
  const nor = g.attributes.normal as THREE.BufferAttribute | undefined;
  const si = g.attributes.skinIndex as THREE.BufferAttribute;
  const sw = g.attributes.skinWeight as THREE.BufferAttribute;
  const bones = m.skeleton.bones, inv = m.skeleton.boneInverses;
  const boneMats = bones.map((b, i) => new THREE.Matrix4().multiplyMatrices(b.matrixWorld, inv[i]).multiply(m.bindMatrix));
  const M = new THREE.Matrix4(), N = new THREE.Matrix3(), v = new THREE.Vector3();
  const out = new Float32Array(pos.count * 3), outN = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    M.elements.fill(0);
    for (let k = 0; k < 4; k++) {
      const w = sw.getComponent(i, k);
      if (w === 0) continue;
      const e = boneMats[si.getComponent(i, k)].elements;
      for (let j = 0; j < 16; j++) M.elements[j] += e[j] * w;
    }
    v.fromBufferAttribute(pos, i).applyMatrix4(M);
    out[i * 3] = v.x; out[i * 3 + 1] = v.y; out[i * 3 + 2] = v.z;
    if (nor) {
      v.fromBufferAttribute(nor, i).applyMatrix3(N.getNormalMatrix(M)).normalize();
      outN[i * 3] = v.x; outN[i * 3 + 1] = v.y; outN[i * 3 + 2] = v.z;
    }
  }
  g.setAttribute('position', new THREE.BufferAttribute(out, 3));
  if (nor) g.setAttribute('normal', new THREE.BufferAttribute(outN, 3));
  g.computeBoundingSphere();
}

// Greffe des maillages skinnes (exportes depuis Blender sur le meme squelette)
// sur un personnage : on se cale sur son corps de reference (memes os, memes
// matrices inverses, meme matrice de liaison), quelle que soit sa pose.
export function graftSkinned(ref: THREE.SkinnedMesh, parts: THREE.Object3D): THREE.SkinnedMesh[] {
  const index = new Map(ref.skeleton.bones.map((b, i) => [b.name, i]));
  parts.updateMatrixWorld(true);
  const found: THREE.SkinnedMesh[] = [];
  parts.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) found.push(o as THREE.SkinnedMesh); });
  for (const m of found) {
    restToModel(m);
    // Passage de l'espace scene (repos) a l'espace de skinning du corps : les
    // os des pieces sont au repos, identique a celui du corps de reference.
    const b0 = m.skeleton.bones[0];
    const toBind = new THREE.Matrix4()
      .multiplyMatrices(b0.matrixWorld, ref.skeleton.boneInverses[index.get(b0.name)!])
      .multiply(ref.bindMatrix)
      .invert();
    m.geometry.applyMatrix4(toBind);
    const ids = m.skeleton.bones.map((b) => {
      const i = index.get(b.name);
      if (i === undefined) throw new Error('Os absent : ' + b.name);
      return i;
    });
    const skel = new THREE.Skeleton(ids.map((i) => ref.skeleton.bones[i]), ids.map((i) => ref.skeleton.boneInverses[i].clone()));
    ref.parent!.add(m);
    m.position.copy(ref.position);
    m.quaternion.copy(ref.quaternion);
    m.scale.copy(ref.scale);
    m.bind(skel, ref.bindMatrix.clone());
    m.frustumCulled = false;
  }
  return found;
}
