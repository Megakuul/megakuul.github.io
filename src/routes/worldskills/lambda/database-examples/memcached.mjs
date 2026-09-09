import { MemcacheClient } from 'memcache-client';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const handler = async () => {
  const db = new MemcacheClient({
    server: process.env.DB_HOST + ':' + (process.env.DB_PORT || '11211'),
    tls: process.env.DB_CA_FILE ? { ca: readFileSync(process.env.DB_CA_FILE, 'utf8') } : {},
  });
  const key = 'demo:' + randomUUID();
  try {
    await db.set(key, JSON.stringify({ name: 'Apple', price: 2.5 }), { lifetime: 60 });
    const item = JSON.parse((await db.get(key)).value);
    await db.set(key, JSON.stringify({ name: 'Apple', price: 4 }), { lifetime: 60 });
    const updated = JSON.parse((await db.get(key)).value);
    await db.delete(key);
    return { item, updated };
  } finally {
    db.shutdown();
  }
};
