import { doc, runTransaction, serverTimestamp, type Transaction, type DocumentReference } from 'firebase/firestore';
import { db } from './app';
import { getGameConfig } from './matches';
import { FACTION_MODES, type GameConfig, type ResMode } from '../domain/types';
import type { BattleSide, BattleSummary, Match, MatchPlayer } from '../domain/match';
import {
  attackSideTotal,
  defenseSideTotals,
  derivedStats,
  outcomeFor,
  rotateTurnOrder,
  shiftedStats,
} from '../domain/battleLogic';

const MATCHES = 'matches';

type Players = Record<string, MatchPlayer>;

function activeWithHeroes(players: Players): MatchPlayer[] {
  return Object.values(players).filter((p) => p.status === 'active');
}

function applyEliminations(players: Players): string | null {
  for (const p of Object.values(players)) {
    if (p.status === 'active' && p.heroIds.length === 0) p.status = 'eliminated';
  }
  const alive = activeWithHeroes(players);
  return alive.length <= 1 ? (alive[0]?.userId ?? null) : null;
}

function advanceAfterAction(match: Match, players: Players, actorId: string): Record<string, unknown> {
  const phase = match.phase;
  const acted = [...(phase.actedThisRound ?? []), actorId];
  const next = phase.turnOrder.find((pid) => players[pid]?.status === 'active' && !acted.includes(pid));
  if (next) return { 'phase.actedThisRound': acted, 'phase.activePlayer': next };
  const newOrder = rotateTurnOrder(phase.turnOrder).filter((pid) => players[pid]?.status === 'active');
  for (const p of Object.values(players)) p.ready = false;
  return {
    phase: { type: 'trade', round: phase.round + 1, turnOrder: newOrder, activePlayer: newOrder[0] ?? null, actedThisRound: [] },
  };
}

export async function setReady(matchId: string, userId: string, ready: boolean): Promise<void> {
  await runTransaction(db(), async (tx) => {
    const ref = doc(db(), MATCHES, matchId);
    const fresh = await tx.get(ref);
    if (!fresh.exists()) return;
    const match = { ...(fresh.data() as Match), matchId };
    if (match.status !== 'duel' || match.phase.type !== 'trade') return;
    const players = structuredClone(match.players) as Players;
    if (!players[userId] || players[userId].status !== 'active') return;
    players[userId].ready = ready;

    const auctionRunning = !!match.shop?.activeAuction || (match.shop?.auctionQueue?.length ?? 0) > 0;
    if (!auctionRunning && activeWithHeroes(players).every((p) => p.ready)) {
      for (const p of Object.values(players)) p.ready = false;
      const order = match.phase.turnOrder.filter((pid) => players[pid]?.status === 'active');
      tx.update(ref, {
        players,
        phase: { type: 'attack', round: match.phase.round, turnOrder: order, activePlayer: order[0] ?? null, actedThisRound: [] },
        tradeOffers: [],
        updatedAt: serverTimestamp(),
      });
    } else {
      tx.update(ref, { [`players.${userId}.ready`]: ready, updatedAt: serverTimestamp() });
    }
  });
}

export async function passTurn(matchId: string, userId: string): Promise<void> {
  await runTransaction(db(), async (tx) => {
    const ref = doc(db(), MATCHES, matchId);
    const fresh = await tx.get(ref);
    if (!fresh.exists()) return;
    const match = { ...(fresh.data() as Match), matchId };
    if (match.status !== 'duel' || match.phase.type !== 'attack' || match.phase.activePlayer !== userId) return;
    if (match.battle) return;
    const players = structuredClone(match.players) as Players;
    tx.update(ref, { players, ...advanceAfterAction(match, players, userId), updatedAt: serverTimestamp() });
  });
}

export interface AttackDeclaration {
  targetOwnerId: string;
  targetHeroId: string;
  attackerHeroId: string;
  attackerMode: ResMode;
}

