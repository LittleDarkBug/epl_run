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

  toast(text: string, warn = false, ms = 1100) {
    const el = $('toast');
    el.textContent = text;
    el.classList.toggle('warn', warn);
    el.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => el.classList.remove('show'), ms);
  }

  private zoneTimer = 0;

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
    el.classList.add('show');
    clearTimeout(this.zoneTimer);
    this.zoneTimer = window.setTimeout(() => el.classList.remove('show'), 2400);
  }

  dossier(have: Set<string>, shield: boolean) {
    const el = $('dossier');
    for (const p of ['stamp', 'copy', 'signature']) el.querySelector(`[data-p="${p}"]`)!.classList.toggle('got', have.has(p) || shield);
    el.classList.toggle('shield', shield);
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

  tutorial(kind: 'lanes' | 'jump' | 'slide' | null) {
    if (!kind) {
      this.tuto.classList.remove('show');
      return;
    }
    const content = {
      lanes: '<span class="arrow" style="--nx:6px">&larr; &rarr;</span>Glisse pour changer de voie',
      jump: '<span class="arrow" style="--ny:-6px">&uarr;</span>Glisse vers le haut pour sauter',
      slide: '<span class="arrow" style="--ny:6px">&darr;</span>Glisse vers le bas pour passer dessous',
    }[kind];
    this.tuto.innerHTML = content;
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
