import { query, transaction } from '../database.js';

export async function createConversation({ id, name, isGroup, createdBy, memberIds }) {
  return await transaction(async (client) => {
    // 创建会话
    const convResult = await client.query(
      `INSERT INTO conversations (id, name, is_group, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [id, name, isGroup, createdBy]
    );
    const conversation = convResult.rows[0];

    // 添加成员
    const members = [createdBy, ...memberIds];
    for (const memberId of members) {
      await client.query(
        `INSERT INTO conversation_members (id, conversation_id, user_id, role)
         VALUES (gen_random_uuid()::text, $1, $2, $3)
         ON CONFLICT (conversation_id, user_id) DO NOTHING`,
        [id, memberId, memberId === createdBy ? 'owner' : 'member']
      );
    }

    return conversation;
  });
}

export async function getUserConversations(userId) {
  const result = await query(
    `SELECT c.*, 
            array_agg(cm.user_id) as members,
            (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message,
            (SELECT created_at FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message_at
     FROM conversations c
     JOIN conversation_members cm ON c.id = cm.conversation_id
     WHERE c.id IN (
       SELECT conversation_id FROM conversation_members WHERE user_id = $1
     )
     GROUP BY c.id
     ORDER BY COALESCE(last_message_at, c.created_at) DESC`,
    [userId]
  );
  return result.rows;
}

export async function getConversationById(id) {
  const result = await query(
    `SELECT c.*, array_agg(cm.user_id) as members
     FROM conversations c
     JOIN conversation_members cm ON c.id = cm.conversation_id
     WHERE c.id = $1
     GROUP BY c.id`,
    [id]
  );
  return result.rows[0];
}

export async function addConversationMember(conversationId, userId, role = 'member') {
  const result = await query(
    `INSERT INTO conversation_members (id, conversation_id, user_id, role)
     VALUES (gen_random_uuid()::text, $1, $2, $3)
     ON CONFLICT (conversation_id, user_id) DO NOTHING
     RETURNING *`,
    [conversationId, userId, role]
  );
  return result.rows[0];
}

export async function updateConversationAnnouncement(conversationId, content, userId) {
  const result = await query(
    `UPDATE conversations
     SET announcement = $1, announcement_by = $2, announcement_at = CURRENT_TIMESTAMP
     WHERE id = $3
     RETURNING *`,
    [content, userId, conversationId]
  );
  return result.rows[0];
}

export async function findDirectConversation(userId1, userId2) {
  const result = await query(
    `SELECT c.*
     FROM conversations c
     WHERE c.is_group = FALSE
       AND c.id IN (
         SELECT conversation_id FROM conversation_members WHERE user_id = $1
       )
       AND c.id IN (
         SELECT conversation_id FROM conversation_members WHERE user_id = $2
       )
     LIMIT 1`,
    [userId1, userId2]
  );
  return result.rows[0];
}

