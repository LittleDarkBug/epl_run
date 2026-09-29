// Controles : glissements tactiles (declenches des le seuil atteint, sans
// attendre le relachement) et clavier.

export type Action = 'left' | 'right' | 'up' | 'down' | 'pause';

export class Input {
  private handlers: ((a: Action) => void)[] = [];
  private sx = 0;
  private sy = 0;
  private tracking = false;
  private pointerId = -1;

  constructor(target: HTMLElement) {
    const threshold = () => Math.max(24, Math.min(window.innerWidth, window.innerHeight) * 0.045);

    target.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      this.tracking = true;
      this.pointerId = e.pointerId;
      this.sx = e.clientX;
      this.sy = e.clientY;
    });
    target.addEventListener('pointermove', (e) => {
      if (!this.tracking || e.pointerId !== this.pointerId) return;
      const dx = e.clientX - this.sx;
      const dy = e.clientY - this.sy;
      const th = threshold();
      if (Math.abs(dx) < th && Math.abs(dy) < th) return;
      if (Math.abs(dx) > Math.abs(dy)) this.emit(dx > 0 ? 'right' : 'left');
      else this.emit(dy > 0 ? 'down' : 'up');
      // On re-ancre pour permettre d'enchainer les gestes sans relacher.
      this.sx = e.clientX;
      this.sy = e.clientY;
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId === this.pointerId) this.tracking = false;
    };
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
    target.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const map: Record<string, Action> = {
        ArrowLeft: 'left', KeyA: 'left', KeyQ: 'left',
        ArrowRight: 'right', KeyD: 'right',
        ArrowUp: 'up', KeyW: 'up', KeyZ: 'up', Space: 'up',
        ArrowDown: 'down', KeyS: 'down',
        Escape: 'pause', KeyP: 'pause',
      };
      const a = map[e.code];
      if (a) {
        e.preventDefault();
        this.emit(a);
      }
    });
  }

  on(h: (a: Action) => void) {
    this.handlers.push(h);
  }

  private emit(a: Action) {
    for (const h of this.handlers) h(a);
  }
}
