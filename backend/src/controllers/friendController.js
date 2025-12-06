import { nanoid } from 'nanoid';
import { db, persist } from '../db.js';
import { recordLog } from '../auth.js';
import { ensureUserShape, decorateFriendRequest } from '../utils/userUtils.js';
import { ensureDirectConversation } from '../utils/conversationUtils.js';

// 好友相关接口
export function createFriendController(io) {
  const getFriends = (req, res) => {
    ensureUserShape(req.user);
    const friends = req.user.friends
      .map((friendId) => {
        const friend = db.data.users.find((u) => u.id === friendId);
        return friend ? { ...friend, passwordHash: undefined } : null;
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
  };

  const requestFriend = (req, res) => {
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
    return res.status(201).json({ request: decorateFriendRequest(request) });
  };

  const respondFriend = (req, res) => {
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
    return res.json({ request: decorateFriendRequest(request) });
  };

  return {
    getFriends,
    requestFriend,
    respondFriend,
  };
}


