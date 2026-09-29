import * as THREE from 'three';
import { Renderer } from '../render/Renderer';
import { createSky, createSkyline, PALETTE, SUN_DIR } from '../render/Sky';
import { makeBlobShadow, makeCapeTexture, makeLogoPlate, makeSoftSprite } from '../render/textures';
import { World } from '../world/World';
import { Campus } from '../world/Campus';
import { Track, PowerUpType } from '../world/Track';
import { zoneAt, Zone } from '../world/World';
import { CORRIDOR_CEIL } from '../world/Zones';
import { Particles } from '../world/Particles';
import { Player } from '../actors/Player';
import { Chaser } from '../actors/Chaser';
import { rimUniform } from '../actors/materials';
import type { Characters } from '../actors/characters';
import { Input, Action } from './Input';
import { Audio } from './Audio';
import { Installer, canFullscreen, enterFullscreen, exitFullscreen, isFullscreen, isStandalone } from './Platform';
import { UI } from '../ui/UI';
import { StoryPlayer, Shot } from '../ui/Story';
import { CHASER, PLAYER, POWERUP_TIME, SPEED, laneX } from '../config';
import { clamp, damp, easeInOutCubic, easeOutCubic, lerp } from './rng';

type State = 'loading' | 'menu' | 'story' | 'intro' | 'playing' | 'paused' | 'countdown' | 'caught' | 'over';

interface Assets {
  logoFull: HTMLImageElement;
  wordmark: HTMLImageElement;
  characters: Characters;
}

const store = {
  get(k: string, d: number): number {
    try {
      const v = localStorage.getItem('eplrun.' + k);
      return v === null ? d : Number(v) || d;
    } catch {
      return d;
    }
  },
  set(k: string, v: number) {
    try {
      localStorage.setItem('eplrun.' + k, String(v));
    } catch {
      /* stockage indisponible */
    }
  },
};

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

export class Game {
  private scene = new THREE.Scene();
  // Plan proche a 30 cm : 3 fois plus de precision de profondeur au loin (plus de z-fighting).
  private camera = new THREE.PerspectiveCamera(60, 1, 0.3, 900);
  private renderer: Renderer;
  private ui = new UI();
  private audio = new Audio();
  private input: Input;
  private story = new StoryPlayer();
  private installer = new Installer();
  private shot: Shot = 'wide';
  private shotTime = 0;
  private lastTime = 0;
  private state: State = 'loading';

  private sky!: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private sun!: THREE.DirectionalLight;
  get sunLight() {
    return this.sun;
  }
  private world!: World;
  private campus!: Campus;
  private track!: Track;
  private particles!: Particles;
  private player!: Player;
  private chaser!: Chaser;

  // Etat de course.
  private lane = 0;
  private x = 0;
  private prevX = 0;
  private laneFromX = 0;
  private laneT = 1;
  private y = 0;
  private vy = 0;
  private grounded = true;
  private slideTimer = 0;
  private slideQueued = false;
  private dist = 0;
  private prevDist = 0;
  private speed = 0;
  private score = 0;
  private coins = 0;
  private timers: Record<PowerUpType, number> = { magnet: 0, sneakers: 0, double: 0 };
  private chaserDist = 3.2;
  private chaserX = 0;
  private warn = 0;
  private stateTime = 0;
  private shake = 0;
  private hitStop = 0;
  private caughtReason = '';
  private tutorialStep = 0;
  private tutorialDone = false;
  private countdownN = 0;
  private lean = 0;
  private best = 0;
  private totalCoins = 0;
  private runTime = 0;
  private diplomas = 0;
  private zone: Zone = 'street';

  // Camera.
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private baseFov = 60;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new Renderer(canvas, this.scene, this.camera);
    this.input = new Input(canvas);
    this.input.on((a) => this.onAction(a));
    this.best = store.get('best', 0);
    this.totalCoins = store.get('coins', 0);
    this.tutorialDone = store.get('tuto', 0) === 1;
    this.ui.setMuted(this.audio.muted);

