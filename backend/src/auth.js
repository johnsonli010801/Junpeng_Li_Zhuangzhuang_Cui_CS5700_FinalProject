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

export function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ message: '缺少授权头' });
  }

  const [, token] = authHeader.split(' ');
  if (!token) {
    return res.status(401).json({ message: '授权头格式错误' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.data.users.find((u) => u.id === payload.sub);
    if (!user) {
      return res.status(401).json({ message: '用户不存在' });
    }
    if (!Array.isArray(user.friends)) {
      user.friends = [];
    }
    req.user = user;
    next();
  } catch (err) {
    logger.error(`JWT 验证失败: ${err.message}`);
    return res.status(401).json({ message: '令牌无效或已过期' });
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

