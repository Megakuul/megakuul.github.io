import { MemcacheClient } from 'memcache-client';
import { randomUUID } from 'node:crypto';

const DB_HOST = 'my-cache.example.com';
const DB_PORT = 11211;

export const handler = async () => {
  const db = new MemcacheClient({
    server: DB_HOST + ':' + DB_PORT,
    tls: {},
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
