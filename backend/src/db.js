import pg from 'pg';

const { Pool } = pg;

const defaultData = {
  users: [],
  conversations: [],
  messages: [],
  files: [],
  logs: [],
  groups: [],
  friendRequests: [],
};

export const db = {
  data: null,
};

const PG_HOST = process.env.PGHOST || process.env.POSTGRES_HOST || 'localhost';
const PG_PORT = Number(process.env.PGPORT || process.env.POSTGRES_PORT || 25432);
const PG_DATABASE = process.env.PGDATABASE || process.env.POSTGRES_DB || 'youchat';
const PG_USER = process.env.PGUSER || process.env.POSTGRES_USER || 'youchat';
const PG_PASSWORD =
  process.env.PGPASSWORD || process.env.POSTGRES_PASSWORD || 'youchat_password';

let pool;
const STATE_TABLE = 'app_state';
const STATE_ID = 'main';

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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${STATE_TABLE} (
      id   TEXT PRIMARY KEY,
      data JSONB NOT NULL
    );
  `);

  const result = await pool.query(
    `SELECT data FROM ${STATE_TABLE} WHERE id = $1`,
    [STATE_ID],
  );

  if (result.rowCount === 0) {
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
      console.error('Failed to persist app state to Postgres:', error.message);
    })
    .finally(() => {
      isPersisting = false;

      if (pendingPersist) {
        pendingPersist = false;
        setImmediate(() => persist());
      }
    });
}

