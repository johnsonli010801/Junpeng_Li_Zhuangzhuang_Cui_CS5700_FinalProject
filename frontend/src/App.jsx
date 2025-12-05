import { Link, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { LoginPage, MfaPage } from './features/auth/index.js';
import { ChatPage } from './features/chat/index.js';
import { DashboardPage } from './features/dashboard/index.js';
import { useAuthStore } from './store/useAuthStore.js';
import './App.css';

function ProtectedLayout() {
  const location = useLocation();
  const token = useAuthStore((state) => state.token);
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);

  if (!token) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1>YouChat Realtime Collaboration</h1>
          <p className="subtitle">Secure · Realtime · Collaborative</p>
        </div>
        <nav className="app-nav">
          <Link to="/app" className={location.pathname === '/app' ? 'active' : ''}>
            Chat
          </Link>
          <Link
            to="/dashboard"
            className={location.pathname === '/dashboard' ? 'active' : ''}
          >
            Dashboard
          </Link>
        </nav>
        <div className="user-chip">
          <span>{user?.name}</span>
          <button onClick={logout}>Sign out</button>
        </div>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/mfa" element={<MfaPage />} />
      <Route element={<ProtectedLayout />}>
        <Route index element={<Navigate to="/app" replace />} />
        <Route path="/app" element={<ChatPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/app" replace />} />
    </Routes>
  );
}

export default App;
