import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { nanoid } from 'nanoid';
import { createServer } from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';

import { initDb, db, persist } from './db.js';
import { logger } from './logger.js';
import {
  authMiddleware,
  register,
  login,
  verifyMfa,
  me,
} from './controllers/authController.js';
import { createFriendController } from './controllers/friendController.js';
import { createConversationController } from './controllers/conversationController.js';
import { createFileController } from './controllers/fileController.js';
import { createDashboardController } from './controllers/dashboardController.js';
import { setupSocketAuth, registerSocketHandlers } from './realtime/socketHandlers.js';
import { ensureUserShape } from './utils/userUtils.js';
import { cleanupExpiredChallenges } from './services/mfaService.js';

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

const onlineUsers = new Map();

app.use(cors({
  origin: ALLOWED_ORIGINS,
  credentials: true,
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 登录注册相关
app.post('/api/auth/register', register);
app.post('/api/auth/login', login);
app.post('/api/auth/mfa/verify', verifyMfa);
app.get('/api/me', authMiddleware, me);

// 简单的用户列表
app.get('/api/users', authMiddleware, (_req, res) => {
  const users = db.data.users.map((user) => user);
  res.json({ users });
});

// 好友接口
const friendController = createFriendController(io);
app.get('/api/friends', authMiddleware, friendController.getFriends);
app.post('/api/friends/request', authMiddleware, friendController.requestFriend);
app.post('/api/friends/respond', authMiddleware, friendController.respondFriend);

// 会话接口
const conversationController = createConversationController(io);
app.get('/api/conversations', authMiddleware, conversationController.listConversations);
app.post('/api/conversations', authMiddleware, conversationController.createConversation);
app.get(
  '/api/conversations/:id/messages',
  authMiddleware,
  conversationController.getConversationMessages,
);
app.post(
  '/api/conversations/:id/members',
  authMiddleware,
  conversationController.addMembers,
);
app.post(
  '/api/conversations/:id/leave',
  authMiddleware,
  conversationController.leaveConversation,
);
app.delete(
  '/api/conversations/:id',
  authMiddleware,
  conversationController.deleteConversation,
);

// 文件接口
const fileController = createFileController(io, uploadDir);
app.post(
  '/api/files/upload',
  authMiddleware,
  upload.single('file'),
  fileController.uploadFile,
);
app.get('/api/files/:fileId', authMiddleware, fileController.getFile);

// 仪表盘接口
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

// 定时清理过期的 MFA 挑战
setInterval(cleanupExpiredChallenges, 60 * 1000);

// 实时连接
setupSocketAuth(io);
registerSocketHandlers(io, onlineUsers);

function hydrateLegacyData() {
  if (!Array.isArray(db.data.friendRequests)) {
    db.data.friendRequests = [];
  }
  db.data.users.forEach((user) => ensureUserShape(user));
  persist();
}

async function bootstrap() {
  await initDb();
  hydrateLegacyData();

  const PORT = process.env.PORT || 4000;
  httpServer.listen(PORT, () => {
    logger.info(`Backend listening on http://localhost:${PORT}`);
  });
}

bootstrap().catch((error) => {
  logger.error(`Failed to start backend: ${error.message}`);
  process.exit(1);
});


