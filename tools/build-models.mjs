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
};

await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
for (const [file, keep] of Object.entries(KEEP)) {
  const doc = await io.read(`assets-src/${file}`);
  for (const a of doc.getRoot().listAnimations()) if (!keep.includes(a.getName())) a.dispose();
  // Le Gardien (X Bot d'origine, tres dense) est simplifie de moitie.
  const simp = file === 'guardian.glb' ? [weld(), simplify({ simplifier: MeshoptSimplifier, ratio: 0.5, error: 0.0015 })] : [];
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
