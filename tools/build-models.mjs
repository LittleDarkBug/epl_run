// Prepare les modeles des personnages : retire les animations inutilisees
// puis compresse la geometrie et les animations (meshopt).
// Usage : node tools/build-models.mjs  (sources dans assets-src/)
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, resample, meshopt, quantize, simplify, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import { MeshoptEncoder } from 'meshoptimizer';

const KEEP = {
  'guardian.glb': ['idle', 'run', 'agree', 'headShake', 'sad_pose'],
  'student.glb': ['SambaDance', 'TPose'],
  // Corps de l'androide (tools/blender/build_guardian.py), sans animation.
  'android.glb': [],
};
// Simplification par modele : [ratio, erreur].
// Le maillage du X Bot n'est plus affiche (remplace par l'androide) : on ne
// garde qu'une ebauche pour conserver la peau et le squelette.
const SIMPLIFY = { 'guardian.glb': [0.02, 1], 'android.glb': [0.55, 0.0008] };

await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
for (const [file, keep] of Object.entries(KEEP)) {
  const doc = await io.read(`assets-src/${file}`);
  for (const a of doc.getRoot().listAnimations()) if (!keep.includes(a.getName())) a.dispose();
  const sp = SIMPLIFY[file];
  const simp = sp ? [weld(), simplify({ simplifier: MeshoptSimplifier, ratio: sp[0], error: sp[1] })] : [];
  await doc.transform(dedup(), ...simp, resample({ tolerance: 1e-4 }), prune({ keepLeaves: true }), quantize(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  await io.write(`public/models/${file}`, doc);
  console.log('ecrit', file);
}

// Decors cuits dans Blender : compression seule (textures deja en JPEG).
for (const [src, dst] of [['assets-src/campus/campus.glb', 'public/models/campus/campus.glb'], ['assets-src/trees/trees.glb', 'public/models/trees.glb']]) {
  const doc = await io.read(src);
  await doc.transform(dedup(), prune(), quantize(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  await io.write(dst, doc);
  console.log('ecrit', dst);
}
