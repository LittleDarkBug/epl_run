import '@fontsource/archivo-black/latin-400.css';
import '@fontsource/outfit/latin-400.css';
import '@fontsource/outfit/latin-600.css';
import '@fontsource/outfit/latin-800.css';
import './style.css';
import { Game } from './core/Game';

// Point d'entree : polices, images du logo, puis construction du jeu.

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function boot() {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const base = import.meta.env.BASE_URL;
  const fonts = Promise.race([
    Promise.all([
      document.fonts.load('64px "Archivo Black"'),
      document.fonts.load('800 16px "Outfit"'),
    ]),
    new Promise((r) => setTimeout(r, 2500)),
  ]).catch(() => undefined);
  const [logoFull, wordmark] = await Promise.all([
    loadImage(`${base}textures/logo_full.png`),
    loadImage(`${base}textures/epl_wordmark.png`),
    fonts,
  ]);
  const game = new Game(canvas);
  await game.load({ logoFull, wordmark });
}

boot().catch((err) => {
  console.error(err);
  const el = document.querySelector('.loading-text');
  if (el) el.textContent = 'Impossible de lancer le jeu sur cet appareil (WebGL2 requis).';
});
