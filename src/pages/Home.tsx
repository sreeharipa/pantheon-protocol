import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { createMatch, joinMatch } from '../firebase/matches';

export default function Home() {
  const { user, profile, signOut } = useAuth();
  const nav = useNavigate();
  const [joining, setJoining] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'new' | 'join' | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function handleNew() {
    if (!user) return;
    setBusy('new'); setErr(null);
    try {
      const { matchId } = await createMatch(user);
      nav(`/match/${matchId}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not create a match.');
      setBusy(null);
    }
  }

  async function handleJoin() {
    if (!user || !code.trim()) return;
    setBusy('join'); setErr(null);
    try {
      const matchId = await joinMatch(code, user);
      nav(`/match/${matchId}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not join.');
      setBusy(null);
    }
  }

  return (
    <div className="screen" style={{ gap: 20 }}>
      <header className="between">
        <div className="row" style={{ gap: 10 }}>
          <span className="mark gods" style={{ fontSize: 18 }}>▲</span>
          <span className="mark titans" style={{ fontSize: 18 }}>■</span>
          <span className="mark demigods" style={{ fontSize: 18 }}>◆</span>
          <span className="wordmark" style={{ fontSize: 13 }}>Pantheon</span>
        </div>
        <button className="btn ghost sm" onClick={() => void signOut()}>Sign out</button>
      </header>

      <div className="stack" style={{ gap: 4 }}>
        <div className="eyebrow">Welcome</div>
        <div className="h1">{profile?.displayName ?? 'Player'}</div>
      </div>

      <div className="stack" style={{ gap: 12 }}>
        <button className="btn" onClick={handleNew} disabled={busy !== null}>
          {busy === 'new' ? 'Creating…' : 'New Match'}
        </button>

        {!joining ? (
          <button className="btn secondary" onClick={() => setJoining(true)} disabled={busy !== null}>
            Join with Room Code
          </button>
        ) : (
          <div className="card" style={{ padding: 14 }}>
            <div className="stack" style={{ gap: 10 }}>
              <div className="field">
                <label>Room code</label>
                <input
                  className="input"
                  autoFocus
                  value={code}
                  placeholder="PNTH-XXXX"
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  onKeyDown={(e) => { if (e.key === 'Enter') void handleJoin(); }}
                />
              </div>
              <div className="row" style={{ gap: 8 }}>
                <button className="btn grow" onClick={handleJoin} disabled={busy !== null || !code.trim()}>
                  {busy === 'join' ? 'Joining…' : 'Join'}
                </button>
                <button className="btn ghost sm" onClick={() => { setJoining(false); setErr(null); }}>Cancel</button>
              </div>
            </div>
          </div>
        )}

        {err && <div className="notice warn">{err}</div>}
      </div>

      {profile?.isAdmin && (
        <Link to="/admin" className="card" style={{ padding: 16, textDecoration: 'none' }}>
          <div className="between">
            <div className="stack" style={{ gap: 2 }}>
              <div className="h2">Admin / Game-Master</div>
              <div className="faint" style={{ fontSize: 13 }}>Manage heroes, artifacts & balance</div>
            </div>
            <span style={{ fontSize: 20 }}>→</span>
          </div>
        </Link>
      )}

      <div className="grow" />
      <div className="notice">
        Create a match to get a room code, share it with 2–5 friends, then start. The Draft
        and Duel phases come in the next passes.
      </div>
    </div>
  );
}
