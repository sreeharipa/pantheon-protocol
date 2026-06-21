import type { GameConfig } from './types';

/**
 * Default tunable balancing values (PRD 14.5 / data_model 3.3).
 * These seed /gameConfig/current and act as the fallback when no config doc exists.
 * Everything here is admin-editable at runtime — nothing about balance is hardcoded
 * into game logic; logic reads from a GameConfig instance.
 */
export const DEFAULT_GAME_CONFIG: GameConfig = {
  startingBudget: 1000,
  bidIncrements: [1, 2, 5],
  levelCap: 5,
  affinity: { matchedPctPerLevel: 0.2, crossPctPerLevel: 0.1 },
  rosterSynergy: [
    { count: 2, primaryBoostPct: 0.2 },
    { count: 4, primaryBoostPct: 0.5 },
    { count: 6, primaryBoostPct: 1.0 },
  ],
  artifactSupply: [
    { levels: 1, qtyFormula: 'n' },
    { levels: 2, qtyFormula: 'n' },
    { levels: 3, qtyFormula: 'n' },
    { levels: 4, qtyFormula: 'ceil(n/2)' },
    { levels: 5, qtyFormula: 'ceil(n/2)' },
  ],
  artifactCosts: { 1: 50, 2: 120, 3: 210, 4: 320, 5: 450 },
  battleDestroyRewardPct: 0.5,
  sellValue: { ratio: 0.5, statGainCoeff: 7 },
  negotiationTimeoutSec: 30,
  attackTimeoutSec: 60,
  maxPlayers: 5,
};
