import { nanoid } from 'nanoid';
import { db, persist } from '../db.js';
import {
  hashPassword,
  verifyPassword,
  generateToken,
  authMiddleware,
} from '../auth.js';
import { sanitizeInput } from '../security.js';
import { logger } from '../logger.js';
import { recordLog } from '../auth.js';
import { sanitizeUser, ensureUserShape } from '../utils/userUtils.js';
import {
  startMfaChallenge,
  verifyMfaToken,
} from '../services/mfaService.js';

// 用户注册
export const register = async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!email || !password || !name) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const existingUser = db.data.users.find((u) => u.email === normalizedEmail);
    if (existingUser) {
      return res.status(409).json({ message: 'Email is already registered' });
    }

    const passwordHash = await hashPassword(password);
    const now = new Date().toISOString();
    const user = {
      id: nanoid(),
      name: sanitizeInput(name),
      email: normalizedEmail,
      passwordHash,
      friends: [],
      roles: ['user'],
      createdAt: now,
      updatedAt: now,
    };

    const doubleCheck = db.data.users.find((u) => u.email === normalizedEmail);
    if (doubleCheck) {
      return res.status(409).json({ message: 'Email is already registered' });
    }

    db.data.users.push(user);
    persist();
    recordLog('info', 'User registered successfully', { userId: user.id });
    return res.status(201).json({ user: sanitizeUser(user) });
  } catch (error) {
    logger.error(`Registration failed: ${error.message}`);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const login = async (req, res) => {
  const { email, password } = req.body;
  const ip = req.ip || req.connection.remoteAddress;

  const normalizedEmail = email.toLowerCase().trim();

  const user = db.data.users.find((u) => u.email === normalizedEmail);
  if (!user) {
    return res.status(401).json({ message: 'Invalid email or password' });
  }
  ensureUserShape(user);
  const match = await verifyPassword(password, user.passwordHash);
  if (!match) {
    return res.status(401).json({ message: 'Invalid email or password' });
  }

  const { challengeId, code } = await startMfaChallenge(user, ip);

  return res.json({ requiresMfa: true, challengeId, mfaCode: code });
};

export const verifyMfa = (req, res) => {
  const { challengeId, token } = req.body;
  const ip = req.ip || req.connection.remoteAddress;

  const result = verifyMfaToken(challengeId, token, ip);
  if (!result.ok) {
    return res.status(result.status).json({ message: result.message });
  }

  const jwtToken = generateToken(result.rawUser);
  return res.json({ token: jwtToken, user: result.user });
};

export const me = (req, res) => {
  res.json({ user: sanitizeUser(req.user) });
};

export { authMiddleware };


