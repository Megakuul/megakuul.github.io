import { createClient, createCluster } from 'redis';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const handler = async () => {
  const socket = { connectTimeout: 5000, reconnectStrategy: false, ...(process.env.DB_CA_FILE ? { ca: readFileSync(process.env.DB_CA_FILE, 'utf8') } : {}) };
  const db = process.env.REDIS_CLUSTER === 'true'
    ? createCluster({ rootNodes: [{ url: process.env.REDIS_URL }], defaults: { socket: { ...socket, tls: true }, username: process.env.DB_USER, password: process.env.DB_PASSWORD } })
    : createClient({ url: process.env.REDIS_URL, socket });
  db.on('error', console.error);
  await db.connect();
  const key = 'demo:{' + randomUUID() + '}';
  try {
    await db.set(key + ':value', 'hello', { EX: 60 });
    const value = await db.get(key + ':value');
    await db.hSet(key + ':item', { name: 'Apple', price: '2.5' });
    await db.hSet(key + ':item', 'price', '4');
    const item = await db.hGetAll(key + ':item');
    const transaction = await db.multi().incr(key + ':count').expire(key + ':count', 60).exec();
    return { value, item, transaction };
  } finally {
    try { await db.del([key + ':value', key + ':item', key + ':count']); }
    finally { await db.close(); }
  }
};
