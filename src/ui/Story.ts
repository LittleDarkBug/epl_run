// Cinematique d'ouverture : le cauchemar administratif de l'EPL.

export type Shot = 'wide' | 'player' | 'doc' | 'chaser' | 'chaserLow' | 'hero';

export interface Beat {
  shot: Shot;
  speaker: string;
  style?: 'robot' | 'hero';
  text: string;
  doc?: boolean;
  stamp?: { text: string; color: string; x: number; y: number; rot: number };
  wake?: boolean; // le Gardien s'eveille
  pose?: 'idle' | 'sad' | 'no' | 'yes';
}

export const STORY: Beat[] = [
  { shot: 'wide', speaker: '', text: 'Lomé, lundi, 7h58. Afi vient simplement récupérer son certificat de scolarité à l\'EPL.' },
  { shot: 'doc', pose: 'idle', speaker: 'GUICHET N°1', text: 'Dossier incomplet. Il manque le tampon du guichet n°2.', doc: true, stamp: { text: 'INCOMPLET', color: '#d6182a', x: 18, y: 38, rot: -14 } },
  { shot: 'doc', speaker: 'GUICHET N°2', text: 'Pour le tampon, il me faut une photocopie légalisée de la photocopie du guichet n°1.', doc: true, stamp: { text: 'PIÈCE MANQUANTE', color: '#1446a0', x: 30, y: 58, rot: 9 } },
  { shot: 'doc', pose: 'sad', speaker: 'GUICHET N°3', text: 'Le chef de service doit signer. Il est en réunion. Depuis 2019.', doc: true, stamp: { text: 'REVENEZ DEMAIN', color: '#0b7a44', x: 8, y: 74, rot: -6 } },
  { shot: 'hero', pose: 'no', speaker: 'AFI', style: 'hero', text: 'Ça fait trois semaines que je « reviens demain » !', doc: true, stamp: { text: 'REJETÉ', color: '#d6182a', x: 40, y: 18, rot: 18 } },
  { shot: 'chaser', speaker: 'SYSTÈME', style: 'robot', text: 'BIP. Réclamation non conforme détectée. Activation du Gardien de l\'EPL.', wake: true },
  { shot: 'chaserLow', speaker: 'LE GARDIEN DE L\'EPL', style: 'robot', text: 'ÉTUDIANTE AFI. RETOUR IMMÉDIAT EN AMPHI. FORMULAIRE B-12 EN SEPT EXEMPLAIRES.', wake: true },
  { shot: 'hero', pose: 'yes', speaker: 'AFI', style: 'hero', text: 'Sept exemplaires ? Hors de question. Je me tire !', wake: true },
];

const $ = (id: string) => document.getElementById(id)!;

export class StoryPlayer {
  private index = -1;
  private chars = 0;
  private holdTime = 0;
  private done = false;
  onEnd: (() => void) | null = null;
  onBeat: ((b: Beat) => void) | null = null;

  constructor() {
    $('story').addEventListener('pointerup', (e) => {
      if ((e.target as HTMLElement).id === 'skip') return;
      this.advance();
    });
    $('skip').addEventListener('click', (e) => {
      e.stopPropagation();
      this.finish();
    });
  }

  get beat(): Beat | null {
    return STORY[this.index] ?? null;
  }

  get beatIndex() {
    return this.index;
  }

  start() {
    this.index = -1;
    this.done = false;
    $('stamps').innerHTML = '';
    $('doc').classList.remove('show');
    this.next();
  }

  private next() {
    this.index++;
    if (this.index >= STORY.length) {
      this.finish();
      return;
    }
    const b = STORY[this.index];
    this.chars = 0;
    this.holdTime = 0;
    const sp = $('speaker');
    sp.textContent = b.speaker;
    sp.className = 'speaker' + (b.style ? ' ' + b.style : '');
    const line = $('line');
    line.className = b.style === 'robot' ? 'robot' : '';
    line.textContent = '';
    $('doc').classList.toggle('show', !!b.doc);
    if (b.stamp) {
      const st = b.stamp;
      window.setTimeout(() => {
        const el = document.createElement('div');
        el.className = 'stamp-ink';
        el.textContent = st.text;
        el.style.color = st.color;
        el.style.left = `${st.x}%`;
        el.style.top = `${st.y}%`;
        el.style.setProperty('--rot', `rotate(${st.rot}deg)`);
        el.style.transform = `rotate(${st.rot}deg)`;
        $('stamps').appendChild(el);
        this.onStamp?.();
      }, 420);
    }
    this.onBeat?.(b);
  }

  onStamp: (() => void) | null = null;

  advance() {
    const b = this.beat;
    if (!b || this.done) return;
    if (this.chars < b.text.length) this.chars = b.text.length;
    else this.next();
  }

  finish() {
    if (this.done) return;
    this.done = true;
    $('doc').classList.remove('show');
    this.onEnd?.();
  }

  update(dt: number) {
    const b = this.beat;
    if (!b || this.done) return;
    if (this.chars < b.text.length) {
      this.chars = Math.min(b.text.length, this.chars + dt * 42);
      $('line').textContent = b.text.slice(0, Math.floor(this.chars));
    } else {
      $('line').textContent = b.text;
      this.holdTime += dt;
      if (this.holdTime > 2.6 + b.text.length * 0.012) this.next();
    }
  }
}
