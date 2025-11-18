import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuthStore } from '../store/useAuthStore.js';

function LoginPage() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((state) => state.setAuth);
  const setPendingChallenge = useAuthStore((state) => state.setPendingChallenge);
  const [form, setForm] = useState({ email: '', password: '', name: '' });
  const [mode, setMode] = useState('login');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      if (mode === 'register') {
        await api.post('/auth/register', {
          name: form.name,
          email: form.email,
          password: form.password,
        });
        setMode('login');
        setError('注册成功，请登录');
      } else {
        const { data } = await api.post('/auth/login', {
          email: form.email,
          password: form.password,
        });
        if (data.requiresMfa) {
          setPendingChallenge(data.challengeId);
          navigate('/mfa');
        } else {
          setAuth({ token: data.token, user: data.user });
          navigate('/app');
        }
      }
    } catch (err) {
      setError(err.response?.data?.message || '操作失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="auth-card">
        <h1>YouChat 安全通讯</h1>
        <p>支持 MFA、加密消息、文件共享与实时协作</p>
        <form onSubmit={handleSubmit}>
          {mode === 'register' && (
            <div className="form-group">
              <label htmlFor="name">姓名</label>
              <input
                id="name"
                name="name"
                type="text"
                value={form.name}
                onChange={handleChange}
                placeholder="请输入您的姓名"
                required
              />
            </div>
          )}
          <div className="form-group">
            <label htmlFor="email">邮箱</label>
            <input
              id="email"
              type="email"
              name="email"
              value={form.email}
              onChange={handleChange}
              placeholder="example@email.com"
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="password">密码</label>
            <input
              id="password"
              type="password"
              name="password"
              value={form.password}
              onChange={handleChange}
              placeholder="请输入密码"
              required
            />
          </div>
          {error && (
            <div className={error.includes('成功') ? 'success-message' : 'error-message'}>
              {error}
            </div>
          )}
          <button className="btn primary btn-lg" type="submit" disabled={loading}>
            {loading ? (
              <>
                <span className="loading dark"></span>
                处理中...
              </>
            ) : (
              mode === 'login' ? '登录' : '注册'
            )}
          </button>
        </form>
        <div className="auth-footer">
          {mode === 'login' ? '还没有账号？' : '已有账号？'}
          <button
            type="button"
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login');
              setError('');
            }}
          >
            {mode === 'login' ? '立即注册' : '去登录'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default LoginPage;



