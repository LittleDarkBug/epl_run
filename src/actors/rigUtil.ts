import * as THREE from 'three';

// Outils pour personnages riggés : surcouches de rotation en espace monde
// (independantes des axes propres a chaque os) et accroche d'accessoires.

const qW = new THREE.Quaternion();
const qP = new THREE.Quaternion();
const qA = new THREE.Quaternion();

// Tourne un os autour d'un axe exprime dans le repere du personnage (root).
export function rotateBone(bone: THREE.Object3D, root: THREE.Object3D, axis: THREE.Vector3, angle: number) {
  if (Math.abs(angle) < 1e-4) return;
  root.getWorldQuaternion(qA);
  const worldAxis = axis.clone().applyQuaternion(qA).normalize();
  bone.updateWorldMatrix(true, false);
  bone.getWorldQuaternion(qW);
  const rot = new THREE.Quaternion().setFromAxisAngle(worldAxis, angle);
  qW.premultiply(rot);
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
