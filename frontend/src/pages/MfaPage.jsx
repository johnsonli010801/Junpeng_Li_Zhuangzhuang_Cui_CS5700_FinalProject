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
        <h1>多因素认证</h1>
        <p>请输入手机或身份验证器上的 6 位动态码</p>
        <form onSubmit={handleSubmit}>
          <label>
            MFA 验证码
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              maxLength={6}
              required
            />
          </label>
          {error && <small style={{ color: '#e11d48' }}>{error}</small>}
          <button className="btn primary" type="submit" disabled={loading}>
            {loading ? '验证中...' : '验证'}
          </button>
        </form>
        <button className="btn secondary" onClick={() => navigate('/login')}>
          返回登录
        </button>
      </div>
    </div>
  );
}

export default MfaPage;

