import crypto from 'node:crypto';
import { db, persist } from './db.js';
import { recordLog } from './auth.js';

const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION = 15 * 60 * 1000; // 15分钟

export function initSecurityData() {
  if (!db.data.loginAttempts) {
    db.data.loginAttempts = [];
  }
  if (!db.data.sessions) {
    db.data.sessions = [];
  }
}

export function checkLoginAttempts(email) {
  initSecurityData();
  const now = Date.now();
  const attempts = db.data.loginAttempts.filter(
    (a) => a.email === email && now - new Date(a.timestamp).getTime() < LOCKOUT_DURATION
  );
  
  if (attempts.length >= MAX_LOGIN_ATTEMPTS) {
    const oldestAttempt = new Date(attempts[0].timestamp).getTime();
    const remainingTime = Math.ceil((LOCKOUT_DURATION - (now - oldestAttempt)) / 1000 / 60);
    return {
      locked: true,
      remainingMinutes: remainingTime,
    };
  }
  
  return { locked: false };
}

export function recordLoginAttempt(email, success, ip) {
  initSecurityData();
  db.data.loginAttempts.push({
    id: crypto.randomUUID(),
    email,
    success,
    ip,
    timestamp: new Date().toISOString(),
  });
  
  // 清理30分钟前的记录
  const cutoff = Date.now() - 30 * 60 * 1000;
  db.data.loginAttempts = db.data.loginAttempts.filter(
    (a) => new Date(a.timestamp).getTime() > cutoff
  );
  
  persist();
  
  if (!success) {
    recordLog('warn', '登录失败', { email, ip });
  }
}

export function createSession(userId, token, ip, userAgent) {
  initSecurityData();
  const session = {
    id: crypto.randomUUID(),
    userId,
    token,
    ip,
    userAgent,
    createdAt: new Date().toISOString(),
    lastActivity: new Date().toISOString(),
  };
  
  db.data.sessions.push(session);
  persist();
  return session;
}

export function validateFileUpload(file) {
  const allowedTypes = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'application/zip',
  ];
  
  const maxSize = 25 * 1024 * 1024; // 25MB
  
  if (!allowedTypes.includes(file.mimetype)) {
    return {
      valid: false,
      error: '不支持的文件类型',
    };
  }
  
  if (file.size > maxSize) {
    return {
      valid: false,
      error: '文件大小超过25MB限制',
    };
  }
  
  return { valid: true };
}

export function sanitizeInput(input) {
  if (typeof input !== 'string') return input;
  return input
    .replace(/[<>]/g, '')
    .trim()
    .slice(0, 5000);
}

