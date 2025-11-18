import pg from 'pg';
import { logger } from './logger.js';

const { Pool } = pg;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'youchat',
  user: process.env.DB_USER || 'youchat',
  password: process.env.DB_PASSWORD || 'youchat_secure_pass_2024',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  logger.error('PostgreSQL pool error:', err);
});

export async function query(text, params) {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    logger.debug(`Query executed in ${duration}ms: ${text.substring(0, 100)}`);
    return res;
  } catch (error) {
    logger.error(`Query error: ${error.message}`, { query: text, params });
    throw error;
  }
}

export async function getClient() {
  return await pool.connect();
}

export async function transaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function initDatabase() {
  try {
    await query('SELECT 1');
    logger.info('PostgreSQL 连接成功');
  } catch (error) {
    logger.error('PostgreSQL 连接失败:', error);
    throw error;
  }
}

export { pool };

