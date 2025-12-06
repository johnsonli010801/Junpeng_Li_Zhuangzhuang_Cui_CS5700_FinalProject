import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuthStore } from '../store/useAuthStore.js';

function MfaPage() {
  const navigate = useNavigate();
  const challengeId = useAuthStore((state) => state.pendingChallenge);
  const setPendingChallenge = useAuthStore((state) => state.setPendingChallenge);
  const setAuth = useAuthStore((state) => state.setAuth);
  const setMfaDebugCode = useAuthStore((state) => state.setMfaDebugCode);
  const token = useAuthStore((state) => state.token);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!challengeId && !token) {
      navigate('/login', { replace: true });
    } else if (token) {
      navigate('/app', { replace: true });
    }
  }, [challengeId, token, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const { data } = await api.post('/auth/mfa/verify', {
        challengeId,
        token: code,
      });
      setAuth({ token: data.token, user: data.user });
      setPendingChallenge(null);
      setMfaDebugCode(null);
      navigate('/app', { replace: true });
    } catch (err) {
      setError(err.response?.data?.message || 'Invalid verification code, please try again');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mfa-page">
      <div className="auth-card">
        <h1>🔐 Multi-factor authentication</h1>
        <p>A 6-digit login verification code has been sent to your email via Google email service.</p>
        <p>Please enter the code within 5 minutes to complete login.</p>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="mfa-code">MFA verification code</label>
            <input
              id="mfa-code"
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              maxLength={6}
              placeholder="000000"
              style={{ fontSize: '1.5rem', textAlign: 'center', letterSpacing: '0.5rem' }}
              required
              autoFocus
            />
          </div>
          {error && (
            <div className="error-message">
              {error}
            </div>
          )}
          <button className="btn primary btn-lg" type="submit" disabled={loading || code.length !== 6}>
            {loading ? (
              <>
                <span className="loading dark"></span>
                Verifying...
              </>
            ) : (
              'Verify and sign in'
            )}
          </button>
        </form>
        <div className="auth-footer">
          <button type="button" onClick={() => navigate('/login')}>
            ← Back to login
          </button>
        </div>
      </div>
    </div>
  );
}

export default MfaPage;



