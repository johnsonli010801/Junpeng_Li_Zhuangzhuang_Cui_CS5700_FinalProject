import { query, transaction } from '../database.js';

export async function createFriendRequest({ id, fromId, toId }) {
  const result = await query(
    `INSERT INTO friend_requests (id, from_id, to_id, status)
     VALUES ($1, $2, $3, 'pending')
     RETURNING *`,
    [id, fromId, toId]
  );
  return result.rows[0];
}

export async function getFriendRequests(userId) {
  const incoming = await query(
    `SELECT fr.*, u.name as from_name, u.email as from_email, u.avatar_url as from_avatar
     FROM friend_requests fr
     JOIN users u ON fr.from_id = u.id
     WHERE fr.to_id = $1 AND fr.status = 'pending'
     ORDER BY fr.created_at DESC`,
    [userId]
  );

  const outgoing = await query(
    `SELECT fr.*, u.name as to_name, u.email as to_email
     FROM friend_requests fr
     JOIN users u ON fr.to_id = u.id
     WHERE fr.from_id = $1 AND fr.status = 'pending'
     ORDER BY fr.created_at DESC`,
    [userId]
  );

  return {
    incoming: incoming.rows,
    outgoing: outgoing.rows,
  };
}

export async function respondToFriendRequest(requestId, action) {
  return await transaction(async (client) => {
    // 更新请求状态
    const reqResult = await client.query(
      `UPDATE friend_requests
       SET status = $1, handled_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND status = 'pending'
       RETURNING *`,
      [action === 'accept' ? 'accepted' : 'declined', requestId]
    );

    if (reqResult.rows.length === 0) {
      throw new Error('好友请求不存在或已处理');
    }

    const request = reqResult.rows[0];

    // 如果接受，创建双向好友关系
    if (action === 'accept') {
      await client.query(
        `INSERT INTO friendships (id, user_id, friend_id)
         VALUES (gen_random_uuid()::text, $1, $2)
         ON CONFLICT (user_id, friend_id) DO NOTHING`,
        [request.from_id, request.to_id]
      );

      await client.query(
        `INSERT INTO friendships (id, user_id, friend_id)
         VALUES (gen_random_uuid()::text, $1, $2)
         ON CONFLICT (user_id, friend_id) DO NOTHING`,
        [request.to_id, request.from_id]
      );
    }

    return request;
  });
}

export async function getUserFriends(userId) {
  const result = await query(
    `SELECT u.id, u.name, u.email, u.avatar_url, u.status, f.created_at as friends_since
     FROM friendships f
     JOIN users u ON f.friend_id = u.id
     WHERE f.user_id = $1
     ORDER BY u.name`,
    [userId]
  );
  return result.rows;
}

export async function areFriends(userId1, userId2) {
  const result = await query(
    `SELECT 1 FROM friendships
     WHERE user_id = $1 AND friend_id = $2`,
    [userId1, userId2]
  );
  return result.rows.length > 0;
}

export async function findPendingRequest(fromId, toId) {
  const result = await query(
    `SELECT * FROM friend_requests
     WHERE status = 'pending'
       AND ((from_id = $1 AND to_id = $2) OR (from_id = $2 AND to_id = $1))`,
    [fromId, toId]
  );
  return result.rows[0];
}

