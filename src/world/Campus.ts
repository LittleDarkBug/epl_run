import * as THREE from 'three';
import { GeoBuilder, mat, UNIT } from '../render/GeoBuilder';
import { createUberMaterial } from '../render/uber';
import { applyBend } from '../render/curve';
import { makeLogoPlate } from '../render/textures';
import { mulberry } from '../core/rng';
import { addBush, addPalm, SIDEWALK_OUT, SIDEWALK_Y, ROAD_HALF, addCurb, addLamp } from './Scenery';

// Point de depart : le portail monumental de l'EPL, les batiments du campus
// et les drapeaux. Le joueur s'en echappe au lancement de la partie.

const BLUE = '#1446a0';
const WHITE = '#f4f2ec';

export class Campus {
  readonly group = new THREE.Group();

  constructor(logoFull: HTMLImageElement, wordmark: HTMLImageElement) {
    const b = new GeoBuilder();
    const r = mulberry(77);
    const gateZ = 7;

    for (const side of [-1, 1]) {
      addCurb(b, side, 60, -4);
      // Piliers du portail.
      const px = side * (ROAD_HALF + 1.4);
      b.add(UNIT.box, mat(px, 4, gateZ, 0, 0, 0, 1.6, 8, 1.6), WHITE, { r: 0.8 });
      b.add(UNIT.box, mat(px, 4, gateZ, 0, 0, 0, 1.7, 1.2, 1.7), BLUE, { r: 0.5, m: 0.2 });
      b.add(UNIT.box, mat(px, 0.3, gateZ, 0, 0, 0, 1.9, 0.6, 1.9), '#9ca3af', { r: 0.9 });
      b.add(UNIT.box, mat(px, 8.1, gateZ, 0, 0, 0, 1.9, 0.25, 1.9), BLUE, { r: 0.5, m: 0.2 });
      // Lanterne sur pilier.
      b.add(UNIT.box, mat(px, 8.55, gateZ, 0, 0, 0, 0.5, 0.65, 0.5), '#ffe3a8', { e: 4, r: 0.3 });
      b.add(UNIT.box, mat(px, 8.95, gateZ, 0, 0, 0, 0.7, 0.12, 0.7), '#222', { r: 0.4, m: 0.6 });
      // Mur d'enceinte.
      const wallX0 = side * (ROAD_HALF + 2.2);
      b.add(UNIT.box, mat(wallX0 + side * 6, 1.4, gateZ, 0, 0, 0, 12, 2.8, 0.45), WHITE, { r: 0.85 });
      b.add(UNIT.box, mat(wallX0 + side * 6, 2.85, gateZ, 0, 0, 0, 12.2, 0.14, 0.6), BLUE, { r: 0.5 });
      for (let i = 0; i < 12; i++) {
        const c = ['#e41f26', '#f5d10d', '#0b9185', '#1455b8', '#c3199b'][i % 5];
        b.add(UNIT.box, mat(wallX0 + side * (0.6 + i * 0.95), 1.6, gateZ - 0.24, 0, 0, -0.3, 0.12, 1.2, 0.04), c, { r: 0.6, e: 0.15 });
      }
      // Pelouses et palmiers du campus.
      b.add(UNIT.box, mat(side * (SIDEWALK_OUT + 12), 0.1, gateZ + 25, 0, 0, 0, 24, 0.2, 50), '#5f8f3a', { r: 1 });
      b.add(UNIT.box, mat(side * (SIDEWALK_OUT + 12), 0.1, gateZ - 6, 0, 0, 0, 24, 0.2, 12), '#5f8f3a', { r: 1 });
      for (let i = 0; i < 4; i++) addPalm(b, side * (SIDEWALK_OUT + 1.5), SIDEWALK_Y, gateZ - 3 - i * 3.5 + (i % 2) * 0.8, 7 + i * 0.4, r);
      for (let i = 0; i < 5; i++) addPalm(b, side * (SIDEWALK_OUT + 3 + (i % 2) * 4), 0.2, gateZ + 8 + i * 7, 8 + (i % 3), r);
      for (let i = 0; i < 6; i++) addBush(b, side * (SIDEWALK_OUT + 0.8), 0.2, gateZ - 1.5 - i * 1.8, 0.9, r);
      addLamp(b, side, gateZ - 8);

      // Aile du batiment principal.
      const bx = side * (SIDEWALK_OUT + 9);
      const bz = gateZ + 22;
      b.add(UNIT.box, mat(bx, 6, bz, 0, 0, 0, 14, 12, 16), WHITE, { r: 0.8 });
      for (let f = 0; f < 3; f++) {
        const y = 1.8 + f * 3.6;
        b.add(UNIT.box, mat(bx, y + 1.4, bz - 8.05, 0, 0, 0, 13, 0.3, 0.2), BLUE, { r: 0.5 });
        for (let i = 0; i < 6; i++) {
          const lit = r() < 0.4;
          b.add(UNIT.box, mat(bx - 5.4 + i * 2.15, y, bz - 8.04, 0, 0, 0, 1.6, 1.9, 0.1), lit ? '#ffc98a' : '#2d4460', lit ? { e: 1.3, r: 0.3 } : { r: 0.06, m: 0.5 });
        }
        // Pare-soleil verticaux.
        for (let i = 0; i < 7; i++) b.add(UNIT.box, mat(bx - 6.45 + i * 2.15, y + 0.1, bz - 8.3, 0, 0, 0, 0.18, 3.2, 0.6), WHITE, { r: 0.8 });
      }
      b.add(UNIT.box, mat(bx, 12.2, bz, 0, 0, 0, 14.4, 0.5, 16.4), BLUE, { r: 0.5, m: 0.2 });
    }

    // Linteau du portail au-dessus de la route.
    const span = (ROAD_HALF + 1.4) * 2;
    b.add(UNIT.box, mat(0, 7.1, gateZ, 0, 0, 0, span + 1.6, 1.9, 1.1), WHITE, { r: 0.8 });
    b.add(UNIT.box, mat(0, 6.1, gateZ, 0, 0, 0, span + 1.7, 0.18, 1.2), BLUE, { r: 0.5, m: 0.2 });
    b.add(UNIT.box, mat(0, 8.1, gateZ, 0, 0, 0, span + 1.8, 0.2, 1.25), BLUE, { r: 0.5, m: 0.2 });
    // Batiment central au fond, dans l'axe de la route.
    const cz = gateZ + 40;
    b.add(UNIT.box, mat(0, 8, cz, 0, 0, 0, 30, 16, 12), WHITE, { r: 0.8 });
    b.add(UNIT.box, mat(0, 16.3, cz, 0, 0, 0, 30.5, 0.6, 12.5), BLUE, { r: 0.5, m: 0.2 });
    for (let f = 0; f < 4; f++) {
      for (let i = 0; i < 10; i++) {
        const lit = r() < 0.45;
        b.add(UNIT.box, mat(-12.6 + i * 2.8, 2.2 + f * 3.7, cz - 6.02, 0, 0, 0, 2.0, 2.1, 0.1), lit ? '#ffc98a' : '#2d4460', lit ? { e: 1.3, r: 0.3 } : { r: 0.06, m: 0.5 });
      }
    }
    // Esplanade.
    b.add(UNIT.box, mat(0, 0.05, gateZ + 20, 0, 0, 0, ROAD_HALF * 2, 0.02, 1), '#f5f5f0', { r: 0.6 });

    const mesh = new THREE.Mesh(b.build(), createUberMaterial({ grime: 0.12, groundAO: true }));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    this.group.add(mesh);

    // Logo complet (Universite de Lome + EPL) sur la face avant du linteau,
    // tournee vers le joueur lors de l'intro.
    const plateTex = makeLogoPlate(logoFull, 2048, 460, { bg: '#fbfaf6', pad: 0.05 });
    const logoMat = applyBend(new THREE.MeshStandardMaterial({ map: plateTex, roughness: 0.7, emissive: '#ffffff', emissiveMap: plateTex, emissiveIntensity: 0.04 }));
    const logo = new THREE.Mesh(new THREE.PlaneGeometry(span + 1.2, (span + 1.2) * 460 / 2048), logoMat);
    logo.position.set(0, 7.1, gateZ - 0.56);
    logo.rotation.y = Math.PI;
    this.group.add(logo);
    // Et cote route, vu pendant la fuite (regard en arriere impossible, mais
    // visible dans le rendu de fin de partie).
    const logoBack = logo.clone();
    logoBack.position.z = gateZ + 0.56;
    logoBack.rotation.y = 0;
    this.group.add(logoBack);

    // Grand logo EPL sur le batiment central.
    const wmTex = makeLogoPlate(wordmark, 1024, 440, { bg: '#fbfaf6', pad: 0.06 });
    const wmMat = applyBend(new THREE.MeshStandardMaterial({ map: wmTex, roughness: 0.7, emissive: '#ffffff', emissiveMap: wmTex, emissiveIntensity: 0.06 }));
    const wm = new THREE.Mesh(new THREE.PlaneGeometry(12, 12 * 440 / 1024), wmMat);
    wm.position.set(0, 12.6, cz - 6.1);
    wm.rotation.y = Math.PI;
    this.group.add(wm);

    // Drapeaux EPL flottants.
    const flagTex = makeLogoPlate(wordmark, 512, 320, { bg: '#f7f5ef', pad: 0.1, stripes: true });
    const flagMat = new THREE.MeshStandardMaterial({ map: flagTex, side: THREE.DoubleSide, roughness: 0.8 });
    const flagU = { uTime: { value: 0 } };
    flagMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = flagU.uTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float fx = (position.x + 1.1) / 2.2;
          transformed.z += sin(fx * 6.0 - uTime * 5.0) * 0.18 * fx;
          transformed.y += sin(fx * 4.0 - uTime * 3.0) * 0.05 * fx;`);
    };
    applyBend(flagMat);
    this.flagTime = flagU.uTime;
    const poleMat = applyBend(new THREE.MeshStandardMaterial({ color: '#d1d5db', metalness: 0.9, roughness: 0.3 }));
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const x = side * (SIDEWALK_OUT + 2 + i * 2.2);
        const z = gateZ - 2.5;
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 9, 10), poleMat);
        pole.position.set(x, 4.5, z);
        pole.castShadow = true;
        this.group.add(pole);
        const fg = new THREE.PlaneGeometry(2.2, 1.4, 16, 4);
        fg.translate(1.1, 0, 0);
        const flag = new THREE.Mesh(fg, flagMat);
        flag.position.set(x, 8.2, z);
        flag.rotation.y = side > 0 ? Math.PI : 0;
        flag.castShadow = true;
        this.group.add(flag);
      }
    }
  }

  private flagTime: { value: number };

  update(dt: number, dz: number) {
    this.flagTime.value += dt;
    this.group.position.z += dz;
    this.group.visible = this.group.position.z < 140;
  }

  reset() {
    this.group.position.z = 0;
    this.group.visible = true;
  }
}
