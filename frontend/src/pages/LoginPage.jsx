import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuthStore } from '../store/useAuthStore.js';

function LoginPage() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((state) => state.setAuth);
  const setPendingChallenge = useAuthStore((state) => state.setPendingChallenge);
  const setMfaDebugCode = useAuthStore((state) => state.setMfaDebugCode);
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
        setError('Registration successful, please sign in');
      } else {
        const { data } = await api.post('/auth/login', {
          email: form.email,
          password: form.password,
        });
        if (data.requiresMfa) {
          setPendingChallenge(data.challengeId);
          if (data.mfaCode) {
            setMfaDebugCode(data.mfaCode);
          }
          navigate('/mfa');
        } else {
          setAuth({ token: data.token, user: data.user });
          setMfaDebugCode(null);
          navigate('/app');
        }
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Operation failed, please try again');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="auth-card">
        <h1>YouChat Secure Communication</h1>
        <p>Supports MFA, encrypted messages, file sharing and realtime collaboration</p>
        <form onSubmit={handleSubmit}>
          {mode === 'register' && (
            <div className="form-group">
            <label htmlFor="name">Name</label>
              <input
                id="name"
                name="name"
                type="text"
                value={form.name}
                onChange={handleChange}
                placeholder="Enter your name"
                required
              />
            </div>
          )}
          <div className="form-group">
            <label htmlFor="email">Email</label>
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
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              name="password"
              value={form.password}
              onChange={handleChange}
                placeholder="Enter your password"
              required
            />
          </div>
          {error && (
            <div className={error.toLowerCase().includes('success') ? 'success-message' : 'error-message'}>
              {error}
            </div>
          )}
          <button className="btn primary btn-lg" type="submit" disabled={loading}>
            {loading ? (
              <>
                <span className="loading dark"></span>
                Processing...
              </>
            ) : (
              mode === 'login' ? 'Sign in' : 'Sign up'
            )}
          </button>
        </form>
        <div className="auth-footer">
          {mode === 'login' ? "Don't have an account yet?" : 'Already have an account?'}
          <button
            type="button"
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login');
              setError('');
            }}
          >
            {mode === 'login' ? 'Sign up' : 'Sign in'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default LoginPage;



