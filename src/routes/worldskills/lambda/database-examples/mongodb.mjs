import { MongoClient } from 'mongodb';
import { randomUUID } from 'node:crypto';

export const handler = async () => {
  const db = new MongoClient(process.env.MONGODB_URI, {
    tls: true,
    ...(process.env.DB_CA_FILE ? { tlsCAFile: process.env.DB_CA_FILE } : {}),
    retryWrites: false, serverSelectionTimeoutMS: 5000, maxPoolSize: 1,
  });
  await db.connect();
  const run = randomUUID();
  const items = db.db(process.env.DB_NAME || 'app').collection('lambda_demo_items');
  try {
    await items.insertMany([{ run, name: 'Apple', price: 2.5 }, { run, name: 'Pear', price: 3 }]);
    await items.updateOne({ run, name: 'Apple' }, { $set: { price: 4 } });
    await items.updateOne({ run, name: 'Peach' }, { $set: { price: 5 } }, { upsert: true });
    const rows = await items.find({ run, price: { $gte: 2 } }).sort({ name: 1 }).limit(10).toArray();
    const totals = await items.aggregate([{ $match: { run } }, { $group: { _id: null, count: { $sum: 1 }, total: { $sum: '$price' } } }]).toArray();
    await items.deleteOne({ run, name: 'Pear' });
    return { rows, totals };
  } finally {
    try { await items.deleteMany({ run }); }
    finally { await db.close(); }
  }
};
