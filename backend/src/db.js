import pg from 'pg';

const { Pool } = pg;

// 默认数据结构：保持和原来 LowDB 一致
const defaultData = {
  users: [],
  conversations: [],
  messages: [],
  files: [],
  logs: [],
  groups: [],
  friendRequests: [],
};

// 导出一个简单的内存对象，其他代码仍然通过 db.data.* 访问
export const db = {
  data: null,
};

// Postgres 连接配置，全部使用非常规端口（默认 25432）
const PG_HOST = process.env.PGHOST || process.env.POSTGRES_HOST || 'localhost';
const PG_PORT = Number(process.env.PGPORT || process.env.POSTGRES_PORT || 25432);
const PG_DATABASE = process.env.PGDATABASE || process.env.POSTGRES_DB || 'youchat';
const PG_USER = process.env.PGUSER || process.env.POSTGRES_USER || 'youchat';
const PG_PASSWORD =
  process.env.PGPASSWORD || process.env.POSTGRES_PASSWORD || 'youchat_password';

let pool;
const STATE_TABLE = 'app_state';
const STATE_ID = 'main';

// Simple lock to prevent concurrent writes
let isPersisting = false;
let pendingPersist = false;

export async function initDb() {
  if (!pool) {
    pool = new Pool({
      host: PG_HOST,
      port: PG_PORT,
      database: PG_DATABASE,
      user: PG_USER,
      password: PG_PASSWORD,
    });
  }

  // 确保存储应用整体 JSON 状态的表存在
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${STATE_TABLE} (
      id   TEXT PRIMARY KEY,
      data JSONB NOT NULL
    );
  `);

  // 尝试读取已有状态
  const result = await pool.query(
    `SELECT data FROM ${STATE_TABLE} WHERE id = $1`,
    [STATE_ID],
  );

  if (result.rowCount === 0) {
    // 初始化默认数据并写入 Postgres
    db.data = JSON.parse(JSON.stringify(defaultData));
    await pool.query(
      `INSERT INTO ${STATE_TABLE} (id, data) VALUES ($1, $2)`,
      [STATE_ID, db.data],
    );
  } else {
    db.data = result.rows[0].data || JSON.parse(JSON.stringify(defaultData));
  }
}

export function persist() {
  if (!pool || !db.data) {
    return;
  }

  if (isPersisting) {
    pendingPersist = true;
    return;
  }

  isPersisting = true;

  pool
    .query(
      `INSERT INTO ${STATE_TABLE} (id, data)
       VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
      [STATE_ID, db.data],
    )
    .catch((error) => {
      // 这里简单打印错误，避免影响正常请求流程
      // eslint-disable-next-line no-console
      console.error('Failed to persist app state to Postgres:', error.message);
    })
    .finally(() => {
      isPersisting = false;

      // If there is a pending persist, execute it immediately
      if (pendingPersist) {
        pendingPersist = false;
        // 再触发一次持久化（尾调用）
        setImmediate(() => persist());
      }
    });
}

