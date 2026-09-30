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
  private minDpr: number;
  private slowTime = 0;
  private fastTime = 0;
  private dpr: number;
  private frameTimes: number[] = [];
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
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = renderer;

    const deviceDpr = Math.min(window.devicePixelRatio || 1, 3);
    // Priorite a la finesse de l'image, quitte a couter un peu de performances.
    this.maxDpr = Math.min(deviceDpr, this.tier === 'low' ? 1.8 : 2);
    // Plancher bas : si l'appareil peine, la fluidite passe avant la finesse.
    this.minDpr = Math.min(this.maxDpr, 1.0);
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
      intensity: 0.85,
      luminanceThreshold: 0.92,
      luminanceSmoothing: 0.3,
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

    // SMAA a tous les niveaux : sans lui, les aretes fines scintillent en mouvement.
    const smaa = new SMAAEffect({ preset: this.tier === 'high' ? SMAAPreset.HIGH : this.tier === 'medium' ? SMAAPreset.MEDIUM : SMAAPreset.LOW });
    this.composer.addPass(new EffectPass(camera, this.bloom, this.chroma, tone, sat, bc, vignette));
    this.composer.addPass(new EffectPass(camera, smaa));
  }

  get shadowMapSize(): number {
    return this.tier === 'high' ? 4096 : 2048;
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

  // Resolution dynamique avec hysteresis : on ne baisse qu'apres 2 s de
  // frames lentes, on ne remonte qu'apres 6 s de marge, par petits pas, pour
  // eviter l'effet de pompage de la nettete.
  private adapt(dt: number) {
    this.frameTimes.push(dt);
    if (this.frameTimes.length > 60) this.frameTimes.shift();
    if (this.frameTimes.length < 60) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.slowTime = avg > 0.024 ? this.slowTime + dt : 0;
    this.fastTime = avg < 0.0145 ? this.fastTime + dt : 0;
    let next = this.dpr;
    if (this.slowTime > 2) next = Math.max(this.minDpr, this.dpr - 0.15);
    else if (this.fastTime > 6) next = Math.min(this.maxDpr, this.dpr + 0.1);
    if (Math.abs(next - this.dpr) > 0.01) {
      this.dpr = next;
      this.slowTime = this.fastTime = 0;
      this.frameTimes.length = 0;
      const size = this.renderer.getSize(new THREE.Vector2());
      this.resize(size.x, size.y);
    }
  }

  get pixelRatio() {
    return this.dpr;
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
