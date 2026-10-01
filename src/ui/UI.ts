import type { PowerUpType } from '../world/Track';

// Interface HTML superposee : ecrans, HUD, notifications.

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export type ScreenId = 'loading' | 'menu' | 'hud' | 'pause' | 'countdown' | 'gameover' | 'story';

const PU_INFO: Record<PowerUpType, { label: string; color: string; icon: string }> = {
  magnet: {
    label: 'Aimant',
    color: '#ff3355',
    icon: '<svg viewBox="0 0 24 24"><path d="M6 3h4v8a2 2 0 0 0 4 0V3h4v8a6 6 0 0 1-12 0z"/></svg>',
  },
  sneakers: {
    label: 'Super baskets',
    color: '#18e0c8',
    icon: '<svg viewBox="0 0 24 24"><path d="M3 15l2-7 4 2 3-3 2 5 6 2v3H3z"/></svg>',
  },
  double: {
    label: 'Bonne note x2',
    color: '#b36bff',
    icon: '<svg viewBox="0 0 24 24"><path d="M12 2l3 7h7l-5.5 4.5L18.5 21 12 16.5 5.5 21l2-7.5L2 9h7z"/></svg>',
  },
};

// Icones des objets, dessinees a l'encre.
const ITEM_ICONS: Record<string, string> = {
  chalk: '<path d="M10 34l20-20 6 6-20 20z"/><path d="M30 14l4-4 6 6-4 4"/><path d="M8 40h6"/>',
  plane: '<path d="M6 24l36-14-10 30-8-11z"/><path d="M24 29l18-19"/><path d="M24 29v9l5-6"/>',
  stamp: '<path d="M19 6h10v10a4 4 0 0 1-2 3l3 5h7v6H11v-6h7l3-5a4 4 0 0 1-2-3z"/><path d="M10 38h28"/>',
  turbo: '<path d="M8 30c6 0 9-8 14-8l6 6h10c3 0 4 3 2 5H8z"/><path d="M4 18h10M6 12h8M2 24h8"/>',
};

// Fleche dessinee a l'encre (tutoriel).
const ARROW = '<svg class="ink-arrow" viewBox="0 0 64 32" aria-hidden="true"><path d="M5 17c12-3 25 1 41-3" /><path d="M37 5l14 10-13 11" /></svg>';

// Grain d'encre des tampons : masque irregulier (taches plus pales, manques).
function inkGrain(): string {
  const n = 256;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const x = c.getContext('2d')!;
  x.fillStyle = '#000';
  x.fillRect(0, 0, n, n);
  const img = x.getImageData(0, 0, n, n);
  const d = img.data;
  for (let i = 0; i < n * n; i++) {
    const r = Math.random();
    d[i * 4 + 3] = r < 0.06 ? 60 + r * 900 : r < 0.12 ? 190 : 255;
  }
  x.putImageData(img, 0, 0);
  // Quelques zones mal encrees.
  x.globalCompositeOperation = 'destination-out';
  for (let k = 0; k < 14; k++) {
    const g = x.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, 'rgba(0,0,0,0.55)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.save();
    x.translate(Math.random() * n, Math.random() * n);
    x.scale(10 + Math.random() * 26, 4 + Math.random() * 10);
    x.fillStyle = g;
    x.beginPath();
    x.arc(0, 0, 1, 0, Math.PI * 2);
    x.fill();
    x.restore();
  }
  return c.toDataURL();
}

document.documentElement.style.setProperty('--ink-grain', `url(${inkGrain()})`);

const tilt = (el: HTMLElement, a: number, b: number, v = '--rot') => el.style.setProperty(v, `${(a + Math.random() * (b - a)).toFixed(1)}deg`);

export class UI {
  private screens = new Map<ScreenId, HTMLElement>();
  private toastTimer = 0;
  private scoreEl = $('score');
  private coinsEl = $('coins');
  private multEl = $('mult');
  private coinsLine = document.querySelector('.coins-line') as HTMLElement;
  private puBox = $('powerups');
  private puEls = new Map<PowerUpType, HTMLElement>();
  private danger = $('danger');
  private flash = $('flash');
  private tuto = $('tuto');
  private lastScore = -1;
  private lastCoins = -1;

  constructor() {
    for (const id of ['loading', 'menu', 'hud', 'pause', 'countdown', 'gameover', 'story'] as ScreenId[]) {
      this.screens.set(id, $(id));
    }
  }

  show(...ids: ScreenId[]) {
    for (const [id, el] of this.screens) el.classList.toggle('active', ids.includes(id));
    $('rotate-hint').classList.toggle('menu-only', ids.includes('menu'));
  }

  progress(p: number) {
    $('progress-fill').style.width = `${Math.round(p * 100)}%`;
  }

  on(id: string, fn: () => void) {
    $(id).addEventListener('click', (e) => {
      e.stopPropagation();
      fn();
    });
  }

  setMenuStats(best: number, coins: number) {
    $('menu-best').textContent = best.toLocaleString('fr-FR');
    $('menu-coins').textContent = coins.toLocaleString('fr-FR');
  }

  setMuted(m: boolean) {
    $('mute').classList.toggle('muted', m);
  }

