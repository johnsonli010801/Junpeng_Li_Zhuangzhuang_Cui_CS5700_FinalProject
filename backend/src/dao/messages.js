import { query } from '../database.js';

export async function createMessage({ id, conversationId, senderId, type, content, fileId, metadata }) {
  const result = await query(
    `INSERT INTO messages (id, conversation_id, sender_id, type, content, file_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [id, conversationId, senderId, type, content, fileId, metadata ? JSON.stringify(metadata) : null]
  );
  return result.rows[0];
}

export async function getConversationMessages(conversationId, limit = 200) {
  const result = await query(
    `SELECT m.*, u.name as sender_name, u.avatar_url as sender_avatar
     FROM messages m
     LEFT JOIN users u ON m.sender_id = u.id
     WHERE m.conversation_id = $1
     ORDER BY m.created_at DESC
     LIMIT $2`,
    [conversationId, limit]
  );
  return result.rows.reverse();
}

export async function markMessageAsRead(messageId, userId) {
  const result = await query(
    `INSERT INTO message_reads (id, message_id, user_id)
     VALUES (gen_random_uuid()::text, $1, $2)
     ON CONFLICT (message_id, user_id) DO NOTHING
     RETURNING *`,
    [messageId, userId]
  );
  return result.rows[0];
}

