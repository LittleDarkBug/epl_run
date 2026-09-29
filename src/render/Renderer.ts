import * as THREE from 'three';
import {
  BloomEffect,
  ChromaticAberrationEffect,
  EffectComposer,
  EffectPass,
  HueSaturationEffect,
  BrightnessContrastEffect,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';

export type QualityTier = 'low' | 'medium' | 'high';

// Rendu : WebGL2, HDR demi-flottant, bloom, anti-aliasing et etalonnage.
// La resolution s'adapte en continu pour tenir 60 i/s sur mobile.

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly composer: EffectComposer;
  readonly tier: QualityTier;
  private renderPass: RenderPass;
  private bloom: BloomEffect;
  private chroma: ChromaticAberrationEffect;
  private maxDpr: number;
  private dpr: number;
  private frameTimes: number[] = [];
  private lastAdjust = 0;
  private chromaAmount = 0;

  constructor(canvas: HTMLCanvasElement, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.tier = detectTier();
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      stencil: false,
      depth: true,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = this.tier === 'low' ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
    this.renderer = renderer;

    const deviceDpr = Math.min(window.devicePixelRatio || 1, 3);
    this.maxDpr = this.tier === 'high' ? Math.min(deviceDpr, 2) : this.tier === 'medium' ? Math.min(deviceDpr, 1.6) : Math.min(deviceDpr, 1.2);
    this.dpr = this.maxDpr;
    renderer.setPixelRatio(this.dpr);

    this.composer = new EffectComposer(renderer, {
      frameBufferType: THREE.HalfFloatType,
      multisampling: this.tier === 'high' && deviceDpr < 2 ? 4 : 0,
    });
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    this.bloom = new BloomEffect({
      mipmapBlur: true,
      intensity: 1.05,
      luminanceThreshold: 0.82,
      luminanceSmoothing: 0.22,
      radius: 0.78,
      levels: this.tier === 'low' ? 5 : 7,
    });
    this.chroma = new ChromaticAberrationEffect({
      offset: new THREE.Vector2(0, 0),
      radialModulation: true,
      modulationOffset: 0.25,
    });
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    const vignette = new VignetteEffect({ offset: 0.32, darkness: 0.52 });
    const sat = new HueSaturationEffect({ saturation: 0.08 });
    const bc = new BrightnessContrastEffect({ brightness: 0.0, contrast: 0.06 });

    const effects = [this.bloom, tone, sat, bc, vignette];
    if (this.tier !== 'low') {
      const smaa = new SMAAEffect({ preset: this.tier === 'high' ? SMAAPreset.HIGH : SMAAPreset.MEDIUM });
      this.composer.addPass(new EffectPass(camera, this.bloom, this.chroma, tone, sat, bc, vignette));
      this.composer.addPass(new EffectPass(camera, smaa));
    } else {
      this.composer.addPass(new EffectPass(camera, ...effects));
    }
  }

  get shadowMapSize(): number {
    return this.tier === 'high' ? 2048 : this.tier === 'medium' ? 1536 : 1024;
  }

  setCamera(camera: THREE.PerspectiveCamera) {
    this.renderPass.mainCamera = camera;
  }

  resize(w: number, h: number) {
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h, false);
  }

  hit(strength = 1) {
    this.chromaAmount = Math.max(this.chromaAmount, 0.006 * strength);
  }

  render(dt: number) {
    this.chromaAmount *= Math.exp(-dt * 5);
    this.chroma.offset.set(this.chromaAmount, this.chromaAmount * 0.6);
    this.composer.render(dt);
    this.adapt(dt);
  }

  // Resolution dynamique : baisse si la frame depasse ~19 ms, remonte si < 13 ms.
  private adapt(dt: number) {
    this.frameTimes.push(dt);
    if (this.frameTimes.length > 45) this.frameTimes.shift();
    const now = performance.now();
    if (now - this.lastAdjust < 1500 || this.frameTimes.length < 45) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    let next = this.dpr;
    if (avg > 0.0195) next = Math.max(0.6, this.dpr * 0.85);
    else if (avg < 0.0135) next = Math.min(this.maxDpr, this.dpr * 1.08);
    if (Math.abs(next - this.dpr) > 0.02) {
      this.dpr = next;
      const size = this.renderer.getSize(new THREE.Vector2());
      this.resize(size.x, size.y);
      this.lastAdjust = now;
      this.frameTimes.length = 0;
    }
  }
}

function detectTier(): QualityTier {
  const q = new URLSearchParams(location.search).get('q');
  if (q === 'low' || q === 'medium' || q === 'high') return q;
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && window.innerWidth < 1100);
  const cores = navigator.hardwareConcurrency || 4;
  if (!mobile && cores >= 6) return 'high';
  if (mobile && cores < 6) return 'low';
  return 'medium';
}
