# Planificateur d'ameublement (HTML/JS)

## Utiliser depuis GitHub

1) Télécharge le repo (Code → Download ZIP) ou clone-le.
2) Décompresse si besoin.
3) Ouvre `furniture-room-app/index.html` dans ton navigateur.

## Format markdown supporté

- `unit`: texte libre (`cm` par défaut).
- `points`: liste de points `x,y` pour le contour de la pièce.
- `walls`: liste de longueurs (si `points` absent, les 2 premières longueurs servent à créer un rectangle).
- `items`: liste d'objets avec `type`, `x`, `y`, `w`, `h`, `rotation`.

Voir `room.md` pour un exemple complet.
