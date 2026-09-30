import { recipe } from './recipes';

// Synthese des sons hors du fil principal : le rendu graphique n'est jamais
// ralenti par le precalcul (sinon la resolution dynamique baisse).
self.onmessage = (e: MessageEvent<{ keys: string[]; sr: number }>) => {
  const { keys, sr } = e.data;
  for (const key of keys) {
    const [make, div] = recipe(key);
    const rate = sr / div;
    const data = make(rate);
    (self as unknown as Worker).postMessage({ key, data, sr: rate }, [data.buffer]);
  }
};
