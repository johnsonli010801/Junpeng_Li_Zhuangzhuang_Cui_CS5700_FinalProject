import { query } from '../database.js';

export async function createUser({ id, name, email, passwordHash }) {
  const result = await query(
    `INSERT INTO users (id, name, email, password_hash, mfa_enabled, roles)
     VALUES ($1, $2, $3, $4, FALSE, ARRAY['user'])
     RETURNING id, name, email, mfa_enabled, roles, created_at, updated_at`,
    [id, name, email, passwordHash]
  );
  return result.rows[0];
}

export async function findUserByEmail(email) {
  const result = await query(
    'SELECT * FROM users WHERE email = $1',
    [email]
  );
  return result.rows[0];
}

export async function findUserById(id) {
  const result = await query(
    'SELECT * FROM users WHERE id = $1',
    [id]
  );
  return result.rows[0];
}

export async function updateUser(id, updates) {
  const fields = [];
  const values = [];
  let paramIndex = 1;

  Object.entries(updates).forEach(([key, value]) => {
    fields.push(`${key} = $${paramIndex}`);
    values.push(value);
    paramIndex++;
  });

  if (fields.length === 0) return null;

  values.push(id);
  const result = await query(
    `UPDATE users SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP
     WHERE id = $${paramIndex}
     RETURNING *`,
    values
  );
  return result.rows[0];
}

export async function getAllUsers() {
  const result = await query('SELECT * FROM users ORDER BY created_at DESC');
  return result.rows;
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

