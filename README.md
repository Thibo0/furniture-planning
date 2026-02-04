# Planificateur d'ameublement (HTML/JS)

Ouvre `index.html` dans un navigateur pour lancer l'app.

## Format markdown supporté

- `unit`: texte libre (`cm` par défaut).
- `points`: liste de points `x,y` pour le contour de la pièce.
- `walls`: liste de longueurs (si `points` absent, les 2 premières longueurs servent à créer un rectangle).
- `items`: liste d'objets avec `type`, `x`, `y`, `w`, `h`, `rotation`.

Voir `room.md` pour un exemple complet.
