# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Pantheon Protocol is a mobile-first PWA: a real-time multiplayer (2–5 player) strategy card game — draft heroes via bidding, then duel with them. React + TypeScript + Vite on Firebase. See `README.md` for the player-facing status and `HOSTING.md` for the Firebase setup.

## Commands

```bash
npm run dev          # Vite dev server (localhost:5173)
npm run build        # tsc -b && vite build — THE correctness gate (typecheck + build)
npm run lint         # eslint

# Deploy (project alias "default" = pantheon-protocol, in .firebaserc)
npm run build && firebase deploy --only hosting
firebase deploy --only firestore:rules
firebase deploy --only storage
```

There is **no test suite or test runner**. `npm run build` (the `tsc -b` step) is the type-level correctness gate — run it after every change before deploying. Verify deploys are live with a cache-busted request: `curl -sI "https://pantheon-protocol.web.app/?cb=$RANDOM"` (`index.html` is intentionally `no-cache`; hashed `/assets/**` are `immutable`).

Firebase config comes from `VITE_FIREBASE_*` in `.env.local` (copy from `.env.example`); Vite inlines them at build time. These are public identifiers, not secrets — access is gated by Security Rules.

## Architecture

### Three-layer separation (enforced by convention, important to preserve)

- **`src/domain/*`** — pure data + game logic, **zero Firebase/React imports**. This is deliberate so the logic can later lift into Cloud Functions unchanged. All rules math lives here: `types.ts` (catalog), `match.ts` (live match state), `stats.ts`, `draftLogic.ts`, `battleLogic.ts`, `matchSetup.ts`, `config.ts`.
- **`src/firebase/*`** — all Firestore I/O: subscriptions and **transactional mutations**. `matches.ts` (lobby/start), `draft.ts`, `duel.ts` (battles + turn/round flow), `trade.ts` (shop/upgrade/sell/trades), `catalog.ts` (admin hero CRUD), `auth.ts`, `app.ts`.
- **`src/pages/*` + `src/components/*`** — UI. Pages subscribe to a match and render by phase.

### The match document is the entire live game state

A single Firestore doc `matches/{matchId}` holds **everything** for a game: `players`, a snapshotted `catalog.heroes`, `draft`, `shop`, `battle`, `tradeOffers`, and `phase`. The shape is the `Match` interface in `src/domain/match.ts` — read it first. Clients subscribe via `subscribeMatch` (onSnapshot); all writes are Firestore **transactions** using **dot-path updates** (e.g. `'phase.activePlayer'`, `catalog.heroes.${id}.ownerId`) so concurrent mutations don't clobber each other.

Game flow is a state machine inside that one doc: `status` = `lobby → draft → duel → completed`, and within the duel `phase.type` = `trade → attack` (repeating per round, with `turnOrder` rotating each round).

### No server — client-authoritative with idempotent "driver" loops (the key pattern)

There are **no Cloud Functions** (free Spark plan). All game logic runs client-side inside Firestore transactions. Anything time-based (draft bid timers, shop-auction windows, battle negotiation windows) is resolved by **every client running an interval** ("driver") that detects a due deadline / no-more-bidders condition and calls an **idempotent `progress*` transaction** (`progressDraft`, `progressShop`, `progressDuel`). The transaction re-reads state and no-ops or advances exactly once, so concurrent callers are safe. Drivers are **staggered by player `seat`** (`700 + seat*500`ms) so the lowest seat usually wins the race and a closed host tab can't stall the game. When adding any timed/auctioned mechanic, follow this pattern; never assume a server tick.

Because logic is client-side, mutation functions validate authority themselves (whose turn, can-afford, ownership) and Firestore `matches` rules are currently permissive (any signed-in user can write) — a known item to tighten.

### Catalog vs. match snapshot

`/heroes` + `/heroImages` (Firestore collections) are the **admin-editable catalog**. At match start (`startMatch` in `matches.ts` → `buildMatchHeroes` in `matchSetup.ts`) the active heroes are **copied** into the match doc as mutable `MatchHero` instances. Editing the catalog never affects a running match. Hero images live in a separate `/heroImages/{heroId}` doc (downscaled 1024px WebP in Cloud Storage), loaded on demand, so the lean `/heroes` docs and match snapshots stay cheap to read.

### Derived-on-read stats (never stored)

Display/combat stats are **computed**, never persisted: rarity tier (`rarityTier`), and `derivedStats` = base × artifact `bonusPct` (PRD 7.3) → roster synergy on the faction primary (PRD 9) → `shiftedStats` applies the resilience mode (PRD 7.5). The artifact `bonusPct` and `level` are the only stored consequences of leveling. When showing or resolving stats, always go through `battleLogic.ts`/`stats.ts`, not raw `baseStats`.

### Tunables

All balance numbers live in `GameConfig` (`DEFAULT_GAME_CONFIG` in `domain/config.ts`). Engine code reads config via `getGameConfig()` (returns `/gameConfig/current` if present, else the in-code default) — never hardcode balance values into logic.

### Admin gate

The admin allow-list is `ADMIN_EMAILS` in `src/firebase/auth.ts`, **mirrored in `firestore.rules`** (and `storage.rules`). Both must be kept in sync; rules — not just the UI — enforce admin-only catalog writes.

## Working notes

- **Schema changes require a new match.** Adding/renaming fields on `Match`/`MatchHero`/`MatchPlayer` won't migrate in-progress games; start a fresh match to test, and guard reads of new optional fields (`?? []`, `?? 0`).
- **Don't render a component defined inside another component's render** and mount it as `<X/>` — the frequent `useNow()` re-renders will remount it and drop taps. Call it as a function (`{X()}`) or hoist it to module scope. (This already bit the draft bid buttons.)
- The PRD/game design has been refined verbally beyond the source docs in several places (e.g. "don't defend" still applies No-Shift defense; turn-based defender-first battle escalation; draft pool = players×5 tier-balanced). Treat the implemented behavior as current spec.
