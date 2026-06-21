import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { subscribeHeroImages } from '../firebase/catalog';
import { getGameConfig } from '../firebase/matches';
import { quitMatch } from '../firebase/duel';
import { passHero, placeBid, progressDraft, setDoneDrafting } from '../firebase/draft';
import { canPass, eligibleBidderExists, secondsRemaining } from '../domain/draftLogic';
import { rarityTier, statSum } from '../domain/stats';
import type { GameConfig } from '../domain/types';
import type { Match, MatchHero } from '../domain/match';
import { FACTION_GLYPH, FactionMark } from '../components/FactionMark';

function useNow(intervalMs = 250): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function HeroPortrait({ sourceHeroId, faction }: { sourceHeroId: string; faction: MatchHero['faction'] }) {
  const [img, setImg] = useState<string | undefined>();
  useEffect(() => subscribeHeroImages(sourceHeroId, (i) => setImg(i.level0)), [sourceHeroId]);
  return (
    <div className="hero-portrait">
      {img ? <img src={img} alt="" /> : <span className={`mark ${faction.toLowerCase()}`}>{FACTION_GLYPH[faction]}</span>}
    </div>
  );
}

export default function DraftView({ match, myId }: { match: Match; myId: string }) {
  const nav = useNavigate();
  const now = useNow();
  const [config, setConfig] = useState<GameConfig | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Refs let the engine interval read the latest state without re-subscribing each tick.
  const matchRef = useRef(match); matchRef.current = match;
  const myIdRef = useRef(myId); myIdRef.current = myId;
  const configRef = useRef<GameConfig | null>(null);
  const driverBusy = useRef(false);

  useEffect(() => {
    getGameConfig().then((c) => { configRef.current = c; setConfig(c); }).catch(() => undefined);
  }, []);

  // Client-driven resolution engine. Every active client runs this; progressDraft's
  // transaction makes it idempotent, and the seat stagger keeps the lowest seat as primary
  // driver with others as backup (so a closed host tab can't stall the draft).
  useEffect(() => {
    const tick = async () => {
      if (driverBusy.current) return;
      const m = matchRef.current;
      const cfg = configRef.current;
      if (!m || m.status !== 'draft' || !m.draft || !cfg) return;
      const d = m.draft;
      const t = Date.now();
      const needs = !d.currentHeroId
        ? !d.nextRevealAt || t >= d.nextRevealAt
        : t >= (d.currentBid?.deadline ?? 0) || !eligibleBidderExists(m, cfg);
      if (!needs) return;
      driverBusy.current = true;
      const seat = m.players[myIdRef.current]?.seat ?? 9;
      try {
        if (seat > 0) await new Promise((r) => setTimeout(r, 700 + seat * 500));
        if (matchRef.current?.status === 'draft') await progressDraft(m.matchId);
      } catch {
        /* contention / rejected — another client handled it */
      } finally {
        driverBusy.current = false;
      }
    };
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const draft = match.draft!;
  const me = match.players[myId];
  const players = Object.values(match.players).sort((a, b) => a.seat - b.seat);
  const deckLen = draft.masterDeckOrder.length;
  const progressPct = Math.min(100, (draft.currentIndex / deckLen) * 100);

  async function act(fn: () => Promise<void>) {
    setBusy(true); setErr(null);
    try { await fn(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Action failed.'); }
    finally { setBusy(false); }
  }

  const hero = draft.currentHeroId ? match.catalog.heroes[draft.currentHeroId] : null;
  const amount = draft.currentBid?.amount ?? 0;
  const leaderId = draft.currentBid?.leaderPlayerId ?? null;
  const leaderName = leaderId ? match.players[leaderId]?.displayName : null;
  const secs = hero && draft.currentBid ? secondsRemaining(draft.currentBid.deadline, now) : 0;
  const inGap = !hero && !!draft.nextRevealAt && now < draft.nextRevealAt && !!draft.lastResult;

  const iPassed = draft.passedPlayers.includes(myId);
  const iLead = leaderId === myId;

  function BidControls() {
    if (!hero || !me) return null;
    if (me.doneDrafting) return <div className="notice" style={{ textAlign: 'center' }}>You've opted out of drafting.</div>;
    if (iPassed) return <div className="notice" style={{ textAlign: 'center' }}>You passed on this hero — waiting for it to resolve.</div>;
    if (iLead) return <div className="faint" style={{ fontSize: 13, textAlign: 'center' }}>You're the top bidder. ✓</div>;

    const passBtn = (
      <button className="btn ghost sm" disabled={busy || !canPass(match, myId)} onClick={() => act(() => passHero(match.matchId, myId))}>
        Pass this hero
      </button>
    );

    if (leaderId === null) {
      // No bids yet — first mover claims at the base price.
      const canAfford = me.credits >= amount;
      return (
        <div className="stack" style={{ gap: 8 }}>
          <button className="btn" disabled={busy || !canAfford} onClick={() => act(() => placeBid(match.matchId, myId, 0))}>
            {canAfford ? `Claim at base — ${amount} cr` : `Base ${amount} cr — not enough credits`}
          </button>
          {passBtn}
        </div>
      );
    }
    return (
      <div className="stack" style={{ gap: 8 }}>
        <div className="bid-buttons">
          {(config?.bidIncrements ?? [1, 2, 5]).map((inc) => {
            const to = amount + inc;
            return (
              <button key={inc} className="bid-btn" disabled={busy || me.credits < to} onClick={() => act(() => placeBid(match.matchId, myId, inc))}>
                <span className="inc">+{inc}</span>
                <span className="to">→ {to}</span>
              </button>
            );
          })}
        </div>
        {passBtn}
      </div>
    );
  }

  return (
    <div className="screen" style={{ gap: 14 }}>
      <div className="between">
        <div className="eyebrow">Draft · {match.roomCode}</div>
        <div className="row" style={{ gap: 10 }}>
          <span className="faint" style={{ fontSize: 12 }}>
            {Math.min(draft.currentIndex + (hero ? 1 : 0), deckLen)} / {deckLen}
          </span>
          <button
            className="btn ghost sm"
            onClick={async () => { if (confirm('Leave the match? You forfeit and your heroes are removed.')) { try { await quitMatch(match.matchId, myId); } catch { /* ignore */ } nav('/'); } }}
          >Leave</button>
        </div>
      </div>
      <div className="draft-progress"><span style={{ width: `${progressPct}%` }} /></div>

      {hero ? (
        <>
          <div className="hero-card-lg">
            <HeroPortrait sourceHeroId={hero.sourceHeroId} faction={hero.faction} />
            <div className="hero-meta">
              <div className="between">
                <b style={{ fontSize: 18 }}>{hero.name}</b>
                <span className="tag">{rarityTier(hero)}</span>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <span className="tag"><FactionMark faction={hero.faction} />&nbsp;{hero.faction}</span>
                <span className="faint" style={{ fontSize: 12 }}>sum {statSum(hero.baseStats)} · base {hero.basePrice} cr</span>
              </div>
              <div className="stat-grid">
                <div className="stat-box"><span className="v">{hero.baseStats.attack}</span><span className="k">⚔️ Atk</span></div>
                <div className="stat-box"><span className="v">{hero.baseStats.defense}</span><span className="k">🛡️ Def</span></div>
                <div className="stat-box"><span className="v">{hero.baseStats.resilience}</span><span className="k">💀 Res</span></div>
              </div>
            </div>
          </div>

          <div className="bid-bar">
            <div className="stack" style={{ gap: 1 }}>
              <span className="faint" style={{ fontSize: 11 }}>{leaderName ? `Top: ${leaderName}` : `Base price · no bids`}</span>
              <span className="bid-amount">{amount}<span style={{ fontSize: 13, fontWeight: 600 }}> cr</span></span>
            </div>
            <div className={`timer ${secs <= 5 ? 'urgent' : ''}`}>{secs}</div>
          </div>

          {/* Called as a function (not <BidControls/>) so the buttons aren't remounted
              on every countdown tick — which was dropping taps. */}
          {BidControls()}
        </>
      ) : inGap ? (
        <div className="result-banner">
          <div className="faint" style={{ fontSize: 12, marginBottom: 4 }}>Result</div>
          <div className="big">
            {draft.lastResult!.winnerId
              ? `${draft.lastResult!.heroName} → ${match.players[draft.lastResult!.winnerId]?.displayName ?? 'Player'} for ${draft.lastResult!.amount} cr`
              : `${draft.lastResult!.heroName} → unclaimed (to graveyard)`}
          </div>
        </div>
      ) : (
        <div className="center-screen" style={{ flex: 'none', padding: '28px 0' }}>
          <div className="spinner" />
          <div className="faint" style={{ fontSize: 13 }}>Revealing next hero…</div>
        </div>
      )}

      {err && <div className="notice warn">{err}</div>}

      <div className="players-strip">
        {players.map((p) => (
          <div key={p.userId} className={`pchip ${p.userId === leaderId ? 'leading' : ''} ${p.doneDrafting || draft.passedPlayers.includes(p.userId) ? 'done' : ''}`}>
            <span className="nm">{p.displayName}{p.userId === myId ? ' (you)' : ''}</span>
            <span className="cr">{p.credits} cr</span>
            <span className="sub">
              {p.heroIds.length} heroes
              {p.doneDrafting ? ' · done' : draft.passedPlayers.includes(p.userId) ? ' · passed' : ''}
            </span>
          </div>
        ))}
      </div>

      <div className="grow" />

      <div className="between" style={{ fontSize: 12 }}>
        <span className="faint">Graveyard: {draft.graveyard.length}</span>
        <span className="faint">Your roster: {me?.heroIds.length ?? 0}</span>
      </div>

      {me && !me.doneDrafting ? (
        <button
          className="btn ghost"
          disabled={busy}
          onClick={() => { if (confirm('Stop drafting entirely? You will not bid on any further heroes.')) void act(() => setDoneDrafting(match.matchId, myId)); }}
        >
          Done Drafting (opt out of all)
        </button>
      ) : me ? (
        <div className="notice" style={{ textAlign: 'center' }}>You've finished drafting — waiting for others.</div>
      ) : null}
    </div>
  );
}
