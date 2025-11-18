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
    // 图片
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/bmp',
    'image/svg+xml',
    
    // 文档
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'text/csv',
    
    // 压缩文件
    'application/zip',
    'application/x-zip-compressed',
    'application/x-rar-compressed',
    'application/x-7z-compressed',
    
    // 音频
    'audio/mpeg',        // mp3
    'audio/mp3',         // mp3 alternative
    'audio/wav',         // wav
    'audio/wave',        // wav alternative
    'audio/x-wav',       // wav alternative
    'audio/ogg',         // ogg
    'audio/aac',         // aac
    'audio/mp4',         // m4a
    'audio/x-m4a',       // m4a alternative
    
    // 视频
    'video/mp4',         // mp4
    'video/mpeg',        // mpeg
    'video/quicktime',   // mov
    'video/x-msvideo',   // avi
    'video/webm',        // webm
  ];
  
  const maxSize = 25 * 1024 * 1024; // 25MB
  
  if (!allowedTypes.includes(file.mimetype)) {
    return {
      valid: false,
      error: `不支持的文件类型: ${file.mimetype}。支持图片、文档、音频、视频、压缩包。`,
    };
  }
  
  if (file.size > maxSize) {
    const sizeMB = (file.size / 1024 / 1024).toFixed(2);
    return {
      valid: false,
      error: `文件大小${sizeMB}MB超过25MB限制`,
    };
  }
  
  return { valid: true };
}

export function sanitizeInput(input) {
  if (typeof input !== 'string') return input;
  
  return input
    // 移除所有HTML标签
    .replace(/<[^>]*>/g, '')
    // 移除javascript:协议
    .replace(/javascript:/gi, '')
    // 移除on事件处理器
    .replace(/on\w+\s*=/gi, '')
    // 移除危险字符
    .replace(/[<>'"]/g, '')
    // 移除控制字符（保留换行和制表符）
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .trim()
    .slice(0, 5000);
}



