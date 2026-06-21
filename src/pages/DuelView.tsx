import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getGameConfig } from '../firebase/matches';
import { addBattleHero, attackerEndTurn, declareAttack, defenderEndTurn, passTurn, progressDuel, quitMatch, removeBattleHero, setBattleHeroMode, setReady } from '../firebase/duel';
import { applyArtifact, cancelTrade, eligibleShopBidderExists, heroSellValue, initiateShopPurchase, outbidShop, passShopAuction, progressShop, proposeTrade, respondTrade, sellHero } from '../firebase/trade';
import { attackSideTotal, defenseSideTotals, derivedStats, livingHeroes, outcomeFor, shiftedStats } from '../domain/battleLogic';
import { secondsRemaining } from '../domain/draftLogic';
import { FACTIONS, FACTION_MODES, RES_MODES, type GameConfig, type ResMode } from '../domain/types';
import type { ArtifactToken, BattleSide, Match, MatchHero, TradeBundle } from '../domain/match';
import { FactionMark } from '../components/FactionMark';

function useNow(ms = 250): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(id); }, [ms]);
  return now;
}

function r(n: number): number { return Math.round(n); }

export default function DuelView({ match, myId }: { match: Match; myId: string }) {
  const nav = useNavigate();
  const now = useNow();
  const [config, setConfig] = useState<GameConfig | null>(null);
  const matchRef = useRef(match); matchRef.current = match;
  const myIdRef = useRef(myId); myIdRef.current = myId;
  const configRef = useRef(config); configRef.current = config;
  const driverBusy = useRef(false);
  const shopBusy = useRef(false);

  useEffect(() => { getGameConfig().then(setConfig).catch(() => undefined); }, []);

  // Negotiation-timeout driver (every client; seat-staggered; idempotent server-side).
  useEffect(() => {
    const tick = async () => {
      if (driverBusy.current) return;
      const m = matchRef.current;
      const b = m?.battle;
      if (!m || m.status !== 'duel' || !b || b.status !== 'negotiating' || Date.now() < b.deadline) return;
      driverBusy.current = true;
      const seat = m.players[myIdRef.current]?.seat ?? 9;
      try {
        if (seat > 0) await new Promise((res) => setTimeout(res, 700 + seat * 500));
        if (matchRef.current?.battle?.status === 'negotiating') await progressDuel(m.matchId);
      } catch { /* handled elsewhere */ } finally { driverBusy.current = false; }
    };
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // Shop-auction timeout driver (every client; seat-staggered; idempotent server-side).
  useEffect(() => {
    const tick = async () => {
      if (shopBusy.current) return;
      const m = matchRef.current;
      const cfg = configRef.current;
      const a = m?.shop?.activeAuction;
      if (!m || m.status !== 'duel' || !a) return;
      // Resolve on timeout OR once nobody can outbid (driven client-side, idempotent server-side).
      if (Date.now() < a.deadline && (!cfg || eligibleShopBidderExists(m, cfg))) return;
      shopBusy.current = true;
      const seat = m.players[myIdRef.current]?.seat ?? 9;
      try {
        if (seat > 0) await new Promise((res) => setTimeout(res, 700 + seat * 500));
        if (matchRef.current?.shop?.activeAuction) await progressShop(m.matchId);
      } catch { /* handled elsewhere */ } finally { shopBusy.current = false; }
    };
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const players = Object.values(match.players).sort((a, b) => a.seat - b.seat);

  if (match.status === 'completed') {
    const winner = match.winner ? match.players[match.winner] : null;
    return (
      <div className="screen win-screen">
        <div className="win-trophy">🏆</div>
        <div className="h1">{winner ? `${winner.displayName} wins!` : 'Match over'}</div>
        <div className="muted" style={{ fontSize: 14 }}>Last pantheon standing.</div>
        <div className="stack" style={{ gap: 6, width: '100%', marginTop: 10 }}>
          {players.map((p) => (
            <div key={p.userId} className="between" style={{ fontSize: 14 }}>
              <span>{p.displayName}{p.userId === myId ? ' (you)' : ''}</span>
              <span className="faint">{p.status === 'eliminated' ? 'eliminated' : `${p.heroIds.length} heroes · ${p.credits} cr`}</span>
            </div>
          ))}
        </div>
        <button className="btn" style={{ marginTop: 14 }} onClick={() => nav('/')}>Back home</button>
      </div>
    );
  }

  const me = match.players[myId];
  const banner = match.lastBattle && now - match.lastBattle.at < 6000 ? match.lastBattle : null;

  return (
    <div className="screen" style={{ gap: 14 }}>
      <div className="between">
        <div className="eyebrow">Duel · {match.roomCode}</div>
        <div className="row" style={{ gap: 10 }}>
          <span className="faint" style={{ fontSize: 12 }}>Round {match.phase.round} · {match.phase.type}</span>
          <button
            className="btn ghost sm"
            onClick={async () => { if (confirm('Leave the match? You forfeit and your heroes are removed.')) { try { await quitMatch(match.matchId, myId); } catch { /* ignore */ } nav('/'); } }}
          >Leave</button>
        </div>
      </div>

      {banner && (
        <div className="result-banner">
          <span className={`outcome-pill ${banner.outcome}`}>{banner.outcome}</span>
          <div style={{ fontSize: 13, marginTop: 4 }}>
            {match.players[banner.attackerId]?.displayName}'s attack on {match.players[banner.targetOwnerId]?.displayName}'s{' '}
            <b>{banner.targetHeroName}</b>
            {banner.outcome === 'capture' && ' → captured!'}
            {banner.outcome === 'destroy' && ` → destroyed (+${banner.reward} cr)`}
            {banner.outcome === 'fail' && ' → attack failed'}
          </div>
        </div>
      )}

      {match.battle
        ? <BattlePanel match={match} myId={myId} config={config} now={now} />
        : match.phase.type === 'trade'
          ? <TradeStage match={match} myId={myId} config={config} now={now} />
          : <AttackStage match={match} myId={myId} config={config} />}

      <div className="grow" />

      <RosterList match={match} myId={myId} config={config} />

      {me?.status === 'eliminated' && (
        <div className="notice" style={{ textAlign: 'center' }}>You've been eliminated — spectating.</div>
      )}
    </div>
  );
}

// ── Trade stage — shop auction, artifact upgrades, selling, Ready gate (PRD 8 / 10.3 Stage 1) ──
function TradeStage({ match, myId, config, now }: { match: Match; myId: string; config: GameConfig | null; now: number }) {
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'shop' | 'manage' | 'trades'>('shop');
  const [shopTab, setShopTab] = useState<'artifacts' | 'graveyard'>('artifacts');
  const [applying, setApplying] = useState<number | null>(null); // artifact index being applied
  const [tradeOpen, setTradeOpen] = useState(false);
  const me = match.players[myId];
  const active = Object.values(match.players).filter((p) => p.status === 'active');
  const readyCount = active.filter((p) => p.ready).length;
  const auction = match.shop?.activeAuction ?? null;
  const queue = match.shop?.auctionQueue ?? [];

  if (!me || me.status !== 'active') {
    return <div className="notice" style={{ textAlign: 'center' }}>Trade stage — you're out, spectating.</div>;
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try { await fn(); } catch (e) { alert(e instanceof Error ? e.message : 'Action failed.'); } finally { setBusy(false); }
  }

  const myHeroes = livingHeroes(match, myId);
  const artifacts = me.artifacts ?? [];
  const allArtifacts = match.shop?.artifacts ?? [];
  const graveyard = (match.shop?.graveyardHeroes ?? []).map((id) => match.catalog.heroes[id]).filter(Boolean) as MatchHero[];

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="turnbar">
        <span>Trade · <b>{me.credits} cr</b></span>
        <span className="faint" style={{ fontSize: 13 }}>{readyCount}/{active.length} ready</span>
      </div>

      {auction && (
        <div className="battle-panel">
          <div className="between">
            <span className="step-label">Shop auction</span>
            <div className={`timer ${secondsRemaining(auction.deadline, now) <= 5 ? 'urgent' : ''}`} style={{ width: 40, height: 40, fontSize: 15 }}>{secondsRemaining(auction.deadline, now)}</div>
          </div>
          <div className="between">
            <span><b>{auction.label}</b> <span className="faint">· {auction.itemType === 'hero' ? 'graveyard hero' : 'artifact'}</span></span>
            <span className="bid-amount" style={{ fontSize: 20 }}>{auction.amount} cr</span>
          </div>
          <div className="faint" style={{ fontSize: 12 }}>Top bid: {match.players[auction.leaderPlayerId]?.displayName}{auction.leaderPlayerId === myId ? ' (you)' : ''}</div>
          {auction.leaderPlayerId === myId ? (
            <div className="faint" style={{ fontSize: 12, textAlign: 'center' }}>You're winning this lot.</div>
          ) : (auction.passedPlayers ?? []).includes(myId) ? (
            <div className="faint" style={{ fontSize: 12, textAlign: 'center' }}>You passed this lot.</div>
          ) : (
            <div className="stack" style={{ gap: 6 }}>
              <div className="bid-buttons">
                {(config?.bidIncrements ?? [1, 2, 5]).map((inc) => {
                  const to = auction.amount + inc;
                  return (
                    <button key={inc} className="bid-btn" disabled={busy || me.credits < to} onClick={() => run(() => outbidShop(match.matchId, myId, inc))}>
                      <span className="inc">+{inc}</span><span className="to">→ {to}</span>
                    </button>
                  );
                })}
              </div>
              <button className="btn ghost sm" disabled={busy} onClick={() => run(() => passShopAuction(match.matchId, myId))}>Ignore this lot</button>
            </div>
          )}
          {queue.length > 0 && <div className="faint" style={{ fontSize: 11 }}>Queued: {queue.map((q) => q.label).join(', ')}</div>}
        </div>
      )}

      <div className="tabs">
        <div className={`tab ${tab === 'shop' ? 'active' : ''}`} onClick={() => setTab('shop')}>Shop</div>
        <div className={`tab ${tab === 'manage' ? 'active' : ''}`} onClick={() => setTab('manage')}>Upgrade &amp; sell</div>
        <div className={`tab ${tab === 'trades' ? 'active' : ''}`} onClick={() => setTab('trades')}>
          Trades{(match.tradeOffers ?? []).some((o) => o.toPlayerId === myId) ? ' •' : ''}
        </div>
      </div>

      {tab === 'shop' ? (
        <>
          <div className="tabs">
            <div className={`tab ${shopTab === 'artifacts' ? 'active' : ''}`} onClick={() => setShopTab('artifacts')}>Artifacts</div>
            <div className={`tab ${shopTab === 'graveyard' ? 'active' : ''}`} onClick={() => setShopTab('graveyard')}>Graveyard ({graveyard.length})</div>
          </div>

          {shopTab === 'artifacts' ? (
            <div className="shop-grid">
              {FACTIONS.map((f) => (
                <div className="shop-col" key={f}>
                  <div className="shop-col-head"><FactionMark faction={f} /> {f}</div>
                  {[1, 2, 3, 4, 5].map((lvl) => {
                    const e = allArtifacts.find((a) => a.faction === f && a.levelsGranted === lvl);
                    if (!e) return null;
                    const soldOut = e.remaining <= 0;
                    return (
                      <button key={lvl} className="shop-tile" disabled={busy || soldOut || me.credits < e.cost}
                        onClick={() => run(() => initiateShopPurchase(match.matchId, myId, { itemType: 'artifact', faction: f, levels: lvl }))}>
                        <span className="lvl">+{lvl}</span>
                        <span className="price">{e.cost} cr</span>
                        <span className="rem">{soldOut ? 'sold out' : `${e.remaining} left`}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          ) : graveyard.length === 0 ? (
            <div className="faint" style={{ fontSize: 12 }}>Empty — every hero was drafted.</div>
          ) : graveyard.map((h) => (
            <div key={h.matchHeroId} className="mh-row" style={{ padding: '8px 0' }}>
              <FactionMark faction={h.faction} />
              <span className="grow" style={{ fontSize: 13 }}><b>{h.name}</b></span>
              <StatTriplet match={match} hero={h} config={config} />
              <button className="shop-buy" disabled={busy || me.credits < h.basePrice} onClick={() => run(() => initiateShopPurchase(match.matchId, myId, { itemType: 'hero', heroId: h.matchHeroId }))}>Bid {h.basePrice}</button>
            </div>
          ))}
        </>
      ) : tab === 'manage' ? (
        <>
          <div className="step-label">Your artifacts ({artifacts.length})</div>
          {artifacts.length === 0 ? <div className="faint" style={{ fontSize: 12 }}>None — buy some in the Shop.</div> : artifacts.map((t, i) => (
            <div key={i} className="mh-row" style={{ padding: '8px 0' }}>
              <FactionMark faction={t.faction} />
              <span className="grow" style={{ fontSize: 13 }}><b>{t.faction} +{t.levels}</b></span>
              <button className="shop-buy" disabled={busy} onClick={() => setApplying(i)}>Apply →</button>
            </div>
          ))}

          <div className="step-label" style={{ marginTop: 8 }}>Your heroes</div>
          {myHeroes.map((h) => (
            <div key={h.matchHeroId} className="mh-row" style={{ padding: '8px 0' }}>
              <FactionMark faction={h.faction} />
              <span className="grow" style={{ fontSize: 13 }}><b>{h.name}</b> <span className="faint">· L{h.level}{h.bonusPct > 0 ? ` (+${Math.round(h.bonusPct * 100)}%)` : ''}</span></span>
              <StatTriplet match={match} hero={h} config={config} />
              {myHeroes.length > 1 && config && (
                <button className="shop-buy" disabled={busy} onClick={() => run(() => sellHero(match.matchId, myId, h.matchHeroId))}>Sell {heroSellValue(h, config)}</button>
              )}
            </div>
          ))}
        </>
      ) : (
        <TradesTab match={match} myId={myId} busy={busy} onPropose={() => setTradeOpen(true)}
          onRespond={(offerId, accept) => run(() => respondTrade(match.matchId, myId, offerId, accept))}
          onCancel={(offerId) => run(() => cancelTrade(match.matchId, myId, offerId))} />
      )}

      <button
        className={me.ready ? 'btn secondary' : 'btn'}
        disabled={busy}
        style={{ marginTop: 8 }}
        onClick={() => run(() => setReady(match.matchId, myId, !me.ready))}
      >
        {me.ready ? 'Ready ✓ (tap to unready)' : 'Ready — proceed to battles'}
      </button>

      {applying !== null && config && (
        <ApplyArtifactSheet
          token={artifacts[applying]}
          heroes={myHeroes}
          levelCap={config.levelCap}
          onClose={() => setApplying(null)}
          onApply={(heroId) => run(async () => { await applyArtifact(match.matchId, myId, applying, heroId); setApplying(null); })}
        />
      )}

      {tradeOpen && (
        <TradeSheet match={match} myId={myId} config={config} onClose={() => setTradeOpen(false)}
          onSend={(toId, give, want) => run(async () => { await proposeTrade(match.matchId, myId, toId, give, want); setTradeOpen(false); })} />
      )}
    </div>
  );
}

function ApplyArtifactSheet({ token, heroes, levelCap, onClose, onApply }: {
  token: ArtifactToken; heroes: MatchHero[]; levelCap: number; onClose: () => void; onApply: (heroId: string) => void;
}) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="between"><div className="h2">Apply {token.faction} +{token.levels}</div><button className="btn ghost sm" onClick={onClose}>Close</button></div>
        <div className="faint" style={{ fontSize: 12 }}>
          Matched faction = +20%/level, cross-faction = +10%/level. Levels past {levelCap} are wasted.
        </div>
        <div className="stack" style={{ gap: 6 }}>
          {heroes.map((h) => {
            const eff = Math.min(token.levels, levelCap - h.level);
            const matched = token.faction === h.faction;
            return (
              <button key={h.matchHeroId} className="selectable" disabled={h.level >= levelCap} onClick={() => onApply(h.matchHeroId)}>
                <FactionMark faction={h.faction} />
                <span className="grow"><b>{h.name}</b> <span className="faint">· L{h.level} → L{h.level + eff}</span></span>
                <span className="faint" style={{ fontSize: 11 }}>{h.level >= levelCap ? 'maxed' : `+${eff * (matched ? 20 : 10)}%`}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function bundleText(match: Match, b: TradeBundle): string {
  const parts: string[] = [];
  for (const id of b.heroIds) parts.push(match.catalog.heroes[id]?.name ?? 'hero');
  for (const t of b.artifacts) parts.push(`${t.faction}+${t.levels}`);
  if (b.credits > 0) parts.push(`${b.credits} cr`);
  return parts.length ? parts.join(', ') : 'nothing';
}

function TradesTab({ match, myId, busy, onPropose, onRespond, onCancel }: {
  match: Match; myId: string; busy: boolean;
  onPropose: () => void;
  onRespond: (offerId: string, accept: boolean) => void;
  onCancel: (offerId: string) => void;
}) {
  const offers = match.tradeOffers ?? [];
  const incoming = offers.filter((o) => o.toPlayerId === myId);
  const outgoing = offers.filter((o) => o.fromPlayerId === myId);
  const others = Object.values(match.players).filter((p) => p.status === 'active' && p.userId !== myId);

  return (
    <div className="stack" style={{ gap: 10 }}>
      <button className="btn" disabled={busy || others.length === 0} onClick={onPropose}>+ Propose a trade</button>

      {incoming.length > 0 && <div className="step-label">Offers to you</div>}
      {incoming.map((o) => (
        <div key={o.offerId} className="card" style={{ padding: 12 }}>
          <div style={{ fontSize: 13 }}><b>{match.players[o.fromPlayerId]?.displayName}</b> proposes a trade</div>
          <div className="faint" style={{ fontSize: 12, marginTop: 4 }}>You receive: {bundleText(match, o.give)}</div>
          <div className="faint" style={{ fontSize: 12 }}>You give: {bundleText(match, o.want)}</div>
          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <button className="btn grow" disabled={busy} onClick={() => onRespond(o.offerId, true)}>Accept</button>
            <button className="btn ghost grow" disabled={busy} onClick={() => onRespond(o.offerId, false)}>Reject</button>
          </div>
        </div>
      ))}

      {outgoing.length > 0 && <div className="step-label" style={{ marginTop: 6 }}>Your pending offers</div>}
      {outgoing.map((o) => (
        <div key={o.offerId} className="card" style={{ padding: 12 }}>
          <div style={{ fontSize: 13 }}>To <b>{match.players[o.toPlayerId]?.displayName}</b></div>
          <div className="faint" style={{ fontSize: 12, marginTop: 4 }}>You give: {bundleText(match, o.give)}</div>
          <div className="faint" style={{ fontSize: 12 }}>You want: {bundleText(match, o.want)}</div>
          <button className="btn ghost sm" style={{ marginTop: 8 }} disabled={busy} onClick={() => onCancel(o.offerId)}>Cancel offer</button>
        </div>
      ))}

      {incoming.length === 0 && outgoing.length === 0 && (
        <div className="faint" style={{ fontSize: 12 }}>No active offers. Propose a trade to swap heroes, artifacts, or credits.</div>
      )}
    </div>
  );
}

function TradeSheet({ match, myId, config, onClose, onSend }: {
  match: Match; myId: string; config: GameConfig | null; onClose: () => void;
  onSend: (toId: string, give: TradeBundle, want: TradeBundle) => void;
}) {
  const [partnerId, setPartnerId] = useState<string | null>(null);
  const [giveHeroes, setGiveHeroes] = useState<string[]>([]);
  const [giveArts, setGiveArts] = useState<number[]>([]);
  const [giveCredits, setGiveCredits] = useState(0);
  const [wantHeroes, setWantHeroes] = useState<string[]>([]);
  const [wantArts, setWantArts] = useState<number[]>([]);
  const [wantCredits, setWantCredits] = useState(0);

  const me = match.players[myId];
  const others = Object.values(match.players).filter((p) => p.status === 'active' && p.userId !== myId).sort((a, b) => a.seat - b.seat);
  const partner = partnerId ? match.players[partnerId] : null;
  const myHeroes = livingHeroes(match, myId);
  const myArts = me.artifacts ?? [];
  const partnerHeroes = partner ? livingHeroes(match, partner.userId) : [];
  const partnerArts = partner?.artifacts ?? [];

  const toggle = <T,>(arr: T[], v: T): T[] => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const clamp = (v: number, max: number) => Math.max(0, Math.min(max, Math.floor(v) || 0));

  function send() {
    if (!partner) return;
    const give: TradeBundle = { heroIds: giveHeroes, artifacts: giveArts.map((i) => myArts[i]), credits: giveCredits };
    const want: TradeBundle = { heroIds: wantHeroes, artifacts: wantArts.map((i) => partnerArts[i]), credits: wantCredits };
    onSend(partner.userId, give, want);
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="between"><div className="h2">Propose a trade</div><button className="btn ghost sm" onClick={onClose}>Close</button></div>

        <div className="stack" style={{ gap: 6 }}>
          <span className="step-label">Trade with</span>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {others.map((p) => (
              <button key={p.userId} className={`mode-chip ${partnerId === p.userId ? 'sel' : ''}`} onClick={() => { setPartnerId(p.userId); setWantHeroes([]); setWantArts([]); setWantCredits(0); }}>{p.displayName}</button>
            ))}
          </div>
        </div>

        {partner && (
          <>
            <TradeColumn title="You give" heroes={myHeroes} arts={myArts} maxCredits={me.credits}
              selHeroes={giveHeroes} selArts={giveArts} credits={giveCredits}
              onToggleHero={(id) => setGiveHeroes((a) => toggle(a, id))} onToggleArt={(i) => setGiveArts((a) => toggle(a, i))}
              onCredits={(v) => setGiveCredits(clamp(v, me.credits))} config={config} match={match} />
            <TradeColumn title={`You want from ${partner.displayName}`} heroes={partnerHeroes} arts={partnerArts} maxCredits={partner.credits}
              selHeroes={wantHeroes} selArts={wantArts} credits={wantCredits}
              onToggleHero={(id) => setWantHeroes((a) => toggle(a, id))} onToggleArt={(i) => setWantArts((a) => toggle(a, i))}
              onCredits={(v) => setWantCredits(clamp(v, partner.credits))} config={config} match={match} />
            <button className="btn" onClick={send}>Send offer</button>
          </>
        )}
      </div>
    </div>
  );
}

function TradeColumn({ title, heroes, arts, maxCredits, selHeroes, selArts, credits, onToggleHero, onToggleArt, onCredits, config, match }: {
  title: string; heroes: MatchHero[]; arts: ArtifactToken[]; maxCredits: number;
  selHeroes: string[]; selArts: number[]; credits: number;
  onToggleHero: (id: string) => void; onToggleArt: (i: number) => void; onCredits: (v: number) => void;
  config: GameConfig | null; match: Match;
}) {
  return (
    <div className="stack" style={{ gap: 6 }}>
      <span className="step-label">{title}</span>
      {heroes.map((h) => (
        <button key={h.matchHeroId} className={`selectable ${selHeroes.includes(h.matchHeroId) ? 'sel' : ''}`} onClick={() => onToggleHero(h.matchHeroId)}>
          <FactionMark faction={h.faction} />
          <span className="grow"><b>{h.name}</b>{h.level > 0 && <span className="faint"> · L{h.level}</span>}</span>
          <StatTriplet match={match} hero={h} config={config} />
        </button>
      ))}
      {arts.map((t, i) => (
        <button key={i} className={`selectable ${selArts.includes(i) ? 'sel' : ''}`} onClick={() => onToggleArt(i)}>
          <FactionMark faction={t.faction} /><span className="grow"><b>{t.faction} +{t.levels}</b> <span className="faint">artifact</span></span>
        </button>
      ))}
      <div className="field">
        <label>Credits (max {maxCredits})</label>
        <input className="input" type="number" min={0} max={maxCredits} value={credits} onChange={(e) => onCredits(Number(e.target.value))} />
      </div>
    </div>
  );
}

// ── Attack stage ──
function AttackStage({ match, myId, config }: { match: Match; myId: string; config: GameConfig | null }) {
  const [showAttack, setShowAttack] = useState(false);
  const [busy, setBusy] = useState(false);
  const isMyTurn = match.phase.activePlayer === myId;
  const active = match.players[match.phase.activePlayer ?? ''];
  const me = match.players[myId];
  const myHeroes = livingHeroes(match, myId);

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="turnbar">
        <span className="who">{isMyTurn ? 'Your turn' : `${active?.displayName ?? 'Player'}'s turn`}</span>
        <span className="faint" style={{ fontSize: 12 }}>Attack stage</span>
      </div>

      {isMyTurn && me?.status === 'active' ? (
        <div className="row" style={{ gap: 8 }}>
          <button className="btn grow" disabled={busy || myHeroes.length === 0} onClick={() => setShowAttack(true)}>Attack</button>
          <button className="btn secondary grow" disabled={busy} onClick={async () => { setBusy(true); try { await passTurn(match.matchId, myId); } finally { setBusy(false); } }}>Pass</button>
        </div>
      ) : (
        <div className="notice" style={{ textAlign: 'center' }}>Waiting for {active?.displayName ?? 'the active player'}…</div>
      )}

      {showAttack && (
        <AttackSheet match={match} myId={myId} config={config} onClose={() => setShowAttack(false)} />
      )}
    </div>
  );
}

function AttackSheet({ match, myId, config, onClose }: { match: Match; myId: string; config: GameConfig | null; onClose: () => void }) {
  const [targetId, setTargetId] = useState<string | null>(null);
  const [mineId, setMineId] = useState<string | null>(null);
  const [mode, setMode] = useState<ResMode>('noShift');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const opponents = Object.values(match.players).filter((p) => p.status === 'active' && p.userId !== myId);
  const myHeroes = livingHeroes(match, myId);
  const myHero = mineId ? match.catalog.heroes[mineId] : null;
  const modes = myHero ? FACTION_MODES[myHero.faction] : [];

  const targetHero = targetId ? match.catalog.heroes[targetId] : null;
  const atkShift = myHero && config ? shiftedStats(match, myHero, mode, config) : null;
  const tgtMinDef = targetHero && config ? derivedStats(match, targetHero, config).defense : null;
  const doomed = !!(atkShift && tgtMinDef != null && atkShift.attack <= tgtMinDef);
  const canConfirm = !!targetHero && !!myHero && !busy && !doomed;

  async function confirm() {
    if (!targetHero || !myHero) return;
    setBusy(true); setErr(null);
    try {
      await declareAttack(match.matchId, myId, {
        targetOwnerId: targetHero.ownerId!,
        targetHeroId: targetHero.matchHeroId,
        attackerHeroId: myHero.matchHeroId,
        attackerMode: mode,
      });
      onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not declare attack.'); setBusy(false); }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="between"><div className="h2">Declare attack</div><button className="btn ghost sm" onClick={onClose}>Close</button></div>

        <div className="stack" style={{ gap: 6 }}>
          <span className="step-label">1 · Target hero</span>
          {opponents.map((p) => livingHeroes(match, p.userId).map((h) => (
            <button key={h.matchHeroId} className={`selectable ${targetId === h.matchHeroId ? 'sel' : ''}`} onClick={() => setTargetId(h.matchHeroId)}>
              <FactionMark faction={h.faction} />
              <span className="grow"><b>{h.name}</b> <span className="faint">· {p.displayName}</span></span>
              <StatTriplet match={match} hero={h} config={config} />
            </button>
          )))}
        </div>

        <div className="stack" style={{ gap: 6 }}>
          <span className="step-label">2 · Attack with</span>
          {myHeroes.map((h) => (
            <button key={h.matchHeroId} className={`selectable ${mineId === h.matchHeroId ? 'sel' : ''}`} onClick={() => { setMineId(h.matchHeroId); setMode('noShift'); }}>
              <FactionMark faction={h.faction} />
              <span className="grow"><b>{h.name}</b></span>
              <StatTriplet match={match} hero={h} config={config} />
            </button>
          ))}
        </div>

        {myHero && (
          <div className="stack" style={{ gap: 6 }}>
            <span className="step-label">3 · Your mode</span>
            <div className="mode-chips">
              {modes.map((m) => (
                <button key={m} className={`mode-chip ${mode === m ? 'sel' : ''}`} onClick={() => setMode(m)}>{RES_MODES[m].label}</button>
              ))}
            </div>
            {atkShift && (
              <div className="faint" style={{ fontSize: 13 }}>
                Your attack: <b style={{ color: 'var(--ink)' }}>{r(atkShift.attack)}</b>
                {targetHero && tgtMinDef != null && <> &nbsp;·&nbsp; {targetHero.name} defends ≥ <b style={{ color: 'var(--ink)' }}>{r(tgtMinDef)}</b></>}
              </div>
            )}
          </div>
        )}

        {doomed && <div className="notice warn">Your attack can't break {targetHero?.name}'s defense — pick a stronger hero or mode, or a different target.</div>}
        {err && <div className="notice warn">{err}</div>}
        <button className="btn" disabled={!canConfirm} onClick={confirm}>{busy ? 'Declaring…' : 'Declare attack'}</button>
      </div>
    </div>
  );
}

// Visual Fail / Capture / Destroy ranges with the live attack marker.
function OutcomeBar({ attackTotal, defenseTotal, remainingRes }: { attackTotal: number; defenseTotal: number; remainingRes: number }) {
  const ceiling = defenseTotal + remainingRes;
  const scaleMax = Math.max(attackTotal, ceiling, 1) * 1.15;
  const pct = (v: number) => Math.max(0, Math.min(100, (v / scaleMax) * 100));
  const failW = pct(defenseTotal);
  const capW = Math.max(0, pct(ceiling) - failW);
  const desW = Math.max(0, 100 - failW - capW);
  return (
    <div className="outbar-wrap">
      <div className="outbar">
        <div className="seg fail" style={{ width: `${failW}%` }} />
        <div className="seg capture" style={{ width: `${capW}%` }} />
        <div className="seg destroy" style={{ width: `${desW}%` }} />
        <div className="marker" style={{ left: `${pct(attackTotal)}%` }}><span className="lab">ATK {r(attackTotal)}</span></div>
      </div>
      <div className="outbar-legend">
        <span><i className="fail" />Fail ≤ {r(defenseTotal)}</span>
        <span><i className="capture" />Capture → {r(ceiling)}</span>
        <span><i className="destroy" />Destroy &gt; {r(ceiling)}</span>
      </div>
    </div>
  );
}

// ── Battle in progress (multi-hero negotiation) ──
function BattlePanel({ match, myId, config, now }: { match: Match; myId: string; config: GameConfig | null; now: number }) {
  const b = match.battle!;
  const [adding, setAdding] = useState<BattleSide | null>(null);
  const [busy, setBusy] = useState(false);
  const secs = secondsRemaining(b.deadline, now);

  const amAttacker = b.attackerId === myId;
  const amDefender = b.targetOwnerId === myId;
  const isPrincipal = amAttacker || amDefender;

  const attackTotal = config ? attackSideTotal(match, b.attackSide, config) : 0;
  const dt = config ? defenseSideTotals(match, b.defenseSide, config) : { defense: 0, remainingRes: 0 };
  const outcome = config ? outcomeFor(attackTotal, dt.defense, dt.remainingRes) : null;

  const myTurn = (b.turn === 'attack' && amAttacker) || (b.turn === 'defense' && amDefender);
  const committed = [...b.attackSide, ...b.defenseSide];
  const available = livingHeroes(match, myId).filter((h) => !committed.some((e) => e.matchHeroId === h.matchHeroId));
  const turnName = match.players[b.turn === 'attack' ? b.attackerId : b.targetOwnerId]?.displayName ?? 'Player';

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try { await fn(); } catch (e) { alert(e instanceof Error ? e.message : 'Action failed.'); } finally { setBusy(false); }
  }

  function side(entries: typeof b.attackSide, which: BattleSide) {
    return entries.map((e) => {
      const h = match.catalog.heroes[e.matchHeroId];
      if (!h) return null;
      const mine = e.playerId === myId;
      const sh = config ? shiftedStats(match, h, e.mode, config) : null;
      const stat = sh ? r(which === 'attack' ? sh.attack : sh.defense) : null;
      return (
        <div key={e.matchHeroId} className="stack" style={{ gap: 3, paddingBottom: 5 }}>
          <div className="mh-row" style={{ padding: 0 }}>
            <FactionMark faction={h.faction} />
            <span className="grow" style={{ fontSize: 13 }}>
              <b>{h.name}</b>{e.matchHeroId === b.targetHeroId && ' 🎯'}
              <span className="faint"> · {match.players[e.playerId]?.displayName}</span>
            </span>
            <span className="faint" style={{ fontSize: 11 }}>{RES_MODES[e.mode].label}{stat != null && ` · ${which === 'attack' ? 'ATK' : 'DEF'} ${stat}`}</span>
            {mine && myTurn && e.matchHeroId !== b.targetHeroId && e.matchHeroId !== b.attackSide[0]?.matchHeroId && (
              <button className="btn ghost sm" style={{ padding: '2px 8px' }} disabled={busy} title="Remove"
                onClick={() => run(() => removeBattleHero(match.matchId, myId, e.matchHeroId))}>×</button>
            )}
          </div>
          {mine && myTurn && (
            <div className="mode-chips">
              {FACTION_MODES[h.faction].map((m) => (
                <button key={m} className={`mode-chip ${e.mode === m ? 'sel' : ''}`} disabled={busy}
                  onClick={() => run(() => setBattleHeroMode(match.matchId, myId, e.matchHeroId, m))}>{RES_MODES[m].label}</button>
              ))}
            </div>
          )}
        </div>
      );
    });
  }

  return (
    <div className="battle-panel">
      <div className="between">
        <span className="step-label">Battle — negotiating</span>
        <div className={`timer ${secs <= 5 ? 'urgent' : ''}`} style={{ width: 40, height: 40, fontSize: 15 }}>{secs}</div>
      </div>

      <div className="stack" style={{ gap: 4 }}>
        <div className="between"><span className="step-label">Attack</span><b>ATK {r(attackTotal)}</b></div>
        {side(b.attackSide, 'attack')}
        {amAttacker && myTurn && available.length > 0 && <button className="btn ghost sm" disabled={busy} onClick={() => setAdding('attack')}>+ Add my hero</button>}
      </div>

      <div className="stack" style={{ gap: 4 }}>
        <div className="between"><span className="step-label">Defense</span><b>DEF {r(dt.defense)} · RES {r(dt.remainingRes)}</b></div>
        {side(b.defenseSide, 'defense')}
        {amDefender && myTurn && available.length > 0 && <button className="btn ghost sm" disabled={busy} onClick={() => setAdding('defense')}>+ Add my hero</button>}
      </div>

      {config && (
        <div className="stack" style={{ gap: 6 }}>
          <OutcomeBar attackTotal={attackTotal} defenseTotal={dt.defense} remainingRes={dt.remainingRes} />
          <div className="between" style={{ fontSize: 13 }}>
            <span className="faint">ATK {r(attackTotal)} vs DEF {r(dt.defense)}</span>
            {outcome && <span className={`outcome-pill ${outcome}`}>{outcome}</span>}
          </div>
        </div>
      )}

      <div className="faint" style={{ fontSize: 11, textAlign: 'center' }}>
        {b.turn === 'defense' ? 'Defender to respond' : 'Attacker to act'}
      </div>

      {isPrincipal ? (
        myTurn ? (
          amDefender ? (
            <button className="btn" disabled={busy} onClick={() => run(() => defenderEndTurn(match.matchId, myId))}>Defend — attacker's turn</button>
          ) : b.dirty ? (
            <button className="btn" disabled={busy} onClick={() => run(() => attackerEndTurn(match.matchId, myId, false))}>Done — defender responds</button>
          ) : (
            <button className={`btn ${outcome === 'fail' ? 'secondary' : ''}`} disabled={busy} onClick={() => run(() => attackerEndTurn(match.matchId, myId, true))}>
              {outcome === 'fail' ? 'Withdraw attack (it fails)' : outcome === 'destroy' ? 'Resolve — destroy' : 'Resolve — capture'}
            </button>
          )
        ) : (
          <div className="notice" style={{ textAlign: 'center' }}>Waiting for {turnName} to act…</div>
        )
      ) : (
        <div className="notice" style={{ textAlign: 'center' }}>A battle is underway…</div>
      )}

      {adding && (
        <AddHeroSheet
          heroes={available}
          side={adding}
          match={match}
          onClose={() => setAdding(null)}
          onAdd={(heroId, mode) => run(async () => { await addBattleHero(match.matchId, myId, adding, heroId, mode); setAdding(null); })}
        />
      )}
    </div>
  );
}

function AddHeroSheet({ heroes, side, match, onClose, onAdd }: {
  heroes: MatchHero[]; side: BattleSide; match: Match; onClose: () => void; onAdd: (heroId: string, mode: ResMode) => void;
}) {
  const [heroId, setHeroId] = useState<string | null>(null);
  const [mode, setMode] = useState<ResMode>('noShift');
  const hero = heroId ? match.catalog.heroes[heroId] : null;
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="between"><div className="h2">Add hero to {side}</div><button className="btn ghost sm" onClick={onClose}>Close</button></div>
        <div className="stack" style={{ gap: 6 }}>
          <span className="step-label">Your hero</span>
          {heroes.map((h) => (
            <button key={h.matchHeroId} className={`selectable ${heroId === h.matchHeroId ? 'sel' : ''}`} onClick={() => { setHeroId(h.matchHeroId); setMode('noShift'); }}>
              <FactionMark faction={h.faction} /><span className="grow"><b>{h.name}</b></span>
            </button>
          ))}
        </div>
        {hero && (
          <div className="stack" style={{ gap: 6 }}>
            <span className="step-label">Mode</span>
            <div className="mode-chips">
              {FACTION_MODES[hero.faction].map((m) => (
                <button key={m} className={`mode-chip ${mode === m ? 'sel' : ''}`} onClick={() => setMode(m)}>{RES_MODES[m].label}</button>
              ))}
            </div>
          </div>
        )}
        <button className="btn" disabled={!hero} onClick={() => hero && onAdd(hero.matchHeroId, mode)}>Commit hero</button>
      </div>
    </div>
  );
}

// ── Shared roster display ──
function StatTriplet({ match, hero, config }: { match: Match; hero: MatchHero; config: GameConfig | null }) {
  const s = config ? derivedStats(match, hero, config) : hero.baseStats;
  return (
    <span className="mh-stats">
      <span>{r(s.attack)}</span>/<span>{r(s.defense)}</span>/<span>{r(s.resilience)}</span>
    </span>
  );
}

function RosterList({ match, myId, config }: { match: Match; myId: string; config: GameConfig | null }) {
  const players = Object.values(match.players).sort((a, b) => a.seat - b.seat);
  const battle = match.battle;
  const sideOf = new Map<string, 'attack' | 'defense'>();
  if (battle) {
    for (const e of battle.attackSide) sideOf.set(e.matchHeroId, 'attack');
    for (const e of battle.defenseSide) sideOf.set(e.matchHeroId, 'defense');
  }
  const targetId = battle?.targetHeroId;
  return (
    <div className="stack" style={{ gap: 8 }}>
      {players.map((p) => {
        const heroes = livingHeroes(match, p.userId);
        return (
          <div key={p.userId} className={`roster ${p.status === 'eliminated' ? 'elim' : ''} ${p.userId === myId ? 'me' : ''}`}>
            <div className="between" style={{ marginBottom: 6 }}>
              <b style={{ fontSize: 14 }}>{p.displayName}{p.userId === myId ? ' · you' : ''}</b>
              <span className="faint" style={{ fontSize: 12 }}>{p.status === 'eliminated' ? 'out' : `${p.credits} cr`}</span>
            </div>
            {heroes.length === 0 ? (
              <div className="faint" style={{ fontSize: 12 }}>No heroes</div>
            ) : heroes.map((h) => {
              const inB = sideOf.get(h.matchHeroId);
              const isTarget = h.matchHeroId === targetId;
              return (
                <div key={h.matchHeroId} className={`mh-row ${inB ? 'inbattle' : ''} ${isTarget ? 'target' : ''}`}>
                  <FactionMark faction={h.faction} />
                  <span className="grow">
                    <b>{h.name}</b>{isTarget && ' 🎯'}{h.level > 0 && <span className="faint"> · L{h.level}</span>}
                    {inB && <span className={`battle-tag ${isTarget ? 'target' : inB}`}> · {isTarget ? 'TARGET' : inB === 'attack' ? 'ATTACKING' : 'DEFENDING'}</span>}
                  </span>
                  <StatTriplet match={match} hero={h} config={config} />
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
