import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuthStore } from '../store/useAuthStore.js';

function MfaPage() {
  const navigate = useNavigate();
  const challengeId = useAuthStore((state) => state.pendingChallenge);
  const setPendingChallenge = useAuthStore((state) => state.setPendingChallenge);
  const setAuth = useAuthStore((state) => state.setAuth);
  const token = useAuthStore((state) => state.token);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // 只有在没有 token 且没有 challengeId 的情况下才跳转回登录页
    // 这样可以避免验证成功后被重定向回登录页
    if (!challengeId && !token) {
      navigate('/login', { replace: true });
    } else if (token) {
      // 如果已经有 token（验证成功），直接跳转到应用
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
      // 先设置认证状态和清空挑战
      setAuth({ token: data.token, user: data.user });
      setPendingChallenge(null);
      // 使用 replace 而不是 push，避免返回到 MFA 页面
      navigate('/app', { replace: true });
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
        <p>我们已经向您的邮箱发送了 6 位登录验证码（通过 Mailtrap sandbox 模拟发送）。</p>
        <p>请在 5 分钟内输入该验证码完成登录。</p>
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



