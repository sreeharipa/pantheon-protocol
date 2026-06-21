// Live match state types (data_model §5). Kept separate from the catalog types in
// types.ts. Still pure data — no Firebase imports — so match logic stays portable.

import type { BaseStats, Faction, ResMode } from './types';

export type MatchStatus = 'lobby' | 'draft' | 'duel' | 'completed';
export type PhaseType = 'draft' | 'trade' | 'attack';
export type PlayerStatus = 'active' | 'eliminated';

/** A generic artifact token a player owns, ready to apply to a hero (PRD 8). */
export interface ArtifactToken {
  faction: Faction;
  levels: number;
}

export interface MatchPlayer {
  userId: string;
  displayName: string;
  photoURL: string | null;
  credits: number;
  seat: number;               // join order
  status: PlayerStatus;
  doneDrafting: boolean;      // draft opt-out (PRD 6.5)
  ready: boolean;             // trade-stage Ready (PRD 10.3)
  heroIds: string[];          // match-hero ids this player owns
  artifacts: ArtifactToken[]; // owned, un-applied artifacts
}

/** A hero instance inside a match — snapshotted from the catalog, mutable (data_model §5.2). */
export interface MatchHero {
  matchHeroId: string;
  sourceHeroId: string;       // provenance into /heroes (also where images load from)
  name: string;
  faction: Faction;
  baseStats: BaseStats;
  basePrice: number;          // draft floor (snapshotted from the catalog)
  level: number;              // 0–5, raised by artifacts
  bonusPct: number;           // accumulated artifact stat bonus (e.g. 0.4 = +40% of base)
  ownerId: string | null;     // null while in the deck, graveyard, or destroyed
  draftCost: number | null;   // what it was won for (drives sell value & destroy reward)
  appliedArtifacts: ArtifactToken[];
  destroyed?: boolean;        // removed from play (PRD 11.3 Destroy)
}

/** Shop stock for a (faction, levelsGranted) tier (data_model §5.3). */
export interface ShopArtifactStock {
  faction: Faction;
  levelsGranted: number;
  cost: number;
  remaining: number;
}

export interface CurrentBid {
  amount: number;
  leaderPlayerId: string | null;
  deadline: number;           // epoch ms; resets on each new bid (PRD 6.3)
}

export interface DraftResult {
  heroId: string;
  heroName: string;
  winnerId: string | null;    // null = went to graveyard (nobody bid)
  amount: number;
}

export interface DraftState {
  masterDeckOrder: string[];  // shuffled matchHeroIds
  currentIndex: number;
  currentHeroId: string | null;
  currentBid: CurrentBid | null;
  passedPlayers: string[];    // opted out of the CURRENT hero only (reset on reveal)
  graveyard: string[];        // unclaimed → shop pool
  nextRevealAt?: number | null; // brief gap after a result before the next reveal
  lastResult?: DraftResult | null;
}

/** A shop item being purchased (artifact token or a graveyard hero). */
export interface ShopItem {
  itemType: 'artifact' | 'hero';
  label: string;
  basePrice: number;
  faction?: Faction;   // artifact
  levels?: number;     // artifact
  heroId?: string;     // hero
}

export interface QueuedPurchase extends ShopItem {
  initiatedBy: string;
}

export interface ShopAuction extends ShopItem {
  auctionId: string;
  amount: number;
  leaderPlayerId: string;
  initiatedBy: string;
  passedPlayers: string[]; // opted out of this lot (reset on each outbid)
  deadline: number;    // 30s, resets on each outbid (PRD 10.3)
}

export interface ShopState {
  artifacts: ShopArtifactStock[];
  graveyardHeroes: string[];
  activeAuction: ShopAuction | null;  // single lane (PRD 10.3)
  auctionQueue: QueuedPurchase[];      // FIFO
}

export interface MatchPhase {
  type: PhaseType;
  round: number;
  activePlayer: string | null;
  turnOrder: string[];
  actedThisRound?: string[];  // players who've taken their attack turn this round
}

// ── Battle (1v1 in this milestone; alliances layer on later) ──
export type BattleOutcome = 'fail' | 'capture' | 'destroy';

export interface BattleResultData {
  outcome: BattleOutcome;
  attackTotal: number;
  defenseTotal: number;
  captureCeiling: number;
  reward: number;
}

export type BattleSide = 'attack' | 'defense';

export interface BattleHero {
  playerId: string;
  matchHeroId: string;
  mode: ResMode;
}

// Ally-recruiting offers/deals (populated in the next pass; kept here so the schema is stable).
export interface BattleOffer {
  offerId: string;
  fromPlayerId: string;
  toPlayerId: string;
  side: BattleSide;
  money: number;
  heroId: string | null;
  status: 'pending' | 'accepted' | 'rejected' | 'expired';
  deadline: number;
}

export interface BattleDeal {
  fromPlayerId: string;
  toPlayerId: string;
  money: number;
  heroId: string | null;
}

export interface BattleState {
  battleId: string;
  status: 'negotiating' | 'resolved';
  attackerId: string;          // principal attacker (the turn owner)
  targetOwnerId: string;       // principal defender (owner of the targeted hero)
  targetHeroId: string;        // the only hero captured/destroyed
  attackSide: BattleHero[];
  defenseSide: BattleHero[];   // includes the targeted hero
  offers: BattleOffer[];
  deals: BattleDeal[];
  turn: BattleSide;            // whose action it is — defender responds first (PRD 11.2)
  dirty: boolean;              // did the current player commit a change this turn (gates escalation handover)
  deadline: number;            // negotiation window; resets on any action
  result: BattleResultData | null;
}

export interface BattleSummary {
  outcome: BattleOutcome;
  attackerId: string;
  attackerHeroName: string;
  targetOwnerId: string;
  targetHeroName: string;
  reward: number;
  at: number;                 // for a transient client-side banner
}

export interface Match {
  matchId: string;
  status: MatchStatus;
  roomCode: string;
  creatorId: string;
  maxPlayers: number;
  phase: MatchPhase;
  players: Record<string, MatchPlayer>;
  catalog: { heroes: Record<string, MatchHero> };
  draft: DraftState | null;
  shop: ShopState | null;
  battle: BattleState | null;
  lastBattle?: BattleSummary | null;
  tradeOffers?: TradeOffer[];
  winner: string | null;
  createdAt?: number;
  updatedAt?: number;
}

// ── Player-to-player trades (PRD 10.3 Stage 1) ──
export interface TradeBundle {
  heroIds: string[];
  artifacts: ArtifactToken[];
  credits: number;
}

export interface TradeOffer {
  offerId: string;
  fromPlayerId: string;
  toPlayerId: string;
  give: TradeBundle;   // what the proposer gives the recipient
  want: TradeBundle;   // what the proposer wants from the recipient
  createdAt: number;
}

export const MIN_PLAYERS = 2;
