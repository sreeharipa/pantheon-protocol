import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from './app';
import { getActiveHeroes } from './catalog';
import { DEFAULT_GAME_CONFIG } from '../domain/config';
import type { GameConfig } from '../domain/types';
import type { Match, MatchPlayer } from '../domain/match';
import { MIN_PLAYERS } from '../domain/match';
import {
  buildMatchHeroes,
  generateShopArtifacts,
  initialTurnOrder,
  randomRoomCode,
} from '../domain/matchSetup';

const MATCHES = 'matches';

/** Read tunable config, falling back to in-code defaults if not yet seeded. */
export async function getGameConfig(): Promise<GameConfig> {
  const snap = await getDoc(doc(db(), 'gameConfig', 'current'));
  return snap.exists() ? (snap.data() as GameConfig) : DEFAULT_GAME_CONFIG;
}

function newPlayer(user: User, seat: number): MatchPlayer {
  return {
    userId: user.uid,
    displayName: user.displayName ?? 'Player',
    photoURL: user.photoURL ?? null,
    credits: 0,
    seat,
    status: 'active',
    doneDrafting: false,
    ready: false,
    heroIds: [],
    artifacts: [],
  };
}

async function generateUniqueRoomCode(): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = randomRoomCode();
    const snap = await getDocs(
      query(collection(db(), MATCHES), where('roomCode', '==', code), limit(1)),
    );
    if (snap.empty) return code;
  }
  return `PNTH-${Date.now().toString(36).slice(-4).toUpperCase()}`;
}

/** Create a lobby match with the caller as host + first player. */
export async function createMatch(user: User): Promise<{ matchId: string; roomCode: string }> {
  const config = await getGameConfig();
  const roomCode = await generateUniqueRoomCode();
  const data = {
    status: 'lobby',
    roomCode,
    creatorId: user.uid,
    maxPlayers: config.maxPlayers,
    phase: { type: 'draft', round: 0, activePlayer: null, turnOrder: [] },
    players: { [user.uid]: newPlayer(user, 0) },
    catalog: { heroes: {} },
    draft: null,
    shop: null,
    battle: null,
    tradeOffers: [],
    winner: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  const ref = await addDoc(collection(db(), MATCHES), data);
  return { matchId: ref.id, roomCode };
}

/** Join an open lobby by room code. Returns the matchId. */
export async function joinMatch(roomCodeInput: string, user: User): Promise<string> {
  const roomCode = roomCodeInput.trim().toUpperCase();
  const snap = await getDocs(
    query(collection(db(), MATCHES), where('roomCode', '==', roomCode), limit(5)),
  );
  const lobby = snap.docs.find((d) => (d.data() as Match).status === 'lobby');
  if (!lobby) throw new Error('No open lobby found for that code.');
  const matchId = lobby.id;

  await runTransaction(db(), async (tx) => {
    const ref = doc(db(), MATCHES, matchId);
    const fresh = await tx.get(ref);
    if (!fresh.exists()) throw new Error('That match no longer exists.');
    const data = fresh.data() as Match;
    if (data.status !== 'lobby') throw new Error('That match has already started.');
    if (data.players[user.uid]) return; // already in — idempotent
    const count = Object.keys(data.players).length;
    if (count >= data.maxPlayers) throw new Error('That lobby is full.');
    tx.update(ref, {
      [`players.${user.uid}`]: newPlayer(user, count),
      updatedAt: serverTimestamp(),
    });
  });
  return matchId;
}

/** Leave a lobby. Transfers host if needed; deletes the match if the last player leaves. */
export async function leaveMatch(matchId: string, userId: string): Promise<void> {
  await runTransaction(db(), async (tx) => {
    const ref = doc(db(), MATCHES, matchId);
    const fresh = await tx.get(ref);
    if (!fresh.exists()) return;
    const data = fresh.data() as Match;
    if (data.status !== 'lobby') return; // mid-game leave handled in a later milestone

    const players = { ...data.players };
    delete players[userId];
    const remaining = Object.keys(players);
    if (remaining.length === 0) {
      tx.delete(ref);
      return;
    }
    // Re-pack seats so they stay contiguous.
    remaining
      .sort((a, b) => players[a].seat - players[b].seat)
      .forEach((pid, i) => (players[pid] = { ...players[pid], seat: i }));
    const creatorId = data.creatorId === userId ? remaining[0] : data.creatorId;
    tx.update(ref, { players, creatorId, updatedAt: serverTimestamp() });
  });
}

/**
 * Host starts the match: snapshot the catalog, generate shop stock, shuffle the deck,
 * set turn order + budgets, and transition to the draft phase (data_model §8).
 */
export async function startMatch(matchId: string, userId: string): Promise<void> {
  const config = await getGameConfig();
  const heroes = await getActiveHeroes();
  if (heroes.length === 0) {
    throw new Error('No active heroes in the catalog — seed heroes in Admin first.');
  }

  await runTransaction(db(), async (tx) => {
    const ref = doc(db(), MATCHES, matchId);
    const fresh = await tx.get(ref);
    if (!fresh.exists()) throw new Error('Match not found.');
    const data = fresh.data() as Match;
    if (data.creatorId !== userId) throw new Error('Only the host can start the match.');
    if (data.status !== 'lobby') throw new Error('Match has already started.');

    const playerIds = Object.keys(data.players);
    if (playerIds.length < MIN_PLAYERS) {
      throw new Error(`Need at least ${MIN_PLAYERS} players to start.`);
    }

    const { catalogHeroes, deckOrder } = buildMatchHeroes(heroes, playerIds.length);
    const shopArtifacts = generateShopArtifacts(config, playerIds.length);
    const turnOrder = initialTurnOrder(playerIds);

    const players = { ...data.players };
    for (const pid of playerIds) {
      players[pid] = { ...players[pid], credits: config.startingBudget };
    }

    tx.update(ref, {
      status: 'draft',
      phase: { type: 'draft', round: 0, activePlayer: turnOrder[0], turnOrder },
      players,
      'catalog.heroes': catalogHeroes,
      draft: {
        masterDeckOrder: deckOrder,
        currentIndex: 0,
        currentHeroId: null,
        currentBid: null,
        passedPlayers: [],
        graveyard: [],
      },
      shop: {
        artifacts: shopArtifacts,
        graveyardHeroes: [],
        activeAuction: null,
        auctionQueue: [],
      },
      updatedAt: serverTimestamp(),
    });
  });
}

export function subscribeMatch(matchId: string, cb: (m: Match | null) => void): () => void {
  return onSnapshot(doc(db(), MATCHES, matchId), (snap) => {
    cb(snap.exists() ? ({ ...(snap.data() as Match), matchId: snap.id }) : null);
  });
}

/** Host-only: discard a lobby outright. */
export async function deleteMatch(matchId: string): Promise<void> {
  await deleteDoc(doc(db(), MATCHES, matchId));
}
