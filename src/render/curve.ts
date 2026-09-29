import * as THREE from 'three';
import { WORLD } from '../config';

// Courbure du monde facon "runner" : les objets lointains plongent vers le bas
// et peuvent glisser lateralement. Applique en espace vue uniquement pour que
// les ombres (calculees en espace monde) restent parfaitement alignees.

export const bendUniform = { value: new THREE.Vector2(WORLD.bend.x, WORLD.bend.y) };

export const BEND_GLSL = /* glsl */ `
  {
    float bz = min(mvPosition.z, 0.0);
    float b2 = bz * bz;
    mvPosition.y -= uBend.y * b2;
    mvPosition.x += uBend.x * b2;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

type Compile = (shader: THREE.WebGLProgramParametersWithUniforms, renderer: THREE.WebGLRenderer) => void;

export function applyBend<T extends THREE.Material>(mat: T): T {
  const prev = mat.onBeforeCompile as Compile | undefined;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    shader.uniforms.uBend = bendUniform;
    shader.vertexShader = 'uniform vec2 uBend;\n' + shader.vertexShader.replace(
      '#include <project_vertex>',
      '#include <project_vertex>\n' + BEND_GLSL,
    );
  };
  const prevKey = mat.customProgramCacheKey.bind(mat);
  mat.customProgramCacheKey = () => prevKey() + '|bend';
  return mat;
}
