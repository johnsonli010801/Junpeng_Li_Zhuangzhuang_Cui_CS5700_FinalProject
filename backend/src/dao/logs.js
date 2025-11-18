import { query } from '../database.js';

export async function createLog({ id, level, message, userId, ipAddress, userAgent, context }) {
  const result = await query(
    `INSERT INTO audit_logs (id, level, message, user_id, ip_address, user_agent, context)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [id, level, message, userId, ipAddress, userAgent, context ? JSON.stringify(context) : null]
  );
  return result.rows[0];
}

export async function getRecentLogs(limit = 100) {
  const result = await query(
    `SELECT * FROM audit_logs
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit]
  );
  return result.rows;
}

export async function getLogsByUser(userId, limit = 50) {
  const result = await query(
    `SELECT * FROM audit_logs
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, limit]
  );
  return result.rows;
}

export async function createLoginAttempt({ id, email, success, ipAddress, userAgent }) {
  const result = await query(
    `INSERT INTO login_attempts (id, email, success, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [id, email, success, ipAddress, userAgent]
  );
  return result.rows[0];
}

export async function getRecentLoginAttempts(email, minutes = 15) {
  const result = await query(
    `SELECT * FROM login_attempts
     WHERE email = $1
       AND created_at > NOW() - INTERVAL '${minutes} minutes'
     ORDER BY created_at DESC`,
    [email]
  );
  return result.rows;
}