    // Chaque lancement (geste utilisateur) passe en plein ecran.
    this.ui.on('play', () => {
      void enterFullscreen();
      this.startRun();
    });
    this.ui.on('story-btn', () => {
      void enterFullscreen();
      this.startStory();
    });
    this.setupPlatform();
    // Acces de debogage pour les tests automatises (?debug).
    if (new URLSearchParams(location.search).has('debug')) (window as unknown as { __game: Game }).__game = this;
    this.story.onEnd = () => this.endStory();
    this.story.onStamp = () => {
      this.audio.stamp();
      this.shake = Math.max(this.shake, 0.18);
    };
    this.story.onBeat = (b) => {
      if (b.shot !== this.shot) {
        this.shot = b.shot;
        this.shotTime = 0;
        const p = this.shotPose(b.shot, 0);
        this.camPos.copy(p.pos);
        this.camLook.copy(p.look);
      }
      if (b.wake && this.chaser.anim === 'idle') {
        this.chaser.setDormant(false);
        this.chaser.play('roar');
        this.audio.roar();
        this.shake = 0.3;
      }
      if (b.speaker === 'LE GARDIEN DE L\'EPL') this.chaser.setAngry(1);
      if (b.pose) this.player.play(b.pose);
    };
    this.ui.on('retry', () => {
      void enterFullscreen();
      this.restart(true);
    });
    this.ui.on('menu-btn', () => this.restart(false));
    this.ui.on('pause-btn', () => this.pause());
    this.ui.on('resume', () => this.resume());
    this.ui.on('quit', () => this.restart(false));
    this.ui.on('mute', () => {
      this.audio.unlock();
      this.audio.setMuted(!this.audio.muted);
      this.ui.setMuted(this.audio.muted);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') this.pause();
    });
    window.addEventListener('resize', () => this.resize());
    window.visualViewport?.addEventListener('resize', () => this.resize());
  }

  private setupPlatform() {
    const fsBtn = document.getElementById('fs-btn')!;
    const installBtn = document.getElementById('install-btn')!;
    const iosModal = document.getElementById('ios-install')!;
    const refresh = () => {
      const showFs = canFullscreen() && !isStandalone();
      fsBtn.classList.toggle('hidden', !showFs);
      fsBtn.classList.toggle('on', isFullscreen());
      document.documentElement.style.setProperty('--hud-right', showFs ? '126px' : '72px');
      installBtn.classList.toggle('hidden', this.installer.mode === null);
    };
    this.installer.onChange = refresh;
    document.addEventListener('fullscreenchange', refresh);
    document.addEventListener('webkitfullscreenchange', refresh);
    fsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isFullscreen()) void exitFullscreen();
      else void enterFullscreen();
    });
    installBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.installer.mode === 'prompt') void this.installer.prompt();
      else if (this.installer.mode === 'ios') iosModal.classList.add('active');
    });
    this.ui.on('ios-close', () => iosModal.classList.remove('active'));
    refresh();
  }

  async load(assets: Assets) {
    const steps: [number, () => void][] = [
      [0.1, () => this.setupLights()],
      [0.3, () => (this.world = new World(this.renderer.renderer.capabilities.getMaxAnisotropy(), assets))],
      [0.45, () => (this.campus = new Campus(assets.logoFull, assets.wordmark))],
      [0.65, () => (this.track = new Track())],
      [0.8, () => this.setupActors(assets)],
      [0.9, () => this.setupEnv()],
    ];
    for (const [p, fn] of steps) {
      fn();
      this.ui.progress(p);
      await nextFrame();
    }
    this.scene.add(this.world.group, this.campus.group, this.track.group, this.particles.group);
    this.bindTrackEvents();
    this.resize();
    this.resetRun();
    // Precompilation des shaders pour eviter les saccades au premier affichage.
    this.renderer.renderer.compile(this.scene, this.camera);
    this.ui.progress(1);
    await nextFrame();
    this.enterMenu();
    this.lastTime = performance.now();
    this.renderer.renderer.setAnimationLoop(() => this.frame());
  }

  private setupLights() {
    this.scene.fog = new THREE.FogExp2(PALETTE.fog, 0.0078);
    this.sky = createSky(true);
    this.scene.add(this.sky);
    this.scene.add(createSkyline());

    const hemi = new THREE.HemisphereLight('#a9b6ff', '#c7825a', 1.05);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight('#ffcf9a', 3.4);
    sun.castShadow = true;
    const size = this.renderer.shadowMapSize;
    sun.shadow.mapSize.set(size, size);
    const cam = sun.shadow.camera;
    cam.near = 1;
    cam.far = 220;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.035;
    sun.shadow.radius = 3;
    sun.target.position.set(0, 0, -20);
    sun.position.copy(sun.target.position).addScaledVector(SUN_DIR, 110);
    this.scene.add(sun, sun.target);
    // Cadrage serre de la carte d'ombres sur la zone utile (route et facades
    // proches) : texels 2 fois plus fins, bords d'ombre qui ne fourmillent plus.
    sun.updateMatrixWorld();
    sun.target.updateMatrixWorld();
    cam.position.copy(sun.position);
    cam.lookAt(sun.target.position);
    cam.updateMatrixWorld();
    const inv = cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    const box = new THREE.Box3();
    for (const x of [-18, 18]) for (const y of [0, 18]) for (const z of [-60, 14]) box.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(inv));
    cam.left = box.min.x;
    cam.right = box.max.x;
    cam.bottom = box.min.y;
    cam.top = box.max.y;
    cam.updateProjectionMatrix();
    this.sun = sun;
  }

  private setupEnv() {
    // Carte d'environnement generee depuis le ciel (reflets PBR coherents).
    const pmrem = new THREE.PMREMGenerator(this.renderer.renderer);
    const envScene = new THREE.Scene();
    const envSky = createSky(false);
    envSky.material.uniforms.uClouds.value = 0;
    envScene.add(envSky);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(400, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#7a4a38' }));
    ground.position.y = -5;
    envScene.add(ground);
    const rt = pmrem.fromScene(envScene, 0.02);
    this.scene.environment = rt.texture;
    this.scene.environmentIntensity = 0.75;
    pmrem.dispose();
  }

  private setupActors(a: Assets) {
    const blob = makeBlobShadow();
    const ch = a.characters;
    this.player = new Player(ch.student, ch.playerClips, blob);
    this.scene.add(this.player.root, this.player.shadowMesh);
    const plate = makeLogoPlate(a.wordmark, 1024, 530, { bg: '#fbfaf6', pad: 0.07, stripes: true });
    const cape = makeCapeTexture(a.wordmark);
    this.chaser = new Chaser(ch.guardian, ch.chaserClips, plate, cape, blob);
    this.scene.add(this.chaser.root);
    this.particles = new Particles(makeSoftSprite());

    this.player.onFootstep = () => {
      if (this.state === 'playing' || this.state === 'intro') this.particles.footDust(this.x, this.y, 0.1, 2);
    };
    this.chaser.onStomp = () => {
      const vol = clamp(1 - (this.chaserDist - 3) / 10, 0, 1);
      if (this.state !== 'menu') {
        this.audio.stomp(vol);
        this.particles.footDust(this.chaserX, 0, this.chaserDist, 3);
        this.shake = Math.max(this.shake, 0.06 * vol);
      }
    };
  }

  private bindTrackEvents() {
    this.track.onCoin = (x, y, z) => {
      this.coins++;
      this.score += 5 * this.multiplier();
      this.audio.coin();
      this.particles.sparkle(x, y, z, [1, 0.78, 0.2], 7);
    };
    this.track.onPowerUp = (t, x, y, z) => {
      if (t === 'diploma') {
        const pts = 250 * this.multiplier();
        this.score += pts;
        this.diplomas++;
        this.audio.powerUp();
        this.particles.sparkle(x, y, z, [1, 0.8, 0.3], 40);
        this.ui.toast(`DIPLÔME ! +${pts}`);
        this.ui.flashWhite(0.3);
        return;
      }
      this.timers[t] = POWERUP_TIME[t];
      this.audio.powerUp();
      const colors: Record<PowerUpType, number[]> = { magnet: [1, 0.2, 0.35], sneakers: [0.1, 0.9, 0.8], double: [0.7, 0.4, 1] };
      this.particles.sparkle(x, y, z, colors[t], 30);
      this.ui.toast({ magnet: 'AIMANT !', sneakers: 'SUPER BASKETS !', double: 'BONNE NOTE x2 !' }[t]);
      this.ui.flashWhite(0.25);
      if (t === 'sneakers') this.player.setSuperSneakers(true);
    };
  }

  // ---------- Etats ----------

  private resetRun() {
    this.lane = 0;
    this.x = this.prevX = this.laneFromX = 0;
    this.laneT = 1;
    this.y = 0;
    this.vy = 0;
    this.grounded = true;
    this.slideTimer = 0;
    this.slideQueued = false;
    // Parametre de debogage ?d=metres pour demarrer plus loin.
    this.dist = this.prevDist = Number(new URLSearchParams(location.search).get('d')) || 0;
    this.speed = 0;
    this.score = 0;
    this.coins = 0;
    this.timers = { magnet: 0, sneakers: 0, double: 0 };
    this.chaserDist = 4.4;
    this.chaserX = 0.6;
    this.warn = 0;
    this.shake = 0;
    this.runTime = 0;
    this.diplomas = 0;
    this.zone = 'street';
    this.tutorialStep = 0;
    this.world.reset(this.dist);
    this.campus.reset();
    this.track.reset(this.dist);
    this.campus.group.position.z = this.dist;
    this.player.play('idle');
    this.player.setSuperSneakers(false);
    this.player.root.position.set(0, 0, 0);
    this.player.root.rotation.set(0, 0, 0);
    this.chaser.play('idle');
    this.chaser.setAngry(0);
    this.chaser.root.position.set(this.chaserX, 0, this.chaserDist);
    this.chaser.root.rotation.set(0, 0, 0);
    this.ui.resetHud();
    this.ui.hud(0, 0, 1, false);
  }

  private enterMenu() {
    this.state = 'menu';
    this.stateTime = 0;
    this.ui.setMenuStats(this.best, this.totalCoins);
    this.ui.show('menu');
    document.getElementById('mute')!.classList.remove('hidden');
    const p = this.menuCamera(0);
    this.camPos.copy(p.pos);
    this.camLook.copy(p.look);
  }

  private startStory() {
    if (this.state !== 'menu') return;
    this.audio.unlock();
    this.audio.startMusic();
    this.audio.duckMusic(true);
    this.state = 'story';
    this.stateTime = 0;
    this.shot = 'wide';
    this.shotTime = 0;
    const p = this.shotPose('wide', 0);
    this.camPos.copy(p.pos);
    this.camLook.copy(p.look);
    this.chaser.setDormant(true);
    this.ui.show('story');
    this.story.start();
  }

  private endStory() {
    store.set('story', 1);
    this.chaser.setAngry(0);
    this.chaser.setDormant(false);
    this.chaser.play('idle');
    this.player.play('idle');
    this.state = 'menu';
    this.beginRun();
  }

  private startRun() {
    if (this.state !== 'menu') return;
    if (store.get('story', 0) !== 1) {
      this.startStory();
      return;
    }
    this.beginRun();
  }

  private beginRun() {
    this.audio.unlock();
    this.audio.startMusic();
    this.audio.duckMusic(false);
    this.state = 'intro';
    this.stateTime = 0;
    this.ui.show('hud');
    this.chaser.play('roar');
    this.audio.roar();
    this.shake = 0.35;
    this.ui.toast('COURS !', true, 1300);
  }

  private restart(play: boolean) {
    this.resetRun();
    this.enterMenu();
    if (play) this.startRun();
  }

  private pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.ui.show('hud', 'pause');
    this.audio.duckMusic(true);
  }

  private resume() {
    if (this.state !== 'paused') return;
    this.state = 'countdown';
    this.countdownN = 3;
    this.stateTime = 0;
    this.ui.show('hud', 'countdown');
    this.ui.countdown(3);
  }

  private onAction(a: Action) {
    if (a === 'pause') {
      if (this.state === 'playing') this.pause();
      else if (this.state === 'paused') this.resume();
      return;
    }
    if (this.state === 'menu') {
      if (a === 'up') this.startRun();
      return;
    }
    if (this.state !== 'playing' && !(this.state === 'intro' && this.stateTime > 0.7)) return;
    if (a === 'left' || a === 'right') {
      const dir = a === 'left' ? -1 : 1;
      const next = this.lane + dir;
      if (next < -1 || next > 1) {
        // Heurte le bord : petite secousse.
        this.shake = Math.max(this.shake, 0.08);
        return;
      }
      this.lane = next;
      this.laneFromX = this.x;
      this.laneT = 0;
      this.audio.swish();
      if (this.tutorialStep === 1) this.advanceTutorial();
    } else if (a === 'up') {
      if (this.grounded) {
        const sup = this.timers.sneakers > 0;
        this.vy = sup ? PLAYER.superJumpVelocity : PLAYER.jumpVelocity;
        this.grounded = false;
        this.slideTimer = 0;
        this.player.play('jump');
        if (sup) {
          this.player.startFlip();
          this.audio.superJump();
        } else this.audio.jump();
        if (this.tutorialStep === 2) this.advanceTutorial();
      }
    } else if (a === 'down') {
      if (!this.grounded) {
        this.vy = Math.min(this.vy, -32);
        this.slideQueued = true;
      } else {
        this.slideTimer = PLAYER.slideTime;
        this.player.play('slide');
        this.audio.slide();
      }
      if (this.tutorialStep === 3) this.advanceTutorial();
    }
  }

  private advanceTutorial() {
    this.tutorialStep++;
    const seq = [null, 'lanes', 'jump', 'slide'] as const;
    if (this.tutorialStep >= 4) {
      this.tutorialDone = true;
      store.set('tuto', 1);
      this.ui.tutorial(null);
      this.ui.toast('BIEN JOUE !', false, 900);
      return;
    }
    this.ui.tutorial(seq[this.tutorialStep]);
  }

  private multiplier(): number {
    const base = Math.min(1 + Math.floor(this.dist / 350), 15);
    return base * (this.timers.double > 0 ? 2 : 1);
  }

  // ---------- Boucle ----------

  private frame() {
    const now = performance.now();
    let dt = Math.min((now - this.lastTime) / 1000, 1 / 20);
    this.lastTime = now;
    const realDt = dt;
    if (this.hitStop > 0) {
      this.hitStop -= dt;
      dt *= 0.15;
    }
    this.stateTime += dt;
    this.sky.material.uniforms.uTime.value += dt;

    switch (this.state) {
      case 'menu':
        this.updateMenu(dt);
        break;
      case 'story':
        this.updateMenu(dt);
        this.story.update(dt);
        this.shotTime += dt;
        break;
      case 'intro':
        this.updateIntro(dt);
        break;
      case 'playing':
        this.updatePlaying(dt);
        break;
      case 'caught':
        this.updateCaught(dt);
        break;
      case 'over':
        this.updateOver(dt);
        break;
      case 'countdown':
        this.updateCountdown(realDt);
        break;
      case 'paused':
        break;
    }
    if (this.state !== 'paused' && this.state !== 'countdown') this.particles.update(dt, this.state === 'playing' || this.state === 'intro' || this.state === 'caught' ? this.speed * dt : 0);
    this.updateCamera(realDt);
    const cam = this.camera;
    this.particles.setViewportHeight(this.canvas.height / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2))) / 0.9);
    this.renderer.render(realDt);
  }

  private updateMenu(dt: number) {
    this.player.update(dt, 0, 0, 0, 0, 0);
    this.chaser.update(dt, 0);
    this.campus.update(dt, 0);
  }

  private updateIntro(dt: number) {
    const t = this.stateTime;
    if (t > 0.35) {
      this.player.play('run');
      this.speed = lerp(0, SPEED.start, easeOutCubic(clamp((t - 0.35) / 1.4, 0, 1)));
    }
    if (t > 1.05) this.chaser.play('run');
    this.simulate(dt);
    if (t > 1.9) {
      this.state = 'playing';
      this.stateTime = 0;
      if (!this.tutorialDone) this.advanceTutorial();
    }
  }

  private updatePlaying(dt: number) {
    this.runTime += dt;
    this.speed = SPEED.start + (SPEED.max - SPEED.start) * (1 - Math.exp(-this.dist / SPEED.rampDistance));
    this.simulate(dt);
    this.score += this.speed * dt * 0.5 * this.multiplier();
    for (const k of Object.keys(this.timers) as PowerUpType[]) {
      if (this.timers[k] > 0) {
        this.timers[k] -= dt;
        if (this.timers[k] <= 0) {
          this.timers[k] = 0;
          if (k === 'sneakers') this.player.setSuperSneakers(false);
        }
      }
    }
    const timers: Partial<Record<PowerUpType, { left: number; total: number }>> = {};
    for (const k of Object.keys(this.timers) as PowerUpType[]) timers[k] = { left: this.timers[k], total: POWERUP_TIME[k] };
    this.ui.powerUps(timers);
    this.ui.hud(this.score, this.coins, this.multiplier(), this.timers.double > 0);
    // Tutoriel de secours si le joueur ne fait rien.
    if (this.tutorialStep > 0 && this.tutorialStep < 4 && this.stateTime > 14) {
      this.tutorialDone = true;
      store.set('tuto', 1);
      this.ui.tutorial(null);
      this.tutorialStep = 4;
    }
  }

  // Physique et logique communes (intro + jeu).
  private simulate(dt: number) {
    this.prevDist = this.dist;
    this.prevX = this.x;
    const dz = this.speed * dt;
    this.dist += dz;

    // Changement de voie avec easing.
    if (this.laneT < 1) {
      this.laneT = Math.min(1, this.laneT + dt / PLAYER.laneChangeTime);
    }
    const tx = laneX(this.lane);
    this.x = lerp(this.laneFromX, tx, easeOutCubic(this.laneT));
    this.lean = damp(this.lean, (tx - this.x) * -0.5, 12, dt);

    // Vertical.
    const ground = this.track.groundAt(this.x, this.dist, this.y);
    if (!this.grounded || this.y > ground + 0.02) {
      this.grounded = false;
      this.vy -= PLAYER.gravity * dt * (this.vy < 0 ? 1.15 : 1);
      this.y += this.vy * dt;
      if (this.y <= ground && this.vy <= 0) {
        const impact = -this.vy;
        this.y = ground;
        this.vy = 0;
        this.grounded = true;
        if (impact > 8) {
          this.audio.land();
          this.particles.footDust(this.x, this.y, 0.1, 6);
          this.shake = Math.max(this.shake, Math.min(0.12, impact * 0.004));
        }
        if (this.slideQueued) {
          this.slideQueued = false;
          this.slideTimer = PLAYER.slideTime;
          this.player.play('slide');
          this.audio.slide();
        } else if (this.player.anim === 'jump') this.player.play('run');
      } else if (this.player.anim === 'run' && this.vy < -4) {
        this.player.play('jump');
      }
    } else {
      this.y = ground;
      this.vy = 0;
      this.grounded = true;
    }

    // Plafond des couloirs.
    const zone = zoneAt(this.dist);
    if (zone === 'corridor') {
      const hNow = this.slideTimer > 0 ? PLAYER.slideHeight : PLAYER.height;
      const maxY = CORRIDOR_CEIL - 0.15 - hNow;
      if (this.y > maxY) {
        this.y = maxY;
        this.vy = Math.min(this.vy, 0);
      }
    }
    if (zone !== this.zone) {
      this.zone = zone;
      if (this.state === 'playing') this.ui.zone(zone);
    }

    if (this.slideTimer > 0) {
      this.slideTimer -= dt;
      if (this.slideTimer <= 0 && this.player.anim === 'slide') this.player.play('run');
    }
    if (this.player.anim === 'stumble' && this.player.animTime > 0.55) this.player.play('run');

    // Collisions.
    const height = this.slideTimer > 0 ? PLAYER.slideHeight : PLAYER.height;
    const hit = this.track.collide({ x: this.x, prevX: this.prevX, y: this.y, height, dist: this.dist, prevDist: this.prevDist });
    if (hit.kind === 'crash') {
      this.onCrash(hit.type);
      return;
    }
    if (hit.kind === 'stumble') this.onStumble(hit.fromX);

    this.track.update(dt, this.dist, this.speed);
    this.track.updateCoins(dt, this.dist, this.x, this.y, this.timers.magnet > 0);
    this.track.checkPowerUps(this.dist, this.x, this.y);
    this.world.update(this.dist);
    this.campus.update(dt, dz);

    // Gardien.
    if (this.warn > 0) this.warn -= dt;
    const introHold = this.state === 'intro' ? (this.stateTime < 1.05 ? 4.4 : CHASER.farDistance) : null;
    const target = introHold ?? (this.warn > 0 ? CHASER.nearDistance : CHASER.farDistance);
    const rate = this.warn > 0 ? 3 : this.state === 'intro' ? 2.5 : 0.45;
    this.chaserDist = damp(this.chaserDist, target, rate, dt);
    if (this.state === 'intro' && this.stateTime < 1.05) this.chaserDist = 4.4;
    this.chaserX = damp(this.chaserX, this.x + (this.x <= 0 ? 1.4 : -1.4), 3, dt);
    this.chaser.setAngry(this.warn > 0 ? 1 : 0);
    this.audio.setIntensity(this.warn > 0 ? 1 : 0);
    this.ui.setDanger(this.warn > 0);

    // Affichage acteurs.
    this.player.root.position.set(this.x, this.y, 0);
    this.player.update(dt, this.speed, this.y, ground, this.vy, this.lean);
    this.chaser.root.position.set(this.chaserX, 0, this.chaserDist);
    // Masque quand il traverserait la camera.
    this.chaser.root.visible = this.chaserDist < 4.7;
    this.chaser.update(dt, this.speed);

    if (this.timers.sneakers > 0 && this.grounded) this.particles.trail(this.x, this.y + 0.08, 0.2, [0.1, 0.9, 0.8]);
    if (this.timers.magnet > 0 && Math.random() < 0.4) this.particles.trail(this.x + (Math.random() - 0.5), this.y + 1 + Math.random(), 0, [1, 0.25, 0.35]);
  }

  private onStumble(fromX: number) {
    // Retour sur la voie de depart.
    this.lane = clamp(Math.round(fromX / laneX(1)), -1, 1);
    this.laneFromX = this.x;
    this.laneT = 0;
    this.shake = 0.3;
    this.renderer.hit(1);
    this.audio.stumble();
    this.particles.impact(this.x, this.y, 0, 12);
    if (this.warn > 0) {
      this.caught('Deux faux pas, le Gardien t\'a rattrapé.');
      return;
    }
    this.warn = CHASER.warnTime;
    this.player.play('stumble');
    this.audio.whistle();
    this.ui.toast('ATTENTION !', true);
  }

  private onCrash(type: string) {
    const reasons: Record<string, string> = {
      barrier: 'Tu as percuté une barrière de chantier.',
      bench: 'Tu as trébuché sur une table-banc.',
      gate: 'La banderole des examens t\'a arrêté net.',
      kiosk: 'Tu as foncé dans un kiosque.',
      bus: 'Tu as embrassé l\'arrière d\'un minibus.',
      ramp: 'Mauvaise prise sur la rampe.',
      moto: 'Le zemidjan ne t\'a pas vu venir.',
    };
    this.audio.crash();
    this.renderer.hit(2.2);
    this.shake = 0.6;
    this.hitStop = 0.18;
    this.ui.flashWhite(0.5);
    this.particles.impact(this.x, this.y + 0.5, -0.5, 30, true);
    this.caught(reasons[type] ?? 'Le Gardien t\'a ramené en amphi.');
  }

  private caught(reason: string) {
    this.caughtReason = reason;
    this.chaserDist = Math.min(this.chaserDist, 5.5);
    this.state = 'caught';
    this.stateTime = 0;
    this.player.play('fall');
    this.chaser.play('grab');
    this.ui.setDanger(false);
    this.ui.tutorial(null);
    this.audio.duckMusic(true);
    this.audio.setIntensity(0);
  }

  private updateCaught(dt: number) {
    const t = this.stateTime;
    // Decelation rapide.
    this.speed = damp(this.speed, 0, 5, dt);
    const dz = this.speed * dt;
    this.dist += dz;
    this.track.update(dt, this.dist, 0);
    this.track.updateCoins(dt, this.dist, this.x, this.y, false);
    this.world.update(this.dist);
    this.campus.update(dt, dz);
    // Retombe au sol si en l'air.
    const ground = this.track.groundAt(this.x, this.dist, this.y);
    if (this.y > ground) {
      this.vy -= PLAYER.gravity * dt;
      this.y = Math.max(ground, this.y + this.vy * dt);
    }
    this.player.root.position.set(this.x, this.y, 0);
    this.player.update(dt, 0, this.y, ground, this.vy, 0);
    // Le gardien arrive et saisit le fuyard.
    this.chaserDist = damp(this.chaserDist, 1.5, 3.2, dt);
    this.chaserX = damp(this.chaserX, this.x, 4, dt);
    this.chaser.root.visible = true;
    this.chaser.root.position.set(this.chaserX, 0, this.chaserDist);
    if (t > 1.1 && this.chaser.anim !== 'victory') {
      this.chaser.play('victory');
      this.audio.roar();
      this.shake = 0.25;
    }
    this.chaser.update(dt, this.speed);
    if (t > 2.1) this.finish();
  }

  private finish() {
    this.state = 'over';
    this.stateTime = 0;
    const record = this.score > this.best;
    if (record) {
      this.best = Math.floor(this.score);
      store.set('best', this.best);
    }
    this.totalCoins += this.coins;
    store.set('coins', this.totalCoins);
    this.ui.gameOver(this.score, this.dist, this.coins, this.best, record, this.caughtReason);
    this.ui.show('gameover');
  }

  private updateOver(dt: number) {
    this.player.update(dt, 0, this.y, this.y, 0, 0);
    this.chaser.update(dt, 0);
    this.campus.update(dt, 0);
  }

  private updateCountdown(dt: number) {
    this.stateTime += dt;
    if (this.stateTime >= 0.8) {
      this.stateTime = 0;
      this.countdownN--;
      if (this.countdownN <= 0) {
        this.state = 'playing';
        this.ui.show('hud');
        this.audio.duckMusic(false);
        this.lastTime = performance.now();
        return;
      }
      this.ui.countdown(this.countdownN);
    }
  }

  // ---------- Camera ----------

  private menuCamera(t: number) {
    const portrait = this.camera.aspect < 0.8;
    const ang = Math.PI - 0.42 + Math.sin(t * 0.25) * 0.08;
    const r = portrait ? 5.3 : 4.8;
    const h = 1.55 + Math.sin(t * 0.4) * 0.08;
    const pos = new THREE.Vector3(Math.sin(ang) * r, h, Math.cos(ang) * r);
    const look = new THREE.Vector3(portrait ? 0.3 : -0.5, portrait ? 1.2 : 1.5, 2.2);
    return { pos, look };
  }

  // Plans de la cinematique (joueur a l'origine face a -z, Gardien derriere).
  private shotPose(shot: Shot, t: number) {
    const d = Math.min(t, 8);
    const portrait = this.camera.aspect < 0.8;
    const k = portrait ? 1.35 : 1;
    const cx = this.chaserX, cz = this.chaserDist;
    switch (shot) {
      case 'wide':
        return { pos: new THREE.Vector3(-7 + d * 0.5, 4.5 - d * 0.15, -15 * k + d * 1.0), look: new THREE.Vector3(0, 5.5, 14) };
      case 'doc':
        return { pos: new THREE.Vector3(-1.2 + d * 0.08, 1.7, -3.3 * k + d * 0.1), look: new THREE.Vector3(0.9, 2.1, 1) };
      case 'hero':
        return { pos: new THREE.Vector3(0.45, 1.7, -1.8 * k + d * 0.08), look: new THREE.Vector3(0, 1.55, 0) };
      case 'chaser':
        return { pos: new THREE.Vector3(cx - 0.2, 2.1, cz - 2.4 * k + d * 0.1), look: new THREE.Vector3(cx, 2.15, cz) };
      case 'chaserLow':
        return { pos: new THREE.Vector3(cx + 0.9, 0.45, cz - 2.2 * k), look: new THREE.Vector3(cx, 2.2, cz) };
      default:
        return this.menuCamera(t);
    }
  }

  private playCamera() {
    const portrait = this.camera.aspect < 0.8;
    const pos = new THREE.Vector3(this.x * 0.78, (portrait ? 3.9 : 3.5) + this.y * 0.65, portrait ? 6.6 : 6.2);
    const look = new THREE.Vector3(this.x * 0.9, 1.1 + this.y * 0.55, -7);
    return { pos, look };
  }

  private updateCamera(dt: number) {
    const s = this.state;
    let pos: THREE.Vector3, look: THREE.Vector3;
    let fovBoost = 0;
    if (s === 'story') {
      ({ pos, look } = this.shotPose(this.shot, this.shotTime));
      this.camPos.lerp(pos, 1 - Math.exp(-dt * 4));
      this.camLook.lerp(look, 1 - Math.exp(-dt * 4));
    } else if (s === 'menu') {
      ({ pos, look } = this.menuCamera(this.stateTime));
      this.camPos.lerp(pos, 1 - Math.exp(-dt * 3));
      this.camLook.lerp(look, 1 - Math.exp(-dt * 3));
    } else if (s === 'intro') {
      const m = this.menuCamera(0);
      const p = this.playCamera();
      const k = easeInOutCubic(clamp((this.stateTime - 0.3) / 1.5, 0, 1));
      // Orbite autour du joueur pour passer de face a dos.
      const a0 = Math.atan2(m.pos.x, m.pos.z), a1 = Math.atan2(p.pos.x - this.x, p.pos.z);
      const r0 = Math.hypot(m.pos.x, m.pos.z), r1 = Math.hypot(p.pos.x - this.x, p.pos.z);
      const ang = lerp(a0, a1, k);
      const r = lerp(r0, r1, k) - Math.sin(k * Math.PI) * 2.2;
      pos = new THREE.Vector3(this.x + Math.sin(ang) * r, lerp(m.pos.y, p.pos.y, k), Math.cos(ang) * r);
      look = m.look.clone().lerp(p.look, k);
      this.camPos.copy(pos);
      this.camLook.copy(look);
    } else if (s === 'caught' || s === 'over') {
      const t = s === 'caught' ? this.stateTime : 2.1 + this.stateTime;
      const ang = lerp(0, Math.PI * 0.62, easeInOutCubic(clamp(t / 1.8, 0, 1))) + (s === 'over' ? this.stateTime * 0.05 : 0);
      const r = lerp(6.2, 7.8, clamp(t / 1.8, 0, 1));
      const cx = this.x;
      pos = new THREE.Vector3(cx + Math.sin(ang) * r, lerp(3.6, 2.6, clamp(t / 1.8, 0, 1)) + this.y, Math.cos(ang) * r);
      look = new THREE.Vector3(cx, 1.2 + this.y * 0.5, lerp(-7, 1.0, clamp(t / 1.2, 0, 1)));
      this.camPos.lerp(pos, 1 - Math.exp(-dt * 6));
      this.camLook.lerp(look, 1 - Math.exp(-dt * 6));
    } else {
      ({ pos, look } = this.playCamera());
      this.camPos.x = damp(this.camPos.x, pos.x, 7, dt);
      this.camPos.y = damp(this.camPos.y, pos.y, 5, dt);
      this.camPos.z = damp(this.camPos.z, pos.z, 5, dt);
      this.camLook.x = damp(this.camLook.x, look.x, 9, dt);
      this.camLook.y = damp(this.camLook.y, look.y, 6, dt);
      this.camLook.z = damp(this.camLook.z, look.z, 6, dt);
      fovBoost = ((this.speed - SPEED.start) / (SPEED.max - SPEED.start)) * 7 + (this.timers.sneakers > 0 && !this.grounded ? 4 : 0);
    }

    this.shake = Math.max(0, this.shake - dt * 1.4);
    const sh = this.shake * this.shake;
    const t = performance.now() * 0.001;
    this.camera.position.set(
      this.camPos.x + Math.sin(t * 43) * sh * 0.9,
      this.camPos.y + Math.sin(t * 57 + 1) * sh * 0.9,
      this.camPos.z,
    );
    this.camera.lookAt(this.camLook);
    const targetFov = this.baseFov + fovBoost;
    if (Math.abs(this.camera.fov - targetFov) > 0.01) {
      this.camera.fov = damp(this.camera.fov, targetFov, 3, dt);
      this.camera.updateProjectionMatrix();
    }
    // Liseré lumineux plus fort en menu (contre-jour flatteur).
    rimUniform.value.setRGB(1, 0.78, 0.56).multiplyScalar(s === 'menu' || s === 'over' ? 0.4 : 0.6);
  }

  private resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.baseFov = this.camera.aspect < 0.6 ? 72 : this.camera.aspect < 0.8 ? 66 : this.camera.aspect < 1.2 ? 62 : 56;
    this.camera.fov = this.baseFov;
    this.camera.updateProjectionMatrix();
    this.renderer.resize(w, h);
  }
}
