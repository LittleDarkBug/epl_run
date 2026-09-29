import * as THREE from 'three';
import { GeoBuilder, mat, UNIT } from '../render/GeoBuilder';
import { createUberMaterial } from '../render/uber';
import { applyBend } from '../render/curve';
import { makeLogoPlate } from '../render/textures';
import { mulberry, pick, range } from '../core/rng';
import {
  addBush, addCampusCurb, addCar, addEplWing, addMoto, addShadeTree, addSlimLamp, addSpeedSign,
  CAR_COLORS, EPL_GREYBLUE, EPL_TEAL, ROAD_HALF, SIDEWALK_OUT,
} from './Scenery';

// Point de depart fidele au vrai batiment de l'EPL : tour d'entree gris-bleu
// avec le panneau UL / EPL et son toit pyramidal vert, passage couvert au
// rez-de-chaussee, ailes jaunes a barreaux et auvents, parking en laterite
// rempli de voitures et de motos, grands arbres d'ombrage.

const FRONT = 16; // z de la facade (tournee vers le joueur, qui regarde -z en course)

export class Campus {
  readonly group = new THREE.Group();

  constructor(logoFull: HTMLImageElement, _wordmark: HTMLImageElement) {
    const b = new GeoBuilder();
    const r = mulberry(77);

    // Route d'acces bordee de blocs rouges et blancs.
    for (const side of [-1, 1]) addCampusCurb(b, side, FRONT, -6);

    // Parkings en laterite de part et d'autre.
    for (const side of [-1, 1]) {
      b.add(UNIT.box, mat(side * (SIDEWALK_OUT + 16.35), 0.085, (FRONT - 8) / 2, 0, 0, 0, 32, 0.17, FRONT + 8), '#b0603a', { r: 1 });
      // Herbe seche en bordure.
      b.add(UNIT.box, mat(side * (SIDEWALK_OUT + 16.35), 0.08, -12, 0, 0, 0, 32, 0.16, 8), '#8d9a4a', { r: 1 });
    }
    // Esplanade devant le passage.
    b.add(UNIT.box, mat(0, 0.12, FRONT - 1.5, 0, 0, 0, ROAD_HALF * 2 + 6, 0.24, 3), '#c9c2b2', { r: 0.9 });

    // Tour d'entree.
    const tw = ROAD_HALF * 2 + 2.4;
    const tdepth = 9;
    const th = 13.5;
    const tz = FRONT + tdepth / 2;
    // Piles du passage et masse au-dessus.
    for (const s of [-1, 1]) b.add(UNIT.box, mat(s * (tw / 2 - 0.6), 2.1, tz, 0, 0, 0, 1.2, 4.2, tdepth), EPL_GREYBLUE, { r: 0.8 });
    b.add(UNIT.box, mat(0, (4.2 + th) / 2, tz, 0, 0, 0, tw, th - 4.2, tdepth), EPL_GREYBLUE, { r: 0.8 });
    // Joints de panneaux.
    for (let i = 1; i < 5; i++) b.add(UNIT.box, mat(-tw / 2 + i * (tw / 5), (4.2 + th) / 2, FRONT - 0.02, 0, 0, 0, 0.05, th - 4.2, 0.05), '#8e99a8', { r: 0.8 });
    for (let j = 1; j < 4; j++) b.add(UNIT.box, mat(0, 4.2 + j * ((th - 4.2) / 4), FRONT - 0.02, 0, 0, 0, tw, 0.05, 0.05), '#8e99a8', { r: 0.8 });
    // Plafond du passage et poutre.
    b.add(UNIT.box, mat(0, 4.3, FRONT - 0.1, 0, 0, 0, tw, 0.4, 0.4), '#d8d8d4', { r: 0.8 });
    b.add(UNIT.box, mat(0, 3.95, tz, 0, 0, 0, tw - 2.4, 0.1, tdepth), '#e9e6de', { r: 0.9 });
    // Toit pyramidal vert.
    const roof = new THREE.ConeGeometry(Math.hypot(tw, tdepth) / 2 + 0.6, 3.2, 4, 1);
    b.add(roof, mat(0, th + 1.6, tz, 0, Math.PI / 4, 0, tw / Math.hypot(tw, tdepth) * 1.4, 1, tdepth / Math.hypot(tw, tdepth) * 1.4), '#4f8a5b', { r: 0.6, m: 0.2 });
    b.add(UNIT.box, mat(0, th + 0.1, tz, 0, 0, 0, tw + 0.5, 0.25, tdepth + 0.5), '#d8d8d4', { r: 0.8 });
    // Cadre du panneau.
    b.add(UNIT.box, mat(0, th - 1.3, FRONT - 0.15, 0, 0, 0, tw - 0.6, 2.3, 0.2), '#1d2a44', { r: 0.5, m: 0.4 });
    // Fond du passage : cour interieure lumineuse et arbres.
    b.add(UNIT.box, mat(0, 0.05, FRONT + tdepth + 6, 0, 0, 0, 30, 0.1, 12), '#8d9a4a', { r: 1 });
    addShadeTree(b, -3, 0, FRONT + tdepth + 5, r, 0.9);
    addShadeTree(b, 5, 0, FRONT + tdepth + 8, r, 0.8);

    // Ailes jaunes de part et d'autre de la tour.
    for (const side of [-1, 1]) {
      const len = 40;
      const x0 = side > 0 ? tw / 2 : -tw / 2 - len;
      addEplWing(b, new THREE.Matrix4().makeTranslation(x0, 0, FRONT + 1), len, r);
      // Haie basse devant l'aile.
      for (let x = tw / 2 + 1; x < tw / 2 + len; x += 1.8) {
        b.add(UNIT.rbox, mat(side * x, 0.55, FRONT - 1.6, 0, 0, 0, 1.9, 1.0, 1.1), pick(r, ['#2f6b2c', '#3a7a31', '#356f2e']), { r: 0.9 });
      }
    }
    // Retour d'aile en fond (profondeur).
    addEplWing(b, new THREE.Matrix4().makeTranslation(-60, 0, FRONT + 26), 120, r);

    // Voitures garees sur la laterite.
    const cars: [number, number, number][] = [[-11, 9, 0], [-15, 8, 0.1], [-24, 7, -0.05], [12, 10, 0], [21, 3, 1.57], [-19, 1, 1.5]];
    for (const [x, z, ry] of cars) addCar(b, new THREE.Matrix4().makeTranslation(x, 0.2, z).multiply(new THREE.Matrix4().makeRotationY(ry)), pick(r, CAR_COLORS));
    // Rangee de motos (zemidjans) devant l'aile droite.
    for (let i = 0; i < 12; i++) {
      addMoto(b, new THREE.Matrix4().makeTranslation(10 + i * 0.95, 0.2, FRONT - 3.4 + (i % 2) * 0.3).multiply(new THREE.Matrix4().makeRotationY(0.15)),
        pick(r, ['#1e1e1e', '#b91c1c', '#1d4ed8', '#6b7280', '#c2410c']), r() < 0.4);
    }
    // Grands arbres d'ombrage.
    for (const [x, z, s] of [[-9, 4, 1.1], [-20, 12, 1], [15, 6, 1.15], [27, 12, 0.9], [-30, 3, 1], [9, -8, 0.9], [-10, -10, 1]] as const) {
      addShadeTree(b, x, 0.2, z, r, s);
    }
    for (let i = 0; i < 5; i++) addBush(b, range(r, -30, 30) + (r() < 0.5 ? -10 : 10), 0.2, range(r, -12, 12), 0.9, r, false);
    addSlimLamp(b, -1, 6);
    addSlimLamp(b, 1, -6);
    addSpeedSign(b, -1, -3);

    const mesh = new THREE.Mesh(b.build(), createUberMaterial({ grime: 0.16, groundAO: true }));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    this.group.add(mesh);

    // Panneau "Universite de Lome / Ecole Polytechnique de Lome" en haut de la tour.
    const plateTex = makeLogoPlate(logoFull, 2048, 460, { bg: '#fbfaf6', pad: 0.05 });
    const logoMat = applyBend(new THREE.MeshStandardMaterial({ map: plateTex, roughness: 0.7, emissive: '#ffffff', emissiveMap: plateTex, emissiveIntensity: 0.05 }));
    const pw = tw - 1.0;
    const logo = new THREE.Mesh(new THREE.PlaneGeometry(pw, pw * 460 / 2048), logoMat);
    logo.position.set(0, th - 1.3, FRONT - 0.27);
    logo.rotation.y = Math.PI;
    this.group.add(logo);
    // Petit panneau bleu au fond du passage.
    const small = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.0), applyBend(new THREE.MeshStandardMaterial({ color: EPL_TEAL, roughness: 0.5 })));
    small.position.set(0, 2.9, FRONT + tdepth - 0.2);
    small.rotation.y = Math.PI;
    this.group.add(small);
  }

  update(_dt: number, dz: number) {
    this.group.position.z += dz;
    this.group.visible = this.group.position.z < 160;
  }

  reset() {
    this.group.position.z = 0;
    this.group.visible = true;
  }
}
