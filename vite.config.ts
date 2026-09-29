import { defineConfig, Plugin } from 'vite';
import { createHash } from 'node:crypto';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// Genere le service worker au build : il precharge tous les fichiers du jeu
// (code, polices, modeles, textures, icones) pour un fonctionnement hors ligne,
// avec une version derivee du contenu pour invalider le cache a chaque mise a jour.
function serviceWorker(): Plugin {
  const listPublic = (dir: string, root = dir): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? listPublic(p, root) : [relative(root, p).split('\\').join('/')];
    });
  return {
    name: 'epl-service-worker',
    apply: 'build',
    generateBundle(_opts, bundle) {
      const files = [...Object.keys(bundle), ...listPublic('public')].filter((f) => !f.endsWith('.map') && f !== 'sw.js');
      const hash = createHash('sha256');
      for (const f of Object.keys(bundle).sort()) hash.update(f);
      for (const f of listPublic('public').sort()) hash.update(f + statSync(join('public', f)).size);
      const version = hash.digest('hex').slice(0, 12);
      const list = ['./', ...files.map((f) => './' + f)];
      const code = `// Genere au build, ne pas modifier.
const CACHE = 'eplrun-${version}';
const PRECACHE = ${JSON.stringify(list)};

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('eplrun-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  // Page : reseau d'abord (mises a jour), cache en secours hors ligne.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((r) => {
      const copy = r.clone();
      caches.open(CACHE).then((c) => c.put('./', copy));
      return r;
    }).catch(() => caches.match('./')));
    return;
  }
  // Ressources : cache d'abord.
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((r) => {
    if (r.ok) {
      const copy = r.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
    }
    return r;
  })));
});
`;
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: code });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [serviceWorker()],
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      input: 'index.html',
    },
  },
});
