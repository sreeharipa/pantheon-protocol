import { doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { db } from './app';
import { getGameConfig } from './matches';
import { statSum } from '../domain/stats';
import type { Faction, GameConfig } from '../domain/types';
import type { ArtifactToken, Match, MatchHero, MatchPlayer, QueuedPurchase, ShopItem, TradeBundle, TradeOffer } from '../domain/match';

const MATCHES = 'matches';
type Players = Record<string, MatchPlayer>;

/** Could anyone still outbid the current shop auction? When false, it resolves immediately. */
export function eligibleShopBidderExists(match: Match, config: GameConfig): boolean {
  const a = match.shop?.activeAuction;
  if (!a) return false;
  const needed = a.amount + Math.min(...config.bidIncrements);
  return Object.values(match.players).some(
    (p) => p.status === 'active' && p.userId !== a.leaderPlayerId && !(a.passedPlayers ?? []).includes(p.userId) && p.credits >= needed,
  );
}

function assertTrading(match: Match, userId: string): void {
  if (match.status !== 'duel' || match.phase.type !== 'trade') throw new Error('The shop is only open in the Trade stage.');
  if (match.players[userId]?.status !== 'active') throw new Error('You are not in this match.');
}

export type PurchaseInput =
  | { itemType: 'artifact'; faction: Faction; levels: number }
  | { itemType: 'hero'; heroId: string };

/** Resolve a purchase request into a concrete shop item (label + listed base price). */
function toShopItem(match: Match, input: PurchaseInput): ShopItem {
  if (input.itemType === 'artifact') {
    const entry = (match.shop?.artifacts ?? []).find((a) => a.faction === input.faction && a.levelsGranted === input.levels);
    if (!entry || entry.remaining <= 0) throw new Error('That artifact is sold out.');
    return { itemType: 'artifact', faction: input.faction, levels: input.levels, label: `${input.faction} +${input.levels}`, basePrice: entry.cost };
  }
  if (!match.shop?.graveyardHeroes.includes(input.heroId)) throw new Error('That hero is no longer in the graveyard.');
  const h = match.catalog.heroes[input.heroId];
  if (!h) throw new Error('Hero missing.');
  return { itemType: 'hero', heroId: input.heroId, label: h.name, basePrice: h.basePrice };
}

/** Start a shop auction at the listed price (or queue it if one is already running, PRD 10.3). */
export async function initiateShopPurchase(matchId: string, userId: string, input: PurchaseInput): Promise<void> {
  const config = await getGameConfig();
  await runTransaction(db(), async (tx) => {
    const ref = doc(db(), MATCHES, matchId);
    const fresh = await tx.get(ref);
    if (!fresh.exists()) throw new Error('Match not found.');
    const match = { ...(fresh.data() as Match), matchId };
    assertTrading(match, userId);
    const item = toShopItem(match, input);
    if (match.players[userId].credits < item.basePrice) throw new Error('Not enough credits to open at the listed price.');

    if (match.shop?.activeAuction) {
      const queued: QueuedPurchase = { ...item, initiatedBy: userId };
      tx.update(ref, { 'shop.auctionQueue': [...(match.shop.auctionQueue ?? []), queued], updatedAt: serverTimestamp() });
    } else {
      tx.update(ref, {
        'shop.activeAuction': {
          ...item,
          auctionId: `sa_${Date.now()}`,
          amount: item.basePrice,
          leaderPlayerId: userId,
          initiatedBy: userId,
          passedPlayers: [],
          deadline: Date.now() + config.negotiationTimeoutSec * 1000,
        },
        updatedAt: serverTimestamp(),
      });
    }
  });
}

/** Outbid the current shop auction (any active player, even those who pressed Ready — PRD 10.3). */
export async function outbidShop(matchId: string, userId: string, increment: number): Promise<void> {
  const config = await getGameConfig();
  await runTransaction(db(), async (tx) => {
    const ref = doc(db(), MATCHES, matchId);
    const fresh = await tx.get(ref);
    if (!fresh.exists()) return;
    const match = { ...(fresh.data() as Match), matchId };
    const a = match.shop?.activeAuction;
    if (!a) throw new Error('No auction is running.');
    if (match.players[userId]?.status !== 'active') throw new Error('You are out.');
    if (a.leaderPlayerId === userId) throw new Error("You're already the top bidder.");
    if (!config.bidIncrements.includes(increment)) throw new Error('Invalid increment.');
    const amount = a.amount + increment;
    if (match.players[userId].credits < amount) throw new Error('Not enough credits.');
    tx.update(ref, {
      'shop.activeAuction.amount': amount,
      'shop.activeAuction.leaderPlayerId': userId,
      'shop.activeAuction.passedPlayers': [], // a new bid reopens the lot for everyone
      'shop.activeAuction.deadline': Date.now() + config.negotiationTimeoutSec * 1000,
      updatedAt: serverTimestamp(),
    });
  });
}

/** Opt out of the current shop lot (like a draft pass) — speeds up resolution. */
export async function passShopAuction(matchId: string, userId: string): Promise<void> {
  await runTransaction(db(), async (tx) => {
    const ref = doc(db(), MATCHES, matchId);
    const fresh = await tx.get(ref);
    if (!fresh.exists()) return;
    const match = { ...(fresh.data() as Match), matchId };
    const a = match.shop?.activeAuction;
    if (!a || match.players[userId]?.status !== 'active' || a.leaderPlayerId === userId) return;
    if ((a.passedPlayers ?? []).includes(userId)) return;
    tx.update(ref, { 'shop.activeAuction.passedPlayers': [...(a.passedPlayers ?? []), userId], updatedAt: serverTimestamp() });
  });
}

/** Client-driven: when the auction window lapses, award the item and start the next queued one. */
export async function progressShop(matchId: string): Promise<void> {
  const config = await getGameConfig();
  await runTransaction(db(), async (tx) => {
    const ref = doc(db(), MATCHES, matchId);
    const fresh = await tx.get(ref);
    if (!fresh.exists()) return;
    const match = { ...(fresh.data() as Match), matchId };
    const a = match.shop?.activeAuction;
    if (!a || !match.shop) return;
    // Resolve when the timer lapses OR nobody can still outbid (PRD 10.3).
    if (Date.now() < a.deadline && eligibleShopBidderExists(match, config)) return;

    const players = structuredClone(match.players) as Players;
    let stock = match.shop.artifacts.map((s) => ({ ...s }));
    let graveyard = [...match.shop.graveyardHeroes];
    const heroUpdates: Record<string, unknown> = {};

    // Award the won item to the highest bidder.
    const winner = players[a.leaderPlayerId];
    if (winner) {
      if (a.itemType === 'artifact') {
        const entry = stock.find((s) => s.faction === a.faction && s.levelsGranted === a.levels);
        if (entry && entry.remaining > 0) {
          entry.remaining -= 1;
          winner.artifacts = [...(winner.artifacts ?? []), { faction: a.faction!, levels: a.levels! } as ArtifactToken];
          winner.credits = Math.max(0, winner.credits - a.amount);
        }
      } else if (a.heroId && graveyard.includes(a.heroId)) {
        graveyard = graveyard.filter((id) => id !== a.heroId); // single instance — won once, then gone
        heroUpdates[`catalog.heroes.${a.heroId}.ownerId`] = a.leaderPlayerId;
        heroUpdates[`catalog.heroes.${a.heroId}.draftCost`] = a.amount;
        winner.heroIds = [...winner.heroIds, a.heroId];
        winner.credits = Math.max(0, winner.credits - a.amount);
      }
    }

    // Pop the next still-valid queued purchase.
    const queue = [...(match.shop.auctionQueue ?? [])];
    let next: typeof a | null = null;
    while (queue.length > 0 && !next) {
      const q = queue.shift()!;
      const avail = q.itemType === 'artifact'
        ? (stock.find((s) => s.faction === q.faction && s.levelsGranted === q.levels)?.remaining ?? 0) > 0
        : graveyard.includes(q.heroId!);
      const initiator = players[q.initiatedBy];
      if (avail && initiator?.status === 'active' && initiator.credits >= q.basePrice) {
        next = {
          ...q,
          auctionId: `sa_${Date.now()}`,
          amount: q.basePrice,
          leaderPlayerId: q.initiatedBy,
          passedPlayers: [],
          deadline: Date.now() + config.negotiationTimeoutSec * 1000,
        };
      }
    }

    const updates: Record<string, unknown> = {
      players,
      ...heroUpdates,
      'shop.artifacts': stock,
      'shop.graveyardHeroes': graveyard,
      'shop.activeAuction': next,
      'shop.auctionQueue': queue,
      updatedAt: serverTimestamp(),
    };

    // No more auctions and everyone's ready → open the Attack stage (PRD 10.3).
    if (!next && queue.length === 0) {
      const aliveActive = Object.values(players).filter((p) => p.status === 'active');
      if (aliveActive.length > 0 && aliveActive.every((p) => p.ready)) {
        for (const p of Object.values(players)) p.ready = false;
        const order = match.phase.turnOrder.filter((pid) => players[pid]?.status === 'active');
        updates.phase = { type: 'attack', round: match.phase.round, turnOrder: order, activePlayer: order[0] ?? null, actedThisRound: [] };
        updates.tradeOffers = [];
      }
    }
    tx.update(ref, updates);
  });
}

/** Apply an owned artifact to one of your heroes, leveling it up (PRD 7.3 / 8.2). */
export async function applyArtifact(matchId: string, userId: string, artifactIndex: number, heroId: string): Promise<void> {
  const config = await getGameConfig();
  await runTransaction(db(), async (tx) => {
    const ref = doc(db(), MATCHES, matchId);
    const fresh = await tx.get(ref);
    if (!fresh.exists()) throw new Error('Match not found.');
    const match = { ...(fresh.data() as Match), matchId };
    assertTrading(match, userId);
    const player = match.players[userId];
    const inventory = [...(player.artifacts ?? [])];
    const token = inventory[artifactIndex];
    if (!token) throw new Error('Artifact not found.');
    const hero = match.catalog.heroes[heroId];
    if (!hero || hero.ownerId !== userId || hero.destroyed) throw new Error('Pick one of your heroes.');
    if (hero.level >= config.levelCap) throw new Error(`${hero.name} is already at max level.`);

    const effective = Math.min(token.levels, config.levelCap - hero.level);
    const pctPerLevel = token.faction === hero.faction ? config.affinity.matchedPctPerLevel : config.affinity.crossPctPerLevel;
    inventory.splice(artifactIndex, 1);

    tx.update(ref, {
      [`players.${userId}.artifacts`]: inventory,
      [`catalog.heroes.${heroId}.level`]: hero.level + effective,
      [`catalog.heroes.${heroId}.bonusPct`]: hero.bonusPct + effective * pctPerLevel,
      [`catalog.heroes.${heroId}.appliedArtifacts`]: [...hero.appliedArtifacts, token],
      updatedAt: serverTimestamp(),
    });
  });
}

/** Sell value: 50% × (draft cost + stat gain × 7), stat gain = artifact-boosted gain only (PRD 16). */
export function heroSellValue(hero: MatchHero, config: { sellValue: { ratio: number; statGainCoeff: number } }): number {
  const statGain = statSum(hero.baseStats) * (hero.bonusPct ?? 0);
  const cost = hero.draftCost ?? hero.basePrice;
  return Math.round(config.sellValue.ratio * (cost + statGain * config.sellValue.statGainCoeff));
}

// ── Player-to-player trades (PRD 10.3) ──

function hasTokens(inv: ArtifactToken[], needed: ArtifactToken[]): boolean {
  const pool = inv.map((t) => ({ ...t }));
  for (const n of needed) {
    const i = pool.findIndex((t) => t.faction === n.faction && t.levels === n.levels);
    if (i < 0) return false;
    pool.splice(i, 1);
  }
  return true;
}

function removeTokens(inv: ArtifactToken[], toRemove: ArtifactToken[]): ArtifactToken[] {
  const pool = inv.map((t) => ({ ...t }));
  for (const n of toRemove) {
    const i = pool.findIndex((t) => t.faction === n.faction && t.levels === n.levels);
    if (i >= 0) pool.splice(i, 1);
  }
  return pool;
}

function ownsHeroes(match: Match, ownerId: string, heroIds: string[]): boolean {
  return heroIds.every((id) => {
    const h = match.catalog.heroes[id];
    return h && h.ownerId === ownerId && !h.destroyed;
  });
}

/** Propose a trade to another player (Trade stage, PRD 10.3). */
export async function proposeTrade(matchId: string, fromId: string, toId: string, give: TradeBundle, want: TradeBundle): Promise<void> {
  await runTransaction(db(), async (tx) => {
    const ref = doc(db(), MATCHES, matchId);
    const fresh = await tx.get(ref);
    if (!fresh.exists()) throw new Error('Match not found.');
    const match = { ...(fresh.data() as Match), matchId };
    assertTrading(match, fromId);
    if (toId === fromId || match.players[toId]?.status !== 'active') throw new Error('Invalid trade partner.');
    const from = match.players[fromId];
    if (give.credits < 0 || want.credits < 0) throw new Error('Credits cannot be negative.');
    if (from.credits < give.credits) throw new Error('Not enough credits to offer.');
    if (!ownsHeroes(match, fromId, give.heroIds)) throw new Error('You no longer own a hero in the offer.');
    if (!hasTokens(from.artifacts ?? [], give.artifacts)) throw new Error('You no longer have those artifacts.');
    if (!ownsHeroes(match, toId, want.heroIds)) throw new Error('Requested hero is unavailable.');
    if (give.heroIds.length + give.artifacts.length + give.credits === 0 && want.heroIds.length + want.artifacts.length + want.credits === 0) {
      throw new Error('An empty trade does nothing.');
    }

    const offer: TradeOffer = { offerId: `t_${Date.now()}`, fromPlayerId: fromId, toPlayerId: toId, give, want, createdAt: Date.now() };
    tx.update(ref, { tradeOffers: [...(match.tradeOffers ?? []), offer], updatedAt: serverTimestamp() });
  });
}

/** Recipient accepts (executes the swap, both must agree) or rejects a trade. */
export async function respondTrade(matchId: string, responderId: string, offerId: string, accept: boolean): Promise<void> {
  await runTransaction(db(), async (tx) => {
    const ref = doc(db(), MATCHES, matchId);
    const fresh = await tx.get(ref);
    if (!fresh.exists()) return;
    const match = { ...(fresh.data() as Match), matchId };
    const offers = match.tradeOffers ?? [];
    const offer = offers.find((o) => o.offerId === offerId);
    if (!offer) return;
    if (responderId !== offer.toPlayerId) throw new Error('Not your offer to answer.');
    const remaining = offers.filter((o) => o.offerId !== offerId);

    if (!accept) {
      tx.update(ref, { tradeOffers: remaining, updatedAt: serverTimestamp() });
      return;
    }

    assertTrading(match, responderId);
    const players = structuredClone(match.players) as Players;
    const from = players[offer.fromPlayerId];
    const to = players[offer.toPlayerId];
    if (!from || !to || from.status !== 'active' || to.status !== 'active') throw new Error('A player is unavailable.');

    // Re-validate both sides at execution (the offer may be stale).
    if (!ownsHeroes(match, offer.fromPlayerId, offer.give.heroIds)) throw new Error('Offer is stale — a hero changed hands.');
    if (!ownsHeroes(match, offer.toPlayerId, offer.want.heroIds)) throw new Error('Offer is stale — a hero changed hands.');
    if (from.credits < offer.give.credits) throw new Error('Proposer no longer has the credits.');
    if (to.credits < offer.want.credits) throw new Error('You lack the requested credits.');
    if (!hasTokens(from.artifacts ?? [], offer.give.artifacts)) throw new Error('Proposer lacks the artifacts.');
    if (!hasTokens(to.artifacts ?? [], offer.want.artifacts)) throw new Error('You lack the requested artifacts.');

    const heroUpdates: Record<string, unknown> = {};
    for (const id of offer.give.heroIds) heroUpdates[`catalog.heroes.${id}.ownerId`] = offer.toPlayerId;
    for (const id of offer.want.heroIds) heroUpdates[`catalog.heroes.${id}.ownerId`] = offer.fromPlayerId;

    from.heroIds = [...from.heroIds.filter((id) => !offer.give.heroIds.includes(id)), ...offer.want.heroIds];
    to.heroIds = [...to.heroIds.filter((id) => !offer.want.heroIds.includes(id)), ...offer.give.heroIds];
    from.artifacts = [...removeTokens(from.artifacts ?? [], offer.give.artifacts), ...offer.want.artifacts];
    to.artifacts = [...removeTokens(to.artifacts ?? [], offer.want.artifacts), ...offer.give.artifacts];
    from.credits = from.credits - offer.give.credits + offer.want.credits;
    to.credits = to.credits - offer.want.credits + offer.give.credits;

    tx.update(ref, { players, ...heroUpdates, tradeOffers: remaining, updatedAt: serverTimestamp() });
  });
}

/** Proposer withdraws their pending trade offer. */
export async function cancelTrade(matchId: string, fromId: string, offerId: string): Promise<void> {
  await runTransaction(db(), async (tx) => {
    const ref = doc(db(), MATCHES, matchId);
    const fresh = await tx.get(ref);
    if (!fresh.exists()) return;
    const match = { ...(fresh.data() as Match), matchId };
    const offers = match.tradeOffers ?? [];
    const offer = offers.find((o) => o.offerId === offerId);
    if (!offer || offer.fromPlayerId !== fromId) return;
    tx.update(ref, { tradeOffers: offers.filter((o) => o.offerId !== offerId), updatedAt: serverTimestamp() });
  });
}

/** Sell one of your heroes for credits (Trade stage only, PRD 16). */
export async function sellHero(matchId: string, userId: string, heroId: string): Promise<void> {
  const config = await getGameConfig();
  await runTransaction(db(), async (tx) => {
    const ref = doc(db(), MATCHES, matchId);
    const fresh = await tx.get(ref);
    if (!fresh.exists()) throw new Error('Match not found.');
    const match = { ...(fresh.data() as Match), matchId };
    assertTrading(match, userId);
    const player = match.players[userId];
    const hero = match.catalog.heroes[heroId];
    if (!hero || hero.ownerId !== userId || hero.destroyed) throw new Error('Pick one of your heroes.');
    if (player.heroIds.length <= 1) throw new Error("You can't sell your last hero.");

    const value = heroSellValue(hero, config);
    tx.update(ref, {
      [`players.${userId}.credits`]: player.credits + value,
      [`players.${userId}.heroIds`]: player.heroIds.filter((id) => id !== heroId),
      [`catalog.heroes.${heroId}.ownerId`]: null,
      [`catalog.heroes.${heroId}.destroyed`]: true,
      updatedAt: serverTimestamp(),
    });
  });
}
