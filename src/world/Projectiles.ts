import * as THREE from 'three';
import { applyBend } from '../render/curve';
import type { Path } from './Path';

// Projectiles du Gardien : des formulaires rejetes, froisses et enveloppes
// d'energie rouge. Une cible au sol annonce le point d'impact (la ou le joueur
// arrivera), le projectile passe au-dessus de la camera puis s'ecrase. On
// l'esquive en changeant de voie ou en sautant assez haut.

interface Shot {
  s: number; // abscisse d'impact sur le chemin
  x: number; // decalage lateral
  t: number; // temps ecoule
  impactAt: number;
  launchAt: number;
  launched: boolean;
  impacted: boolean;
  from: THREE.Vector3;
  to: THREE.Vector3;
  ball: THREE.Group;
  marker: THREE.Group;
  scorch: THREE.Mesh;
}

const FLIGHT = 1.0; // duree de vol
const HAZARD = 0.5; // flammes actives apres l'impact
const up = new THREE.Vector3();

export class Projectiles {
  readonly group = new THREE.Group();
  private shots: Shot[] = [];
  private free: Shot[] = [];
  private ballGeo: THREE.BufferGeometry;
  private paperMat: THREE.MeshStandardMaterial;
  private glowMat: THREE.MeshBasicMaterial;
  private ringMat: THREE.MeshBasicMaterial;
  private discMat: THREE.MeshBasicMaterial;
  private scorchMat: THREE.MeshBasicMaterial;
  private baseMat: THREE.MeshBasicMaterial;
  private beamMat: THREE.MeshBasicMaterial;
  private time = 0;
  onLaunch: ((from: THREE.Vector3) => void) | null = null;
  onImpact: ((pos: THREE.Vector3, s: number, x: number) => void) | null = null;
  onTrail: ((pos: THREE.Vector3) => void) | null = null;

