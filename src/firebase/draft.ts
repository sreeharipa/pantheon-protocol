import { arrayUnion, doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { db } from './app';
import { getGameConfig } from './matches';
import type { Match } from '../domain/match';
import {
  canAnyoneParticipate,
  canPass,
  checkBid,
  eligibleBidderExists,
} from '../domain/draftLogic';

const MATCHES = 'matches';
const REVEAL_GAP_MS = 2500; // pause to show each auction result before the next reveal

/** Claim at base price (increment 0) or raise on top (+1/+2/+5) — PRD 6.3. */
export async function placeBid(matchId: string, userId: string, increment: number): Promise<void> {
  const config = await getGameConfig();
  await runTransaction(db(), async (tx) => {
    const ref = doc(db(), MATCHES, matchId);
    const fresh = await tx.get(ref);
    if (!fresh.exists()) throw new Error('Match not found.');
    const match = { ...(fresh.data() as Match), matchId };
    const check = checkBid(match, userId, increment, config);
    if (!check.ok) throw new Error(check.reason ?? 'Bid rejected.');
    const deadline = Date.now() + config.negotiationTimeoutSec * 1000;
    tx.update(ref, {
      'draft.currentBid': { amount: check.amount, leaderPlayerId: userId, deadline },
      updatedAt: serverTimestamp(),
    });
  });
}

/** Pass on the current hero only — stays in the draft for future heroes (pointer 2/4). */
export async function passHero(matchId: string, userId: string): Promise<void> {
  await runTransaction(db(), async (tx) => {
    const ref = doc(db(), MATCHES, matchId);
    const fresh = await tx.get(ref);
    if (!fresh.exists()) throw new Error('Match not found.');
    const match = { ...(fresh.data() as Match), matchId };
    if (!canPass(match, userId)) throw new Error('You cannot pass right now.');
    tx.update(ref, {
      'draft.passedPlayers': arrayUnion(userId),
      updatedAt: serverTimestamp(),
    });
  });
}

/** Opt out of the rest of the draft (PRD 6.5). */
export async function setDoneDrafting(matchId: string, userId: string): Promise<void> {
  await runTransaction(db(), async (tx) => {
    const ref = doc(db(), MATCHES, matchId);
    const fresh = await tx.get(ref);
    if (!fresh.exists()) return;
    const match = fresh.data() as Match;
    if (match.status !== 'draft' || !match.players[userId]) return;
    tx.update(ref, {
      [`players.${userId}.doneDrafting`]: true,
      updatedAt: serverTimestamp(),
    });
  });
}

/**
 * Advance the draft one step (idempotent — safe for every client to call). Reveals the
 * next hero (opening at its base price), or resolves the current auction once its timer
 * expires OR nobody can still act, awarding the hero or sending it to the graveyard.
 */
export async function progressDraft(matchId: string): Promise<void> {
  const config = await getGameConfig();
  await runTransaction(db(), async (tx) => {
    const ref = doc(db(), MATCHES, matchId);
    const fresh = await tx.get(ref);
    if (!fresh.exists()) return;
    const match = { ...(fresh.data() as Match), matchId };
    if (match.status !== 'draft' || !match.draft) return;
    const draft = match.draft;
    const now = Date.now();

    // ── Between heroes: reveal the next one (or end the draft) ──
    if (!draft.currentHeroId) {
      if (draft.nextRevealAt && now < draft.nextRevealAt) return; // still showing last result

      const deckDone = draft.currentIndex >= draft.masterDeckOrder.length;
      if (deckDone || !canAnyoneParticipate(match)) {
        // Enter the Duel. Players who drafted nothing are eliminated immediately.
        const players = structuredClone(match.players);
        for (const p of Object.values(players)) {
          if (p.status === 'active' && p.heroIds.length === 0) p.status = 'eliminated';
        }
        const alive = Object.values(players).filter((p) => p.status === 'active');
        const order = match.phase.turnOrder.filter((pid) => players[pid]?.status === 'active');
        // Every unowned hero — unclaimed reveals AND heroes never revealed (e.g. all
        // players opted out early) — goes to the shop graveyard pool (PRD 6.4 + refinement).
        const graveyard = Object.values(match.catalog.heroes)
          .filter((h) => h.ownerId === null && !h.destroyed)
          .map((h) => h.matchHeroId);
        const common = {
          players,
          'shop.graveyardHeroes': graveyard,
          'draft.currentHeroId': null,
          'draft.currentBid': null,
          'draft.nextRevealAt': null,
          'draft.lastResult': null,
          updatedAt: serverTimestamp(),
        };
        if (alive.length <= 1) {
          tx.update(ref, { ...common, status: 'completed', winner: alive[0]?.userId ?? null });
        } else {
          tx.update(ref, {
            ...common,
            status: 'duel',
            phase: { type: 'trade', round: 1, turnOrder: order, activePlayer: order[0] ?? null, actedThisRound: [] },
          });
        }
        return;
      }

      const heroId = draft.masterDeckOrder[draft.currentIndex];
      const basePrice = match.catalog.heroes[heroId]?.basePrice ?? 0;
      tx.update(ref, {
        'draft.currentHeroId': heroId,
        // Opens at base price with no leader; first bid claims at base, raises stack on top.
        'draft.currentBid': { amount: basePrice, leaderPlayerId: null, deadline: now + config.negotiationTimeoutSec * 1000 },
        'draft.passedPlayers': [],
        'draft.nextRevealAt': null,
        'draft.lastResult': null,
        updatedAt: serverTimestamp(),
      });
      return;
    }

    // ── Hero is up: resolve when timer expires OR no one can still act ──
    const expired = now >= (draft.currentBid?.deadline ?? 0);
    if (!expired && eligibleBidderExists(match, config)) return;

    const heroId = draft.currentHeroId;
    const hero = match.catalog.heroes[heroId];
    const leader = draft.currentBid?.leaderPlayerId ?? null;
    const amount = draft.currentBid?.amount ?? 0;

    const updates: Record<string, unknown> = {
      'draft.currentHeroId': null,
      'draft.currentBid': null,
      'draft.passedPlayers': [],
      'draft.currentIndex': draft.currentIndex + 1,
      'draft.nextRevealAt': now + REVEAL_GAP_MS,
      'draft.lastResult': {
        heroId,
        heroName: hero?.name ?? 'Hero',
        winnerId: leader,
        amount,
      },
      updatedAt: serverTimestamp(),
    };

    if (leader) {
      const p = match.players[leader];
      updates[`players.${leader}.credits`] = p.credits - amount;
      updates[`players.${leader}.heroIds`] = [...p.heroIds, heroId];
      updates[`catalog.heroes.${heroId}.ownerId`] = leader;
      updates[`catalog.heroes.${heroId}.draftCost`] = amount;
    } else {
      updates['draft.graveyard'] = [...draft.graveyard, heroId];
      updates['shop.graveyardHeroes'] = [...(match.shop?.graveyardHeroes ?? []), heroId];
    }

    tx.update(ref, updates);
  });
}
