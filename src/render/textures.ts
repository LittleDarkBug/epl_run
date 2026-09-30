import * as THREE from 'three';

// Textures procedurales generees sur canvas au demarrage.

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function rand(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Bruit de valeur 2D tuilable.
function makeNoise(w: number, h: number, cells: number, seed: number): Float32Array {
  const r = rand(seed);
  const gw = cells, gh = Math.round(cells * h / w);
  const grid = new Float32Array(gw * gh).map(() => r());
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const fx = (x / w) * gw, fy = (y / h) * gh;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const tx = fx - x0, ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const a = grid[(y0 % gh) * gw + (x0 % gw)];
      const b = grid[(y0 % gh) * gw + ((x0 + 1) % gw)];
      const c = grid[((y0 + 1) % gh) * gw + (x0 % gw)];
      const d = grid[((y0 + 1) % gh) * gw + ((x0 + 1) % gw)];
      out[y * w + x] = (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
    }
  }
  return out;
}

function fbm(w: number, h: number, seed: number, octaves = 4, base = 8): Float32Array {
  const out = new Float32Array(w * h);
  let amp = 0.5, total = 0;
  for (let o = 0; o < octaves; o++) {
    const n = makeNoise(w, h, base << o, seed + o * 101);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

function normalFromHeight(h: Float32Array, w: number, hh: number, strength: number): HTMLCanvasElement {
  const [c, ctx] = canvas(w, hh);
  const img = ctx.createImageData(w, hh);
  for (let y = 0; y < hh; y++) {
    for (let x = 0; x < w; x++) {
      const l = h[y * w + ((x - 1 + w) % w)], r = h[y * w + ((x + 1) % w)];
      const u = h[((y - 1 + hh) % hh) * w + x], d = h[((y + 1) % hh) * w + x];
      let nx = (l - r) * strength, ny = (u - d) * strength, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;
      const i = (y * w + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export interface RoadTextures {
  map: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
}

// Route : 9 m de large (u) sur 18 m de long (v). L'albedo est en double
// resolution pour des marquages nets ; relief et rugosite restent doux pour
// eviter tout scintillement speculaire.
export function makeRoadTextures(maxAniso: number, markings = true): RoadTextures {
  const W = 512, H = 1024;
  const pxPerM = W / 9;
  const n = fbm(W, H, 7, 4, 6);
  const mid = makeNoise(W, H, 64, 99);
  const height = new Float32Array(W * H);

  const [c, ctx] = canvas(W, H);
  const img = ctx.createImageData(W, H);
  const [rc, rctx] = canvas(W, H);
  const rimg = rctx.createImageData(W, H);
  const r = rand(3);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const m = x / pxPerM - 4.5;
      const lanePos = ((m + 1.25) % 2.5 + 2.5) % 2.5 - 1.25;
      // Traces de roues legerement plus sombres et plus lisses.
      const tire = Math.exp(-Math.pow((Math.abs(lanePos) - 0.62) / 0.28, 2));
      // Bitume clair et chaud (goudron blanchi au soleil) : les silhouettes
      // sombres, comme l'uniforme bleu marine, s'en detachent nettement.
      let v = 0.36 + n[i] * 0.1 + (mid[i] - 0.5) * 0.05;
      v *= 1 - tire * 0.12;
      const edge = Math.max(0, Math.min(1, (Math.abs(m) - 3.7) / 0.8));
      const o = i * 4;
      img.data[o] = Math.min(255, (v * 1.04 + edge * 0.16 * n[i]) * 255);
      img.data[o + 1] = Math.min(255, (v * 0.99 + edge * 0.07 * n[i]) * 255);
      img.data[o + 2] = Math.min(255, (v * 0.92 + edge * 0.02 * n[i]) * 255);
      img.data[o + 3] = 255;
      height[i] = n[i] * 0.7 + mid[i] * 0.3;
      const rough = 0.86 + (mid[i] - 0.5) * 0.06 - tire * 0.1;
      rimg.data[o] = rimg.data[o + 1] = rimg.data[o + 2] = Math.max(0, Math.min(255, rough * 255));
      rimg.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  rctx.putImageData(rimg, 0, 0);

  // Rustines de bitume aux bords adoucis.
  for (let k = 0; k < 5; k++) {
    const px = r() * W, py = r() * H, w = 50 + r() * 110, h = 60 + r() * 160;
    const g = ctx.createLinearGradient(px, py, px + w, py);
    g.addColorStop(0, 'rgba(18,18,22,0)');
    g.addColorStop(0.1, `rgba(18,18,22,${0.12 + r() * 0.12})`);
    g.addColorStop(0.9, `rgba(18,18,22,${0.12 + r() * 0.12})`);
    g.addColorStop(1, 'rgba(18,18,22,0)');
    ctx.fillStyle = g;
    ctx.fillRect(px, py, w, h);
  }
  // Quelques fissures fines et discretes.
  ctx.strokeStyle = 'rgba(12,12,14,0.35)';
  ctx.lineWidth = 1;
  for (let k = 0; k < 8; k++) {
    let px = r() * W, py = r() * H;
    ctx.beginPath();
    ctx.moveTo(px, py);
    for (let st = 0; st < 6; st++) {
      px += (r() - 0.5) * 24;
      py += r() * 22;
      ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  // Albedo final en double resolution avec marquages nets.
  const [hc, hctx] = canvas(W * 2, H * 2);
  hctx.imageSmoothingQuality = 'high';
  hctx.drawImage(c, 0, 0, W * 2, H * 2);
  const S = 2 * pxPerM;
  const paint = (mx: number, width: number, dash: number, gap: number, color: string) => {
    const x = (mx + 4.5) * S;
    const wpx = width * S;
    const step = (dash + gap) * S;
    for (let y = 0; y < H * 2; y += step) {
      hctx.fillStyle = color;
      hctx.fillRect(x - wpx / 2, y, wpx, dash * S);
      // Usure legere : zones un peu plus transparentes, sans taches.
      hctx.fillStyle = 'rgba(40,40,44,0.18)';
      for (let k = 0; k < 3; k++) hctx.fillRect(x - wpx / 2, y + r() * dash * S, wpx, (0.1 + r() * 0.3) * S);
      rctx.fillStyle = 'rgb(165,165,165)';
      rctx.fillRect((mx + 4.5) * pxPerM - width * pxPerM / 2, y / 2, width * pxPerM, (dash * S) / 2);
    }
  };
  if (markings) {
    paint(-1.25, 0.14, 3, 3, 'rgba(232,230,220,0.9)');
    paint(1.25, 0.14, 3, 3, 'rgba(232,230,220,0.9)');
    paint(-4.05, 0.15, 18, 0, 'rgba(236,190,40,0.9)');
    paint(4.05, 0.15, 18, 0, 'rgba(236,190,40,0.9)');
  }

  const map = new THREE.CanvasTexture(hc);
  map.colorSpace = THREE.SRGBColorSpace;
  const roughnessMap = new THREE.CanvasTexture(rc);
  const normalMap = new THREE.CanvasTexture(normalFromHeight(height, W, H, 0.9));
  for (const t of [map, roughnessMap, normalMap]) {
    t.wrapS = THREE.ClampToEdgeWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = maxAniso;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
  }
  return { map, roughnessMap, normalMap };
}

// Pavage des trottoirs (tuilable).
export function makePaverTextures(maxAniso: number): { map: THREE.CanvasTexture; normalMap: THREE.CanvasTexture } {
  const S = 256;
  const [c, ctx] = canvas(S, S);
  const r = rand(11);
  const n = fbm(S, S, 5, 4, 4);
  const height = new Float32Array(S * S);
  const img = ctx.createImageData(S, S);
  const tiles = 4, t = S / tiles;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const row = Math.floor(y / t);
      const ox = row % 2 ? t / 2 : 0;
      const lx = (x + ox) % t, ly = y % t;
      const d = Math.min(lx, ly, t - lx, t - ly);
      const joint = Math.min(1, Math.max(0, (d - 1.5) / 1.5));
      const bevel = Math.min(1, d / 8);
      const tileId = Math.floor((x + ox) / t) + row * 7;
      const tint = 0.85 + ((tileId * 9301 + 49297) % 233280) / 233280 * 0.2;
      const v = (0.58 + n[i] * 0.18) * tint * (0.6 + 0.4 * joint);
      height[i] = joint * bevel * 0.8 + n[i] * 0.2;
      const o = i * 4;
      img.data[o] = v * 222;
      img.data[o + 1] = v * 196;
      img.data[o + 2] = v * 170;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  for (let k = 0; k < 30; k++) {
    ctx.fillStyle = `rgba(120,60,30,${r() * 0.12})`;
    ctx.beginPath();
    ctx.arc(r() * S, r() * S, 4 + r() * 18, 0, Math.PI * 2);
    ctx.fill();
  }
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  const normalMap = new THREE.CanvasTexture(normalFromHeight(height, S, S, 1.2));
  for (const tex of [map, normalMap]) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = maxAniso;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
  }
  return { map, normalMap };
}

// Banderole textile avec texte (portiques).
export function makeBannerTexture(text: string, bg: string, fg: string, accent: string): THREE.CanvasTexture {
  const W = 1024, H = 428;
  const [c, ctx] = canvas(W, H);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, bg);
  g.addColorStop(1, shade(bg, -0.22));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, W, 26);
  ctx.fillRect(0, H - 26, W, 26);
  // Motif de bandes du logo EPL.
  const bars = ['#e41f26', '#f5d10d', '#0b9185', '#6fb4ff', '#c3199b', '#ffffff'];
  for (let i = 0; i < 30; i++) {
    ctx.fillStyle = bars[i % bars.length];
    ctx.fillRect(W / 2 - 165 + i * 11, H - 92, 5, 44);
  }
  // Oeillets.
  ctx.fillStyle = '#d1d5db';
  for (const x of [30, W - 30]) for (const y of [48, H - 48]) {
    ctx.beginPath();
    ctx.arc(x, y, 12, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = fg;
  ctx.font = '150px "Archivo Black", "Arial Black", Impact, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowOffsetY = 6;
  ctx.shadowBlur = 8;
  ctx.fillText(text, W / 2, H * 0.44, W - 110);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function shade(hex: string, amt: number): string {
  const col = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  col.getHSL(hsl);
  col.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l + amt)));
  return '#' + col.getHexString();
}

// Plaque blanche portant le logo (poitrine du gardien, cape, panneaux).
export function makeLogoPlate(
  img: HTMLImageElement,
  w: number, h: number,
  opts: { bg?: string; pad?: number; radius?: number; border?: string; stripes?: boolean } = {},
): THREE.CanvasTexture {
  const [c, ctx] = canvas(w, h);
  const pad = opts.pad ?? 0.08;
  const rad = opts.radius ?? 0;
  ctx.fillStyle = opts.bg ?? '#f6f4ee';
  roundRect(ctx, 0, 0, w, h, rad);
  ctx.fill();
  if (opts.border) {
    ctx.lineWidth = Math.max(4, w * 0.012);
    ctx.strokeStyle = opts.border;
    roundRect(ctx, ctx.lineWidth / 2, ctx.lineWidth / 2, w - ctx.lineWidth, h - ctx.lineWidth, rad);
    ctx.stroke();
  }
  const bottom = opts.stripes ? h * 0.12 : 0;
  const aw = w * (1 - pad * 2), ah = (h - bottom) * (1 - pad * 2);
  const s = Math.min(aw / img.width, ah / img.height);
  const dw = img.width * s, dh = img.height * s;
  ctx.drawImage(img, (w - dw) / 2, (h - bottom - dh) / 2, dw, dh);
  if (opts.stripes) {
    const bars = ['#e41f26', '#f5d10d', '#0b9185', '#1455b8', '#c3199b', '#f5d10d', '#111'];
    const n = 40, bw = w / (n * 2);
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = bars[(i * 3) % bars.length];
      ctx.fillRect(i * bw * 2 + bw / 2, h - bottom * 0.85, bw, bottom * 0.6);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Sprite doux pour particules.
export function makeSoftSprite(): THREE.CanvasTexture {
  const [c, ctx] = canvas(64, 64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

// Ombre de contact floue (sous les personnages).
export function makeBlobShadow(): THREE.CanvasTexture {
  const [c, ctx] = canvas(128, 128);
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(0,0,0,0.75)');
  g.addColorStop(0.5, 'rgba(0,0,0,0.35)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

// Tissu du drapeau/cape : bleu EPL avec le logo.
export function makeCapeTexture(img: HTMLImageElement): THREE.CanvasTexture {
  const [c, ctx] = canvas(512, 768);
  const g = ctx.createLinearGradient(0, 0, 0, 768);
  g.addColorStop(0, '#1a4fb4');
  g.addColorStop(1, '#0c2f78');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 768);
  // Liseres dores.
  ctx.fillStyle = '#f2c230';
  ctx.fillRect(0, 0, 512, 14);
  ctx.fillRect(18, 0, 8, 768);
  ctx.fillRect(486, 0, 8, 768);
  // Plaque logo.
  ctx.fillStyle = '#f7f5ef';
  roundRect(ctx, 56, 120, 400, 240, 26);
  ctx.fill();
  const s = Math.min(360 / img.width, 200 / img.height);
  ctx.drawImage(img, 256 - (img.width * s) / 2, 240 - (img.height * s) / 2, img.width * s, img.height * s);
  // Bandes code-barres.
  const bars = ['#e41f26', '#f5d10d', '#0b9185', '#6fb4ff', '#c3199b', '#f5d10d'];
  for (let i = 0; i < 22; i++) {
    ctx.fillStyle = bars[i % bars.length];
    ctx.save();
    ctx.translate(70 + i * 17, 470);
    ctx.transform(1, 0, -0.25, 1, 0, 0);
    ctx.fillRect(0, 0, 7, 70 + (i % 3) * 20);
    ctx.restore();
  }
  ctx.fillStyle = '#f7f5ef';
  ctx.font = '58px "Archivo Black", "Arial Black", Impact, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('EPL', 256, 690);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Panneau texte simple (enseignes de batiment, plaques).
export function makeSignTexture(lines: string[], bg: string, fg: string, w = 1024, h = 256, accent?: string): THREE.CanvasTexture {
  const [c, ctx] = canvas(w, h);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  if (accent) {
    ctx.fillStyle = accent;
    ctx.fillRect(0, h - h * 0.1, w, h * 0.1);
  }
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const size = Math.min(h / (lines.length + 0.6), 150);
  ctx.font = `${size}px "Archivo Black", "Arial Black", Impact, sans-serif`;
  lines.forEach((l, i) => ctx.fillText(l, w / 2, h / 2 + (i - (lines.length - 1) / 2) * size * 1.05 - (accent ? h * 0.04 : 0), w * 0.92));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// Tableau noir avec ecritures a la craie.
export function makeChalkboardTexture(variant: number): THREE.CanvasTexture {
  const [c, ctx] = canvas(1024, 512);
  const g = ctx.createLinearGradient(0, 0, 1024, 512);
  g.addColorStop(0, '#1f3a2c');
  g.addColorStop(1, '#16291f');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1024, 512);
  // Traces d'effacage.
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.04})`;
    ctx.fillRect(Math.random() * 1024, Math.random() * 512, 80 + Math.random() * 200, 20 + Math.random() * 60);
  }
  const boards = [
    ['EXAMEN DEMAIN !', 'Chapitre 1 a 12', '∫ f(x) dx = ?'],
    ['PARTIEL DE MATHS', 'Δ = b² - 4ac', 'Salle 12, 8h00'],
    ['TP NOTÉ', 'U = R × I', 'Rendu avant midi'],
    ['SOUTENANCE', 'Groupe 3 : 10h', 'Soyez à l\'heure'],
  ];
  const lines = boards[variant % boards.length];
  ctx.fillStyle = 'rgba(245,245,235,0.92)';
  ctx.textAlign = 'center';
  ctx.font = '84px "Archivo Black", "Arial Black", sans-serif';
  ctx.fillText(lines[0], 512, 130, 960);
  ctx.font = '600 64px "Outfit", sans-serif';
  ctx.fillText(lines[1], 512, 270, 940);
  ctx.fillStyle = 'rgba(255,220,90,0.9)';
  ctx.fillText(lines[2], 512, 390, 940);
  ctx.strokeStyle = 'rgba(245,245,235,0.8)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(200, 170);
  ctx.lineTo(824, 170);
  ctx.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
