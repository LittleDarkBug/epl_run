// Prepare les modeles des personnages : retire les animations inutilisees
// puis compresse la geometrie et les animations (meshopt).
// Usage : node tools/build-models.mjs  (sources dans assets-src/)
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, resample, meshopt, quantize } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';

const KEEP = {
  'guardian.glb': ['idle', 'run', 'agree', 'headShake', 'sad_pose'],
  'student.glb': ['SambaDance', 'TPose'],
};

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
for (const [file, keep] of Object.entries(KEEP)) {
  const doc = await io.read(`assets-src/${file}`);
  for (const a of doc.getRoot().listAnimations()) if (!keep.includes(a.getName())) a.dispose();
  await doc.transform(dedup(), resample({ tolerance: 1e-4 }), prune({ keepLeaves: true }), quantize(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  await io.write(`public/models/${file}`, doc);
  console.log('ecrit', file);
}
