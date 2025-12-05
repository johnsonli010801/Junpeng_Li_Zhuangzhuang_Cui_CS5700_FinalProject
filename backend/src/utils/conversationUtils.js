import { nanoid } from 'nanoid';
import { db, persist } from '../db.js';

// 会话相关的小工具
export function findConversation(id) {
  return db.data.conversations.find((c) => c.id === id);
}

export function createMessage({ conversationId, senderId, type = 'text', content, fileId }) {
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

export function ensureDirectConversation(userIdA, userIdB) {
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


