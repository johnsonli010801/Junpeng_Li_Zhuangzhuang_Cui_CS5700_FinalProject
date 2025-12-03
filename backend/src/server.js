import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
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
  validateFileUpload,
  sanitizeInput,
} from './security.js';
import { sendMfaCodeEmail } from './mailer.js';

const app = express();
const httpServer = createServer(app);
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:5173', 'http://localhost:3000'];

const io = new SocketIOServer(httpServer, {
  cors: {
    origin: ALLOWED_ORIGINS,
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

app.use(cors({
  origin: ALLOWED_ORIGINS,
  credentials: true,
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!email || !password || !name) {
      return res.status(400).json({ message: '缺少必要字段' });
    }
    
    // 邮箱格式验证
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: '邮箱格式不正确' });
    }
    
    // 标准化邮箱
    const normalizedEmail = email.toLowerCase().trim();
    
    // 检查邮箱是否已存在
    const existingUser = db.data.users.find((u) => u.email === normalizedEmail);
    if (existingUser) {
      return res.status(409).json({ message: '邮箱已注册' });
    }
    
    const passwordHash = await hashPassword(password);
    const now = new Date().toISOString();
    const user = {
      id: nanoid(),
      name: sanitizeInput(name), // 清理用户名
      email: normalizedEmail, // 规范化邮箱
      passwordHash,
      friends: [],
      roles: ['user'],
      createdAt: now,
      updatedAt: now,
    };
    
    // 二次检查（防止并发竞态条件）
    const doubleCheck = db.data.users.find((u) => u.email === normalizedEmail);
    if (doubleCheck) {
      return res.status(409).json({ message: '邮箱已注册' });
    }
    
    db.data.users.push(user);
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
  
  // 标准化邮箱（与注册时保持一致）
  const normalizedEmail = email.toLowerCase().trim();
  
  const user = db.data.users.find((u) => u.email === normalizedEmail);
  if (!user) {
    return res.status(401).json({ message: '账号或密码错误' });
  }
  ensureUserShape(user);
  const match = await verifyPassword(password, user.passwordHash);
  if (!match) {
    return res.status(401).json({ message: '账号或密码错误' });
  }

  // 第一步密码验证通过后，无论用户输入什么邮箱，
  // 都触发"邮箱验证码 MFA"，并把验证码发到固定的 Mailtrap sandbox 邮箱。
  const challengeId = nanoid();
  const code = generateNumericCode(6);
  const expiresAt = Date.now() + 5 * 60 * 1000;
  pendingMfaChallenges.set(challengeId, {
    userId: user.id,
    code,
    expiresAt,
  });

  // 在控制台打印验证码（仅用于开发测试）
  console.log(`\nMFA 验证码已生成：${code}`);
  console.log(`用户邮箱：${user.email}`);
  console.log(`有效期至：${new Date(expiresAt).toLocaleString('zh-CN')}`);
  console.log(`Challenge ID：${challengeId}\n`);

  try {
    await sendMfaCodeEmail(user.email, code);
  } catch (error) {
    logger.error(`发送 MFA 邮件失败: ${error.message}`, {
      userId: user.id,
      email: user.email,
    });
    return res.status(500).json({ message: '发送验证码失败，请稍后重试' });
  }

  recordLog('info', '触发邮箱 MFA 登录挑战', {
    userId: user.id,
    ip,
    code, // 记录验证码到日志（生产环境应该移除）
  });

  return res.json({ requiresMfa: true, challengeId });
});

