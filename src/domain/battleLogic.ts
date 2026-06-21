// Pure battle math (PRD 9, 11). No Firebase/React — authoritative resolution shared by
// the client engine now and Cloud Functions later. Artifact level bonuses arrive with
// the shop milestone (heroes are level 0 here, so the level factor is 1).

import type { BaseStats, Faction, GameConfig, ResMode } from './types';
import { FACTION_PRIMARY } from './types';
import { applyModeShift, synergyBoostPct, type ShiftedStats } from './stats';
import type { BattleHero, BattleOutcome, Match, MatchHero } from './match';

/** A player's live (on-board) heroes. */
export function livingHeroes(match: Match, ownerId: string): MatchHero[] {
  return Object.values(match.catalog.heroes).filter((h) => h.ownerId === ownerId && !h.destroyed);
}

export function sameFactionCount(match: Match, ownerId: string, faction: Faction): number {
  return livingHeroes(match, ownerId).filter((h) => h.faction === faction).length;
}

/**
 * Current stats of a hero: base × artifact bonus (all stats, PRD 7.3), then roster synergy
 * on the faction primary (PRD 9). Synergy is owner-specific and applied before mode shifting
 * (PRD 7.5); the artifact bonus is permanent and transfers on capture (PRD 12.7).
 */
export function derivedStats(match: Match, hero: MatchHero, config: GameConfig): BaseStats {
  const f = 1 + (hero.bonusPct ?? 0);
  const stats: BaseStats = {
    attack: hero.baseStats.attack * f,
    defense: hero.baseStats.defense * f,
    resilience: hero.baseStats.resilience * f,
  };
  if (hero.ownerId) {
    const count = sameFactionCount(match, hero.ownerId, hero.faction);
    const pct = synergyBoostPct(count, config);
    if (pct > 0) {
      const primary = FACTION_PRIMARY[hero.faction];
      stats[primary] = stats[primary] * (1 + pct);
    }
  }
  return stats;
}

/** Derived stats with a resilience mode applied — the values used in battle and shown in UI. */
export function shiftedStats(match: Match, hero: MatchHero, mode: ResMode, config: GameConfig): ShiftedStats {
  return applyModeShift(derivedStats(match, hero, config), mode);
}

export interface BattleInput {
  attackerHero: MatchHero;
  attackerMode: ResMode;
  targetHero: MatchHero;
  defends: boolean;
  defenderMode: ResMode;
}

export interface BattleResult {
  outcome: BattleOutcome;
  attackTotal: number;
  defenseTotal: number;
  captureCeiling: number;
  reward: number;
}

/**
 * Resolve a 1v1 battle (PRD 11.3). A targeted hero's defense ALWAYS applies — "don't
 * defend" simply means it defends passively in No-Shift mode rather than choosing a mode.
 * So an attack that can't beat the hero's defense fails, even undefended (refinement of
 * PRD 11.2, which had Defense = 0 when undefended).
 */
export function resolveBattle(match: Match, config: GameConfig, input: BattleInput): BattleResult {
  const attackTotal = shiftedStats(match, input.attackerHero, input.attackerMode, config).attack;

  const defMode: ResMode = input.defends ? input.defenderMode : 'noShift';
  const def = shiftedStats(match, input.targetHero, defMode, config);
  const defenseTotal = def.defense;
  const remainingRes = def.remainingRes;
  const captureCeiling = defenseTotal + remainingRes;

  let outcome: BattleOutcome;
  if (attackTotal <= defenseTotal) outcome = 'fail';
  else if (attackTotal <= captureCeiling) outcome = 'capture';
  else outcome = 'destroy';

  const reward = outcome === 'destroy'
    ? Math.round((input.targetHero.draftCost ?? 0) * config.battleDestroyRewardPct)
    : 0;

  return { outcome, attackTotal, defenseTotal, captureCeiling, reward };
}

// ── Multi-hero (alliance) battles: totals sum across all heroes on a side (PRD 11.3) ──

export function attackSideTotal(match: Match, side: BattleHero[], config: GameConfig): number {
  return side.reduce((sum, e) => {
    const h = match.catalog.heroes[e.matchHeroId];
    return h ? sum + shiftedStats(match, h, e.mode, config).attack : sum;
  }, 0);
}

export function defenseSideTotals(
  match: Match,
  side: BattleHero[],
  config: GameConfig,
): { defense: number; remainingRes: number } {
  return side.reduce(
    (acc, e) => {
      const h = match.catalog.heroes[e.matchHeroId];
      if (h) {
        const sh = shiftedStats(match, h, e.mode, config);
        acc.defense += sh.defense;
        acc.remainingRes += sh.remainingRes; // Remaining RES sums across defenders (PRD 7.5)
      }
      return acc;
    },
    { defense: 0, remainingRes: 0 },
  );
}

export function outcomeFor(attackTotal: number, defenseTotal: number, remainingRes: number): BattleOutcome {
  if (attackTotal <= defenseTotal) return 'fail';
  if (attackTotal <= defenseTotal + remainingRes) return 'capture';
  return 'destroy';
}

/** Round-robin rotation: second player becomes first, old first goes to the end (PRD 10.3). */
export function rotateTurnOrder(order: string[]): string[] {
  if (order.length <= 1) return order;
  return [...order.slice(1), order[0]];
}
