import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuthStore } from '../store/useAuthStore.js';

function MfaPage() {
  const navigate = useNavigate();
  const challengeId = useAuthStore((state) => state.pendingChallenge);
  const setPendingChallenge = useAuthStore((state) => state.setPendingChallenge);
  const setAuth = useAuthStore((state) => state.setAuth);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!challengeId) {
      navigate('/login');
    }
  }, [challengeId, navigate]);

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
      navigate('/app');
    } catch (err) {
      setError(err.response?.data?.message || '验证码错误，请重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mfa-page">
      <div className="auth-card">
        <h1>🔐 多因素认证</h1>
        <p>请输入身份验证器应用中的 6 位动态验证码</p>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="mfa-code">MFA 验证码</label>
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
                验证中...
              </>
            ) : (
              '验证并登录'
            )}
          </button>
        </form>
        <div className="auth-footer">
          <button type="button" onClick={() => navigate('/login')}>
            ← 返回登录
          </button>
        </div>
      </div>
    </div>
  );
}

export default MfaPage;



