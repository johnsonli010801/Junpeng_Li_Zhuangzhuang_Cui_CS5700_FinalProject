import { create } from 'zustand';
import { setAuthToken } from '../api/client.js';

const storedToken = localStorage.getItem('youchat_token');
const storedUser = localStorage.getItem('youchat_user');

if (storedToken) {
  setAuthToken(storedToken);
}

export const useAuthStore = create((set) => ({
  token: storedToken,
  user: storedUser ? JSON.parse(storedUser) : null,
  pendingChallenge: null,
  mfaDebugCode: null,
  setPendingChallenge: (challengeId) => set({ pendingChallenge: challengeId }),
  setMfaDebugCode: (code) => set({ mfaDebugCode: code }),
  setAuth: ({ token, user }) => {
    if (token) {
      localStorage.setItem('youchat_token', token);
      setAuthToken(token);
    }
    if (user) {
      localStorage.setItem('youchat_user', JSON.stringify(user));
    }
    set({ token, user });
  },
  logout: () => {
    localStorage.removeItem('youchat_token');
    localStorage.removeItem('youchat_user');
    setAuthToken(null);
    set({ token: null, user: null });
  },
}));



