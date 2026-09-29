import * as THREE from 'three';
import { applyBend } from './curve';

// Materiau "uber" partage par tout le decor fusionne : couleur par sommet et
// attribut aPbr = (emissif, rugosite, metal). Un seul appel de rendu par bloc.
// Ajoute une variation de surface procedurale et une occlusion de pied de mur.

export interface UberOptions {
  grime?: number;
  groundAO?: boolean;
  envIntensity?: number;
}

export function createUberMaterial(opts: UberOptions = {}): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1,
    metalness: 1,
    envMapIntensity: opts.envIntensity ?? 1,
  });
  const grime = (opts.grime ?? 0.18).toFixed(3);
  const ao = opts.groundAO ? 1 : 0;
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec3 aPbr;
        varying vec3 vPbr;
        varying vec3 vWPos;
        varying vec3 vWNormal;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vPbr = aPbr;`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vec4 uberWorld = modelMatrix * vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          uberWorld = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
        #endif
        vWPos = uberWorld.xyz;
        vWNormal = normalize(mat3(modelMatrix) * objectNormal);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vPbr;
        varying vec3 vWPos;
        varying vec3 vWNormal;
        float uHash(vec3 p) {
          p = fract(p * 0.3183099 + 0.1);
          p *= 17.0;
          return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
        }
        float uNoise(vec3 x) {
          vec3 i = floor(x);
          vec3 f = fract(x);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(uHash(i + vec3(0,0,0)), uHash(i + vec3(1,0,0)), f.x),
                         mix(uHash(i + vec3(0,1,0)), uHash(i + vec3(1,1,0)), f.x), f.y),
                     mix(mix(uHash(i + vec3(0,0,1)), uHash(i + vec3(1,0,1)), f.x),
                         mix(uHash(i + vec3(0,1,1)), uHash(i + vec3(1,1,1)), f.x), f.y), f.z);
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec3 np = vWPos * vec3(1.3, 2.1, 1.3);
          float n = uNoise(np) * 0.6 + uNoise(np * 3.7) * 0.4;
          float streak = uNoise(vec3(vWPos.x * 3.0, vWPos.y * 0.35, vWPos.z * 3.0));
          float g = ${grime} * (1.0 - vPbr.z);
          diffuseColor.rgb *= 1.0 - g + g * 1.35 * n;
          diffuseColor.rgb *= 1.0 - g * 0.6 * smoothstep(0.55, 0.9, streak) * step(abs(vWNormal.y), 0.5);
          #if ${ao} == 1
            float aoH = smoothstep(0.0, 1.6, vWPos.y);
            diffuseColor.rgb *= mix(0.55, 1.0, aoH);
          #endif
        }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = vPbr.y;`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
        metalnessFactor = vPbr.z;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += diffuseColor.rgb * vPbr.x;`,
      );
  };
  mat.customProgramCacheKey = () => `uber-${grime}-${ao}`;
  return applyBend(mat);
}
