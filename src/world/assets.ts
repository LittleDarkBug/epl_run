import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { applyBend } from '../render/curve';

// Decors modelises dans Blender (tools/blender/) : glTF + occlusion ambiante
// cuite, une image par objet, lue sur le second jeu d'UV.

export interface BakedAsset {
  root: THREE.Object3D;
}

const AO_OF: Record<string, string> = {
  tower: 'tower',
  wing: 'wing',
  wing_left: 'wing',
  wing_back: 'wing_back',
  ground: 'ground',
  hedges: 'hedges',
};

export async function loadBaked(base: string, dir: string, file: string, onProgress?: (p: number) => void): Promise<BakedAsset> {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(`${base}models/${dir}/${file}`, (e) => {
    if (e.total) onProgress?.(e.loaded / e.total);
  });
  const texLoader = new THREE.TextureLoader();
  const aoCache = new Map<string, Promise<THREE.Texture>>();
  const ao = (key: string) => {
    if (!aoCache.has(key)) {
      aoCache.set(key, texLoader.loadAsync(`${base}models/${dir}/ao_${key}.jpg`).then((t) => {
        t.flipY = false; // convention des UV glTF
        t.channel = 1;
        t.colorSpace = THREE.NoColorSpace;
        return t;
      }));
    }
    return aoCache.get(key)!;
  };

  const jobs: Promise<void>[] = [];
  const root = gltf.scene;
  // Objet Blender d'origine = enfant direct de la scene.
  for (const top of root.children) {
    const key = AO_OF[top.name];
    top.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      const src = m.material as THREE.MeshStandardMaterial;
      const mat = src.clone();
      mat.envMapIntensity = 0.85;
      for (const t of [mat.map, mat.normalMap]) if (t) t.anisotropy = 8;
      if (mat.normalMap) mat.normalScale.set(0.8, 0.8);
      m.material = applyBend(mat);
      if (key) {
        jobs.push(ao(key).then((t) => {
          mat.aoMap = t;
          mat.aoMapIntensity = 1;
          mat.needsUpdate = true;
        }));
      }
    });
  }
  await Promise.all(jobs);
  return { root };
}

// Arbres modelises dans Blender : 3 variantes (tree_0..2), bois + feuillage
// en cartes decoupees par transparence.
export async function loadTrees(base: string): Promise<THREE.Object3D[]> {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(`${base}models/trees.glb`);
  const out: THREE.Object3D[] = [];
  const mats = new Map<THREE.Material, THREE.Material>();
  for (const top of [...gltf.scene.children]) {
    top.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      const src = m.material as THREE.MeshStandardMaterial;
      if (!mats.has(src)) {
        const mat = src.clone();
        if (mat.name.includes('leaves')) {
          mat.alphaTest = 0.45;
          mat.transparent = false;
          mat.side = THREE.DoubleSide;
          mat.vertexColors = true;
          mat.envMapIntensity = 0.6;
          if (mat.map) mat.map.anisotropy = 4;
        }
        mats.set(src, applyBend(mat));
      }
      m.material = mats.get(src)!;
    });
    out.push(top);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
