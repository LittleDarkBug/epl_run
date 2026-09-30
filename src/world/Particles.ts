import * as THREE from 'three';
import { bendUniform } from '../render/curve';

// Systeme de particules CPU rendu en points (poussiere, etincelles, eclats).

const vert = /* glsl */ `
  uniform vec2 uBend;
  uniform float uScale;
  attribute float aSize;
  attribute vec4 aColor;
  varying vec4 vColor;
  void main() {
    vColor = aColor;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    // Pres de la camera, la particule s'efface (sinon enorme tache floue).
    vColor.a *= smoothstep(2.5, 6.0, -mvPosition.z);
    float bz = min(mvPosition.z, 0.0);
    mvPosition.y -= uBend.y * bz * bz;
    mvPosition.x += uBend.x * bz * bz;
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = min(aSize * uScale / max(-mvPosition.z, 0.1), uScale * 0.12);
  }
`;

const frag = /* glsl */ `
  uniform sampler2D uMap;
  varying vec4 vColor;
  void main() {
    vec4 t = texture2D(uMap, gl_PointCoord);
    gl_FragColor = vec4(vColor.rgb, vColor.a * t.a);
    if (gl_FragColor.a < 0.01) discard;
  }
`;

interface P {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; max: number;
  size: number; grow: number;
  r: number; g: number; b: number; a: number;
  drag: number; grav: number;
  world: boolean;
}

class Pool {
  readonly points: THREE.Points;
  private ps: P[] = [];
  private pos: Float32Array;
  private col: Float32Array;
  private siz: Float32Array;
  private geo: THREE.BufferGeometry;

  constructor(private max: number, map: THREE.Texture, additive: boolean) {
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.siz = new Float32Array(max);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.siz, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uMap: { value: map }, uBend: bendUniform, uScale: { value: 400 } },
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  setScale(s: number) {
    (this.points.material as THREE.ShaderMaterial).uniforms.uScale.value = s;
  }

  spawn(p: P) {
    if (this.ps.length >= this.max) this.ps.shift();
    this.ps.push(p);
  }

  update(dt: number, dz: number) {
    let n = 0;
    for (let i = this.ps.length - 1; i >= 0; i--) {
      const p = this.ps[i];
      p.life += dt;
      if (p.life >= p.max) {
        this.ps.splice(i, 1);
        continue;
      }
      const drag = Math.exp(-p.drag * dt);
      p.vx *= drag; p.vy *= drag; p.vz *= drag;
      p.vy -= p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt + (p.world ? dz : 0);
      const t = p.life / p.max;
      this.pos[n * 3] = p.x;
      this.pos[n * 3 + 1] = p.y;
      this.pos[n * 3 + 2] = p.z;
      const fade = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;
      this.col[n * 4] = p.r;
      this.col[n * 4 + 1] = p.g;
      this.col[n * 4 + 2] = p.b;
      this.col[n * 4 + 3] = p.a * fade;
      this.siz[n] = p.size * (1 + p.grow * t);
      n++;
    }
    this.geo.setDrawRange(0, n);
    for (const k of ['position', 'aColor', 'aSize']) (this.geo.getAttribute(k) as THREE.BufferAttribute).needsUpdate = true;
  }
}

export class Particles {
  readonly group = new THREE.Group();
  private dust: Pool;
  private glow: Pool;
  // Direction "vers l'arriere" du joueur (la poussiere part derriere lui).
  private bx = 0;
  private bz = 1;

  setBack(x: number, z: number) {
    this.bx = x;
    this.bz = z;
  }

  constructor(sprite: THREE.Texture) {
    this.dust = new Pool(500, sprite, false);
    this.glow = new Pool(600, sprite, true);
    this.group.add(this.dust.points, this.glow.points);
  }

  setViewportHeight(h: number) {
    this.dust.setScale(h * 0.9);
    this.glow.setScale(h * 0.9);
  }

  footDust(x: number, y: number, z: number, amount = 3) {
    for (let i = 0; i < amount; i++) {
      this.dust.spawn({
        x: x + (Math.random() - 0.5) * 0.3, y: y + 0.05, z: z + (Math.random() - 0.5) * 0.3,
        vx: (Math.random() - 0.5) * 1.5 + this.bx * (2 + Math.random() * 2), vy: Math.random() * 1.2 + 0.3, vz: (Math.random() - 0.5) * 1.5 + this.bz * (2 + Math.random() * 2),
        life: 0, max: 0.6 + Math.random() * 0.5, size: 0.35, grow: 2.2,
        r: 0.78, g: 0.55, b: 0.4, a: 0.35, drag: 3, grav: -0.3, world: true,
      });
    }
  }

  impact(x: number, y: number, z: number, amount = 26, heavy = false) {
    for (let i = 0; i < amount; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (heavy ? 5 : 3) * (0.4 + Math.random());
      this.dust.spawn({
        x, y: y + 0.1, z,
        vx: Math.cos(a) * sp, vy: Math.random() * (heavy ? 3 : 2), vz: Math.sin(a) * sp,
        life: 0, max: 0.8 + Math.random() * 0.6, size: heavy ? 0.9 : 0.5, grow: 2.5,
        r: 0.72, g: 0.52, b: 0.4, a: 0.45, drag: 3.5, grav: 0.4, world: true,
      });
    }
  }

  sparkle(x: number, y: number, z: number, color = [1.0, 0.8, 0.25], amount = 10) {
    for (let i = 0; i < amount; i++) {
      const a = Math.random() * Math.PI * 2;
      const e = Math.random() * Math.PI - Math.PI / 2;
      const sp = 2 + Math.random() * 3;
      this.glow.spawn({
        x, y, z,
        vx: Math.cos(a) * Math.cos(e) * sp, vy: Math.sin(e) * sp + 1.5, vz: Math.sin(a) * Math.cos(e) * sp,
        life: 0, max: 0.35 + Math.random() * 0.3, size: 0.22, grow: -0.6,
        r: color[0] * 3, g: color[1] * 3, b: color[2] * 3, a: 1, drag: 4, grav: 4, world: false,
      });
    }
  }

  trail(x: number, y: number, z: number, color: number[]) {
    this.glow.spawn({
      x: x + (Math.random() - 0.5) * 0.2, y, z,
      vx: 0, vy: 0.3, vz: 0,
      life: 0, max: 0.35, size: 0.2, grow: -0.5,
      r: color[0] * 2.5, g: color[1] * 2.5, b: color[2] * 2.5, a: 0.9, drag: 1, grav: 0, world: true,
    });
  }

  update(dt: number, dz: number) {
    this.dust.update(dt, dz);
    this.glow.update(dt, dz);
  }
}
