import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

// Accumulateur de geometries : fusionne des primitives transformees en une
// seule BufferGeometry avec couleur et parametres PBR par sommet.

export interface Pbr {
  e?: number; // emissif
  r?: number; // rugosite
  m?: number; // metal
}

const tmpV = new THREE.Vector3();
const tmpN = new THREE.Vector3();
const tmpNM = new THREE.Matrix3();
const tmpC = new THREE.Color();

export class GeoBuilder {
  private pos: number[] = [];
  private nor: number[] = [];
  private col: number[] = [];
  private pbr: number[] = [];
  private uv: number[] = [];
  private idx: number[] = [];
  private vcount = 0;

  add(geo: THREE.BufferGeometry, matrix: THREE.Matrix4, color: THREE.ColorRepresentation, p: Pbr = {}): this {
    const P = geo.getAttribute('position') as THREE.BufferAttribute;
    const N = geo.getAttribute('normal') as THREE.BufferAttribute | undefined;
    const U = geo.getAttribute('uv') as THREE.BufferAttribute | undefined;
    const colorAttr = geo.getAttribute('color') as THREE.BufferAttribute | undefined;
    tmpNM.getNormalMatrix(matrix);
    tmpC.set(color);
    const e = p.e ?? 0, r = p.r ?? 0.8, m = p.m ?? 0;
    const base = this.vcount;
    const flip = matrix.determinant() < 0;
    for (let i = 0; i < P.count; i++) {
      tmpV.fromBufferAttribute(P, i).applyMatrix4(matrix);
      this.pos.push(tmpV.x, tmpV.y, tmpV.z);
      if (N) {
        tmpN.fromBufferAttribute(N, i).applyMatrix3(tmpNM).normalize();
        this.nor.push(tmpN.x, tmpN.y, tmpN.z);
      } else {
        this.nor.push(0, 1, 0);
      }
      if (colorAttr) {
        this.col.push(colorAttr.getX(i) * tmpC.r, colorAttr.getY(i) * tmpC.g, colorAttr.getZ(i) * tmpC.b);
      } else {
        this.col.push(tmpC.r, tmpC.g, tmpC.b);
      }
      this.pbr.push(e, r, m);
      if (U) this.uv.push(U.getX(i), U.getY(i));
      else this.uv.push(0, 0);
    }
    const index = geo.getIndex();
    if (index) {
      for (let i = 0; i < index.count; i += 3) {
        const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2);
        if (flip) this.idx.push(base + a, base + c, base + b);
        else this.idx.push(base + a, base + b, base + c);
      }
    } else {
      for (let i = 0; i < P.count; i += 3) {
        if (flip) this.idx.push(base + i, base + i + 2, base + i + 1);
        else this.idx.push(base + i, base + i + 1, base + i + 2);
      }
    }
    this.vcount += P.count;
    return this;
  }

  get vertexCount(): number {
    return this.vcount;
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aPbr', new THREE.Float32BufferAttribute(this.pbr, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.vcount > 65535) g.setIndex(new THREE.Uint32BufferAttribute(this.idx, 1));
    else g.setIndex(new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

// Petits utilitaires de composition.
const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const e3 = new THREE.Euler();
const s3 = new THREE.Vector3();
const p3 = new THREE.Vector3();

export function mat(
  x: number, y: number, z: number,
  rx = 0, ry = 0, rz = 0,
  sx = 1, sy = 1, sz = 1,
): THREE.Matrix4 {
  e3.set(rx, ry, rz);
  q.setFromEuler(e3);
  p3.set(x, y, z);
  s3.set(sx, sy, sz);
  return m4.clone().compose(p3, q, s3);
}

// Geometries unitaires partagees (a transformer via mat()).
export const UNIT = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 14, 1),
  cylLow: new THREE.CylinderGeometry(0.5, 0.5, 1, 8, 1),
  cone: new THREE.ConeGeometry(0.5, 1, 12, 1),
  sphere: new THREE.SphereGeometry(0.5, 16, 12),
  sphereLow: new THREE.SphereGeometry(0.5, 10, 8),
  torus: new THREE.TorusGeometry(0.5, 0.12, 8, 20),
  rbox: new RoundedBoxGeometry(1, 1, 1, 2, 0.08),
  rboxSoft: new RoundedBoxGeometry(1, 1, 1, 3, 0.22),
};
