// Pure match-setup helpers (data_model §8 "Match start"). No Firebase/React imports —
// these run client-side now and lift into Cloud Functions later unchanged.

import type { GameConfig, Hero, RarityTier } from './types';
import { FACTIONS, RARITY_TIERS } from './types';
import { heroBasePrice, rarityTier } from './stats';
import type { MatchHero, ShopArtifactStock } from './match';

/** Fisher–Yates shuffle (non-mutating). rng injectable for deterministic tests. */
export function shuffle<T>(arr: T[], rng: () => number = Math.random): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Pick the draft pool: n×5 heroes, filled tier-by-tier from the highest tier down, in
 * whole batches of n so every player gets an equal shot at each tier present (PRD draft
 * refinement). A tier with fewer than n heroes is skipped in favour of the next tier down.
 */
export function selectDraftPool(heroes: Hero[], n: number, rng: () => number = Math.random): Hero[] {
  const target = Math.min(n * 5, heroes.length);
  const byTier = new Map<RarityTier, Hero[]>();
  for (const h of heroes) {
    const t = rarityTier(h);
    const list = byTier.get(t) ?? [];
    list.push(h);
    byTier.set(t, list);
  }
  const selected: Hero[] = [];
  for (const { tier } of RARITY_TIERS) { // highest → lowest
    const pool = shuffle(byTier.get(tier) ?? [], rng);
    while (selected.length + n <= target && pool.length >= n) {
      selected.push(...pool.splice(0, n));
    }
  }
  // Best-effort top-up (only if too few full batches existed to reach n×5).
  if (selected.length < target) {
    const chosen = new Set(selected);
    selected.push(...shuffle(heroes.filter((h) => !chosen.has(h)), rng).slice(0, target - selected.length));
  }
  return selected;
}

/** Snapshot the selected draft pool into match-hero instances + a shuffled deck order. */
export function buildMatchHeroes(
  heroes: Hero[],
  n: number,
  rng: () => number = Math.random,
): { catalogHeroes: Record<string, MatchHero>; deckOrder: string[] } {
  const pool = selectDraftPool(heroes, n, rng);
  const catalogHeroes: Record<string, MatchHero> = {};
  for (const h of pool) {
    const id = `mh_${h.heroId}`;
    catalogHeroes[id] = {
      matchHeroId: id,
      sourceHeroId: h.heroId,
      name: h.name,
      faction: h.faction,
      baseStats: { ...h.baseStats },
      basePrice: heroBasePrice(h),
      level: 0,
      bonusPct: 0,
      ownerId: null,
      draftCost: null,
      appliedArtifacts: [],
    };
  }
  return { catalogHeroes, deckOrder: shuffle(Object.keys(catalogHeroes), rng) };
}

/** Evaluate a supply quantity formula from gameConfig for n players. */
export function evalQtyFormula(formula: string, n: number): number {
  switch (formula.replace(/\s+/g, '')) {
    case 'n':
      return n;
    case 'ceil(n/2)':
      return Math.ceil(n / 2);
    case 'floor(n/2)':
      return Math.floor(n / 2);
    default:
      return 0;
  }
}

/** Generate shop artifact stock for all factions from the supply formula (PRD 8.5). */
export function generateShopArtifacts(config: GameConfig, n: number): ShopArtifactStock[] {
  const stock: ShopArtifactStock[] = [];
  for (const faction of FACTIONS) {
    for (const tier of config.artifactSupply) {
      stock.push({
        faction,
        levelsGranted: tier.levels,
        cost: config.artifactCosts[tier.levels] ?? 0,
        remaining: evalQtyFormula(tier.qtyFormula, n),
      });
    }
  }
  return stock;
}

/** Initial turn order — random at match start (PRD 10.3). */
export function initialTurnOrder(playerIds: string[], rng: () => number = Math.random): string[] {
  return shuffle(playerIds, rng);
}

// Room codes: short, shareable, unambiguous (no I/O/0/1). Branded "PNTH-XXXX".
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomRoomCode(rng: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < 4; i++) s += CODE_ALPHABET[Math.floor(rng() * CODE_ALPHABET.length)];
  return `PNTH-${s}`;
}
