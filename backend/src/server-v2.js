import express from 'express';
import cors from 'cors';
import multer from 'multer';
import speakeasy from 'speakeasy';
import { nanoid } from 'nanoid';
import { createServer } from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';

import { initDatabase, query } from './database.js';
import { logger } from './logger.js';
import * as usersDao from './dao/users.js';
import * as conversationsDao from './dao/conversations.js';
import * as messagesDao from './dao/messages.js';
import * as friendsDao from './dao/friends.js';
import * as logsDao from './dao/logs.js';
import {
  hashPassword,
  verifyPassword,
  generateToken,
  JWT_SECRET,
} from './auth.js';
import {
  validateFileUpload,
  sanitizeInput,
} from './security.js';

const app = express();
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true,
  },
});

const uploadDir = join(process.cwd(), '..', 'uploads');
if (!existsSync(uploadDir)) {
  mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) =>
    cb(null, `${Date.now()}-${nanoid(6)}-${file.originalname}`),
});
const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
});

const pendingMfaChallenges = new Map();
const onlineUsers = new Map(); // userId -> Set<socketId>

// 初始化数据库
await initDatabase();

app.use(cors());
app.use(express.json({ limit: '2mb' }));

// 认证中间件
async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ message: '未授权' });
  }

  const [, token] = authHeader.split(' ');
  if (!token) {
    return res.status(401).json({ message: '令牌格式错误' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await usersDao.findUserById(payload.sub);
    if (!user) {
      return res.status(401).json({ message: '用户不存在' });
    }
    req.user = user;
    next();
  } catch (err) {
    logger.error(`JWT verification failed: ${err.message}`);
    return res.status(401).json({ message: '令牌无效或已过期' });
  }
}

// 记录日志
async function recordLog(level, message, context = {}) {
  try {
    await logsDao.createLog({
      id: crypto.randomUUID(),
      level,
      message,
      userId: context.userId || null,
      ipAddress: context.ip || null,
      userAgent: context.userAgent || null,
      context,
    });
    logger.log(level, message, context);
  } catch (error) {
    logger.error('记录日志失败:', error);
  }
}

function sanitizeUser(user) {
  const { password_hash, mfa_secret, mfa_temp_secret, ...rest } = user;
  return rest;
}

// ==================== API 路由 ====================

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), db: 'postgresql' });
});

// 注册
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!email || !password || !name) {
      return res.status(400).json({ message: '缺少必要字段' });
    }

    const existing = await usersDao.findUserByEmail(email);
    if (existing) {
      return res.status(409).json({ message: '邮箱已注册' });
    }

    const passwordHash = await hashPassword(password);
    const user = await usersDao.createUser({
      id: nanoid(),
      name,
      email,
      passwordHash,
    });

    // 加入默认群组
    try {
      await conversationsDao.addConversationMember('general', user.id, 'member');
    } catch (error) {
      // 默认群组可能不存在，忽略
    }

    await recordLog('info', '用户注册成功', { userId: user.id });
    res.status(201).json({ user: sanitizeUser(user) });
  } catch (error) {
    logger.error(`注册失败: ${error.message}`);
    res.status(500).json({ message: '服务器错误' });
  }
});

// 登录
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const ip = req.ip || req.connection.remoteAddress;

    // 检查登录尝试
    const attempts = await logsDao.getRecentLoginAttempts(email, 15);
    const failedAttempts = attempts.filter(a => !a.success);
    if (failedAttempts.length >= 5) {
      return res.status(429).json({
        message: '登录尝试过多，请15分钟后重试',
      });
    }

    const user = await usersDao.findUserByEmail(email);
    if (!user) {
      await logsDao.createLoginAttempt({
        id: crypto.randomUUID(),
        email,
        success: false,
        ipAddress: ip,
        userAgent: req.headers['user-agent'],
      });
      return res.status(401).json({ message: '账号或密码错误' });
    }

    const match = await verifyPassword(password, user.password_hash);
    if (!match) {
      await logsDao.createLoginAttempt({
        id: crypto.randomUUID(),
        email,
        success: false,
        ipAddress: ip,
        userAgent: req.headers['user-agent'],
      });
      return res.status(401).json({ message: '账号或密码错误' });
    }

    if (user.mfa_enabled) {
      const challengeId = nanoid();
      pendingMfaChallenges.set(challengeId, {
        userId: user.id,
        expiresAt: Date.now() + 5 * 60 * 1000,
      });
      return res.json({ requiresMfa: true, challengeId });
    }

    const token = generateToken(user);
    await logsDao.createLoginAttempt({
      id: crypto.randomUUID(),
      email,
      success: true,
      ipAddress: ip,
      userAgent: req.headers['user-agent'],
    });
    await recordLog('info', '用户登录', { userId: user.id, ip });
    
    res.json({ token, user: sanitizeUser(user) });
  } catch (error) {
    logger.error(`登录失败: ${error.message}`);
    res.status(500).json({ message: '服务器错误' });
  }
});

