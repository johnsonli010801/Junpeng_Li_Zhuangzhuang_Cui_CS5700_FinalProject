import { db } from '../db.js';

// 从原 server.js 提取，保持逻辑不变
export function sanitizeUser(user) {
  const {
    passwordHash,
    ...rest
  } = user;
  return rest;
}

export function ensureUserShape(user) {
  if (!user) return;
  if (!Array.isArray(user.friends)) {
    user.friends = [];
  }
}

export function decorateFriendRequest(request) {
  const from = db.data.users.find((u) => u.id === request.fromId);
  const to = db.data.users.find((u) => u.id === request.toId);
  return {
    ...request,
    from: from ? sanitizeUser(from) : null,
    to: to ? sanitizeUser(to) : null,
  };
}


