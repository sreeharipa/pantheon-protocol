import { useState } from 'react';
import { useAuth } from '../auth/AuthProvider';

export default function Login() {
  const { signIn, configured } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSignIn() {
    setError(null);
    setBusy(true);
    try {
      await signIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen center-screen">
      <div className="stack" style={{ alignItems: 'center', gap: 18 }}>
        <div className="row" style={{ gap: 14, fontSize: 26 }}>
          <span className="mark gods">▲</span>
          <span className="mark titans">■</span>
          <span className="mark demigods">◆</span>
        </div>
        <div className="stack" style={{ alignItems: 'center', gap: 2 }}>
          <div className="wordmark" style={{ fontSize: 26 }}>Pantheon</div>
          <div className="wordmark" style={{ fontSize: 26 }}>Protocol</div>
        </div>
        <div className="eyebrow">Draft · Duel · Dominion</div>
      </div>

      <div className="stack" style={{ width: '100%', gap: 12, marginTop: 8 }}>
        {!configured && (
          <div className="notice warn">
            Firebase isn't configured yet. Add your project's web config to
            <code> .env.local</code> and reload to enable sign-in.
          </div>
        )}
        <button className="btn" onClick={handleSignIn} disabled={busy || !configured}>
          {busy ? 'Signing in…' : 'Continue with Google'}
        </button>
        {error && <div className="notice warn">{error}</div>}
      </div>
    </div>
  );
}