  hud(score: number, coins: number, mult: number, boosted: boolean) {
    const s = Math.floor(score);
    if (s !== this.lastScore) {
      this.scoreEl.textContent = s.toLocaleString('fr-FR');
      this.lastScore = s;
    }
    if (coins !== this.lastCoins) {
      this.coinsEl.textContent = String(coins);
      if (this.lastCoins >= 0 && coins > this.lastCoins) {
        this.coinsLine.classList.remove('bump');
        void this.coinsLine.offsetWidth;
        this.coinsLine.classList.add('bump');
      }
      this.lastCoins = coins;
    }
    const m = `x${mult}`;
    if (this.multEl.textContent !== m) this.multEl.textContent = m;
    this.multEl.classList.toggle('boost', boosted);
  }

  resetHud() {
    this.lastScore = -1;
    this.lastCoins = -1;
    for (const el of this.puEls.values()) el.remove();
    this.puEls.clear();
    this.setDanger(false);
    this.tutorial(null);
  }

  powerUps(timers: Partial<Record<PowerUpType, { left: number; total: number }>>) {
    for (const t of ['magnet', 'sneakers', 'double'] as PowerUpType[]) {
      const info = timers[t];
      let el = this.puEls.get(t);
      if (info && info.left > 0) {
        if (!el) {
          const d = PU_INFO[t];
          el = document.createElement('div');
          el.className = 'pu';
          el.style.color = d.color;
          el.innerHTML = `<span class="pu-icon" style="background:${d.color}">${d.icon}</span><span style="color:#fff">${d.label}</span><span class="pu-bar"><i></i></span>`;
          this.puBox.appendChild(el);
          this.puEls.set(t, el);
        }
        (el.querySelector('.pu-bar i') as HTMLElement).style.width = `${(info.left / info.total) * 100}%`;
      } else if (el) {
        el.remove();
        this.puEls.delete(t);
      }
    }
  }

