import * as THREE from 'three';

// Ciel de fin d'apres-midi : degrade, soleil, halo, nuages procéduraux,
// plus une silhouette de ville lointaine en bandeau.

export const PALETTE = {
  zenith: new THREE.Color('#1d2f78'),
  mid: new THREE.Color('#6a64b8'),
  horizon: new THREE.Color('#ffae76'),
  sun: new THREE.Color('#ffd7a1'),
  fog: new THREE.Color('#e7a07f'),
  cloudLit: new THREE.Color('#ffd0a8'),
  cloudShade: new THREE.Color('#6b5b9c'),
};

export const SUN_DIR = new THREE.Vector3(-0.55, 0.26, -0.8).normalize();

const skyVert = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww;
  }
`;

const skyFrag = /* glsl */ `
  uniform vec3 uSunDir, uZenith, uMid, uHorizon, uSun, uCloudLit, uCloudShade, uFog;
  uniform float uTime, uClouds;
  varying vec3 vDir;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + 11.7; a *= 0.5; }
    return v;
  }

  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    float sd = max(dot(d, uSunDir), 0.0);

    vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.22, h));
    col = mix(col, uZenith, smoothstep(0.18, 0.75, h));
    // Halo solaire et diffusion pres de l'horizon.
    float horizonBand = 1.0 - smoothstep(-0.05, 0.35, h);
    col += uSun * pow(sd, 6.0) * 0.55 * horizonBand;
    col += uSun * pow(sd, 48.0) * 0.9;
    col += uSun * pow(sd, 900.0) * 6.0;
    col += uSun * smoothstep(0.99955, 0.9998, sd) * 14.0;

    // Nuages.
    if (uClouds > 0.5 && h > 0.0) {
      vec2 uv = d.xz / (h + 0.12);
      uv += vec2(uTime * 0.004, uTime * 0.002);
      float n = fbm(uv * 0.9);
      float c = smoothstep(0.52, 0.78, n) * smoothstep(0.02, 0.2, h);
      float thick = smoothstep(0.55, 0.9, fbm(uv * 1.7 + 3.0));
      vec3 cc = mix(uCloudShade, uCloudLit, clamp(pow(sd, 3.0) * 1.4 + 0.25 - thick * 0.3, 0.0, 1.0));
      cc += uSun * pow(sd, 12.0) * (1.0 - thick) * 0.9; // liseres dores
      col = mix(col, cc, c * 0.9);
    }

    // Sous l'horizon : brume chaude.
    col = mix(col, uFog, smoothstep(0.02, -0.08, h));
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createSky(clouds = true): THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> {
  const mat = new THREE.ShaderMaterial({
    vertexShader: skyVert,
    fragmentShader: skyFrag,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uSunDir: { value: SUN_DIR.clone() },
      uZenith: { value: PALETTE.zenith },
      uMid: { value: PALETTE.mid },
      uHorizon: { value: PALETTE.horizon },
      uSun: { value: PALETTE.sun },
      uCloudLit: { value: PALETTE.cloudLit },
      uCloudShade: { value: PALETTE.cloudShade },
      uFog: { value: PALETTE.fog },
      uTime: { value: 0 },
      uClouds: { value: clouds ? 1 : 0 },
    },
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}

// Silhouette de ville lointaine : un anneau partiel texture en shader.
const skylineFrag = /* glsl */ `
  uniform vec3 uColor, uTop, uFog, uSun, uSunDir;
  uniform float uSeed, uHeight, uWindows;
  varying vec2 vUv;
  varying vec3 vDir;
  float hash(float x) { return fract(sin(x * 91.345 + uSeed) * 47453.5453); }
  void main() {
    float cols = 260.0;
    float x = vUv.x * cols;
    float id = floor(x);
    float fx = fract(x);
    float hgt = 0.12 + pow(hash(id), 2.2) * uHeight;
    // Quelques tours, antennes et palmiers.
    float tower = step(0.93, hash(id + 7.0));
    hgt += tower * 0.35;
    float antenna = step(0.96, hash(id + 13.0)) * step(abs(fx - 0.5), 0.05) * 0.18;
    float palm = step(0.85, hash(id + 29.0));
    float palmTop = palm * (1.0 - smoothstep(0.0, 0.08, abs(vUv.y - (hgt + 0.16)) - 0.03 * (1.0 - abs(fx - 0.5) * 2.0)));
    float palmTrunk = palm * step(abs(fx - 0.5), 0.04) * step(vUv.y, hgt + 0.16);
    float inside = step(vUv.y, hgt) + step(vUv.y, hgt + antenna) + palmTop + palmTrunk;
    if (inside < 0.5) discard;
    float grad = smoothstep(0.0, 0.6, vUv.y);
    vec3 col = mix(uColor, uTop, grad);
    float facing = pow(max(dot(normalize(vDir), uSunDir), 0.0), 4.0);
    col += uSun * facing * 0.25;
    // Fenetres allumees.
    vec2 w = vec2(fract(x * 3.0), fract(vUv.y * 60.0));
    float lit = step(0.72, hash(floor(x * 3.0) * 7.1 + floor(vUv.y * 60.0) * 3.3));
    float win = step(0.3, w.x) * step(w.x, 0.7) * step(0.35, w.y) * step(w.y, 0.75) * lit * step(vUv.y, hgt - 0.02);
    col = mix(col, vec3(1.0, 0.75, 0.4) * 1.6, win * uWindows);
    col = mix(col, uFog, smoothstep(0.35, 0.0, vUv.y) * 0.55);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const skylineVert = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vDir;
  void main() {
    vUv = uv;
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export function createSkyline(): THREE.Group {
  const g = new THREE.Group();
  const layers = [
    { r: 620, h: 110, y: -24, color: '#8a6a8f', top: '#b98a96', seed: 1.0, height: 0.45, win: 0.0 },
    { r: 520, h: 90, y: -22, color: '#5e4a78', top: '#8d6a8a', seed: 7.0, height: 0.55, win: 1.0 },
  ];
  for (const L of layers) {
    const geo = new THREE.CylinderGeometry(L.r, L.r, L.h, 160, 1, true, Math.PI * 0.5, Math.PI);
    const mat = new THREE.ShaderMaterial({
      vertexShader: skylineVert,
      fragmentShader: skylineFrag,
      side: THREE.BackSide,
      fog: false,
      uniforms: {
        uColor: { value: new THREE.Color(L.color) },
        uTop: { value: new THREE.Color(L.top) },
        uFog: { value: PALETTE.fog },
        uSun: { value: PALETTE.sun },
        uSunDir: { value: SUN_DIR },
        uSeed: { value: L.seed },
        uHeight: { value: L.height },
        uWindows: { value: L.win },
      },
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.y = L.y + L.h / 2;
    m.frustumCulled = false;
    m.renderOrder = -5;
    g.add(m);
  }
  return g;
}