app.post('/api/auth/mfa/verify', (req, res) => {
  const { challengeId, token } = req.body;
  
  console.log(`\nMFA 验证请求：`);
  console.log(`Challenge ID: ${challengeId}`);
  console.log(`用户输入验证码: ${token}`);
  console.log(`当前挑战数量: ${pendingMfaChallenges.size}`);
  
  const challenge = pendingMfaChallenges.get(challengeId);
  if (!challenge) {
    console.log(`Challenge 不存在（可能是服务器重启导致内存清空）\n`);
    return res.status(400).json({ message: '挑战已失效，请重新登录' });
  }
  
  const now = Date.now();
  if (challenge.expiresAt < now) {
    console.log(`Challenge 已过期`);
    console.log(`过期时间: ${new Date(challenge.expiresAt).toLocaleString('zh-CN')}`);
    console.log(`当前时间: ${new Date(now).toLocaleString('zh-CN')}\n`);
    return res.status(400).json({ message: '验证码已过期，请重新登录' });
  }
  
  const user = db.data.users.find((u) => u.id === challenge.userId);
  if (!user) {
    console.log(`用户不存在: ${challenge.userId}\n`);
    return res.status(400).json({ message: '用户不存在' });
  }

  const expectedCode = String(challenge.code || '');
  console.log(`期望验证码: ${expectedCode}`);
  
  if (!expectedCode || String(token) !== expectedCode) {
    console.log(`验证码不匹配\n`);
    return res.status(400).json({ message: '验证码错误' });
  }

  console.log(`验证码正确，登录成功\n`);
  pendingMfaChallenges.delete(challengeId);
  const jwtToken = generateToken(user);
  const ip = req.ip || req.connection.remoteAddress;
  recordLog('info', '用户通过邮箱 MFA 登录', { userId: user.id, ip });
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
  
  // 清理会话名称
  const cleanName = sanitizeInput(name);
  if (!cleanName) {
    return res.status(400).json({ message: '会话名称不能为空' });
  }
  
  const participants = Array.from(new Set([req.user.id, ...memberIds]));
  
  // 私聊验证
  if (!isGroup) {
    if (memberIds.length === 0) {
      return res.status(400).json({ 
        message: '私聊需要指定对方用户ID' 
      });
    }
    if (participants.length !== 2) {
      return res.status(400).json({ 
        message: '私聊会话需要且仅能有两位成员' 
      });
    }
    
    // 检查是否已存在相同的私聊
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
    name: cleanName,
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
  
  // 验证是否是群聊
  if (!conversation.isGroup) {
    return res.status(400).json({ message: '私聊不支持添加成员' });
  }
  
  // 验证权限：创建者、管理员或现有成员可以邀请
  if (!conversation.members.includes(req.user.id) && !req.user.roles?.includes('admin')) {
    return res.status(403).json({ message: '无权添加成员' });
  }
  
  const { memberIds = [] } = req.body;
  if (!Array.isArray(memberIds) || memberIds.length === 0) {
    return res.status(400).json({ message: '请指定要添加的成员' });
  }
  
  // 验证要添加的用户都存在
  const validMemberIds = memberIds.filter(id => 
    db.data.users.some(u => u.id === id)
  );
  
  conversation.members = Array.from(
    new Set([...conversation.members, ...validMemberIds])
  );
  persist();
  
  // 通知所有成员
  io.to(conversation.id).emit('conversation:updated', { conversation });
  
  recordLog('info', '添加群成员', { 
    conversationId: conversation.id, 
    addedBy: req.user.id,
    newMembers: validMemberIds,
  });
  
  res.json({ conversation });
});

// 退出群聊
app.post('/api/conversations/:id/leave', authMiddleware, (req, res) => {
  const conversation = findConversation(req.params.id);
  if (!conversation) {
    return res.status(404).json({ message: '会话不存在' });
  }
  
  if (!conversation.isGroup) {
    return res.status(400).json({ message: '私聊不支持退出操作' });
  }
  
  if (!conversation.members.includes(req.user.id)) {
    return res.status(403).json({ message: '您不在该群聊中' });
  }
  
  // 如果是群主退出，解散群聊
  if (conversation.createdBy === req.user.id) {
    // 删除群聊
    const index = db.data.conversations.findIndex(c => c.id === conversation.id);
    if (index !== -1) {
      db.data.conversations.splice(index, 1);
    }
    persist();
    
    // 通知所有成员群已解散
    io.to(conversation.id).emit('conversation:dissolved', {
      conversationId: conversation.id,
      message: '群主已退出，群聊已解散',
    });
    
    recordLog('info', '群主退出，群聊解散', { 
      conversationId: conversation.id, 
      creatorId: req.user.id,
    });
    
    return res.json({ message: '您已退出，群聊已解散' });
  }
  
  // 普通成员退出
  conversation.members = conversation.members.filter(id => id !== req.user.id);
  persist();
  
  // 通知其他成员
  io.to(conversation.id).emit('conversation:updated', { conversation });
  
  recordLog('info', '用户退出群聊', { 
    conversationId: conversation.id, 
    userId: req.user.id,
  });
  
  res.json({ message: '已退出群聊' });
});

// 删除群聊（仅群主）
app.delete('/api/conversations/:id', authMiddleware, (req, res) => {
  const conversation = findConversation(req.params.id);
  if (!conversation) {
    return res.status(404).json({ message: '会话不存在' });
  }
  
  if (!conversation.isGroup) {
    return res.status(400).json({ message: '私聊不支持删除操作' });
  }
  
  if (conversation.createdBy !== req.user.id && !req.user.roles?.includes('admin')) {
    return res.status(403).json({ message: '只有群主或管理员可以删除群聊' });
  }
  
  // 删除群聊
  const index = db.data.conversations.findIndex(c => c.id === conversation.id);
  if (index !== -1) {
    db.data.conversations.splice(index, 1);
  }
  persist();
  
  // 通知所有成员
  io.to(conversation.id).emit('conversation:deleted', {
    conversationId: conversation.id,
    message: '群聊已被删除',
  });
  
  recordLog('info', '删除群聊', { 
    conversationId: conversation.id, 
    deletedBy: req.user.id,
  });
  
  res.json({ message: '群聊已删除' });
});

app.post(
  '/api/files/upload',
  authMiddleware,
  upload.single('file'),
  (req, res) => {
    // 检查文件是否上传
    if (!req.file) {
      return res.status(400).json({ message: '未检测到文件' });
    }
    
    const { conversationId } = req.body;
    if (!conversationId) {
      return res.status(400).json({ message: '缺少会话ID' });
    }
    
    const conversation = findConversation(conversationId);
    if (!conversation) {
      return res.status(404).json({ message: '会话不存在' });
    }
    
    if (!conversation.members.includes(req.user.id)) {
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
      content: `${req.user.name} 分享了文件: ${fileEntry.originalName}`,
      fileId: fileEntry.id,
    });
    persist();
    
    const messageWithSender = {
      ...message,
      sender: sanitizeUser(req.user),
    };
    
    console.log('[Server] 广播文件消息:', messageWithSender);
    io.to(conversationId).emit('message:new', messageWithSender);
    
    recordLog('info', '文件上传', {
      conversationId,
      fileId: fileEntry.id,
      uploaderId: req.user.id,
      fileName: fileEntry.originalName,
    });
    res.status(201).json({ file: fileEntry, message: messageWithSender });
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

function generateNumericCode(length = 6) {
  let code = '';
  for (let i = 0; i < length; i += 1) {
    code += Math.floor(Math.random() * 10).toString();
  }
  // 确保首位不是 0，增强展示效果
  if (code[0] === '0') {
    code = `1${code.slice(1)}`;
  }
  return code;
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
    
    // 验证消息内容
    if (!content || typeof content !== 'string') {
      return socket.emit('error', { message: '消息内容不能为空' });
    }
    
    const sanitizedContent = sanitizeInput(content);
    if (!sanitizedContent || sanitizedContent.trim().length === 0) {
      return socket.emit('error', { message: '消息内容不能为空' });
    }
    
    const message = createMessage({
      conversationId,
      senderId: user.id,
      content: sanitizedContent,
      type: 'text',
    });
    persist();
    io.to(conversationId).emit('message:new', {
      ...message,
      sender: sanitizeUser(user),
    });
    recordLog('info', '发送消息', { userId: user.id, conversationId });
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

