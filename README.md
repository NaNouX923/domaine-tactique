# Domaine Tactique

Carte temps réel de l'escouade pour le terrain **Domaine** (château de Bois-Boudran, Fontenailles 77).
Chaque joueur ouvre le site sur son téléphone. Il voit les autres sur l'image satellite, avec leur niveau : Dehors, -1, RDC, 1er, 2e ou 3e.

## Fonctions
- Position GPS en direct de 3 à 5 joueurs (ou plus), regroupés par **code d'équipe**.
- **Étage** : quand tu entres dans un bâtiment tracé, l'appli passe en RDC et fait vibrer le sélecteur. Tu tapes ton niveau. Quand tu ressors plus de 15 s, elle repasse en « Dehors ».
- **Zones** : château, petits bâtiments, forêt, plaine (ancien golf), lac, zone neutre. Tu les traces sur la carte et elles sont partagées avec toute l'équipe.
- **Signaux** : Ennemi, Besoin d'aide, Objectif, Regroupement. Le signal porte l'étage, il fait vibrer les téléphones de l'équipe et il disparaît après 90 s.
- Distance et direction de chaque coéquipier (« 120 m NE ») et filtre par étage.
- **Placer à la main** quand le GPS décroche à l'intérieur du château.
- Fonds de carte : Satellite IGN (le plus net en France), Satellite Esri, Plan IGN (chemins forestiers).
- **Hors-ligne** : bouton « Télécharger le terrain » dans les réglages (environ 1 200 tuiles), à lancer en wifi avant la partie.
- Écran maintenu allumé, installable comme une appli (« Ajouter à l'écran d'accueil »).

## Lancer en local
```bash
npm install
npm start          # http://localhost:3000
```
Le GPS ne marche qu'en **HTTPS** (ou sur localhost). Pour jouer, il faut donc héberger l'appli.

## Mettre en ligne (gratuit) sur Render
1. Pousse ce dossier sur un dépôt GitHub.
2. Sur render.com, choisis New → Web Service, puis ton dépôt.
3. Build : `npm install`. Start : `npm start`.
4. Tu obtiens une adresse `https://xxx.onrender.com` à partager à l'équipe.

À savoir : l'offre gratuite de Render met le serveur en veille. La première ouverture prend 30 à 60 s, donc ouvre le site sur le parking. Son disque est aussi effacé à chaque redémarrage. Une fois tes zones tracées, fais **Zones → Exporter**, puis remplace `zones.default.json` par le fichier exporté et pousse-le sur GitHub. Tes zones deviennent alors celles par défaut.
Pour garder les zones sans y penser, utilise Railway ou un petit VPS avec un volume, et la variable `DATA_DIR=/chemin/du/volume`.

## Premier passage sur le terrain
Aucun plan intérieur du château n'est publié. Le contour du château fourni est **approximatif**, centré sur ses coordonnées (48.5625 N, 2.9494 E).
1. Ouvre **Zones**, supprime « Château (à ajuster) » et redessine-le au zoom max sur le satellite IGN.
2. Trace chaque petit bâtiment et coche ses niveaux réels (ex. RDC + 1er).
3. Trace les grandes zones : forêt, plaine, zone neutre.
4. Exporte le résultat (voir plus haut).

Une zone « bâtiment » posée à l'intérieur d'une zone « forêt » est prioritaire : l'appli sait que tu es dans le bâtiment.

## Limites honnêtes
- Le GPS d'un téléphone ne peut pas mesurer l'étage. L'altitude est trop imprécise à l'intérieur, donc c'est toi qui choisis le niveau.
- À l'intérieur des murs épais, le GPS dérive de 10 à 30 m. Dans ce cas, sers-toi de **Placer**.
- Sur iPhone, une page web ne suit plus la position quand l'écran est verrouillé. Garde l'appli ouverte (elle empêche la mise en veille), en luminosité basse.
- Prévois une batterie externe : le GPS continu consomme beaucoup.