export async function declareAttack(matchId: string, attackerId: string, d: AttackDeclaration): Promise<void> {
  const config = await getGameConfig();
  await runTransaction(db(), async (tx) => {
    const ref = doc(db(), MATCHES, matchId);
    const fresh = await tx.get(ref);
    if (!fresh.exists()) throw new Error('Match not found.');
    const match = { ...(fresh.data() as Match), matchId };
    if (match.status !== 'duel' || match.phase.type !== 'attack') throw new Error('Not the attack stage.');
    if (match.phase.activePlayer !== attackerId) throw new Error("It's not your turn.");
    if (match.battle) throw new Error('A battle is already in progress.');

    const atkHero = match.catalog.heroes[d.attackerHeroId];
    const tgtHero = match.catalog.heroes[d.targetHeroId];
    if (!atkHero || atkHero.ownerId !== attackerId || atkHero.destroyed) throw new Error('Pick one of your heroes.');
    if (d.targetOwnerId === attackerId) throw new Error('You cannot attack yourself.');
    if (!tgtHero || tgtHero.ownerId !== d.targetOwnerId || tgtHero.destroyed) throw new Error('Invalid target.');
    if (match.players[d.targetOwnerId]?.status !== 'active') throw new Error('That player is out.');
    if (!FACTION_MODES[atkHero.faction].includes(d.attackerMode)) throw new Error('Mode not allowed for this hero.');

    const attackTotal = shiftedStats(match, atkHero, d.attackerMode, config).attack;
    const minDefense = derivedStats(match, tgtHero, config).defense;
    if (attackTotal <= minDefense) {
      throw new Error(`Your attack (${Math.round(attackTotal)}) can't break ${tgtHero.name}'s defense (${Math.round(minDefense)}).`);
    }

    tx.update(ref, {
      battle: {
        battleId: `b_${Date.now()}`,
        status: 'negotiating',
        attackerId,
        targetOwnerId: d.targetOwnerId,
        targetHeroId: d.targetHeroId,
        attackSide: [{ playerId: attackerId, matchHeroId: d.attackerHeroId, mode: d.attackerMode }],
        defenseSide: [{ playerId: d.targetOwnerId, matchHeroId: d.targetHeroId, mode: 'noShift' }],
        offers: [],
        deals: [],
        turn: 'defense', // defender responds first (PRD 11.2)
        dirty: false,
        deadline: Date.now() + (config.attackTimeoutSec ?? 60) * 1000,
        result: null,
      },
      updatedAt: serverTimestamp(),
    });
  });
}

/** Change the resilience mode of one of your committed heroes. Resets the pass state. */
export async function setBattleHeroMode(matchId: string, playerId: string, matchHeroId: string, mode: ResMode): Promise<void> {
  const config = await getGameConfig();
  await runTransaction(db(), async (tx) => {
    const ref = doc(db(), MATCHES, matchId);
    const fresh = await tx.get(ref);
    if (!fresh.exists()) return;
    const match = { ...(fresh.data() as Match), matchId };
    const battle = match.battle;
    if (!battle || battle.status !== 'negotiating') return;
    // Only the principal whose turn it is may adjust their heroes.
    const myTurn = (battle.turn === 'attack' && playerId === battle.attackerId) || (battle.turn === 'defense' && playerId === battle.targetOwnerId);
    if (!myTurn) throw new Error("It's not your turn.");
    const hero = match.catalog.heroes[matchHeroId];
    if (!hero || !FACTION_MODES[hero.faction].includes(mode)) throw new Error('Mode not allowed.');
    const swap = (arr: typeof battle.attackSide) =>
      arr.map((e) => (e.matchHeroId === matchHeroId && e.playerId === playerId ? { ...e, mode } : e));
    tx.update(ref, {
      'battle.attackSide': swap(battle.attackSide),
      'battle.defenseSide': swap(battle.defenseSide),
      'battle.dirty': true,
      'battle.deadline': Date.now() + (config.attackTimeoutSec ?? 60) * 1000,
      updatedAt: serverTimestamp(),
    });
  });
}

/** Add one of your own heroes to a side. Defender adds are gated by attacker escalation (PRD 12.2). */
export async function addBattleHero(matchId: string, playerId: string, side: BattleSide, matchHeroId: string, mode: ResMode): Promise<void> {
  const config = await getGameConfig();
  await runTransaction(db(), async (tx) => {
    const ref = doc(db(), MATCHES, matchId);
    const fresh = await tx.get(ref);
    if (!fresh.exists()) throw new Error('Match not found.');
    const match = { ...(fresh.data() as Match), matchId };
    const battle = match.battle;
    if (!battle || battle.status !== 'negotiating') throw new Error('No active battle.');
    // Turn-based, defender-first: you add to your own side, only on your turn (PRD 11.2/12.3).
    if (side === 'attack' && playerId !== battle.attackerId) throw new Error('Recruiting allies comes in the next update.');
    if (side === 'defense' && playerId !== battle.targetOwnerId) throw new Error('Recruiting allies comes in the next update.');
    if (battle.turn !== side) throw new Error("It's not your turn to add a hero.");
    const hero = match.catalog.heroes[matchHeroId];
    if (!hero || hero.ownerId !== playerId || hero.destroyed) throw new Error('Pick one of your heroes.');
    if ([...battle.attackSide, ...battle.defenseSide].some((e) => e.matchHeroId === matchHeroId)) {
      throw new Error('That hero is already in the battle.');
    }
    if (!FACTION_MODES[hero.faction].includes(mode)) throw new Error('Mode not allowed.');

    const key = side === 'attack' ? 'battle.attackSide' : 'battle.defenseSide';
    const arr = side === 'attack' ? battle.attackSide : battle.defenseSide;
    // Stay on the same turn — the player keeps editing and ends their turn explicitly.
    tx.update(ref, {
      [key]: [...arr, { playerId, matchHeroId, mode }],
      'battle.dirty': true,
      'battle.deadline': Date.now() + (config.attackTimeoutSec ?? 60) * 1000,
      updatedAt: serverTimestamp(),
    });
  });
}