// MFA 设置
app.post('/api/auth/mfa/setup', authMiddleware, async (req, res) => {
  try {
    const secret = speakeasy.generateSecret({
      name: `YouChat (${req.user.email})`,
      length: 20,
    });
    
    await usersDao.updateUser(req.user.id, { mfa_temp_secret: secret.base32 });
    
    res.json({
      secret: secret.base32,
      otpauth_url: secret.otpauth_url,
    });
  } catch (error) {
    logger.error(`MFA setup failed: ${error.message}`);
    res.status(500).json({ message: '服务器错误' });
  }
});

// MFA 启用
app.post('/api/auth/mfa/enable', authMiddleware, async (req, res) => {
  try {
    const { token } = req.body;
    const user = await usersDao.findUserById(req.user.id);
    
    if (!user.mfa_temp_secret) {
      return res.status(400).json({ message: '未发起 MFA 绑定' });
    }

    const verified = speakeasy.totp.verify({
      secret: user.mfa_temp_secret,
      encoding: 'base32',
      token,
    });

    if (!verified) {
      return res.status(400).json({ message: '验证码错误' });
    }

    await usersDao.updateUser(user.id, {
      mfa_secret: user.mfa_temp_secret,
      mfa_temp_secret: null,
      mfa_enabled: true,
    });

    await recordLog('info', '用户启用 MFA', { userId: user.id });
    res.json({ message: 'MFA 已启用' });
  } catch (error) {
    logger.error(`MFA enable failed: ${error.message}`);
    res.status(500).json({ message: '服务器错误' });
  }
});

// MFA 验证
app.post('/api/auth/mfa/verify', async (req, res) => {
  try {
    const { challengeId, token } = req.body;
    const challenge = pendingMfaChallenges.get(challengeId);
    
    if (!challenge || challenge.expiresAt < Date.now()) {
      return res.status(400).json({ message: '挑战已失效' });
    }

    const user = await usersDao.findUserById(challenge.userId);
    if (!user || !user.mfa_secret) {
      return res.status(400).json({ message: '用户未启用 MFA' });
    }

    const verified = speakeasy.totp.verify({
      secret: user.mfa_secret,
      encoding: 'base32',
      token,
    });

    if (!verified) {
      return res.status(400).json({ message: '验证码错误' });
    }

    pendingMfaChallenges.delete(challengeId);
    const jwtToken = generateToken(user);
    await recordLog('info', '用户通过 MFA 登录', { userId: user.id });
    
    res.json({ token: jwtToken, user: sanitizeUser(user) });
  } catch (error) {
    logger.error(`MFA verify failed: ${error.message}`);
    res.status(500).json({ message: '服务器错误' });
  }
});

// 获取当前用户信息
app.get('/api/me', authMiddleware, (req, res) => {
  res.json({ user: sanitizeUser(req.user) });
});

// 获取所有用户
app.get('/api/users', authMiddleware, async (_req, res) => {
  try {
    const users = await usersDao.getAllUsers();
    res.json({ users: users.map(sanitizeUser) });
  } catch (error) {
    logger.error(`Get users failed: ${error.message}`);
    res.status(500).json({ message: '服务器错误' });
  }
});

// 好友相关
app.get('/api/friends', authMiddleware, async (req, res) => {
  try {
    const friends = await friendsDao.getUserFriends(req.user.id);
    const requests = await friendsDao.getFriendRequests(req.user.id);
    res.json({ friends, requests });
  } catch (error) {
    logger.error(`Get friends failed: ${error.message}`);
    res.status(500).json({ message: '服务器错误' });
  }
});

