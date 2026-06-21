// Core domain types for Pantheon Protocol.
// These are pure data shapes shared across the app (and, later, Cloud Functions).
// Keep this file free of Firebase / React imports so the game logic stays portable.

export type Faction = 'Gods' | 'Titans' | 'Demigods';

export type Gender = 'M' | 'F';

export type EntityStatus = 'active' | 'archived';

export const FACTIONS: Faction[] = ['Gods', 'Titans', 'Demigods'];

/** The primary attribute each faction is built around (PRD 3 / 7.2). */
export const FACTION_PRIMARY: Record<Faction, keyof BaseStats> = {
  Gods: 'attack',
  Titans: 'defense',
  Demigods: 'resilience',
};

export interface BaseStats {
  attack: number;
  defense: number;
  resilience: number;
}

export type HeroLevel = 0 | 1 | 2 | 3 | 4 | 5;
export type HeroLevelKey = 'level0' | 'level1' | 'level2' | 'level3' | 'level4' | 'level5';

export const HERO_LEVEL_KEYS: HeroLevelKey[] = [
  'level0', 'level1', 'level2', 'level3', 'level4', 'level5',
];

/** Image references, one per level (PRD 14.3 / data_model 3.1). May hold a data URL or storage URL. */
export type HeroImages = Partial<Record<HeroLevelKey, string>>;

/** Admin catalog hero — the master, editable definition (/heroes/{heroId}). */
export interface Hero {
  heroId: string;
  name: string;
  faction: Faction;
  gender: Gender;
  origin: string;
  baseStats: BaseStats;
  /** Draft floor price — auction opens here. Defaults to stat sum if unset. */
  basePrice?: number;
  images?: HeroImages;
  status: EntityStatus;
  createdAt?: number;
  updatedAt?: number;
}

/** Admin catalog artifact definition (/artifacts/{artifactId}). */
export interface Artifact {
  artifactId: string;
  faction: Faction;
  levelsGranted: number; // 1–5
  cost: number;
  image?: string;
  status: EntityStatus;
  createdAt?: number;
  updatedAt?: number;
}

/** Tunable balancing values (/gameConfig/current). See data_model 3.3 & PRD 14.5. */
export interface GameConfig {
  startingBudget: number;
  bidIncrements: number[];
  levelCap: number;
  affinity: { matchedPctPerLevel: number; crossPctPerLevel: number };
  rosterSynergy: { count: number; primaryBoostPct: number }[];
  artifactSupply: { levels: number; qtyFormula: string }[];
  artifactCosts: Record<number, number>;
  battleDestroyRewardPct: number;
  sellValue: { ratio: number; statGainCoeff: number };
  negotiationTimeoutSec: number;   // draft bids & ally offers (PRD 6.3 / 12.5)
  attackTimeoutSec: number;        // battle negotiation window per turn
  maxPlayers: number;
  updatedAt?: number;
}

// ---- Rarity tiers (PRD 7.4). Derived from current stat sum, never stored. ----

export type RarityTier = 'Earthborn' | 'Favored' | 'Heroic' | 'Divine' | 'Olympian';

export interface RarityTierDef {
  tier: RarityTier;
  min: number; // inclusive lower bound on stat sum
}

// Ordered high → low so the first match wins.
export const RARITY_TIERS: RarityTierDef[] = [
  { tier: 'Olympian', min: 190 },
  { tier: 'Divine', min: 150 },
  { tier: 'Heroic', min: 110 },
  { tier: 'Favored', min: 70 },
  { tier: 'Earthborn', min: 0 },
];

// ---- Resilience modes (PRD 7.5). ----

export type ResMode =
  | 'noShift'
  | 'fullAttack'
  | 'attackHeavy'
  | 'balanced'
  | 'defenceHeavy'
  | 'fullDefence';

export interface ResModeDef {
  mode: ResMode;
  label: string;
  /** Fraction of resilience routed into attack (rest of the shifted portion goes to defense). */
  toAttack: number;
  toDefense: number;
}

export const RES_MODES: Record<ResMode, ResModeDef> = {
  noShift: { mode: 'noShift', label: 'No Shift', toAttack: 0, toDefense: 0 },
  fullAttack: { mode: 'fullAttack', label: 'Full Attack', toAttack: 1, toDefense: 0 },
  attackHeavy: { mode: 'attackHeavy', label: 'Attack Heavy', toAttack: 0.75, toDefense: 0.25 },
  balanced: { mode: 'balanced', label: 'Balanced', toAttack: 0.5, toDefense: 0.5 },
  defenceHeavy: { mode: 'defenceHeavy', label: 'Defence Heavy', toAttack: 0.25, toDefense: 0.75 },
  fullDefence: { mode: 'fullDefence', label: 'Full Defence', toAttack: 0, toDefense: 1 },
};

/** Modes available to each faction (PRD 7.5). */
export const FACTION_MODES: Record<Faction, ResMode[]> = {
  Gods: ['noShift', 'attackHeavy'],
  Titans: ['noShift', 'defenceHeavy'],
  Demigods: ['noShift', 'fullAttack', 'attackHeavy', 'balanced', 'defenceHeavy', 'fullDefence'],
};
