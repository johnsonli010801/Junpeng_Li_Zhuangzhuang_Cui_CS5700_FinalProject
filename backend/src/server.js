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
      return res.status(400).json({ message: 'Missing required fields' });
    }
    
    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }
    
    // Normalize email
    const normalizedEmail = email.toLowerCase().trim();
    
    // Check if email already exists
    const existingUser = db.data.users.find((u) => u.email === normalizedEmail);
    if (existingUser) {
      return res.status(409).json({ message: 'Email is already registered' });
    }
    
    const passwordHash = await hashPassword(password);
    const now = new Date().toISOString();
    const user = {
      id: nanoid(),
      name: sanitizeInput(name), // Sanitize user name
      email: normalizedEmail, // Normalized email
      passwordHash,
      friends: [],
      roles: ['user'],
      createdAt: now,
      updatedAt: now,
    };
    
    // Double-check to avoid race conditions
    const doubleCheck = db.data.users.find((u) => u.email === normalizedEmail);
    if (doubleCheck) {
      return res.status(409).json({ message: 'Email is already registered' });
    }
    
    db.data.users.push(user);
    persist();
    recordLog('info', 'User registered successfully', { userId: user.id });
    res.status(201).json({ user: sanitizeUser(user) });
  } catch (error) {
    logger.error(`Registration failed: ${error.message}`);
    res.status(500).json({ message: 'Server error' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const ip = req.ip || req.connection.remoteAddress;
  
  // Normalize email (same as during registration)
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
  
  // After the initial password check passes, always trigger email-code MFA
  // and send the code to a fixed Mailtrap sandbox inbox.
  const challengeId = nanoid();
  const code = generateNumericCode(6);
  const expiresAt = Date.now() + 5 * 60 * 1000;
  pendingMfaChallenges.set(challengeId, {
    userId: user.id,
    code,
    expiresAt,
  });

  // Log MFA code in console (development/testing only)
  console.log(`\nMFA code generated: ${code}`);
  console.log(`User email: ${user.email}`);
  console.log(`Expires at: ${new Date(expiresAt).toLocaleString('zh-CN')}`);
  console.log(`Challenge ID: ${challengeId}\n`);

  try {
    await sendMfaCodeEmail(user.email, code);
  } catch (error) {
    logger.error(`Failed to send MFA email: ${error.message}`, {
      userId: user.id,
      email: user.email,
    });
    return res.status(500).json({ message: 'Failed to send verification code, please try again later' });
  }

  recordLog('info', 'Triggered email MFA login challenge', {
    userId: user.id,
    ip,
    code, // Log code for demo purposes (remove in production)
  });
  
  return res.json({ requiresMfa: true, challengeId, mfaCode: code });
});

app.post('/api/auth/mfa/verify', (req, res) => {
  const { challengeId, token } = req.body;
  
  console.log(`\nMFA verification request:`);
  console.log(`Challenge ID: ${challengeId}`);
  console.log(`User input code: ${token}`);
  console.log(`Current number of challenges: ${pendingMfaChallenges.size}`);
  
  const challenge = pendingMfaChallenges.get(challengeId);
  if (!challenge) {
    console.log(`Challenge not found (possibly cleared after server restart)\n`);
    return res.status(400).json({ message: 'Challenge is no longer valid, please log in again' });
  }
  
  const now = Date.now();
  if (challenge.expiresAt < now) {
    console.log(`Challenge expired`);
    console.log(`Expires at: ${new Date(challenge.expiresAt).toLocaleString('zh-CN')}`);
    console.log(`Current time: ${new Date(now).toLocaleString('zh-CN')}\n`);
    return res.status(400).json({ message: 'Verification code has expired, please log in again' });
  }
  
  const user = db.data.users.find((u) => u.id === challenge.userId);
  if (!user) {
    console.log(`User not found: ${challenge.userId}\n`);
    return res.status(400).json({ message: 'User does not exist' });
  }

  const expectedCode = String(challenge.code || '');
  console.log(`Expected code: ${expectedCode}`);
  
  if (!expectedCode || String(token) !== expectedCode) {
    console.log(`Verification code does not match\n`);
    return res.status(400).json({ message: 'Invalid verification code' });
  }
  
  console.log(`Verification code correct, login success\n`);
  pendingMfaChallenges.delete(challengeId);
  const jwtToken = generateToken(user);
  const ip = req.ip || req.connection.remoteAddress;
  recordLog('info', 'User logged in via email MFA', { userId: user.id, ip });
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
    return res.status(404).json({ message: 'User not found' });
  }
  if (target.id === req.user.id) {
    return res.status(400).json({ message: 'You cannot add yourself as a friend' });
  }
  ensureUserShape(req.user);
  ensureUserShape(target);
  if (req.user.friends.includes(target.id)) {
    return res.status(409).json({ message: 'Already friends' });
  }
  const existing = db.data.friendRequests.find(
    (item) =>
      item.status === 'pending' &&
      ((item.fromId === req.user.id && item.toId === target.id) ||
        (item.fromId === target.id && item.toId === req.user.id))
  );
  if (existing) {
    return res.status(409).json({ message: 'There is already a pending friend request' });
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
  recordLog('info', 'Friend request created', { from: req.user.id, to: target.id });
  io.to(target.id).emit('friends:update');
  io.to(req.user.id).emit('friends:update');
  res.status(201).json({ request: decorateFriendRequest(request) });
});

app.post('/api/friends/respond', authMiddleware, (req, res) => {
  const { requestId, action } = req.body;
  const request = db.data.friendRequests.find((item) => item.id === requestId);
  if (!request || request.toId !== req.user.id) {
    return res.status(404).json({ message: 'Friend request not found' });
  }
  if (request.status !== 'pending') {
    return res.status(400).json({ message: 'Request has already been handled' });
  }
  if (!['accept', 'decline'].includes(action)) {
    return res.status(400).json({ message: 'Invalid action' });
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
    recordLog('info', 'Friend request accepted', { requestId, from: fromUser.id, to: toUser.id });
  } else {
    recordLog('info', 'Friend request declined', { requestId });
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
    return res.status(400).json({ message: 'Conversation name is required' });
  }
  
  // Sanitize conversation name
  const cleanName = sanitizeInput(name);
  if (!cleanName) {
    return res.status(400).json({ message: 'Conversation name cannot be empty' });
  }
  
  const participants = Array.from(new Set([req.user.id, ...memberIds]));
  
  // Direct conversation validation
  if (!isGroup) {
    if (memberIds.length === 0) {
      return res.status(400).json({ 
        message: 'Direct chat requires a target user id' 
      });
    }
    if (participants.length !== 2) {
      return res.status(400).json({ 
        message: 'Direct chat must have exactly two members' 
      });
    }
    
    // Check whether a direct conversation between the two users already exists
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
  recordLog('info', 'Conversation created', { conversationId: conversation.id });
  res.status(201).json({ conversation });
});

app.get('/api/conversations/:id/messages', authMiddleware, (req, res) => {
  const conversation = findConversation(req.params.id);
  if (!conversation || !conversation.members.includes(req.user.id)) {
    return res.status(404).json({ message: 'Conversation does not exist or you lack permission' });
  }
  const messages = db.data.messages
    .filter((m) => m.conversationId === conversation.id)
    .slice(-200);
  res.json({ messages });
});

app.post('/api/conversations/:id/members', authMiddleware, (req, res) => {
  const conversation = findConversation(req.params.id);
  if (!conversation) {
    return res.status(404).json({ message: 'Conversation not found' });
  }
  
  // Ensure this is a group conversation
  if (!conversation.isGroup) {
    return res.status(400).json({ message: 'Direct chats do not support adding members' });
  }
  
  // Permission check: creator, admins or existing members can invite
  if (!conversation.members.includes(req.user.id) && !req.user.roles?.includes('admin')) {
    return res.status(403).json({ message: 'You are not allowed to add members to this conversation' });
  }
  
  const { memberIds = [] } = req.body;
  if (!Array.isArray(memberIds) || memberIds.length === 0) {
    return res.status(400).json({ message: 'Please specify members to add' });
  }
  
  // Ensure users to be added all exist
  const validMemberIds = memberIds.filter(id => 
    db.data.users.some(u => u.id === id)
  );
  
  conversation.members = Array.from(
    new Set([...conversation.members, ...validMemberIds])
  );
  persist();
  
  // Notify all members
  io.to(conversation.id).emit('conversation:updated', { conversation });
  
  recordLog('info', 'Added members to group', { 
    conversationId: conversation.id, 
    addedBy: req.user.id,
    newMembers: validMemberIds,
  });
  
  res.json({ conversation });
});

// Leave group chat
app.post('/api/conversations/:id/leave', authMiddleware, (req, res) => {
  const conversation = findConversation(req.params.id);
  if (!conversation) {
    return res.status(404).json({ message: 'Conversation not found' });
  }
  
  if (!conversation.isGroup) {
    return res.status(400).json({ message: 'Direct chats do not support leaving' });
  }
  
  if (!conversation.members.includes(req.user.id)) {
    return res.status(403).json({ message: 'You are not a member of this group' });
  }
  
  // If the owner leaves, dissolve the group
  if (conversation.createdBy === req.user.id) {
    // Delete group
    const index = db.data.conversations.findIndex(c => c.id === conversation.id);
    if (index !== -1) {
      db.data.conversations.splice(index, 1);
    }
    persist();
    
    // Notify all members that the group is dissolved
    io.to(conversation.id).emit('conversation:dissolved', {
      conversationId: conversation.id,
      message: 'Group owner left, group has been dissolved',
    });
    
    recordLog('info', 'Group owner left, group dissolved', { 
      conversationId: conversation.id, 
      creatorId: req.user.id,
    });
    
    return res.json({ message: 'You left the group and it was dissolved' });
  }
  
  // Regular member leaves
  conversation.members = conversation.members.filter(id => id !== req.user.id);
  persist();
  
  // Notify remaining members
  io.to(conversation.id).emit('conversation:updated', { conversation });
  
  recordLog('info', 'User left group', { 
    conversationId: conversation.id, 
    userId: req.user.id,
  });
  
  res.json({ message: 'You left the group' });
});

// Delete group chat (owner only)
app.delete('/api/conversations/:id', authMiddleware, (req, res) => {
  const conversation = findConversation(req.params.id);
  if (!conversation) {
    return res.status(404).json({ message: 'Conversation not found' });
  }
  
  if (!conversation.isGroup) {
    return res.status(400).json({ message: 'Direct chats cannot be deleted' });
  }
  
  // Only the creator can delete the group
  if (conversation.createdBy !== req.user.id) {
    return res.status(403).json({ message: 'Only the group owner can delete this group' });
  }
  
  // Delete group
  const index = db.data.conversations.findIndex(c => c.id === conversation.id);
  if (index !== -1) {
    db.data.conversations.splice(index, 1);
  }
  persist();
  
  // Notify all members
  io.to(conversation.id).emit('conversation:deleted', {
    conversationId: conversation.id,
    message: 'Group chat has been deleted',
  });
  
  recordLog('info', 'Group chat deleted', { 
    conversationId: conversation.id, 
    deletedBy: req.user.id,
  });
  
  res.json({ message: 'Group chat deleted' });
});

app.post(
  '/api/files/upload',
  authMiddleware,
  upload.single('file'),
  (req, res) => {
    // Ensure a file was uploaded
    if (!req.file) {
      return res.status(400).json({ message: 'No file detected in upload' });
    }
    
    const { conversationId } = req.body;
    if (!conversationId) {
      return res.status(400).json({ message: 'Conversation id is required' });
    }
    
  const conversation = findConversation(conversationId);
  if (!conversation) {
    return res.status(404).json({ message: 'Conversation not found' });
  }
  
  if (!conversation.members.includes(req.user.id)) {
    return res.status(403).json({ message: 'You are not allowed to upload to this conversation' });
    }
    
    // File safety validation
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
      content: `${req.user.name} shared a file: ${fileEntry.originalName}`,
      fileId: fileEntry.id,
    });
    persist();
    
    const messageWithSender = {
      ...message,
      sender: sanitizeUser(req.user),
    };
    
    console.log('[Server] broadcasting file message:', messageWithSender);
    io.to(conversationId).emit('message:new', messageWithSender);
    
    recordLog('info', 'File uploaded', {
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
    return res.status(404).json({ message: 'File not found' });
  }
  const conversation = findConversation(file.conversationId);
  if (!conversation || !conversation.members.includes(req.user.id)) {
    return res.status(403).json({ message: 'You are not allowed to access this file' });
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
    .filter((log) => log.message.includes('connection'))
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
    name: 'Direct chat',
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
  // Ensure first digit is not 0 for nicer display
  if (code[0] === '0') {
    code = `1${code.slice(1)}`;
  }
  return code;
}

setInterval(cleanupExpiredChallenges, 60 * 1000);

io.use((socket, next) => {
  const { token } = socket.handshake.auth || {};
  if (!token) {
    return next(new Error('Unauthorized'));
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.data.users.find((u) => u.id === payload.sub);
    if (!user) {
      return next(new Error('User not found'));
    }
    socket.user = user;
    next();
  } catch (error) {
    next(new Error('Invalid token'));
  }
});

io.on('connection', (socket) => {
  const user = socket.user;
  socket.join(user.id);
  addOnlineUser(user.id, socket.id);
  recordLog('info', 'Realtime connection established', { userId: user.id });
  socket.emit('system:online', { message: 'Connected to realtime service', timestamp: new Date().toISOString() });

  socket.on('conversation:join', ({ conversationId }) => {
    const conversation = findConversation(conversationId);
    if (!conversation || !conversation.members.includes(user.id)) {
      return socket.emit('error', { message: 'You are not allowed to join this conversation' });
    }
    socket.join(conversationId);
    socket.emit('conversation:joined', { conversationId });
    recordLog('info', 'Joined conversation', { userId: user.id, conversationId });
  });

  socket.on('conversation:leave', ({ conversationId }) => {
    socket.leave(conversationId);
    socket.emit('conversation:left', { conversationId });
  });

  socket.on('message:send', ({ conversationId, content }) => {
    const conversation = findConversation(conversationId);
    if (!conversation || !conversation.members.includes(user.id)) {
      return socket.emit('error', { message: 'Unable to send to this conversation' });
    }
    
    // Validate message content
    if (!content || typeof content !== 'string') {
      return socket.emit('error', { message: 'Message content cannot be empty' });
    }
    
    const sanitizedContent = sanitizeInput(content);
    if (!sanitizedContent || sanitizedContent.trim().length === 0) {
      return socket.emit('error', { message: 'Message content cannot be empty' });
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
    recordLog('info', 'Message sent', { userId: user.id, conversationId });
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
    recordLog('info', 'Realtime connection closed', { userId: user.id });
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