app.post('/api/friends/request', authMiddleware, async (req, res) => {
  try {
    const { targetEmail, targetUserId } = req.body;
    
    const target = targetEmail
      ? await usersDao.findUserByEmail(targetEmail)
      : await usersDao.findUserById(targetUserId);

    if (!target) {
      return res.status(404).json({ message: '用户不存在' });
    }

    if (target.id === req.user.id) {
      return res.status(400).json({ message: '不能添加自己为好友' });
    }

    const areFriends = await friendsDao.areFriends(req.user.id, target.id);
    if (areFriends) {
      return res.status(409).json({ message: '已是好友' });
    }

    const pending = await friendsDao.findPendingRequest(req.user.id, target.id);
    if (pending) {
      return res.status(409).json({ message: '已存在待处理的好友请求' });
    }

    const request = await friendsDao.createFriendRequest({
      id: nanoid(),
      fromId: req.user.id,
      toId: target.id,
    });

    await recordLog('info', '发起好友请求', { from: req.user.id, to: target.id });
    
    // 通知目标用户
    io.to(`user:${target.id}`).emit('friends:update', {});
    
    res.status(201).json({ request });
  } catch (error) {
    logger.error(`Friend request failed: ${error.message}`);
    res.status(500).json({ message: '服务器错误' });
  }
});

app.post('/api/friends/respond', authMiddleware, async (req, res) => {
  try {
    const { requestId, action } = req.body;
    
    if (!['accept', 'decline'].includes(action)) {
      return res.status(400).json({ message: '无效操作' });
    }

    const request = await friendsDao.respondToFriendRequest(requestId, action);
    
    await recordLog('info', `好友请求${action === 'accept' ? '已接受' : '被拒绝'}`, {
      requestId,
      from: request.from_id,
      to: request.to_id,
    });

    // 通知双方
    io.to(`user:${request.from_id}`).emit('friends:update', {});
    io.to(`user:${request.to_id}`).emit('friends:update', {});

    res.json({ request });
  } catch (error) {
    logger.error(`Friend respond failed: ${error.message}`);
    res.status(500).json({ message: error.message || '服务器错误' });
  }
});

// 会话相关
app.get('/api/conversations', authMiddleware, async (req, res) => {
  try {
    const conversations = await conversationsDao.getUserConversations(req.user.id);
    res.json({ conversations });
  } catch (error) {
    logger.error(`Get conversations failed: ${error.message}`);
    res.status(500).json({ message: '服务器错误' });
  }
});

app.post('/api/conversations', authMiddleware, async (req, res) => {
  try {
    const { name, memberIds = [], isGroup = true } = req.body;
    
    if (!name) {
      return res.status(400).json({ message: '缺少会话名称' });
    }

    const participants = Array.from(new Set([req.user.id, ...memberIds]));
    
    if (!isGroup && participants.length !== 2) {
      return res.status(400).json({ message: '私聊需要且仅能有两位成员' });
    }

    // 检查私聊是否已存在
    if (!isGroup) {
      const otherId = participants.find(id => id !== req.user.id);
      const existing = await conversationsDao.findDirectConversation(req.user.id, otherId);
      if (existing) {
        return res.json({ conversation: existing });
      }
    }

    const conversation = await conversationsDao.createConversation({
      id: nanoid(),
      name,
      isGroup,
      createdBy: req.user.id,
      memberIds: participants.filter(id => id !== req.user.id),
    });

    await recordLog('info', '创建会话', { conversationId: conversation.id });
    res.status(201).json({ conversation });
  } catch (error) {
    logger.error(`Create conversation failed: ${error.message}`);
    res.status(500).json({ message: '服务器错误' });
  }
});

app.get('/api/conversations/:id/messages', authMiddleware, async (req, res) => {
  try {
    const conversation = await conversationsDao.getConversationById(req.params.id);
    if (!conversation || !conversation.members.includes(req.user.id)) {
      return res.status(404).json({ message: '会话不存在或无权限' });
    }

    const messages = await messagesDao.getConversationMessages(req.params.id);
    res.json({ messages });
  } catch (error) {
    logger.error(`Get messages failed: ${error.message}`);
    res.status(500).json({ message: '服务器错误' });
  }
});

