// Integration plateforme : plein ecran, orientation, installation PWA et
// service worker.

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

type FsDoc = Document & { webkitFullscreenElement?: Element; webkitFullscreenEnabled?: boolean; webkitExitFullscreen?: () => void };
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => void };

const doc = document as FsDoc;

export const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function canFullscreen(): boolean {
  return !!(doc.fullscreenEnabled || doc.webkitFullscreenEnabled);
}

export function isFullscreen(): boolean {
  return !!(doc.fullscreenElement || doc.webkitFullscreenElement);
}

export async function enterFullscreen() {
  if (isStandalone() && window.matchMedia('(display-mode: fullscreen)').matches) return;
  if (!isFullscreen() && canFullscreen()) {
    const el = document.documentElement as FsEl;
    try {
      if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
      else el.webkitRequestFullscreen?.();
    } catch {
      /* refuse par le navigateur */
    }
  }
  lockPortrait();
}

export async function exitFullscreen() {
  try {
    if (doc.exitFullscreen) await doc.exitFullscreen();
    else doc.webkitExitFullscreen?.();
  } catch {
    /* deja sorti */
  }
}

function lockPortrait() {
  const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
  // Uniquement sur telephone : les tablettes et ordinateurs gardent leur orientation.
  if (o?.lock && Math.min(screen.width, screen.height) < 600) o.lock('portrait').catch(() => undefined);
}

export class Installer {
  private deferred: BeforeInstallPromptEvent | null = null;
  onChange: (() => void) | null = null;

  constructor() {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferred = e as BeforeInstallPromptEvent;
      this.onChange?.();
    });
    window.addEventListener('appinstalled', () => {
      this.deferred = null;
      this.onChange?.();
    });
  }

  // 'prompt' : invite native disponible. 'ios' : marche a suivre manuelle.
  get mode(): 'prompt' | 'ios' | null {
    if (isStandalone()) return null;
    if (this.deferred) return 'prompt';
    if (isIOS) return 'ios';
    return null;
  }

  async prompt(): Promise<boolean> {
    if (!this.deferred) return false;
    await this.deferred.prompt();
    const r = await this.deferred.userChoice;
    this.deferred = null;
    this.onChange?.();
    return r.outcome === 'accepted';
  }
}

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => undefined);
  });
}