/** Remove a hero you added this battle (not the targeted hero or the declaring attacker). */
export async function removeBattleHero(matchId: string, playerId: string, matchHeroId: string): Promise<void> {
  const config = await getGameConfig();
  await runTransaction(db(), async (tx) => {
    const ref = doc(db(), MATCHES, matchId);
    const fresh = await tx.get(ref);
    if (!fresh.exists()) return;
    const match = { ...(fresh.data() as Match), matchId };
    const battle = match.battle;
    if (!battle || battle.status !== 'negotiating') return;
    const myTurn = (battle.turn === 'attack' && playerId === battle.attackerId) || (battle.turn === 'defense' && playerId === battle.targetOwnerId);
    if (!myTurn) throw new Error("It's not your turn.");
    if (matchHeroId === battle.targetHeroId) throw new Error('Cannot remove the targeted hero.');
    if (matchHeroId === battle.attackSide[0]?.matchHeroId) throw new Error('Cannot remove the declaring hero.');
    const drop = (arr: typeof battle.attackSide) => arr.filter((e) => !(e.matchHeroId === matchHeroId && e.playerId === playerId));
    tx.update(ref, {
      'battle.attackSide': drop(battle.attackSide),
      'battle.defenseSide': drop(battle.defenseSide),
      'battle.dirty': true,
      'battle.deadline': Date.now() + (config.attackTimeoutSec ?? 60) * 1000,
      updatedAt: serverTimestamp(),
    });
  });
}

/** Resolve the battle within an existing transaction (PRD 11.3 / 12.6). */
function applyResolution(tx: Transaction, ref: DocumentReference, match: Match, config: GameConfig): void {
  const battle = match.battle!;
  const target = match.catalog.heroes[battle.targetHeroId];
  if (!target) {
    tx.update(ref, { battle: null, updatedAt: serverTimestamp() });
    return;
  }
  const attackTotal = attackSideTotal(match, battle.attackSide, config);
  const { defense, remainingRes } = defenseSideTotals(match, battle.defenseSide, config);
  const outcome = outcomeFor(attackTotal, defense, remainingRes);
  const reward = outcome === 'destroy' ? Math.round((target.draftCost ?? 0) * config.battleDestroyRewardPct) : 0;

  const players = structuredClone(match.players) as Players;
  const heroUpdates: Record<string, unknown> = {};

  // Supporting heroes only contributed stats — only the primary target changes hands (PRD 12.6).
  if (outcome === 'capture') {
    players[battle.targetOwnerId].heroIds = players[battle.targetOwnerId].heroIds.filter((id) => id !== battle.targetHeroId);
    players[battle.attackerId].heroIds = [...players[battle.attackerId].heroIds, battle.targetHeroId];
    heroUpdates[`catalog.heroes.${battle.targetHeroId}.ownerId`] = battle.attackerId;
  } else if (outcome === 'destroy') {
    players[battle.targetOwnerId].heroIds = players[battle.targetOwnerId].heroIds.filter((id) => id !== battle.targetHeroId);
    players[battle.attackerId].credits += reward;
    heroUpdates[`catalog.heroes.${battle.targetHeroId}.ownerId`] = null;
    heroUpdates[`catalog.heroes.${battle.targetHeroId}.destroyed`] = true;
  }

  const summary: BattleSummary = {
    outcome,
    attackerId: battle.attackerId,
    attackerHeroName: match.catalog.heroes[battle.attackSide[0]?.matchHeroId]?.name ?? 'Attacker',
    targetOwnerId: battle.targetOwnerId,
    targetHeroName: target.name,
    reward,
    at: Date.now(),
  };

  const winner = applyEliminations(players);
  if (winner) {
    tx.update(ref, { players, ...heroUpdates, battle: null, lastBattle: summary, status: 'completed', winner, updatedAt: serverTimestamp() });
    return;
  }
  tx.update(ref, { players, ...heroUpdates, battle: null, lastBattle: summary, ...advanceAfterAction(match, players, battle.attackerId), updatedAt: serverTimestamp() });
}

