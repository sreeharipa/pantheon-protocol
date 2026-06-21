# Pantheon Protocol

Real-time multiplayer strategy card game (mobile-first PWA). Draft heroes via a bidding
economy, then duel using them. Built with **React + TypeScript + Vite** on **Firebase**
(Auth + Firestore + Hosting).

See [`HOSTING.md`](./HOSTING.md) for the full Firebase setup & deploy guide.

## Status — Foundation milestone ✅

- Google Sign-In + user profiles
- Admin / Game-Master gate (server-enforced via Firestore rules)
- Hero catalog: all **31** heroes from the PRD, seedable from the Admin panel
- Admin hero CRUD: add / edit / archive / restore / delete, with **per-level image upload**
  (auto-downscaled to 1024px WebP, stored in Cloud Storage, CDN-served)
- Portable game-logic modules (`src/domain/*`) ready to lift into Cloud Functions later

### Coming next
Lobby (room codes) → Draft phase (bidding) → Duel phase (trade/shop, battle, alliance
negotiation) → Artifact & balance editing in Admin.

## Local development

```bash
npm install
cp .env.example .env.local   # then fill in your Firebase web config
npm run dev
```

Without a `.env.local`, the app runs but shows a "Firebase not configured" notice on the
login screen.

## Project layout

```
src/
  domain/      # pure, portable types + game logic (no Firebase/React imports)
  data/        # hero seed data (all 31 heroes)
  firebase/    # Firebase init, auth, Firestore catalog access
  auth/        # AuthProvider (React context)
  components/  # shared UI (FactionMark, HeroEditor)
  pages/       # Login, Home, Admin
firestore.rules        # security rules (admin allow-list lives here + in src/firebase/auth.ts)
firebase.json          # hosting + firestore config
```

## Admin access
The admin allow-list is `ADMIN_EMAILS` in `src/firebase/auth.ts`, mirrored in
`firestore.rules`. Currently: `sreeharipa1999@gmail.com`. Add more admins by editing both
(or flipping `isAdmin` on a `/users` doc once an admin exists).
