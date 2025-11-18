import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LowSync } from 'lowdb';
import { JSONFileSync } from 'lowdb/node';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, '..', 'data');

if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
}

const defaultData = {
  users: [],
  conversations: [],
  messages: [],
  files: [],
  logs: [],
  groups: [],
  friendRequests: [],
};

const adapter = new JSONFileSync(join(dataDir, 'db.json'));
export const db = new LowSync(adapter, defaultData);

export function initDb() {
  db.read();
  if (!db.data) {
    db.data = JSON.parse(JSON.stringify(defaultData));
    db.write();
  }
}

export function persist() {
  try {
    db.write();
  } catch (error) {
    if (error.code === 'ENOENT') {
      if (!existsSync(dataDir)) {
        mkdirSync(dataDir, { recursive: true });
      }
      writeFileSync(
        join(dataDir, 'db.json'),
        JSON.stringify(db.data ?? defaultData, null, 2),
        'utf-8'
      );
    } else {
      throw error;
    }
  }
}

