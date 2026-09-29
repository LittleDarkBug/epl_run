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
          // Variation de teinte douce et basse frequence (pas de bruit fin :
          // non filtre, il grésille a distance). Estompee avec l'eloignement.
          float dist = length(vWPos - cameraPosition);
          float fade = 1.0 - smoothstep(18.0, 70.0, dist);
          float n = uNoise(vWPos * vec3(0.35, 0.5, 0.35));
          float g = ${grime} * (1.0 - vPbr.z) * (0.35 + 0.65 * fade);
          diffuseColor.rgb *= 1.0 - g * 0.5 + g * n;
          // Leger assombrissement des bas de murs (eclaboussures de laterite).
          float splash = (1.0 - smoothstep(0.2, 1.1, vWPos.y)) * step(abs(vWNormal.y), 0.5);
          diffuseColor.rgb *= 1.0 - splash * g * 0.8;
          #if ${ao} == 1
            float aoH = smoothstep(0.0, 1.6, vWPos.y);
            diffuseColor.rgb *= mix(0.68, 1.0, aoH);
          #endif
        }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        // Anti-aliasing speculaire : les surfaces lisses (vitres, metal) se
        // rugosifient avec la distance pour ne pas scintiller.
        roughnessFactor = max(vPbr.y, mix(0.12, 0.5, smoothstep(15.0, 110.0, length(vWPos - cameraPosition))));`,
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
