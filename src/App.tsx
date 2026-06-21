import type { ReactNode } from 'react';
import { Navigate, Route, BrowserRouter, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthProvider';
import Login from './pages/Login';
import Home from './pages/Home';
import Admin from './pages/Admin';
import MatchLobby from './pages/MatchLobby';

function Loading() {
  return (
    <div className="app-frame">
      <div className="screen center-screen"><div className="spinner" /></div>
    </div>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RequireAdmin({ children }: { children: ReactNode }) {
  const { profile, loading } = useAuth();
  if (loading) return <Loading />;
  if (!profile?.isAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  const { user, loading } = useAuth();

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/login"
          element={loading ? <Loading /> : user ? <Navigate to="/" replace /> : <div className="app-frame"><Login /></div>}
        />
        <Route
          path="/"
          element={<RequireAuth><div className="app-frame"><Home /></div></RequireAuth>}
        />
        <Route path="/match/:matchId" element={<RequireAuth><MatchLobby /></RequireAuth>} />
        <Route path="/admin" element={<RequireAdmin><Admin /></RequireAdmin>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
