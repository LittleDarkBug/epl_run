import * as THREE from 'three';

// Retouche du pantalon d'Afi en pantalon de costume : les jambes du maillage
// d'origine (sarouel large a revers) sont resserrees autour de l'axe de chaque
// jambe pour une coupe droite, avec un bas qui tombe sur la chaussure.
// Calcul unique au chargement, en pose de repos ; les poids de skinning ne
// changent pas, toutes les animations restent valables.

const LEG = ['LeftUpLeg', 'LeftLeg', 'RightUpLeg', 'RightLeg'];

// Rayon vise le long de la jambe (t = 0 a la hanche, 1 a la cheville).
function target(t: number): number {
  if (t < 0.5) return THREE.MathUtils.lerp(0.08, 0.06, t / 0.5);
  return THREE.MathUtils.lerp(0.06, 0.064, Math.min(1, (t - 0.5) / 0.5));
}

// Allongement du bas : le revers qui laissait la cheville nue descend sur la
// chaussure (plafonne a t = 1.06), comme un pantalon de costume.
const HEM0 = 0.75;
// Plafonne a t = 1.06 : au-dela, les sommets passeraient sous le sol et
// etireraient les faces raccordees a la chaussure.
const stretch = (t: number) => (t < HEM0 ? t : Math.min(1.06, HEM0 + (t - HEM0) * 1.35));

// `rest` : os au repos (meme squelette), dans l'espace de la scene.
export function tailorTrousers(body: THREE.SkinnedMesh, rest: Map<string, THREE.Object3D>) {
  const g = body.geometry;
  const pos = g.attributes.position as THREE.BufferAttribute;
  const si = g.attributes.skinIndex as THREE.BufferAttribute;
  const sw = g.attributes.skinWeight as THREE.BufferAttribute;
  const bones = body.skeleton.bones;
  const name = (i: number) => bones[i].name.replace('mixamorig', '');
  const hips = rest.get('mixamorigHips');
  if (!hips) return;
  // Espace de skinning -> scene au repos (identique pour tous les os au repos).
  const i0 = bones.findIndex((b) => b.name === 'mixamorigHips');
  const toScene = new THREE.Matrix4().multiplyMatrices(hips.matrixWorld, body.skeleton.boneInverses[i0]).multiply(body.bindMatrix);
  const toBind = toScene.clone().invert();
  const wp = (n: string) => rest.get('mixamorig' + n)!.getWorldPosition(new THREE.Vector3());
  const axes = {
    Left: [wp('LeftUpLeg'), wp('LeftFoot')],
    Right: [wp('RightUpLeg'), wp('RightFoot')],
  };

  // Sommets du pantalon : os dominant de jambe, au-dessus de la cheville.
  const n = pos.count;
  const side: (keyof typeof axes | null)[] = new Array(n).fill(null);
  const T = new Float32Array(n);
  const R = new Float32Array(n);
  const D: THREE.Vector3[] = new Array(n);
  const bins = new Float32Array(40), counts = new Float32Array(40);
  const v = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    let best = 0, bw = -1;
    for (let k = 0; k < 4; k++) {
      const w = sw.getComponent(i, k);
      if (w > bw) { bw = w; best = si.getComponent(i, k); }
    }
    const b = name(best);
    if (!LEG.includes(b)) continue;
    const p = v.fromBufferAttribute(pos, i).applyMatrix4(toScene).clone();
    const s = b.startsWith('Left') ? 'Left' : 'Right';
    const [a, f] = axes[s];
    const ab = f.clone().sub(a);
    const t = THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / ab.lengthSq(), 0, 1.2);
    if (t > 1.02) continue; // chaussures
    c.copy(a).addScaledVector(ab, t);
    const d = p.clone().sub(c);
    side[i] = s;
    T[i] = t;
    R[i] = d.length();
    D[i] = d;
    const bi = Math.min(39, Math.floor(t * 39));
    bins[bi] += R[i];
    counts[bi]++;
  }
  // Rayon moyen actuel par tranche, lisse.
  const avg = new Float32Array(40);
  for (let k = 0; k < 40; k++) {
    let s = 0, m = 0;
    for (let j = Math.max(0, k - 2); j <= Math.min(39, k + 2); j++) { s += bins[j]; m += counts[j]; }
    avg[k] = m ? s / m : 0.08;
  }
  for (let i = 0; i < n; i++) {
    const s = side[i];
    if (!s) continue;
    const t = T[i];
    const k = Math.min(39, Math.floor(t * 39));
    // Pres de la hanche on raccorde en douceur avec le bassin.
    const blend = THREE.MathUtils.smoothstep(t, 0.0, 0.12);
    const scale = THREE.MathUtils.clamp(target(t) / avg[k], 0.5, 1.3);
    const f = 1 + (scale - 1) * blend;
    const [a, e] = axes[s];
    c.copy(a).addScaledVector(e.clone().sub(a), stretch(t));
    const q = c.addScaledVector(D[i], f).applyMatrix4(toBind);
    pos.setXYZ(i, q.x, q.y, q.z);
  }
  // Normales d'origine conservees : la mise a l'echelle radiale garde leur direction.
  pos.needsUpdate = true;
  g.computeBoundingSphere();
}
