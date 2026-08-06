# Prospect Pilot

Recherche et enrichissement de prospects (Google Places + enrichissement complémentaire), avec authentification serveur.

## Fonctionnement

- `api/search.mjs` : recherche de prospects
- `api/enrich.mjs` : enrichissement des résultats
- Authentification temporaire par mot de passe serveur (`api/login.mjs`, `api/_lib/auth.mjs`)

## Variables

Copier `.env.example` vers `.env.local`, puis définir :

- `GOOGLE_PLACES_API_KEY`
- `APP_PASSWORD`
- `APP_SESSION_SECRET` (24 caractères minimum)

## Déploiement

Vercel, projet `prospect-pilot`, équipe `jac-digital`. [prospect-pilot-tau.vercel.app](https://prospect-pilot-tau.vercel.app)

## Origine

Code extrait le 06/08/2026 du dossier de synchronisation ChatGPT partagé (`g-p-6a1de0f0db988191849f2ac982440585`), où il vivait à la racine mélangé à d'autres expérimentations. Isolé ici dans son propre dépôt pour versionnement indépendant.
