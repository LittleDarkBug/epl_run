# EPL Run

Jeu de course infinie en 3D, pensé d'abord pour le mobile et jouable dans le navigateur. Yao voulait seulement son certificat de scolarité. Après trois guichets, sept exemplaires et un chef de service en réunion depuis 2019, le Gardien de l'EPL se réveille. Il ne reste qu'une solution : courir.

## Jouer

```bash
npm install
npm run dev      # serveur de developpement accessible sur le reseau local
npm run build    # version de production dans dist/
npm run preview  # sert la version de production
```

Commandes : glisser le doigt à gauche ou à droite pour changer de voie, vers le haut pour sauter, vers le bas pour glisser. Au clavier : flèches, espace et Échap.

## Contenu

- Départ fidèle au vrai bâtiment de l'EPL : tour gris-bleu avec le panneau UL / EPL et son toit vert, ailes jaunes à barreaux et auvents, parking en latérite, motos et voitures garées.


- Cinématique d'ouverture : le cauchemar administratif (guichets, tampons, réveil du Gardien), rejouable depuis le menu.
- Trois zones qui s'enchaînent : rues de Lomé, couloirs des bâtiments de l'EPL, routes du campus de l'UL (Pelouse centrale, Amphi 20, Grand Amphi FDS, UniPod).
- Obstacles : barrières de chantier, tables-bancs, piles de livres, tableaux noirs mobiles, voitures garées (on peut sauter dessus), banderoles d'examens, kiosques, minibus (avec rampes pour courir sur les toits), zemidjans à contresens.
- À ramasser : cahiers aux couleurs du logo EPL, diplômes (gros bonus), aimant, super baskets, bonne note x2.
- Le Gardien de l'EPL : colosse bleu en toque de diplômé, logo EPL sur le torse et sur la cape. Deux faux pas rapprochés et il t'attrape.

## Technique

- Three.js + post-traitement (bloom, tonemapping ACES, SMAA, vignette, aberration chromatique sur impact), rendu HDR.
- Décor procédural fusionné par blocs (un appel de rendu par bloc), courbure du monde en shader, ombres dynamiques, carte d'environnement générée depuis le ciel.
- Qualité adaptative (`?q=low|medium|high`) et résolution dynamique pour tenir la fluidité sur téléphone.
- Musique et effets sonores synthétisés en WebAudio, aucun fichier audio.
- Paramètre de test `?d=1000` pour démarrer à une distance donnée.

Les logos se trouvent dans `public/textures/`.
