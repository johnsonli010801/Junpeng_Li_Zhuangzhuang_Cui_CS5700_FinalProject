import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../auth.js';
import { db, persist } from '../db.js';
import { sanitizeInput } from '../security.js';
import { recordLog } from '../auth.js';
import { sanitizeUser } from '../utils/userUtils.js';
import { findConversation, createMessage } from '../utils/conversationUtils.js';

export function setupSocketAuth(io) {
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
      return next();
    } catch (error) {
      return next(new Error('Invalid token'));
    }
  });
}

export function registerSocketHandlers(io, onlineUsers) {
  io.on('connection', (socket) => {
    const user = socket.user;
    socket.join(user.id);
    addOnlineUser(onlineUsers, user.id, socket.id);
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

    // 用户发送消息（聊天文本）
    socket.on('message:send', ({ conversationId, content }) => {
      const conversation = findConversation(conversationId);
      if (!conversation || !conversation.members.includes(user.id)) {
        return socket.emit('error', { message: 'Unable to send to this conversation' });
      }

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
      removeOnlineUser(onlineUsers, user.id, socket.id);
      recordLog('info', 'Realtime connection closed', { userId: user.id });
    });
  });
}

function addOnlineUser(onlineUsers, userId, socketId) {
  const entry = onlineUsers.get(userId) || { sockets: new Set() };
  entry.sockets.add(socketId);
  onlineUsers.set(userId, entry);
}

function removeOnlineUser(onlineUsers, userId, socketId) {
  const entry = onlineUsers.get(userId);
  if (!entry) return;
  entry.sockets.delete(socketId);
  if (entry.sockets.size === 0) {
    onlineUsers.delete(userId);
  } else {
    onlineUsers.set(userId, entry);
  }
}


