// Controles tactiles : un geste = une action.
// Le geste se declenche des que le doigt a parcouru le seuil (sans attendre le
// relachement), puis il est verrouille jusqu'au relachement : un balayage
// long ne fait donc changer que d'une seule voie. Un petit coup rapide
// (flick) qui n'atteint pas le seuil est aussi reconnu au relachement ;
// un simple tapotement (moins de 14 px) est ignore.
// Le clavier reste disponible sur ordinateur.

export type Action = 'left' | 'right' | 'up' | 'down' | 'pause';

interface Touch {
  id: number;
  x: number;
  y: number;
  done: boolean;
}

export class Input {
  private handlers: ((a: Action) => void)[] = [];
  private touches = new Map<number, Touch>();

  constructor(target: HTMLElement) {
    // Seuils en pixels CSS, independants de la densite de l'ecran.
    const threshold = () => Math.min(42, Math.max(22, Math.min(window.innerWidth, window.innerHeight) * 0.06));
    const flickMin = 14;

    const direction = (dx: number, dy: number): Action => {
      // Legere preference pour l'horizontal (changements de voie plus frequents).
      if (Math.abs(dx) * 1.15 >= Math.abs(dy)) return dx > 0 ? 'right' : 'left';
      return dy > 0 ? 'down' : 'up';
    };

    target.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      target.setPointerCapture?.(e.pointerId);
      this.touches.set(e.pointerId, { id: e.pointerId, x: e.clientX, y: e.clientY, done: false });
    });

    target.addEventListener('pointermove', (e) => {
      const tc = this.touches.get(e.pointerId);
      if (!tc || tc.done) return;
      const dx = e.clientX - tc.x;
      const dy = e.clientY - tc.y;
      if (Math.hypot(dx, dy) < threshold()) return;
      tc.done = true;
      this.emit(direction(dx, dy));
    });

    const end = (e: PointerEvent) => {
      const tc = this.touches.get(e.pointerId);
      if (!tc) return;
      this.touches.delete(e.pointerId);
      if (tc.done || e.type === 'pointercancel') return;
      const dx = e.clientX - tc.x;
      const dy = e.clientY - tc.y;
      // Geste court (flick) : reconnu au relachement, quelle que soit sa duree.
      if (Math.hypot(dx, dy) >= flickMin) this.emit(direction(dx, dy));
    };
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
    target.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
    target.addEventListener('contextmenu', (e) => e.preventDefault());

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