// 文件上传
app.post('/api/files/upload', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    const { conversationId } = req.body;
    const conversation = await conversationsDao.getConversationById(conversationId);
    
    if (!conversation || !conversation.members.includes(req.user.id)) {
      return res.status(403).json({ message: '无权上传到该会话' });
    }

    const validation = validateFileUpload(req.file);
    if (!validation.valid) {
      return res.status(400).json({ message: validation.error });
    }

    const fileId = nanoid();
    await query(
      `INSERT INTO files (id, conversation_id, uploader_id, original_name, stored_name, mime_type, size_bytes, path)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [fileId, conversationId, req.user.id, sanitizeInput(req.file.originalname), 
       req.file.filename, req.file.mimetype, req.file.size, req.file.filename]
    );

    const message = await messagesDao.createMessage({
      id: nanoid(),
      conversationId,
      senderId: req.user.id,
      type: 'file',
      content: `${req.user.name} 分享了文件`,
      fileId,
    });

    io.to(conversationId).emit('message:new', message);
    await recordLog('info', '文件上传', { conversationId, fileId, uploaderId: req.user.id });
    
    res.status(201).json({ file: { id: fileId }, message });
  } catch (error) {
    logger.error(`File upload failed: ${error.message}`);
    res.status(500).json({ message: '服务器错误' });
  }
});

app.get('/api/files/:fileId', authMiddleware, async (req, res) => {
  try {
    const fileResult = await query('SELECT * FROM files WHERE id = $1', [req.params.fileId]);
    if (fileResult.rows.length === 0) {
      return res.status(404).json({ message: '文件不存在' });
    }

    const file = fileResult.rows[0];
    const conversation = await conversationsDao.getConversationById(file.conversation_id);
    
    if (!conversation || !conversation.members.includes(req.user.id)) {
      return res.status(403).json({ message: '无权访问该文件' });
    }

    res.sendFile(join(uploadDir, file.path));
  } catch (error) {
    logger.error(`File download failed: ${error.message}`);
    res.status(500).json({ message: '服务器错误' });
  }
});

// 日志和仪表盘
app.get('/api/logs', authMiddleware, async (_req, res) => {
  try {
    const logs = await logsDao.getRecentLogs(100);
    res.json({ logs });
  } catch (error) {
    logger.error(`Get logs failed: ${error.message}`);
    res.status(500).json({ message: '服务器错误' });
  }
});

app.get('/api/dashboard/summary', authMiddleware, async (_req, res) => {
  try {
    const [usersCount, convsCount, messagesCount, filesCount] = await Promise.all([
      query('SELECT COUNT(*) FROM users'),
      query('SELECT COUNT(*) FROM conversations'),
      query('SELECT COUNT(*) FROM messages'),
      query('SELECT COUNT(*) FROM files'),
    ]);

    res.json({
      users: parseInt(usersCount.rows[0].count),
      conversations: parseInt(convsCount.rows[0].count),
      messages: parseInt(messagesCount.rows[0].count),
      files: parseInt(filesCount.rows[0].count),
      onlineUsers: onlineUsers.size,
    });
  } catch (error) {
    logger.error(`Dashboard summary failed: ${error.message}`);
    res.status(500).json({ message: '服务器错误' });
  }
});

app.get('/api/dashboard/activity', authMiddleware, async (_req, res) => {
  try {
    const messagesPerDay = await query(`
      SELECT DATE(created_at) as day, COUNT(*) as count
      FROM messages
      WHERE created_at > NOW() - INTERVAL '30 days'
      GROUP BY DATE(created_at)
      ORDER BY day
    `);

    const recentConnections = await logsDao.getRecentLogs(50);

    res.json({
      messagesPerDay: messagesPerDay.rows,
      recentConnections: recentConnections.filter(log => log.message.includes('连接')),
    });
  } catch (error) {
    logger.error(`Dashboard activity failed: ${error.message}`);
    res.status(500).json({ message: '服务器错误' });
  }
});

// ==================== Socket.IO ====================

io.use(async (socket, next) => {
  const { token } = socket.handshake.auth || {};
  if (!token) {
    return next(new Error('未授权'));
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await usersDao.findUserById(payload.sub);
    if (!user) {
      return next(new Error('用户不存在'));
    }
    socket.user = user;
    next();
  } catch (error) {
    next(new Error('令牌无效'));
  }
});

io.on('connection', (socket) => {
  const user = socket.user;
  
  // 加入用户专属房间
  socket.join(`user:${user.id}`);
  
  // 记录在线状态
  if (!onlineUsers.has(user.id)) {
    onlineUsers.set(user.id, new Set());
  }
  onlineUsers.get(user.id).add(socket.id);
  
  recordLog('info', '实时连接建立', { userId: user.id });
  socket.emit('system:online', { message: '已连接', timestamp: new Date().toISOString() });

  // 加入会话
  socket.on('conversation:join', async ({ conversationId }) => {
    try {
      const conversation = await conversationsDao.getConversationById(conversationId);
      if (!conversation || !conversation.members.includes(user.id)) {
        return socket.emit('error', { message: '无权加入该会话' });
      }
      socket.join(conversationId);
      socket.emit('conversation:joined', { conversationId });
      await recordLog('info', '加入会话', { userId: user.id, conversationId });
    } catch (error) {
      socket.emit('error', { message: '加入会话失败' });
    }
  });

  socket.on('conversation:leave', ({ conversationId }) => {
    socket.leave(conversationId);
    socket.emit('conversation:left', { conversationId });
  });

  // 发送消息
  socket.on('message:send', async ({ conversationId, content }) => {
    try {
      const conversation = await conversationsDao.getConversationById(conversationId);
      if (!conversation || !conversation.members.includes(user.id)) {
        return socket.emit('error', { message: '无法发送到该会话' });
      }

      const message = await messagesDao.createMessage({
        id: nanoid(),
        conversationId,
        senderId: user.id,
        content: sanitizeInput(content),
        type: 'text',
      });

      io.to(conversationId).emit('message:new', {
        ...message,
        sender_name: user.name,
      });

      await recordLog('info', '发送消息', { userId: user.id, conversationId });
    } catch (error) {
      logger.error(`Send message failed: ${error.message}`);
      socket.emit('error', { message: '发送失败' });
    }
  });

  // 输入状态
  socket.on('typing:start', ({ conversationId }) => {
    socket.to(conversationId).emit('typing:user', {
      conversationId,
      userId: user.id,
      userName: user.name,
      isTyping: true,
    });
  });

  socket.on('typing:stop', ({ conversationId }) => {
    socket.to(conversationId).emit('typing:user', {
      conversationId,
      userId: user.id,
      isTyping: false,
    });
  });

  // 视频通话信令
  socket.on('call:invite', ({ conversationId }) => {
    console.log(`[Call] ${user.name} 发起呼叫到会话 ${conversationId}`);
    socket.to(conversationId).emit('call:ring', {
      conversationId,
      from: { id: user.id, name: user.name },
    });
    recordLog('info', '发起视频通话', { userId: user.id, conversationId });
  });

  socket.on('call:accept', ({ conversationId }) => {
    console.log(`[Call] ${user.name} 接听呼叫 ${conversationId}`);
    socket.to(conversationId).emit('call:accept', { conversationId });
    recordLog('info', '接听视频通话', { userId: user.id, conversationId });
  });

  socket.on('call:decline', ({ conversationId }) => {
    console.log(`[Call] ${user.name} 拒绝呼叫 ${conversationId}`);
    socket.to(conversationId).emit('call:decline', { conversationId });
    recordLog('info', '拒绝视频通话', { userId: user.id, conversationId });
  });

  socket.on('call:end', ({ conversationId }) => {
    console.log(`[Call] ${user.name} 结束通话 ${conversationId}`);
    socket.to(conversationId).emit('call:end', { conversationId });
    recordLog('info', '结束视频通话', { userId: user.id, conversationId });
  });

  socket.on('webrtc:signal', ({ conversationId, payload }) => {
    console.log(`[WebRTC] ${user.name} 发送信令 ${payload.type} 到 ${conversationId}`);
    socket.to(conversationId).emit('webrtc:signal', {
      from: user.id,
      conversationId,
      payload,
    });
  });

  // 断开连接
  socket.on('disconnect', () => {
    const userSockets = onlineUsers.get(user.id);
    if (userSockets) {
      userSockets.delete(socket.id);
      if (userSockets.size === 0) {
        onlineUsers.delete(user.id);
      }
    }
    recordLog('info', '实时连接断开', { userId: user.id });
  });
});

// 定期清理过期的 MFA 挑战
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of pendingMfaChallenges.entries()) {
    if (value.expiresAt < now) {
      pendingMfaChallenges.delete(key);
    }
  }
}, 60 * 1000);

const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () => {
  logger.info(`Backend (PostgreSQL) listening on http://localhost:${PORT}`);
});