  constructor(private path: Path) {
    // Boule de papier froisse (icosaedre deforme, facettes nettes).
    const g = new THREE.IcosahedronGeometry(0.3, 1);
    const p = g.attributes.position as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    const seen = new Map<string, number>();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const k = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
      if (!seen.has(k)) seen.set(k, 0.75 + Math.random() * 0.45);
      v.multiplyScalar(seen.get(k)!);
      p.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeVertexNormals();
    this.ballGeo = g;
    this.paperMat = applyBend(new THREE.MeshStandardMaterial({ color: '#f3eee2', roughness: 0.8, emissive: '#ff3a1a', emissiveIntensity: 0.9, flatShading: true }));
    this.glowMat = applyBend(new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.45, 0.2), transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.ringMat = applyBend(new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 0.2, 0.08), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.discMat = applyBend(new THREE.MeshBasicMaterial({ color: new THREE.Color(1.8, 0.1, 0.05), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.baseMat = applyBend(new THREE.MeshBasicMaterial({ color: '#1a0503', transparent: true, opacity: 0.55, depthWrite: false }));
    // Colonne de lumiere au point d'impact (degrade vertical).
    const c = document.createElement('canvas');
    c.width = 4;
    c.height = 64;
    const x = c.getContext('2d')!;
    const gr = x.createLinearGradient(0, 0, 0, 64);
    gr.addColorStop(0, 'rgba(255,255,255,0)');
    gr.addColorStop(1, 'rgba(255,255,255,1)');
    x.fillStyle = gr;
    x.fillRect(0, 0, 4, 64);
    const beamTex = new THREE.CanvasTexture(c);
    this.beamMat = applyBend(new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.2, 0.1), map: beamTex, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.scorchMat = applyBend(new THREE.MeshBasicMaterial({ color: '#120804', transparent: true, opacity: 0.6, depthWrite: false }));
  }

  private make(): Shot {
    const ball = new THREE.Group();
    const paper = new THREE.Mesh(this.ballGeo, this.paperMat);
    paper.castShadow = true;
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.62, 16, 12), this.glowMat);
    ball.add(paper, glow);
    const marker = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.78, 1.02, 48).rotateX(-Math.PI / 2), this.ringMat);
    const inner = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.36, 32).rotateX(-Math.PI / 2), this.ringMat);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.8, 48).rotateX(-Math.PI / 2), this.discMat);
    // Reticule : quatre traits.
    for (let k = 0; k < 4; k++) {
      const bar = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.34).rotateX(-Math.PI / 2).translate(0, 0, -0.6), this.ringMat);
      bar.rotation.y = (k * Math.PI) / 2;
      marker.add(bar);
    }
    const base = new THREE.Mesh(new THREE.CircleGeometry(1.05, 48).rotateX(-Math.PI / 2).translate(0, -0.01, 0), this.baseMat);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.85, 3.6, 24, 1, true).translate(0, 1.8, 0), this.beamMat);
    beam.name = 'beam';
    marker.add(base, disc, ring, inner, beam);
    marker.renderOrder = 2;
    const scorch = new THREE.Mesh(new THREE.CircleGeometry(1.2, 32).rotateX(-Math.PI / 2), this.scorchMat.clone());
    scorch.renderOrder = 1;
    this.group.add(ball, marker, scorch);
    return { s: 0, x: 0, t: 0, impactAt: 0, launchAt: 0, launched: false, impacted: false, from: new THREE.Vector3(), to: new THREE.Vector3(), ball, marker, scorch };
  }

  get active(): number {
    return this.shots.length;
  }

  // Lance un tir qui touchera (s, x) dans `delay` secondes.
  spawn(s: number, x: number, delay: number) {
    const sh = this.free.pop() ?? this.make();
    sh.s = s;
    sh.x = x;
    sh.t = 0;
    sh.impactAt = delay;
    sh.launchAt = delay - FLIGHT;
    sh.launched = false;
    sh.impacted = false;
    this.path.pos(s, x, sh.to, 0);
    sh.marker.position.copy(sh.to).setY(0.05);
    sh.marker.visible = true;
    sh.marker.scale.setScalar(1.6);
    sh.ball.visible = false;
    sh.scorch.visible = false;
    sh.scorch.position.copy(sh.to).setY(0.03);
    this.shots.push(sh);
  }

  // Point de depart du vol (fourni par le jeu : derriere le joueur, en hauteur).
  launchFrom(from: THREE.Vector3) {
    for (const sh of this.shots) if (!sh.launched && sh.t >= sh.launchAt - 0.02) sh.from.copy(from);
  }

  needsLaunch(): boolean {
    return this.shots.some((sh) => !sh.launched && sh.t >= sh.launchAt);
  }

  update(dt: number) {
    this.time += dt;
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const sh = this.shots[i];
      sh.t += dt;
      // Cible : se resserre et pulse jusqu'a l'impact.
      if (!sh.impacted) {
        const k = Math.min(1, sh.t / sh.impactAt);
        sh.marker.scale.setScalar(1.6 - 0.6 * k);
        sh.marker.rotation.y += dt * (1.5 + 4 * k);
        this.ringMat.opacity = 0.7 + 0.3 * Math.sin(this.time * (10 + 14 * k));
        this.beamMat.opacity = 0.25 + 0.35 * k;
      }
      if (!sh.launched && sh.t >= sh.launchAt) {
        sh.launched = true;
        sh.ball.visible = true;
        this.onLaunch?.(sh.from);
      }
      if (sh.launched && !sh.impacted) {
        const u = Math.min(1, (sh.t - sh.launchAt) / FLIGHT);
        const h = 7 * Math.sin(Math.PI * u) * (1 - 0.3 * u);
        sh.ball.position.lerpVectors(sh.from, sh.to, u).add(up.set(0, h + 0.3, 0));
        sh.ball.rotation.x += dt * 9;
        sh.ball.rotation.z += dt * 6;
        this.onTrail?.(sh.ball.position);
      }
      if (!sh.impacted && sh.t >= sh.impactAt) {
        sh.impacted = true;
        sh.ball.visible = false;
        sh.marker.visible = false;
        sh.scorch.visible = true;
        this.onImpact?.(sh.to, sh.s, sh.x);
      }
      if (sh.impacted) {
        const f = sh.t - sh.impactAt;
        (sh.scorch.material as THREE.MeshBasicMaterial).opacity = 0.6 * Math.max(0, 1 - f / 3);
        if (f > 3) {
          sh.scorch.visible = false;
          this.shots.splice(i, 1);
          this.free.push(sh);
        }
      }
    }
  }

  // Le joueur (abscisse, decalage, hauteur) est-il dans une zone d'impact active ?
  hits(s: number, x: number, y: number): boolean {
    for (const sh of this.shots) {
      if (!sh.impacted && sh.t < sh.impactAt - 0.06) continue;
      const f = sh.t - sh.impactAt;
      if (f > HAZARD) continue;
      if (Math.abs(s - sh.s) < 1.5 && Math.abs(x - sh.x) < 1.15 && y < 1.1) {
        sh.t = sh.impactAt + HAZARD + 0.01; // un seul coup par tir
        return true;
      }
    }
    return false;
  }

  clear() {
    for (const sh of this.shots) {
      sh.ball.visible = sh.marker.visible = sh.scorch.visible = false;
      this.free.push(sh);
    }
    this.shots = [];
  }
}
