# EPL Run

Jeu de course infinie en 3D, pensé d'abord pour le mobile et jouable dans le navigateur. Afi voulait seulement son certificat de scolarité. Après trois guichets, sept exemplaires et un chef de service en réunion depuis 2019, le Gardien de l'EPL se réveille. Il ne reste qu'une solution : courir.

## Jouer

```bash
npm install
npm run dev      # serveur de developpement accessible sur le reseau local
npm run build    # version de production dans dist/
npm run preview  # sert la version de production
```

Commandes : glisser le doigt à gauche ou à droite pour changer de voie, et pour tourner à l'approche d'un carrefour ; vers le haut pour sauter, vers le bas pour glisser. Un geste correspond toujours à une seule action, même s'il est long. Au clavier : flèches, espace et Échap.

## Application installable (PWA)

- Installable depuis le menu (bouton « Installer le jeu ») sur Android et ordinateur, ou via Partager puis « Sur l'écran d'accueil » sur iPhone et iPad (la marche à suivre s'affiche dans le jeu).
- Une fois installé, le jeu s'ouvre en plein écran et en portrait, et fonctionne hors ligne : le service worker généré au build (`dist/sw.js`) précharge tout le jeu.
- Dans le navigateur, chaque lancement de partie passe en plein écran quand l'appareil le permet, et un bouton permet de basculer. Safari sur iPhone n'autorise le plein écran qu'aux applications installées.
- Les icônes sont générées par `python3 tools/make-icons.py <police ArchivoBlack.ttf>`.
- Le service worker n'est actif qu'en production : tester avec `npm run build` puis `npm run preview`, en HTTPS ou sur localhost.

## Contenu

- Départ fidèle au vrai bâtiment de l'EPL : tour gris-bleu avec le panneau UL / EPL et son toit vert, ailes jaunes à barreaux et auvents, parking en latérite, motos et voitures garées.


- Cinématique d'ouverture : le cauchemar administratif (guichets, tampons, réveil du Gardien), rejouable depuis le menu.
- Un chemin sinueux à la Temple Run : des carrefours à angle droit où il faut tourner au bon moment (sinon, c'est le mur du fond, signalé par des panneaux à chevrons), des caniveaux ouverts à sauter, des banderoles et des branches basses sous lesquelles glisser.
- Trois zones qui s'enchaînent : rues de Lomé, couloirs des bâtiments de l'EPL, routes du campus de l'UL (Pelouse centrale, Amphi 20, Grand Amphi FDS, UniPod).
- Obstacles propres à chaque lieu : dans les rues de Lomé, barrières de chantier, kiosques, voitures garées, zemidjans à contresens et caniveaux ; dans les couloirs, piles de livres, tables-bancs, chaises d'amphi, tableaux noirs et photocopieuses sur roulettes ; sur le campus, voitures garées, branches basses, caniveaux et estrade de remise des diplômes sur laquelle on peut monter et courir. Partout, les banderoles d'examens obligent à glisser dessous.
- Dossier administratif : le tampon, la copie légalisée et la signature du chef apparaissent au fil de la course. Les trois réunis rapportent un gros bonus et protègent d'une collision (le Gardien recule).
- À ramasser : cahiers aux couleurs du logo EPL, diplômes (gros bonus, surtout sur les estrades), aimant, super baskets, bonne note x2.
- Personnages riggés et animés par capture de mouvement : Afi, l'étudiante en fuite, et le Gardien de l'EPL, androïde bleu en toque de diplômé avec le logo EPL sur le torse et sur la cape. Deux faux pas rapprochés et il t'attrape, puis il fête ça en dansant la samba (un toucher abrège la scène).

## Technique

- Three.js + post-traitement (bloom, tonemapping ACES, SMAA, vignette, aberration chromatique sur impact), rendu HDR.
- Décor procédural fusionné par blocs (un appel de rendu par bloc), courbure du monde en shader, ombres dynamiques, carte d'environnement générée depuis le ciel.
- Qualité adaptative (`?q=low|medium|high`) et résolution dynamique pour tenir la fluidité sur téléphone.
- Musique et effets sonores synthétisés en WebAudio, aucun fichier audio.
- Paramètre de test `?d=1000` pour démarrer à une distance donnée.

Les logos se trouvent dans `public/textures/`.

## Personnages

- Modèles et animations dans `public/models/`, sources non compressées dans `assets-src/`.
- `node tools/build-models.mjs` retire les animations inutilisées et compresse les modèles (meshopt).
- Les animations de course, d'attente et les gestes viennent du X Bot et sont transférées sur Afi au chargement par un retargeting maison (`src/actors/retarget.ts`). Saut, glissade, faux pas et chute sont des surcouches procédurales sur les os (`src/actors/Player.ts`).
- `npm run dev` puis `/dev/preview.html?a=slide` (ou `?who=chaser&a=victory&v=front`) affiche un personnage isolé pour régler les poses.

## Décor modélisé dans Blender

Le départ (bâtiment de l'EPL, parking, haies) et les arbres sont modélisés par script dans Blender 5 (module Python `bpy`, sans interface), puis exportés en glTF :

- `tools/blender/textures.py` : textures tuilables (crépi jaune, panneaux gris-bleu, béton, métal, tôle, latérite, herbe, haie, bâche) avec normal maps.
- `tools/blender/build_campus.py` : tour d'entrée à panneaux avec passage et toit pyramidal, ailes à ouvertures en retrait, barreaux et auvents, sol et haies. L'occlusion ambiante est cuite par Cycles (images `public/models/campus/ao_*.jpg`, lues sur le second jeu d'UV).
- `tools/blender/foliage.py` et `tools/blender/build_trees.py` : arbres d'ombrage (tronc et branches ramifiés, feuillage en cartes découpées).
- `node tools/build-models.mjs` compresse ensuite les modèles (meshopt).

Pour régénérer : installer `bpy` (`pip install bpy`, Python 3.11), puis lancer les scripts depuis la racine du projet avec ce Python. Les sources non compressées sont dans `assets-src/`.

## Crédits

- Personnages Michelle (Afi) et X Bot (le Gardien), ainsi que leurs animations : Mixamo (Adobe), fichiers repris des exemples de three.js.
- Logos : Université de Lomé et École Polytechnique de Lomé.
