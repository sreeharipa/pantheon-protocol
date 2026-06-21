// Pure, portable stat math. No Firebase / React imports — safe to reuse in Cloud
// Functions later. The full battle-resolution engine (capture/destroy, alliances)
// lands in the Duel milestone; this file holds the foundational helpers the catalog,
// admin panel, and later the engine all share.

import type {
  BaseStats,
  Faction,
  GameConfig,
  Hero,
  RarityTier,
  ResMode,
} from './types';
import { FACTION_PRIMARY, RARITY_TIERS, RES_MODES } from './types';

/** Sum of the three core stats. */
export function statSum(stats: BaseStats): number {
  return stats.attack + stats.defense + stats.resilience;
}

export function baseStatSum(hero: Pick<Hero, 'baseStats'>): number {
  return statSum(hero.baseStats);
}

/** Rarity tier from a stat sum (PRD 7.4). Derived on read, never persisted. */
export function rarityTierForSum(sum: number): RarityTier {
  for (const t of RARITY_TIERS) {
    if (sum >= t.min) return t.tier;
  }
  return 'Earthborn';
}

export function rarityTier(hero: Pick<Hero, 'baseStats'>): RarityTier {
  return rarityTierForSum(baseStatSum(hero));
}

/** A hero's draft floor price — explicit value, or stat sum as the default. */
export function heroBasePrice(hero: Pick<Hero, 'baseStats' | 'basePrice'>): number {
  return hero.basePrice ?? statSum(hero.baseStats);
}

/** Highest synergy boost a roster's same-faction count qualifies for (PRD 9). */
export function synergyBoostPct(sameFactionCount: number, config: GameConfig): number {
  let pct = 0;
  for (const tier of config.rosterSynergy) {
    if (sameFactionCount >= tier.count) pct = Math.max(pct, tier.primaryBoostPct);
  }
  return pct;
}

export interface ShiftedStats {
  attack: number;
  defense: number;
  /** Unshifted resilience — defines the capture window width (PRD 7.5). */
  remainingRes: number;
}

/**
 * Apply a resilience mode to a stat block (PRD 7.5). Synergy/level bonuses should
 * already be folded into `stats` before calling — mode shifting operates on the
 * boosted resilience value, not base (PRD 7.5 "order of operations").
 */
export function applyModeShift(stats: BaseStats, mode: ResMode): ShiftedStats {
  const def = RES_MODES[mode];
  const shifted = def.toAttack + def.toDefense; // fraction of RES that leaves the pool
  return {
    attack: stats.attack + stats.resilience * def.toAttack,
    defense: stats.defense + stats.resilience * def.toDefense,
    remainingRes: stats.resilience * (1 - shifted),
  };
}

/** A hero's faction primary attribute value (the stat synergy boosts). */
export function primaryStatValue(hero: Pick<Hero, 'faction' | 'baseStats'>): number {
  return hero.baseStats[FACTION_PRIMARY[hero.faction]];
}

export const FACTION_PRIMARY_LABEL: Record<Faction, string> = {
  Gods: 'Attack',
  Titans: 'Defense',
  Demigods: 'Resilience',
};
