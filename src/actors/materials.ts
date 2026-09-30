import * as THREE from 'three';
import { applyBend } from '../render/curve';

// Materiaux des personnages : PBR standard, courbure du monde et liseré
// lumineux (rim light) discret et froid pour detacher les silhouettes du
// decor, sous le seuil du bloom (pas de halo).

export const rimUniform = { value: new THREE.Color('#9eb8e6').multiplyScalar(0.16) };

export function charMat(
  color: THREE.ColorRepresentation,
  opts: { r?: number; m?: number; e?: THREE.ColorRepresentation; ei?: number; rim?: number; map?: THREE.Texture; side?: THREE.Side } = {},
): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness: opts.r ?? 0.7,
    metalness: opts.m ?? 0,
    emissive: opts.e ?? '#000000',
    emissiveIntensity: opts.ei ?? 1,
    map: opts.map ?? null,
    side: opts.side ?? THREE.FrontSide,
  });
  const rim = (opts.rim ?? 1).toFixed(2);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRim = rimUniform;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRim;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          vec3 vd = normalize(vViewPosition);
          float rim = pow(1.0 - clamp(dot(normal, vd), 0.0, 1.0), 4.0);
          totalEmissiveRadiance += uRim * rim * ${rim};
        }`,
      );
  };
  mat.customProgramCacheKey = () => 'char' + rim;
  return applyBend(mat);
}

// Utilitaire : maillage avec ombres.
export function part(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function joint(x = 0, y = 0, z = 0): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  return g;
}
