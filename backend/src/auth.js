import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { db, persist } from './db.js';
import { logger } from './logger.js';

export const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const TOKEN_EXPIRY = '8h';

export async function hashPassword(plainText) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(plainText, salt);
}

export async function verifyPassword(plainText, hash) {
  return bcrypt.compare(plainText, hash);
}

export function generateToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      name: user.name,
      roles: user.roles ?? [],
    },
    JWT_SECRET,
    { expiresIn: TOKEN_EXPIRY }
  );
}

// JWT 鉴权中间件
export function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ message: 'Missing Authorization header' });
  }

  const [, token] = authHeader.split(' ');
  if (!token) {
    return res.status(401).json({ message: 'Invalid Authorization header format' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.data.users.find((u) => u.id === payload.sub);
    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }
    if (!Array.isArray(user.friends)) {
      user.friends = [];
    }
    req.user = user;
    next();
  } catch (err) {
    logger.error(`JWT validation failed: ${err.message}`);
    return res.status(401).json({ message: 'Token is invalid or expired' });
  }
}

export function recordLog(level, message, context = {}) {
  const entry = {
    id: crypto.randomUUID(),
    level,
    message,
    context,
    timestamp: new Date().toISOString(),
  };
  db.data.logs.push(entry);
  persist();
  logger.log(level, message, context);
  return entry;
}