/** Defender finishes their turn and hands control to the attacker. */
export async function defenderEndTurn(matchId: string, defenderId: string): Promise<void> {
  const config = await getGameConfig();
  await runTransaction(db(), async (tx) => {
    const ref = doc(db(), MATCHES, matchId);
    const fresh = await tx.get(ref);
    if (!fresh.exists()) return;
    const match = { ...(fresh.data() as Match), matchId };
    const battle = match.battle;
    if (!battle || battle.status !== 'negotiating' || battle.turn !== 'defense' || defenderId !== battle.targetOwnerId) return;
    tx.update(ref, {
      'battle.turn': 'attack',
      'battle.dirty': false,
      'battle.deadline': Date.now() + (config.attackTimeoutSec ?? 60) * 1000,
      updatedAt: serverTimestamp(),
    });
  });
}

/**
 * Attacker finishes their turn. If they escalated this turn, control passes to the
 * defender to respond; otherwise (resolve = true) the battle resolves now.
 */
export async function attackerEndTurn(matchId: string, attackerId: string, resolve: boolean): Promise<void> {
  const config = await getGameConfig();
  await runTransaction(db(), async (tx) => {
    const ref = doc(db(), MATCHES, matchId);
    const fresh = await tx.get(ref);
    if (!fresh.exists()) return;
    const match = { ...(fresh.data() as Match), matchId };
    const battle = match.battle;
    if (!battle || battle.status !== 'negotiating' || battle.turn !== 'attack' || attackerId !== battle.attackerId) return;
    if (resolve && !battle.dirty) {
      applyResolution(tx, ref, match, config);
    } else {
      // Escalated → let the defender respond.
      tx.update(ref, {
        'battle.turn': 'defense',
        'battle.dirty': false,
        'battle.deadline': Date.now() + (config.attackTimeoutSec ?? 60) * 1000,
        updatedAt: serverTimestamp(),
      });
    }
  });
}

/** Client-driven housekeeping: resolve a battle whose negotiation window has elapsed. */
export async function progressDuel(matchId: string): Promise<void> {
  const config = await getGameConfig();
  await runTransaction(db(), async (tx) => {
    const ref = doc(db(), MATCHES, matchId);
    const fresh = await tx.get(ref);
    if (!fresh.exists()) return;
    const match = { ...(fresh.data() as Match), matchId };
    const battle = match.battle;
    if (!battle || battle.status !== 'negotiating' || Date.now() < battle.deadline) return;
    applyResolution(tx, ref, match, config);
  });
}

/** Forfeit an in-progress match. */
export async function quitMatch(matchId: string, userId: string): Promise<void> {
  const config = await getGameConfig();
  await runTransaction(db(), async (tx) => {
    const ref = doc(db(), MATCHES, matchId);
    const fresh = await tx.get(ref);
    if (!fresh.exists()) return;
    const match = { ...(fresh.data() as Match), matchId };
    if (match.status === 'lobby' || match.status === 'completed') return;
    const players = structuredClone(match.players) as Players;
    if (!players[userId]) return;

    const updates: Record<string, unknown> = { updatedAt: serverTimestamp() };
    for (const h of Object.values(match.catalog.heroes)) {
      if (h.ownerId === userId && !h.destroyed) {
        updates[`catalog.heroes.${h.matchHeroId}.ownerId`] = null;
        updates[`catalog.heroes.${h.matchHeroId}.destroyed`] = true;
      }
    }
    players[userId].heroIds = [];
    players[userId].status = 'eliminated';

    if (match.battle && (match.battle.attackerId === userId || match.battle.targetOwnerId === userId)) {
      updates.battle = null;
    }
    if (match.status === 'draft' && match.draft?.currentHeroId && match.draft.currentBid?.leaderPlayerId === userId) {
      const basePrice = match.catalog.heroes[match.draft.currentHeroId]?.basePrice ?? 0;
      updates['draft.currentBid'] = { amount: basePrice, leaderPlayerId: null, deadline: Date.now() + config.negotiationTimeoutSec * 1000 };
    }

    const alive = Object.values(players).filter((p) => p.status === 'active');
    updates.players = players;

    if (alive.length <= 1) {
      updates.status = 'completed';
      updates.winner = alive[0]?.userId ?? null;
      updates.battle = null;
      tx.update(ref, updates);
      return;
    }
    if (match.status === 'duel' && match.phase.type === 'attack' && !match.battle && match.phase.activePlayer === userId) {
      Object.assign(updates, advanceAfterAction(match, players, userId));
    } else if (match.status === 'duel' && match.phase.type === 'trade' && alive.every((p) => p.ready)) {
      for (const p of Object.values(players)) p.ready = false;
      const order = match.phase.turnOrder.filter((pid) => players[pid]?.status === 'active');
      updates.phase = { type: 'attack', round: match.phase.round, turnOrder: order, activePlayer: order[0] ?? null, actedThisRound: [] };
    }
    tx.update(ref, updates);
  });
}
