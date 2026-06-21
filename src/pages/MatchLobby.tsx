import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import './match.css';
import { useAuth } from '../auth/AuthProvider';
import { leaveMatch, startMatch, subscribeMatch } from '../firebase/matches';
import type { Match } from '../domain/match';
import { MIN_PLAYERS } from '../domain/match';
import DraftView from './DraftView';
import DuelView from './DuelView';

export default function MatchLobby() {
  const { matchId = '' } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const [match, setMatch] = useState<Match | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!matchId) return;
    return subscribeMatch(matchId, (m) => {
      setMatch(m);
      setLoading(false);
    });
  }, [matchId]);

  if (loading) {
    return <div className="app-frame"><div className="screen center-screen"><div className="spinner" /></div></div>;
  }
  if (!match) {
    return (
      <div className="app-frame">
        <div className="screen center-screen">
          <div className="h2">Match not found</div>
          <div className="muted" style={{ fontSize: 14, textAlign: 'center' }}>
            It may have been closed or already finished.
          </div>
          <button className="btn" onClick={() => nav('/')}>Back home</button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-frame">
      {match.status === 'lobby' ? (
        <LobbyView match={match} myId={user?.uid ?? ''} />
      ) : match.status === 'draft' ? (
        <DraftView match={match} myId={user?.uid ?? ''} />
      ) : (
        <DuelView match={match} myId={user?.uid ?? ''} />
      )}
    </div>
  );
}

function LobbyView({ match, myId }: { match: Match; myId: string }) {
  const nav = useNavigate();
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const players = Object.values(match.players).sort((a, b) => a.seat - b.seat);
  const isHost = match.creatorId === myId;
  const canStart = players.length >= MIN_PLAYERS;
  const emptySlots = Math.max(0, match.maxPlayers - players.length);

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(match.roomCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setErr('Could not copy — long-press the code to copy manually.');
    }
  }

  async function handleStart() {
    setBusy(true); setErr(null);
    try {
      await startMatch(match.matchId, myId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not start.');
    } finally {
      setBusy(false);
    }
  }

  async function handleLeave() {
    setBusy(true);
    try {
      await leaveMatch(match.matchId, myId);
      nav('/');
    } catch {
      setBusy(false);
    }
  }

  return (
    <div className="screen" style={{ gap: 18 }}>
      <div className="between">
        <div className="eyebrow">Lobby</div>
        <button className="btn ghost sm" onClick={handleLeave} disabled={busy}>Leave</button>
      </div>

      <div className="roomcode">
        <div className="eyebrow">Room code</div>
        <div className="code">{match.roomCode}</div>
        <button className="copy" onClick={copyCode}>{copied ? '✓ Copied' : 'Tap to copy & share'}</button>
      </div>

      <div className="stack" style={{ gap: 8 }}>
        <div className="between">
          <div className="h2">Players</div>
          <span className="faint" style={{ fontSize: 13 }}>{players.length}/{match.maxPlayers}</span>
        </div>
        <div className="player-list">
          {players.map((p) => (
            <div key={p.userId} className="player-card">
              <div className="seat">{p.seat + 1}</div>
              {p.photoURL
                ? <img className="avatar" src={p.photoURL} alt="" referrerPolicy="no-referrer" />
                : <div className="avatar" />}
              <div className="grow">
                <b>{p.displayName}</b>
                {p.userId === myId && <span className="faint"> · you</span>}
              </div>
              {p.userId === match.creatorId && <span className="tag">Host</span>}
            </div>
          ))}
          {Array.from({ length: emptySlots }).map((_, i) => (
            <div key={`empty-${i}`} className="empty-slot">Waiting for a player…</div>
          ))}
        </div>
      </div>

      {err && <div className="notice warn">{err}</div>}

      <div className="grow" />

      {isHost ? (
        <div className="stack" style={{ gap: 8 }}>
          <button className="btn" onClick={handleStart} disabled={!canStart || busy}>
            {busy ? 'Starting…' : 'Start match'}
          </button>
          {!canStart && (
            <div className="faint" style={{ fontSize: 12, textAlign: 'center' }}>
              Need at least {MIN_PLAYERS} players to start.
            </div>
          )}
        </div>
      ) : (
        <div className="notice" style={{ textAlign: 'center' }}>
          Waiting for the host to start the match…
        </div>
      )}
    </div>
  );
}