  // Message central : coup de tampon (encre bleue, rouge si danger) et sceau
  // rond pour une valeur (+250, 2/3).
  callout(o: { title: string; value?: string; danger?: boolean; ms?: number }) {
    const el = $('toast');
    const [stamp, seal] = Array.from(el.children) as HTMLElement[];
    stamp.querySelector('strong')!.textContent = o.title;
    seal.textContent = o.value ?? '';
    for (const e of [stamp, seal]) {
      e.classList.toggle('red', !!o.danger);
      e.classList.toggle('blue', !o.danger);
    }
    tilt(el, -8, -3);
    tilt(el, 6, 15, '--rot2');
    el.classList.remove('show', 'hide');
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      el.classList.remove('show');
      el.classList.add('hide');
    }, o.ms ?? 1200);
  }

  toast(text: string, warn = false, ms = 1100) {
    this.callout({ title: text, danger: warn, ms });
  }

  private zoneTimer = 0;
  private lastRank = 0;

  // Carte de depart d'un defi : 3, 2, 1, puis PARTEZ ; null pour masquer.
  challengeIntro(n: number | 'go' | null) {
    const el = $('ch-intro');
    if (n === null) {
      el.classList.remove('show', 'go');
      return;
    }
    const c = $('ch-count');
    c.textContent = n === 'go' ? 'PARTEZ !' : String(n);
    c.classList.toggle('red', n === 'go');
    tilt(c, -14, 14, '--rot2');
    el.classList.toggle('go', n === 'go');
    el.classList.add('show');
    c.classList.remove('tick');
    void c.offsetWidth;
    c.classList.add('tick');
  }

  // Pastille du defi en cours : secondes restantes et barre.
  challenge(on: boolean, left = 0, frac = 1, hot = false) {
    const el = $('challenge');
    el.classList.toggle('show', on);
    if (!on) return;
    $('ch-time').textContent = String(Math.max(0, Math.ceil(left)));
    ($('ch-bar') as HTMLElement).style.transform = `scaleX(${frac})`;
    el.classList.toggle('hot', hot);
  }

  // Case objet : vide, roulette (icone qui defile) ou pret a lancer.
  item(state: 'empty' | 'roll' | 'ready', type: string | null, hint = false) {
    const el = $('item-btn');
    el.className = `item-btn ${state}${type === 'stamp' ? ' stamp' : ''}${hint ? ' hint' : ''}`;
    if (type && el.dataset.type !== type) {
      el.dataset.type = type;
      $('item-icon').innerHTML = ITEM_ICONS[type] ?? '';
    }
    if (!type) el.dataset.type = '';
  }

  // Tir qui arrive de derriere : decalage lateral (-1..1) ou null.
  incoming(side: number | null) {
    const el = $('incoming');
    el.classList.toggle('show', side !== null);
    if (side !== null) el.style.left = `${50 + side * 26}%`;
  }

  rankShow(on: boolean) {
    $('rank').classList.toggle('hidden-rank', !on);
    if (!on) this.lastRank = 0;
  }

  // Bandeau d'annonce (meme style que les zones) : defis.
  banner(sub: string, name: string, ms = 2400) {
    $('zone-sub').textContent = sub;
    $('zone-name').textContent = name;
    const el = $('zone-banner');
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(this.zoneTimer);
    this.zoneTimer = window.setTimeout(() => el.classList.remove('show'), ms);
  }

  // Position (1 = en tete), nombre de coureurs, jauge hors top 2 (0..1).
  rank(n: number, total: number, gauge: number) {
    const el = $('rank');
    if (n !== this.lastRank) {
      $('rank-n').textContent = String(n);
      $('rank-suf').textContent = n === 1 ? 'ER' : 'E';
      $('rank-of').textContent = '/' + total;
      if (this.lastRank) {
        el.classList.remove('up', 'down');
        void el.offsetWidth;
        el.classList.add(n < this.lastRank ? 'up' : 'down');
      }
      this.lastRank = n;
    }
    el.classList.toggle('out', n > 2);
    ($('rank-gauge') as unknown as SVGCircleElement).style.strokeDashoffset = String(220 * (1 - gauge));
  }
  private threatTimer = 0;

  // Carte d'alerte : le Gardien lance un formulaire rejete.
  threat(ms = 2300) {
    const el = $('threat');
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(this.threatTimer);
    this.threatTimer = window.setTimeout(() => el.classList.remove('show'), ms);
  }

  // Coup de tampon plein ecran.
  stamp(text: string) {
    const el = $('stamp-fx');
    el.querySelector('strong')!.textContent = text;
    el.classList.remove('slam');
    void el.offsetWidth;
    el.classList.add('slam');
  }

  zone(z: 'street' | 'corridor' | 'court') {
    const pickOne = (a: string[]) => a[Math.floor(Math.random() * a.length)];
    const info = {
      street: ['Quartier', pickOne(['RUES DE LOMÉ', 'BOULEVARD DU 13 JANVIER', 'VERS LE GRAND MARCHÉ'])],
      corridor: ['Intérieur', pickOne(['BÂTIMENTS DE L\'EPL', 'COULOIR DES TP', 'AILE GÉNIE CIVIL'])],
      court: ['Campus de l\'UL', pickOne(['PELOUSE CENTRALE', 'VERS L\'AMPHI 20', 'GRAND AMPHI FDS', 'DEVANT L\'UNIPOD'])],
    }[z];
    $('zone-sub').textContent = info[0];
    $('zone-name').textContent = info[1];
    const el = $('zone-banner');
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(this.zoneTimer);
    this.zoneTimer = window.setTimeout(() => el.classList.remove('show'), 2400);
  }

  dossier(have: Set<string>, shield: boolean) {
    const el = $('dossier');
    for (const p of ['stamp', 'copy', 'signature']) el.querySelector(`[data-p="${p}"]`)!.classList.toggle('got', have.has(p) || shield);
    el.classList.toggle('shield', shield);
  }

  // Fleche d'annonce de virage (0 pour masquer).
  turnHint(dir: number) {
    const el = $('turn-hint');
    if (!dir) {
      el.classList.remove('show');
      return;
    }
    el.classList.toggle('left', dir < 0);
    $('turn-text').textContent = 'TOURNE';
    el.classList.add('show');
  }

  setDanger(on: boolean) {
    this.danger.classList.toggle('on', on);
  }

  flashWhite(strength = 0.6) {
    this.flash.style.transition = 'none';
    this.flash.style.opacity = String(strength);
    void this.flash.offsetWidth;
    this.flash.style.transition = 'opacity 0.5s ease-out';
    this.flash.style.opacity = '0';
  }

  // Tutoriel : un tampon avec fleches a l'encre et un seul mot.
  tutorial(kind: 'lanes' | 'jump' | 'slide' | null) {
    if (!kind) {
      this.tuto.classList.remove('show');
      return;
    }
    const pair = (flip = false) => `<span class="ink-pair">${flip ? ARROW.replace('ink-arrow', 'ink-arrow flip') : ARROW}</span>`;
    const word = (w: string) => `<strong>${w}</strong>`;
    const inner = kind === 'lanes' ? pair(true) + word('GLISSE') + pair()
      : kind === 'jump' ? pair() + word('SAUTE') : word('BAISSE-TOI') + pair();
    const v = kind === 'jump' ? ' v' : kind === 'slide' ? ' v down' : '';
    this.tuto.innerHTML = `<div class="ink blue${v}">${inner}</div>`;
    tilt(this.tuto.firstElementChild as HTMLElement, -5, -2);
    this.tuto.classList.add('show');
  }

  countdown(n: number) {
    const el = $('count-num');
    el.textContent = String(n);
    el.classList.remove('tick');
    void el.offsetWidth;
    el.classList.add('tick');
  }

  gameOver(score: number, dist: number, coins: number, best: number, record: boolean, reason: string) {
    $('go-score').textContent = Math.floor(score).toLocaleString('fr-FR');
    $('go-dist').textContent = `${Math.floor(dist).toLocaleString('fr-FR')} m`;
    $('go-coins').textContent = String(coins);
    $('go-best').textContent = Math.floor(best).toLocaleString('fr-FR');
    $('record').classList.toggle('show', record);
    $('go-sub').textContent = reason;
  }
}
