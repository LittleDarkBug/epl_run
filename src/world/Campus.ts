import * as THREE from 'three';
import { GeoBuilder } from '../render/GeoBuilder';
import { createUberMaterial } from '../render/uber';
import type { BakedAsset } from './assets';
import { mulberry, pick, range } from '../core/rng';
import {
  addBush, addCampusCurb, addCar, addMoto, addSlimLamp, addSpeedSign,
  CAR_COLORS,
} from './Scenery';

// Point de depart fidele au vrai batiment de l'EPL : tour d'entree gris-bleu
// avec le panneau UL / EPL et son toit pyramidal vert, passage couvert au
// rez-de-chaussee, ailes jaunes a barreaux et auvents, parking en laterite
// rempli de voitures et de motos, grands arbres d'ombrage.

const FRONT = 16; // z de la facade (tournee vers le joueur, qui regarde -z en course)

export class Campus {
  readonly group = new THREE.Group();

  constructor(baked: BakedAsset, trees: THREE.Object3D[]) {
    const b = new GeoBuilder();
    const r = mulberry(77);

    // Route d'acces bordee de blocs rouges et blancs.
    for (const side of [-1, 1]) addCampusCurb(b, side, FRONT, -6);

    // Batiment, sol et haies : modelises dans Blender (tools/blender/build_campus.py).
    this.group.add(baked.root);
    // Arbres d'ombrage modelises dans Blender (parking et cour interieure).
    const spots: [number, number, number][] = [
      [-9, 4, 1.1], [-20, 12, 1], [15, 6, 1.15], [27, 12, 0.95], [-30, 3, 1], [9, -8, 0.9], [-10, -10, 1],
      [-3, FRONT + 14, 0.9], [5, FRONT + 17, 0.85], [34, 4, 1], [-38, 10, 1.05],
    ];
    spots.forEach(([x, z, s], i) => {
      const t = trees[i % trees.length].clone();
      t.position.set(x, 0.15, z);
      t.rotation.y = r() * Math.PI * 2;
      t.scale.setScalar(s * (0.95 + r() * 0.15));
      this.group.add(t);
    });

    // Voitures garees sur la laterite.
    const cars: [number, number, number][] = [[-11, 9, 0], [-15, 8, 0.1], [-24, 7, -0.05], [12, 10, 0], [21, 3, 1.57], [-19, 1, 1.5]];
    for (const [x, z, ry] of cars) addCar(b, new THREE.Matrix4().makeTranslation(x, 0.2, z).multiply(new THREE.Matrix4().makeRotationY(ry)), pick(r, CAR_COLORS));
    // Rangee de motos (zemidjans) devant l'aile droite.
    for (let i = 0; i < 12; i++) {
      addMoto(b, new THREE.Matrix4().makeTranslation(10 + i * 0.95, 0.2, FRONT - 3.4 + (i % 2) * 0.3).multiply(new THREE.Matrix4().makeRotationY(0.15)),
        pick(r, ['#1e1e1e', '#b91c1c', '#1d4ed8', '#6b7280', '#c2410c']), r() < 0.4);
    }
    for (let i = 0; i < 5; i++) {
      const side = r() < 0.5 ? -1 : 1;
      addBush(b, side * range(r, 11, 34), 0.2, range(r, -12, 10), 0.9, r, false);
    }
    addSlimLamp(b, -1, 6);
    addSlimLamp(b, 1, -6);
    addSpeedSign(b, -1, -3);

    const mesh = new THREE.Mesh(b.build(), createUberMaterial({ grime: 0.16, groundAO: true }));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    this.group.add(mesh);
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
