// Pure draft-auction predicates (PRD 6 + refinements: base prices, per-hero passing,
// instant resolve). No Firebase/React — shared by the client engine now and Cloud
// Functions later.

import type { GameConfig } from './types';
import type { Match, MatchHero } from './match';

export function minIncrement(config: GameConfig): number {
  return Math.min(...config.bidIncrements);
}

export function currentBidAmount(match: Match): number {
  return match.draft?.currentBid?.amount ?? 0;
}

export function currentHero(match: Match): MatchHero | null {
  const id = match.draft?.currentHeroId;
  return id ? match.catalog.heroes[id] ?? null : null;
}

/** Credits a non-leader needs to act: claim at base (no leader) or out-raise the leader. */
export function requiredToAct(match: Match, config: GameConfig): number {
  const draft = match.draft;
  if (!draft?.currentBid) return Infinity;
  const hasLeader = draft.currentBid.leaderPlayerId !== null;
  return draft.currentBid.amount + (hasLeader ? minIncrement(config) : 0);
}

function hasPassed(match: Match, playerId: string): boolean {
  return match.draft?.passedPlayers.includes(playerId) ?? false;
}

export interface BidCheck {
  ok: boolean;
  reason?: string;
  amount?: number;
}

/**
 * Validate a bid. With no current leader, increment must be 0 — that's a "claim at base
 * price". With a leader, increment is one of the configured raises, stacked on top.
 */
export function checkBid(
  match: Match,
  playerId: string,
  increment: number,
  config: GameConfig,
): BidCheck {
  const draft = match.draft;
  if (match.status !== 'draft' || !draft || !draft.currentHeroId || !draft.currentBid) {
    return { ok: false, reason: 'No hero is up for bid.' };
  }
  const p = match.players[playerId];
  if (!p || p.status !== 'active') return { ok: false, reason: 'Not an active player.' };
  if (p.doneDrafting) return { ok: false, reason: 'You opted out of drafting.' };
  if (hasPassed(match, playerId)) return { ok: false, reason: 'You passed on this hero.' };

  const leader = draft.currentBid.leaderPlayerId;
  if (leader === playerId) return { ok: false, reason: "You're already the top bidder." };

  let amount: number;
  if (leader === null) {
    if (increment !== 0) return { ok: false, reason: 'Open by claiming at the base price.' };
    amount = draft.currentBid.amount; // base price
  } else {
    if (!config.bidIncrements.includes(increment) || increment <= 0) {
      return { ok: false, reason: 'Invalid bid increment.' };
    }
    amount = draft.currentBid.amount + increment;
  }
  if (p.credits < amount) return { ok: false, reason: 'Not enough credits.' };
  return { ok: true, amount };
}

/** Can a player drop out of just this hero? Only when they're not the top bidder. */
export function canPass(match: Match, playerId: string): boolean {
  const draft = match.draft;
  if (match.status !== 'draft' || !draft || !draft.currentHeroId) return false;
  const p = match.players[playerId];
  if (!p || p.status !== 'active' || p.doneDrafting) return false;
  if (hasPassed(match, playerId)) return false;
  return draft.currentBid?.leaderPlayerId !== playerId;
}

/**
 * Is there anyone who could still act on the current hero (claim or out-raise)? When this
 * is false, the auction resolves immediately — no need to wait out the timer (PRD 6.3 +
 * pointers: lone bidder wins, top bidder wins once everyone else passes).
 */
export function eligibleBidderExists(match: Match, config: GameConfig): boolean {
  const draft = match.draft;
  if (!draft?.currentBid) return false;
  const leader = draft.currentBid.leaderPlayerId;
  const needed = requiredToAct(match, config);
  return Object.values(match.players).some(
    (p) =>
      p.status === 'active' &&
      !p.doneDrafting &&
      !hasPassed(match, p.userId) &&
      p.userId !== leader &&
      p.credits >= needed,
  );
}

/** Anyone still in the draft overall (not globally opted out / eliminated)? Else it ends. */
export function canAnyoneParticipate(match: Match): boolean {
  return Object.values(match.players).some((p) => p.status === 'active' && !p.doneDrafting);
}

export function secondsRemaining(deadline: number, now: number = Date.now()): number {
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}
