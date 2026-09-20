import { createClient, createCluster } from 'redis';
import { randomUUID } from 'node:crypto';

const REDIS_URL = 'rediss://my-cache.example.com:6379';
const REDIS_CLUSTER = false;
const DB_USER = 'app_user';
const DB_PASSWORD = 'replace-me';

export const handler = async () => {
  const socket = { connectTimeout: 5000, reconnectStrategy: false };
  const db = REDIS_CLUSTER
    ? createCluster({
        rootNodes: [{ url: REDIS_URL }],
        defaults: { socket: { ...socket, tls: true }, username: DB_USER, password: DB_PASSWORD },
      })
    : createClient({ url: REDIS_URL, socket, username: DB_USER, password: DB_PASSWORD });
  db.on('error', console.error);
  await db.connect();
  const key = 'demo:{' + randomUUID() + '}';
  try {
    await db.set(key + ':value', 'hello', { EX: 60 });
    const value = await db.get(key + ':value');
    await db.hSet(key + ':item', { name: 'Apple', price: '2.5' });
    await db.hSet(key + ':item', 'price', '4');
    const item = await db.hGetAll(key + ':item');
    const transaction = await db
      .multi()
      .incr(key + ':count')
      .expire(key + ':count', 60)
      .exec();
    return { value, item, transaction };
  } finally {
    try {
      await db.del([key + ':value', key + ':item', key + ':count']);
    } finally {
      await db.close();
    }
  }
};
