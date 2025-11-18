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

import { initDb, db, persist } from './db.js';
import {
  authMiddleware,
  generateToken,
  hashPassword,
  verifyPassword,
  recordLog,
  JWT_SECRET,
} from './auth.js';
import { logger } from './logger.js';
import {
  checkLoginAttempts,
  recordLoginAttempt,
  createSession,
  validateFileUpload,
  sanitizeInput,
} from './security.js';

const app = express();
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: '*',
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
const onlineUsers = new Map();

initDb();
hydrateLegacyData();
seedDefaultConversation();

app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!email || !password || !name) {
      return res.status(400).json({ message: '缺少必要字段' });
    }
    if (db.data.users.find((u) => u.email === email)) {
      return res.status(409).json({ message: '邮箱已注册' });
    }
    const passwordHash = await hashPassword(password);
    const now = new Date().toISOString();
    const user = {
      id: nanoid(),
      name,
      email,
      passwordHash,
      mfaEnabled: false,
      mfaSecret: null,
      friends: [],
      roles: ['user'],
      createdAt: now,
      updatedAt: now,
    };
    db.data.users.push(user);
    const general = db.data.conversations.find((c) => c.id === 'general');
    if (general && !general.members.includes(user.id)) {
      general.members.push(user.id);
    }
    persist();
    recordLog('info', '用户注册成功', { userId: user.id });
    res.status(201).json({ user: sanitizeUser(user) });
  } catch (error) {
    logger.error(`注册失败: ${error.message}`);
    res.status(500).json({ message: '服务器错误' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const ip = req.ip || req.connection.remoteAddress;
  
  // 检查登录尝试次数
  const attemptCheck = checkLoginAttempts(email);
  if (attemptCheck.locked) {
    return res.status(429).json({
      message: `登录尝试过多，请在 ${attemptCheck.remainingMinutes} 分钟后重试`,
    });
  }
  
  const user = db.data.users.find((u) => u.email === email);
  if (!user) {
    recordLoginAttempt(email, false, ip);
    return res.status(401).json({ message: '账号或密码错误' });
  }
  ensureUserShape(user);
  const match = await verifyPassword(password, user.passwordHash);
  if (!match) {
    recordLoginAttempt(email, false, ip);
    return res.status(401).json({ message: '账号或密码错误' });
  }

  if (user.mfaEnabled) {
    const challengeId = nanoid();
    pendingMfaChallenges.set(challengeId, {
      userId: user.id,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });
    return res.json({ requiresMfa: true, challengeId });
  }

  const token = generateToken(user);
  recordLoginAttempt(email, true, ip);
  createSession(user.id, token, ip, req.headers['user-agent']);
  recordLog('info', '用户登录', { userId: user.id, ip });
  return res.json({ token, user: sanitizeUser(user) });
});

app.post('/api/auth/mfa/setup', authMiddleware, (req, res) => {
  const secret = speakeasy.generateSecret({
    name: `YouChat (${req.user.email})`,
    length: 20,
  });
  req.user.mfaTempSecret = secret.base32;
  persist();
  res.json({
    secret: secret.base32,
    otpauth_url: secret.otpauth_url,
  });
});

app.post('/api/auth/mfa/enable', authMiddleware, (req, res) => {
  const { token } = req.body;
  if (!req.user.mfaTempSecret) {
    return res.status(400).json({ message: '未发起 MFA 绑定' });
  }

  const verified = speakeasy.totp.verify({
    secret: req.user.mfaTempSecret,
    encoding: 'base32',
    token,
  });
  if (!verified) {
    return res.status(400).json({ message: '验证码错误' });
  }

  req.user.mfaSecret = req.user.mfaTempSecret;
  req.user.mfaTempSecret = null;
  req.user.mfaEnabled = true;
  req.user.updatedAt = new Date().toISOString();
  persist();
  recordLog('info', '用户启用 MFA', { userId: req.user.id });
  res.json({ message: 'MFA 已启用' });
});

app.post('/api/auth/mfa/verify', (req, res) => {
  const { challengeId, token } = req.body;
  const challenge = pendingMfaChallenges.get(challengeId);
  if (!challenge || challenge.expiresAt < Date.now()) {
    return res.status(400).json({ message: '挑战已失效' });
  }
  const user = db.data.users.find((u) => u.id === challenge.userId);
  if (!user || !user.mfaSecret) {
    return res.status(400).json({ message: '用户未启用 MFA' });
  }

  const verified = speakeasy.totp.verify({
    secret: user.mfaSecret,
    encoding: 'base32',
    token,
  });

  if (!verified) {
    return res.status(400).json({ message: '验证码错误' });
  }

  pendingMfaChallenges.delete(challengeId);
  const jwtToken = generateToken(user);
  recordLog('info', '用户通过 MFA 登录', { userId: user.id });
  res.json({ token: jwtToken, user: sanitizeUser(user) });
});

app.get('/api/me', authMiddleware, (req, res) => {
  res.json({ user: sanitizeUser(req.user) });
});

app.get('/api/users', authMiddleware, (_req, res) => {
  const users = db.data.users.map((user) => {
    ensureUserShape(user);
    return sanitizeUser(user);
  });
  res.json({ users });
});

app.get('/api/friends', authMiddleware, (req, res) => {
  ensureUserShape(req.user);
  const friends = req.user.friends
    .map((friendId) => {
      const friend = db.data.users.find((u) => u.id === friendId);
      return friend ? sanitizeUser(friend) : null;
    })
    .filter(Boolean);

  const incoming = db.data.friendRequests
    .filter((reqItem) => reqItem.toId === req.user.id && reqItem.status === 'pending')
    .map(decorateFriendRequest);
  const outgoing = db.data.friendRequests
    .filter((reqItem) => reqItem.fromId === req.user.id && reqItem.status === 'pending')
    .map(decorateFriendRequest);

  res.json({
    friends,
    requests: {
      incoming,
      outgoing,
    },
  });
});

app.post('/api/friends/request', authMiddleware, (req, res) => {
  const { targetEmail, targetUserId } = req.body;
  const target =
    db.data.users.find((u) => u.email === targetEmail) ||
    db.data.users.find((u) => u.id === targetUserId);
  if (!target) {
    return res.status(404).json({ message: '用户不存在' });
  }
  if (target.id === req.user.id) {
    return res.status(400).json({ message: '不能添加自己为好友' });
  }
  ensureUserShape(req.user);
  ensureUserShape(target);
  if (req.user.friends.includes(target.id)) {
    return res.status(409).json({ message: '已是好友' });
  }
  const existing = db.data.friendRequests.find(
    (item) =>
      item.status === 'pending' &&
      ((item.fromId === req.user.id && item.toId === target.id) ||
        (item.fromId === target.id && item.toId === req.user.id))
  );
  if (existing) {
    return res.status(409).json({ message: '已存在待处理的好友请求' });
  }
  const request = {
    id: nanoid(),
    fromId: req.user.id,
    toId: target.id,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  db.data.friendRequests.push(request);
  persist();
  recordLog('info', '发起好友请求', { from: req.user.id, to: target.id });
  io.to(target.id).emit('friends:update');
  io.to(req.user.id).emit('friends:update');
  res.status(201).json({ request: decorateFriendRequest(request) });
});

app.post('/api/friends/respond', authMiddleware, (req, res) => {
  const { requestId, action } = req.body;
  const request = db.data.friendRequests.find((item) => item.id === requestId);
  if (!request || request.toId !== req.user.id) {
    return res.status(404).json({ message: '好友请求不存在' });
  }
  if (request.status !== 'pending') {
    return res.status(400).json({ message: '请求已被处理' });
  }
  if (!['accept', 'decline'].includes(action)) {
    return res.status(400).json({ message: '无效操作' });
  }
  request.status = action === 'accept' ? 'accepted' : 'declined';
  request.handledAt = new Date().toISOString();

  if (action === 'accept') {
    const fromUser = db.data.users.find((u) => u.id === request.fromId);
    const toUser = db.data.users.find((u) => u.id === request.toId);
    ensureUserShape(fromUser);
    ensureUserShape(toUser);
    if (!fromUser.friends.includes(toUser.id)) {
      fromUser.friends.push(toUser.id);
    }
    if (!toUser.friends.includes(fromUser.id)) {
      toUser.friends.push(fromUser.id);
    }
    ensureDirectConversation(fromUser.id, toUser.id);
    recordLog('info', '好友请求已接受', { requestId, from: fromUser.id, to: toUser.id });
  } else {
    recordLog('info', '好友请求被拒绝', { requestId });
  }
  persist();
  io.to(request.fromId).emit('friends:update');
  io.to(request.toId).emit('friends:update');
  res.json({ request: decorateFriendRequest(request) });
});

app.get('/api/conversations', authMiddleware, (req, res) => {
  const conversations = db.data.conversations.filter((c) =>
    c.members.includes(req.user.id)
  );
  res.json({ conversations });
});

app.post('/api/conversations', authMiddleware, (req, res) => {
  const { name, memberIds = [], isGroup = true } = req.body;
  if (!name) {
    return res.status(400).json({ message: '缺少会话名称' });
  }
  const participants = Array.from(new Set([req.user.id, ...memberIds]));
  if (!isGroup && participants.length !== 2) {
    return res
      .status(400)
      .json({ message: '私聊会话需要且仅能有两位成员' });
  }

  if (!isGroup) {
    const existing = db.data.conversations.find(
      (conv) =>
        !conv.isGroup &&
        conv.members.length === participants.length &&
        participants.every((id) => conv.members.includes(id))
    );
    if (existing) {
      return res.json({ conversation: existing });
    }
  }

  const conversation = {
    id: nanoid(),
    name,
    isGroup,
    members: participants,
    createdBy: req.user.id,
    createdAt: new Date().toISOString(),
  };
  db.data.conversations.push(conversation);
  persist();
  recordLog('info', '创建会话', { conversationId: conversation.id });
  res.status(201).json({ conversation });
});

app.get('/api/conversations/:id/messages', authMiddleware, (req, res) => {
  const conversation = findConversation(req.params.id);
  if (!conversation || !conversation.members.includes(req.user.id)) {
    return res.status(404).json({ message: '会话不存在或无权限' });
  }
  const messages = db.data.messages
    .filter((m) => m.conversationId === conversation.id)
    .slice(-200);
  res.json({ messages });
});

app.post('/api/conversations/:id/members', authMiddleware, (req, res) => {
  const conversation = findConversation(req.params.id);
  if (!conversation) {
    return res.status(404).json({ message: '会话不存在' });
  }
  if (conversation.createdBy !== req.user.id && !req.user.roles?.includes('admin')) {
    return res.status(403).json({ message: '只有创建者或管理员可以管理成员' });
  }
  const { memberIds = [] } = req.body;
  conversation.members = Array.from(
    new Set([...conversation.members, ...memberIds])
  );
  persist();
  res.json({ conversation });
});

app.post('/api/conversations/:id/announcement', authMiddleware, (req, res) => {
  const conversation = findConversation(req.params.id);
  if (!conversation) {
    return res.status(404).json({ message: '会话不存在' });
  }
  if (!conversation.isGroup) {
    return res.status(400).json({ message: '只有群聊支持公告' });
  }
  if (conversation.createdBy !== req.user.id && !req.user.roles?.includes('admin')) {
    return res.status(403).json({ message: '只有创建者或管理员可以发布公告' });
  }
  const { content } = req.body;
  if (!content) {
    return res.status(400).json({ message: '公告内容不能为空' });
  }
  
  conversation.announcement = {
    content: sanitizeInput(content),
    createdBy: req.user.id,
    createdAt: new Date().toISOString(),
  };
  persist();
  
  // 通知群成员
  io.to(conversation.id).emit('announcement:updated', {
    conversationId: conversation.id,
    announcement: conversation.announcement,
  });
  
  recordLog('info', '发布群公告', { conversationId: conversation.id, userId: req.user.id });
  res.json({ conversation });
});

app.post(
  '/api/files/upload',
  authMiddleware,
  upload.single('file'),
  (req, res) => {
    const { conversationId } = req.body;
    const conversation = findConversation(conversationId);
    if (!conversation || !conversation.members.includes(req.user.id)) {
      return res.status(403).json({ message: '无权上传到该会话' });
    }
    
    // 文件安全检查
    const validation = validateFileUpload(req.file);
    if (!validation.valid) {
      return res.status(400).json({ message: validation.error });
    }
    
    const fileEntry = {
      id: nanoid(),
      conversationId,
      uploaderId: req.user.id,
      path: req.file.filename,
      originalName: sanitizeInput(req.file.originalname),
      mimeType: req.file.mimetype,
      size: req.file.size,
      createdAt: new Date().toISOString(),
    };
    db.data.files.push(fileEntry);

    const message = createMessage({
      conversationId,
      senderId: req.user.id,
      type: 'file',
      content: `${req.user.name} 分享了文件`,
      fileId: fileEntry.id,
    });
    persist();
    io.to(conversationId).emit('message:new', message);
    recordLog('info', '文件上传', {
      conversationId,
      fileId: fileEntry.id,
      uploaderId: req.user.id,
    });
    res.status(201).json({ file: fileEntry, message });
  }
);

app.get('/api/files/:fileId', authMiddleware, (req, res) => {
  const file = db.data.files.find((f) => f.id === req.params.fileId);
  if (!file) {
    return res.status(404).json({ message: '文件不存在' });
  }
  const conversation = findConversation(file.conversationId);
  if (!conversation || !conversation.members.includes(req.user.id)) {
    return res.status(403).json({ message: '无权访问该文件' });
  }
  res.sendFile(join(uploadDir, file.path));
});

app.get('/api/dashboard/summary', authMiddleware, (_req, res) => {
  res.json({
    users: db.data.users.length,
    conversations: db.data.conversations.length,
    messages: db.data.messages.length,
    files: db.data.files.length,
    onlineUsers: onlineUsers.size,
  });
});

app.get('/api/dashboard/activity', authMiddleware, (_req, res) => {
  const perDay = {};
  db.data.messages.forEach((msg) => {
    const day = msg.createdAt.slice(0, 10);
    perDay[day] = (perDay[day] || 0) + 1;
  });
  const data = Object.entries(perDay)
    .sort(([a], [b]) => (a > b ? 1 : -1))
    .map(([day, count]) => ({ day, count }));

  const connectionEvents = db.data.logs
    .filter((log) => log.message.includes('连接'))
    .slice(-50);

  res.json({
    messagesPerDay: data,
    recentConnections: connectionEvents,
  });
});

app.get('/api/logs', authMiddleware, (_req, res) => {
  const latest = db.data.logs.slice(-100).reverse();
  res.json({ logs: latest });
});

function findConversation(id) {
  return db.data.conversations.find((c) => c.id === id);
}

function createMessage({ conversationId, senderId, type = 'text', content, fileId }) {
  const message = {
    id: nanoid(),
    conversationId,
    senderId,
    type,
    content,
    fileId: fileId ?? null,
    createdAt: new Date().toISOString(),
  };
  db.data.messages.push(message);
  return message;
}

function sanitizeUser(user) {
  const {
    passwordHash,
    mfaSecret,
    mfaTempSecret,
    ...rest
  } = user;
  return rest;
}

function ensureUserShape(user) {
  if (!user) return;
  if (!Array.isArray(user.friends)) {
    user.friends = [];
  }
}

function decorateFriendRequest(request) {
  const from = db.data.users.find((u) => u.id === request.fromId);
  const to = db.data.users.find((u) => u.id === request.toId);
  return {
    ...request,
    from: from ? sanitizeUser(from) : null,
    to: to ? sanitizeUser(to) : null,
  };
}

function seedDefaultConversation() {
  if (db.data.conversations.length === 0) {
    db.data.conversations.push({
      id: 'general',
      name: '班级公共频道',
      isGroup: true,
      members: [],
      createdBy: 'system',
      createdAt: new Date().toISOString(),
    });
    persist();
  }
}

function ensureDirectConversation(userIdA, userIdB) {
  const existing = db.data.conversations.find(
    (conv) =>
      !conv.isGroup &&
      conv.members.length === 2 &&
      conv.members.includes(userIdA) &&
      conv.members.includes(userIdB)
  );
  if (existing) {
    return existing;
  }
  const conversation = {
    id: nanoid(),
    name: '私聊',
    isGroup: false,
    members: [userIdA, userIdB],
    createdBy: 'system',
    createdAt: new Date().toISOString(),
  };
  db.data.conversations.push(conversation);
  persist();
  return conversation;
}

function cleanupExpiredChallenges() {
  const now = Date.now();
  for (const [key, value] of pendingMfaChallenges.entries()) {
    if (value.expiresAt < now) {
      pendingMfaChallenges.delete(key);
    }
  }
}

setInterval(cleanupExpiredChallenges, 60 * 1000);

io.use((socket, next) => {
  const { token } = socket.handshake.auth || {};
  if (!token) {
    return next(new Error('未授权'));
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.data.users.find((u) => u.id === payload.sub);
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
  socket.join(user.id);
  addOnlineUser(user.id, socket.id);
  recordLog('info', '实时连接建立', { userId: user.id });
  socket.emit('system:online', { message: '已连接实时服务', timestamp: new Date().toISOString() });

  socket.on('conversation:join', ({ conversationId }) => {
    const conversation = findConversation(conversationId);
    if (!conversation || !conversation.members.includes(user.id)) {
      return socket.emit('error', { message: '无权加入该会话' });
    }
    socket.join(conversationId);
    socket.emit('conversation:joined', { conversationId });
    recordLog('info', '加入会话', { userId: user.id, conversationId });
  });

  socket.on('conversation:leave', ({ conversationId }) => {
    socket.leave(conversationId);
    socket.emit('conversation:left', { conversationId });
  });

  socket.on('message:send', ({ conversationId, content }) => {
    const conversation = findConversation(conversationId);
    if (!conversation || !conversation.members.includes(user.id)) {
      return socket.emit('error', { message: '无法发送到该会话' });
    }
    const message = createMessage({
      conversationId,
      senderId: user.id,
      content: sanitizeInput(content),
      type: 'text',
    });
    persist();
    io.to(conversationId).emit('message:new', {
      ...message,
      sender: sanitizeUser(user),
    });
    recordLog('info', '发送消息', { userId: user.id, conversationId });
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

  // 已读回执
  socket.on('message:read', ({ conversationId, messageId }) => {
    socket.to(conversationId).emit('message:read', {
      conversationId,
      messageId,
      readBy: user.id,
      readAt: new Date().toISOString(),
    });
  });

  socket.on('webrtc:signal', ({ conversationId, payload }) => {
    socket.to(conversationId).emit('webrtc:signal', {
      from: user.id,
      conversationId,
      payload,
    });
  });

  socket.on('call:invite', ({ conversationId, mediaType = 'video' }) => {
    const conversation = findConversation(conversationId);
    if (!conversation || !conversation.members.includes(user.id)) {
      return;
    }
    socket.to(conversationId).emit('call:ring', {
      conversationId,
      mediaType,
      from: sanitizeUser(user),
      timestamp: new Date().toISOString(),
    });
  });

  socket.on('call:accept', ({ conversationId }) => {
    socket.to(conversationId).emit('call:accept', {
      conversationId,
      from: user.id,
      timestamp: new Date().toISOString(),
    });
  });

  socket.on('call:decline', ({ conversationId, reason }) => {
    socket.to(conversationId).emit('call:decline', {
      conversationId,
      from: user.id,
      reason: reason ?? 'declined',
      timestamp: new Date().toISOString(),
    });
  });

  socket.on('call:end', ({ conversationId }) => {
    socket.to(conversationId).emit('call:end', {
      conversationId,
      from: user.id,
      timestamp: new Date().toISOString(),
    });
  });

  socket.on('disconnect', () => {
    removeOnlineUser(user.id, socket.id);
    recordLog('info', '实时连接断开', { userId: user.id });
  });
});

function addOnlineUser(userId, socketId) {
  const entry = onlineUsers.get(userId) || { sockets: new Set() };
  entry.sockets.add(socketId);
  onlineUsers.set(userId, entry);
}

function removeOnlineUser(userId, socketId) {
  const entry = onlineUsers.get(userId);
  if (!entry) return;
  entry.sockets.delete(socketId);
  if (entry.sockets.size === 0) {
    onlineUsers.delete(userId);
  } else {
    onlineUsers.set(userId, entry);
  }
}

function hydrateLegacyData() {
  if (!Array.isArray(db.data.friendRequests)) {
    db.data.friendRequests = [];
  }
  db.data.users.forEach((user) => ensureUserShape(user));
  persist();
}

const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () => {
  logger.info(`Backend listening on http://localhost:${PORT}`);
});

