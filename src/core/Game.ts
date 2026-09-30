import * as THREE from 'three';
import { Renderer } from '../render/Renderer';
import { createSky, createSkyline, PALETTE, SUN_DIR } from '../render/Sky';
import { makeBlobShadow, makeCapeTexture, makeLogoPlate, makeSoftSprite } from '../render/textures';
import { World } from '../world/World';
import { Campus } from '../world/Campus';
import { Track, PowerUpType, DossierPiece } from '../world/Track';
import { CORRIDOR_CEIL } from '../world/Zones';
import { Path, J, Zone } from '../world/Path';

// Distance avant le coin a partir de laquelle un geste lateral fait tourner.
const TURN_WINDOW = 22;
// Le virage s'execute des l'entree dans le carrefour (a TURN_EARLY m du centre) :
// un geste fait dans le carrefour tourne immediatement, un geste un peu
// anticipe est garde en memoire jusqu'a l'entree.
const TURN_EARLY = 4.2;
// Duree de la sequence de capture (danse du Gardien) avant l'ecran de fin.
const CAUGHT_TIME = 4.6;

const Y_AXIS = new THREE.Vector3(0, 1, 0);

function dampAngle(a: number, b: number, k: number, dt: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * (1 - Math.exp(-k * dt));
}
import { Particles } from '../world/Particles';
import { Player } from '../actors/Player';
import { Chaser } from '../actors/Chaser';
import { rimUniform } from '../actors/materials';
import type { Characters } from '../actors/characters';
import type { BakedAsset } from '../world/assets';
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
  campus: BakedAsset;
  trees: THREE.Object3D[];
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
  private skyline!: THREE.Group;
  private lightQ = new THREE.Quaternion();
  private lightInvQ = new THREE.Quaternion();
  private texel = 0.05;
  private tmpV = new THREE.Vector3();
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
  // Dossier administratif : tampon, photocopie legalisee, signature du chef.
  private dossier = new Set<DossierPiece>();
  private shield = false;
  // Chemin sinueux : troncon courant, virage demande, position monde.
  private path = new Path(Math.floor(Math.random() * 1e9));
  private segIdx = 0;
  private turnQueued = 0;
  private laneDur: number = PLAYER.laneChangeTime;
  private pw = new THREE.Vector3();
  private yaw = 0;
  private camYaw = 0;
  private cornerAnnounced = -1;
  private cornersSeen = 0;
  private falling = false;
  private skipCaught = false;
  private zone: Zone = 'street';

  // Camera.
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private baseFov = 60;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new Renderer(canvas, this.scene, this.camera);
    this.input = new Input(canvas);
    this.input.on((a) => this.onAction(a));
    canvas.addEventListener('pointerup', () => {
      if (this.state === 'caught') this.skipCaught = true;
    });
    // Premier geste : l'audio se deverrouille et la musique du menu demarre.
    window.addEventListener('pointerup', () => {
      if (this.state === 'menu' || this.state === 'over') this.audio.startMenuMusic();
    });
    document.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest?.('button')) this.audio.tick();
    }, true);
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
      [0.3, () => (this.world = new World(this.renderer.renderer.capabilities.getMaxAnisotropy(), assets, this.path))],
      [0.45, () => (this.campus = new Campus(assets.campus, assets.trees))],
      [0.65, () => (this.track = new Track(this.path))],
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
    this.skyline = createSkyline();
    this.scene.add(this.skyline);

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
    // Zone carree autour du joueur (le chemin tourne) ; elle le suit en se
    // calant sur la grille de texels pour eviter le scintillement des ombres.
    const box = new THREE.Box3();
    const off = sun.target.position;
    for (const x of [-40, 40]) for (const y of [0, 18]) for (const z of [-40, 40]) box.expandByPoint(new THREE.Vector3(x + off.x, y, z + off.z).applyMatrix4(inv));
    cam.left = box.min.x;
    cam.right = box.max.x;
    cam.bottom = box.min.y;
    cam.top = box.max.y;
    cam.updateProjectionMatrix();
    this.sun = sun;
    this.lightQ.copy(cam.quaternion);
    this.lightInvQ.copy(cam.quaternion).invert();
    this.texel = (cam.right - cam.left) / size;
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
    this.chaser = new Chaser(ch.guardian, ch.android, ch.chaserClips, plate, cape, blob);
    this.scene.add(this.chaser.root);
    this.particles = new Particles(makeSoftSprite());

    this.player.onFootstep = () => {
      if (this.state === 'playing' || this.state === 'intro') {
        this.particles.footDust(this.pw.x, this.y, this.pw.z, 2);
        if (this.grounded) this.audio.footstep(this.zone === 'corridor' ? 'tile' : this.zone === 'court' ? 'dirt' : 'asphalt');
      }
    };
    this.chaser.onStomp = () => {
      const vol = clamp(1 - (this.chaserDist - 3) / 10, 0, 1);
      if (this.state !== 'menu') {
        this.audio.stomp(vol);
        const cp = this.chaser.root.position;
        this.particles.footDust(cp.x, 0, cp.z, 3);
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
      if (t === 'stamp' || t === 'copy' || t === 'signature') {
        this.collectPiece(t, x, y, z);
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

  private static readonly PIECES: DossierPiece[] = ['stamp', 'copy', 'signature'];

  private refreshDossier() {
    this.track.dossierNeed = this.shield ? null : Game.PIECES.find((p) => !this.dossier.has(p)) ?? null;
    this.ui.dossier(this.dossier, this.shield);
  }

  private collectPiece(p: DossierPiece, x: number, y: number, z: number) {
    this.dossier.add(p);
    if (p === 'stamp') this.audio.stamp();
    else if (p === 'copy') this.audio.copy();
    else this.audio.signature();
    this.particles.sparkle(x, y, z, [1, 0.85, 0.4], 30);
    const names: Record<DossierPiece, string> = { stamp: 'TAMPON', copy: 'COPIE LÉGALISÉE', signature: 'SIGNATURE DU CHEF' };
    if (this.dossier.size >= 3) {
      // Dossier complet : protection contre une collision, le Gardien recule.
      this.dossier.clear();
      this.shield = true;
      this.warn = 0;
      const pts = 500 * this.multiplier();
      this.score += pts;
      this.audio.shieldUp();
      this.ui.flashWhite(0.45);
      this.ui.toast(`DOSSIER COMPLET ! +${pts}`, false, 1600);
    } else {
      this.ui.toast(`${names[p]} (${this.dossier.size}/3)`);
    }
    this.refreshDossier();
  }

  // Le dossier complet absorbe une collision. Retourne vrai s'il a servi.
  private useShield(): boolean {
    if (!this.shield) return false;
    this.shield = false;
    this.warn = 0;
    this.shake = 0.35;
    this.hitStop = 0.1;
    this.renderer.hit(1.2);
    this.audio.shieldBreak();
    this.player.play('stumble');
    this.particles.sparkle(this.pw.x, this.y + 1, this.pw.z, [1, 0.85, 0.4], 40);
    this.ui.flashWhite(0.35);
    this.ui.toast('LE DOSSIER T\'A SAUVÉ !', false, 1400);
    this.refreshDossier();
    return true;
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
    this.dossier.clear();
    this.shield = false;
    this.zone = 'street';
    this.path.reset();
    this.segIdx = this.path.segIndexAt(this.dist);
    this.turnQueued = 0;
    this.yaw = this.camYaw = this.path.yawOf(this.path.segs[this.segIdx]);
    this.cornerAnnounced = -1;
    this.cornersSeen = 0;
    this.falling = false;
    this.skipCaught = false;
    this.path.posOn(this.path.segs[this.segIdx], this.dist, 0, this.pw);
    this.tutorialStep = 0;
    this.world.reset(this.dist);
    this.track.reset(this.dist);
    this.player.play('idle');
    this.player.setSuperSneakers(false);
    this.player.root.position.copy(this.pw);
    this.player.root.rotation.set(0, this.yaw, 0);
    this.chaser.play('idle');
    this.chaser.setAngry(0);
    this.path.pos(this.dist - this.chaserDist, this.chaserX, this.chaser.root.position);
    this.chaser.root.rotation.set(0, this.yaw, 0);
    this.ui.resetHud();
    this.ui.hud(0, 0, 1, false);
    this.refreshDossier();
  }

  private enterMenu() {
    this.state = 'menu';
    this.stateTime = 0;
    this.ui.setMenuStats(this.best, this.totalCoins);
    this.ui.show('menu');
    document.getElementById('mute')!.classList.remove('hidden');
    this.audio.ambience(false);
    this.audio.startMenuMusic();
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
    this.audio.setSpeed(0);
    this.audio.setZone(this.zone);
    this.audio.startMusic();
    this.audio.duckMusic(false);
    this.audio.ambience(true, this.zone);
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
    this.audio.countdown(3);
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
      // Pres d'un carrefour, le geste lateral sert a tourner.
      const seg = this.path.segs[this.segIdx];
      if (this.dist > seg.s1 - TURN_WINDOW && !this.turnQueued) {
        if (dir === seg.turn) {
          this.turnQueued = dir;
          return;
        }
        // Mauvais cote : on se cogne contre la bordure.
        this.shake = Math.max(this.shake, 0.1);
        return;
      }
      const next = this.lane + dir;
      if (next < -1 || next > 1) {
        // Heurte le bord : petite secousse.
        this.shake = Math.max(this.shake, 0.08);
        return;
      }
      this.lane = next;
      this.laneFromX = this.x;
      this.laneT = 0;
      this.laneDur = PLAYER.laneChangeTime;
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
    if (this.state !== 'paused' && this.state !== 'countdown') this.particles.update(dt, 0);
    this.followSun();
    this.updateCamera(realDt);
    const cam = this.camera;
    this.particles.setViewportHeight(this.canvas.height / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2))) / 0.9);
    this.renderer.render(realDt);
  }

  private updateMenu(dt: number) {
    this.path.posOn(this.path.segs[this.segIdx], this.dist, this.x, this.pw, 0);
    this.placeActors(dt, 0, false);
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
    this.audio.setSpeed((this.speed - SPEED.start) / (SPEED.max - SPEED.start));
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
    this.dist += this.speed * dt;

    // Changement de voie avec easing.
    if (this.laneT < 1) this.laneT = Math.min(1, this.laneT + dt / this.laneDur);
    const tx = laneX(this.lane);
    this.x = lerp(this.laneFromX, tx, easeOutCubic(this.laneT));
    this.lean = damp(this.lean, (tx - this.x) * -0.5, 12, dt);

    // Virage : au passage du coin si le geste a ete fait, sinon le mur.
    let seg = this.path.segs[this.segIdx];
    this.path.ensure(this.dist);
    if (this.turnQueued && this.dist >= seg.s1 - TURN_EARLY) {
      this.performTurn();
      seg = this.path.segs[this.segIdx];
    } else if (!this.turnQueued && this.dist > seg.s1 + J - 1.1) {
      this.onWall();
      return;
    }
    this.announceCorner(seg);

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
          this.particles.footDust(this.pw.x, this.y, this.pw.z, 6);
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

    // Plafond des couloirs et annonce de zone.
    const zone = this.path.zoneAt(this.dist);
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
      this.audio.setZone(zone);
      if (this.state === 'playing') this.ui.zone(zone);
    }

    if (this.slideTimer > 0) {
      this.slideTimer -= dt;
      if (this.slideTimer <= 0 && this.player.anim === 'slide') this.player.play('run');
    }
    if (this.player.anim === 'stumble' && this.player.animTime > 0.55) this.player.play('run');

    // Position monde du joueur (le troncon courant est prolonge s'il n'a pas tourne).
    this.path.posOn(seg, this.dist, this.x, this.pw, this.y);

    // Collisions.
    const height = this.slideTimer > 0 ? PLAYER.slideHeight : PLAYER.height;
    const hit = this.track.collide({ x: this.x, prevX: this.prevX, y: this.y, height, dist: this.dist, prevDist: this.prevDist });
    if (hit.kind === 'crash') {
      this.onCrash(hit.type);
      return;
    }
    if (hit.kind === 'fall') {
      this.onFall();
      return;
    }
    if (hit.kind === 'stumble') this.onStumble(hit.fromX);

    this.track.update(dt, this.dist, this.speed);
    this.track.updateCoins(dt, this.dist, this.x, this.y, this.timers.magnet > 0, this.pw);
    this.track.checkPowerUps(this.dist, this.x, this.y);
    this.world.update(this.dist, this.pw.x, this.pw.z);

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

    this.placeActors(dt, ground, true);
    // Masque le Gardien quand il traverserait la camera.
    this.chaser.root.visible = this.chaserDist < 4.7;

    const px = this.pw.x, pz = this.pw.z;
    if (this.shield && Math.random() < 0.5) this.particles.trail(px + (Math.random() - 0.5) * 0.8, this.y + 0.3 + Math.random() * 1.4, pz, [1, 0.8, 0.3]);
    if (this.timers.sneakers > 0 && this.grounded) this.particles.trail(px, this.y + 0.08, pz, [0.1, 0.9, 0.8]);
    if (this.timers.magnet > 0 && Math.random() < 0.4) this.particles.trail(px + (Math.random() - 0.5), this.y + 1 + Math.random(), pz, [1, 0.25, 0.35]);
  }

  // Le soleil (et sa carte d'ombres) suit le joueur, cale sur la grille de texels.
  private followSun() {
    const f = this.path.segs[this.segIdx];
    const t = this.tmpV.set(this.pw.x + f.dx * 14, 0, this.pw.z + f.dz * 14);
    t.applyQuaternion(this.lightInvQ);
    t.x = Math.round(t.x / this.texel) * this.texel;
    t.y = Math.round(t.y / this.texel) * this.texel;
    t.applyQuaternion(this.lightQ);
    this.sun.target.position.copy(t);
    this.sun.position.copy(t).addScaledVector(SUN_DIR, 110);
    this.sun.target.updateMatrixWorld();
    this.sun.updateMatrixWorld();
    this.campus.group.visible = this.pw.lengthSq() < 300 * 300;
  }

  // Place joueur et Gardien dans le monde, orientes selon le chemin.
  private placeActors(dt: number, ground: number, running: boolean) {
    const seg = this.path.segs[this.segIdx];
    const targetYaw = this.path.yawOf(seg);
    this.yaw = dampAngle(this.yaw, targetYaw, 14, dt);
    this.player.root.position.copy(this.pw);
    this.player.root.rotation.y = this.yaw;
    this.player.update(dt, running ? this.speed : 0, this.y, ground, this.vy, this.lean);
    // Le Gardien suit le chemin derriere le joueur.
    const cs = this.dist - this.chaserDist;
    const cseg = cs >= seg.s0 ? seg : this.path.segAt(cs);
    this.path.posOn(cseg, cs, this.chaserX, this.chaser.root.position);
    this.chaser.root.rotation.y = dampAngle(this.chaser.root.rotation.y, this.path.yawOf(cseg), 8, dt);
    this.chaser.update(dt, running ? this.speed : 0);
    const f = this.path.segs[this.segIdx];
    this.particles.setBack(-f.dx, -f.dz);
  }

  // Bascule sur le troncon suivant sans saut de position : on exprime la
  // position courante dans le repere du nouveau troncon.
  private performTurn() {
    const seg = this.path.segs[this.segIdx];
    const next = this.path.segs[this.segIdx + 1];
    const c = this.path.posOn(seg, seg.s1, 0, new THREE.Vector3());
    const p = this.path.posOn(seg, this.dist, this.x, new THREE.Vector3());
    const rx = p.x - c.x, rz = p.z - c.z;
    const along = next.dx * rx + next.dz * rz;
    const lat = -next.dz * rx + next.dx * rz;
    this.segIdx++;
    this.dist = this.prevDist = next.s0 + along;
    this.x = this.prevX = lat;
    // On garde la voie la plus proche : glissement court, sans retour force au centre.
    this.lane = clamp(Math.round(lat / laneX(1)), -1, 1);
    this.laneFromX = lat;
    this.laneT = 0;
    this.laneDur = 0.3;
    this.turnQueued = 0;
    this.cornerAnnounced = -1;
    this.ui.turnHint(0);
    this.audio.turn(Math.sign(seg.turn));
    this.shake = Math.max(this.shake, 0.05);
  }

  // Annonce visuelle du virage (fleche) pour les premiers carrefours.
  private announceCorner(seg: { i: number; s1: number; turn: number }) {
    if (this.state !== 'playing' || this.turnQueued) return;
    if (this.dist > seg.s1 - 48 && this.cornerAnnounced !== seg.i) {
      this.cornerAnnounced = seg.i;
      this.cornersSeen++;
      this.audio.cornerCue();
      if (this.cornersSeen <= 3) this.ui.turnHint(seg.turn);
    }
  }

  private onWall() {
    if (this.useShield()) {
      // Le dossier sauve aussi du mur : virage force.
      this.turnQueued = this.path.segs[this.segIdx].turn;
      this.performTurn();
      return;
    }
    this.audio.crash();
    this.renderer.hit(2.2);
    this.shake = 0.6;
    this.hitStop = 0.18;
    this.ui.flashWhite(0.5);
    this.particles.impact(this.pw.x, this.y + 0.5, this.pw.z, 30, true);
    this.ui.turnHint(0);
    this.caught('Tu as foncé dans le mur au lieu de tourner.');
  }

  private onFall() {
    if (this.useShield()) {
      // Rebond hors du caniveau.
      this.vy = PLAYER.jumpVelocity * 0.8;
      this.grounded = false;
      this.player.play('jump');
      return;
    }
    this.audio.fall();
    this.shake = 0.4;
    this.falling = true;
    this.caught('Tu es tombé dans un caniveau ouvert.');
  }

  private onStumble(fromX: number) {
    // Retour sur la voie de depart.
    this.lane = clamp(Math.round(fromX / laneX(1)), -1, 1);
    this.laneFromX = this.x;
    this.laneT = 0;
    this.laneDur = PLAYER.laneChangeTime;
    this.shake = 0.3;
    this.renderer.hit(1);
    this.audio.stumble();
    this.particles.impact(this.pw.x, this.y, this.pw.z, 12);
    if (this.warn > 0) {
      if (this.useShield()) return;
      this.caught('Deux faux pas, le Gardien t\'a rattrapé.');
      return;
    }
    this.warn = CHASER.warnTime;
    this.player.play('stumble');
    this.audio.whistle();
    this.ui.toast('ATTENTION !', true);
  }

  private onCrash(type: string) {
    if (this.useShield()) return;
    const reasons: Record<string, string> = {
      books: 'Tu t\'es étalé dans une pile de livres.',
      board: 'Le tableau noir t\'a arrêté. Leçon retenue.',
      car: 'Tu as percuté une voiture garée.',
      steps: 'Raté, la marche de l\'estrade.',
      stage: 'Tu as foncé dans l\'estrade des diplômes.',
      copier: 'La photocopieuse a gagné.',
      chairs: 'Les chaises d\'amphi ont eu raison de toi.',
      barrier: 'Tu as percuté une barrière de chantier.',
      bench: 'Tu as trébuché sur une table-banc.',
      gate: 'La banderole des examens t\'a arrêté net.',
      kiosk: 'Tu as foncé dans un kiosque.',
      bus: 'Tu as embrassé l\'arrière d\'un minibus.',
      moto: 'Le zemidjan ne t\'a pas vu venir.',
    };
    this.audio.crash();
    this.renderer.hit(2.2);
    this.shake = 0.6;
    this.hitStop = 0.18;
    this.ui.flashWhite(0.5);
    this.particles.impact(this.pw.x, this.y + 0.5, this.pw.z, 30, true);
    this.caught(reasons[type] ?? 'Le Gardien t\'a ramené en amphi.');
  }

  private caught(reason: string) {
    this.caughtReason = reason;
    this.skipCaught = false;
    this.ui.turnHint(0);
    this.chaserDist = Math.min(this.chaserDist, 5.5);
    this.state = 'caught';
    this.stateTime = 0;
    this.player.play('fall');
    this.chaser.play('grab');
    this.ui.setDanger(false);
    this.ui.tutorial(null);
    this.audio.setIntensity(0);
    this.audio.caught();
  }

  private updateCaught(dt: number) {
    const t = this.stateTime;
    // Decelation rapide (le monde est fixe, seul le joueur glisse).
    this.speed = damp(this.speed, 0, 5, dt);
    this.dist += this.speed * dt;
    this.track.update(dt, this.dist, 0);
    this.track.updateCoins(dt, this.dist, this.x, this.y, false, this.pw);
    this.world.update(this.dist, this.pw.x, this.pw.z);
    const seg = this.path.segs[this.segIdx];
    let ground = this.track.groundAt(this.x, this.dist, this.y);
    if (this.falling) ground = -1.6; // au fond du caniveau
    if (this.y > ground) {
      this.vy -= PLAYER.gravity * dt;
      this.y = Math.max(ground, this.y + this.vy * dt);
    }
    this.path.posOn(seg, this.dist, this.x, this.pw, this.y);
    // Le Gardien arrive et saisit le fuyard, puis danse sa victoire.
    this.chaserDist = damp(this.chaserDist, 1.6, 3.2, dt);
    this.chaserX = damp(this.chaserX, this.x, 4, dt);
    this.chaser.root.visible = true;
    if (t > 1.1 && this.chaser.anim !== 'victory') {
      this.chaser.play('victory');
      this.audio.roar();
      this.shake = 0.25;
    }
    this.placeActors(dt, ground, false);
    // Laisser le temps d'apprecier la danse ; un toucher permet d'abreger.
    if (t > CAUGHT_TIME || (t > 1.6 && this.skipCaught)) this.finish();
  }

  private finish() {
    this.state = 'over';
    this.stateTime = 0;
    const record = this.score > this.best;
    if (record) {
      this.best = Math.floor(this.score);
      store.set('best', this.best);
      this.audio.newRecord();
    }
    this.totalCoins += this.coins;
    store.set('coins', this.totalCoins);
    this.ui.gameOver(this.score, this.dist, this.coins, this.best, record, this.caughtReason);
    this.ui.show('gameover');
  }

  private updateOver(dt: number) {
    this.placeActors(dt, this.falling ? -1.6 : this.y, false);
  }

  private updateCountdown(dt: number) {
    this.stateTime += dt;
    if (this.stateTime >= 0.8) {
      this.stateTime = 0;
      this.countdownN--;
      if (this.countdownN <= 0) {
        this.state = 'playing';
        this.ui.show('hud');
        this.audio.countdown(0);
        this.audio.duckMusic(false);
        this.lastTime = performance.now();
        return;
      }
      this.ui.countdown(this.countdownN);
      this.audio.countdown(this.countdownN);
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
        return { pos: new THREE.Vector3(-2.5 + d * 0.3, 3.4 - d * 0.1, -12 * k + d * 0.9), look: new THREE.Vector3(0, 6.5, 16) };
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

  // Poses de camera exprimees dans le repere du joueur (origine sur l'axe de
  // la route a sa hauteur de piste, -z vers l'avant), converties en monde
  // avec un lacet lisse : la camera pivote en douceur dans les virages.
  private toWorld(v: THREE.Vector3, origin: THREE.Vector3): THREE.Vector3 {
    return v.applyAxisAngle(Y_AXIS, this.camYaw).add(origin);
  }

  private updateCamera(dt: number) {
    const s = this.state;
    let pos: THREE.Vector3, look: THREE.Vector3;
    let fovBoost = 0;
    const seg = this.path.segs[this.segIdx];
    this.camYaw = s === 'menu' || s === 'story' ? this.path.yawOf(seg) : dampAngle(this.camYaw, this.path.yawOf(seg), 4.5, dt);
    const origin = this.path.posOn(seg, this.dist, 0, new THREE.Vector3());
    if (s === 'story') {
      ({ pos, look } = this.shotPose(this.shot, this.shotTime));
      this.camPos.lerp(this.toWorld(pos, origin), 1 - Math.exp(-dt * 4));
      this.camLook.lerp(this.toWorld(look, origin), 1 - Math.exp(-dt * 4));
    } else if (s === 'menu') {
      ({ pos, look } = this.menuCamera(this.stateTime));
      this.camPos.lerp(this.toWorld(pos, origin), 1 - Math.exp(-dt * 3));
      this.camLook.lerp(this.toWorld(look, origin), 1 - Math.exp(-dt * 3));
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
      this.camPos.copy(this.toWorld(pos, origin));
      this.camLook.copy(this.toWorld(look, origin));
    } else if (s === 'caught' || s === 'over') {
      // Travelling autour du Gardien qui danse, puis lente orbite.
      const t = s === 'caught' ? this.stateTime : CAUGHT_TIME + this.stateTime;
      const ang = lerp(0, Math.PI * 0.75, easeInOutCubic(clamp(t / 2.4, 0, 1))) + Math.max(0, t - 2.4) * 0.12;
      const r = lerp(6.2, 6.8, clamp(t / 2.4, 0, 1));
      const cx = this.x;
      const cz = this.chaserDist * 0.5;
      pos = new THREE.Vector3(cx + Math.sin(ang) * r, lerp(3.6, 2.3, clamp(t / 2.4, 0, 1)) + Math.max(0, this.y) * 0.5, cz + Math.cos(ang) * r);
      look = new THREE.Vector3(cx, 1.3 + Math.max(0, this.y) * 0.5, lerp(-7, cz, clamp(t / 1.2, 0, 1)));
      this.camPos.lerp(this.toWorld(pos, origin), 1 - Math.exp(-dt * 5));
      this.camLook.lerp(this.toWorld(look, origin), 1 - Math.exp(-dt * 5));
    } else {
      ({ pos, look } = this.playCamera());
      this.toWorld(pos, origin);
      this.toWorld(look, origin);
      this.camPos.x = damp(this.camPos.x, pos.x, 8, dt);
      this.camPos.y = damp(this.camPos.y, pos.y, 5, dt);
      this.camPos.z = damp(this.camPos.z, pos.z, 8, dt);
      this.camLook.x = damp(this.camLook.x, look.x, 10, dt);
      this.camLook.y = damp(this.camLook.y, look.y, 6, dt);
      this.camLook.z = damp(this.camLook.z, look.z, 10, dt);
      fovBoost = ((this.speed - SPEED.start) / (SPEED.max - SPEED.start)) * 7 + (this.timers.sneakers > 0 && !this.grounded ? 4 : 0);
    }

    this.shake = Math.max(0, this.shake - dt * 1.4);
    const sh = this.shake * this.shake;
    const t = performance.now() * 0.001;
    this.camera.position.set(
      this.camPos.x + Math.sin(t * 43) * sh * 0.9,
      this.camPos.y + Math.sin(t * 57 + 1) * sh * 0.9,
      this.camPos.z + Math.sin(t * 37 + 2) * sh * 0.5,
    );
    this.camera.lookAt(this.camLook);
    const targetFov = this.baseFov + fovBoost;
    if (Math.abs(this.camera.fov - targetFov) > 0.01) {
      this.camera.fov = damp(this.camera.fov, targetFov, 3, dt);
      this.camera.updateProjectionMatrix();
    }
    // Ciel et silhouette lointaine suivent la camera.
    this.sky.position.copy(this.camera.position);
    this.skyline.position.set(this.camera.position.x, 0, this.camera.position.z);
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
