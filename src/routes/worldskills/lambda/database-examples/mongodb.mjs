import { MongoClient } from 'mongodb';
import { randomUUID } from 'node:crypto';

const MONGODB_URI =
  'mongodb://my-cluster.cluster-abcdefghijkl.eu-central-1.docdb.amazonaws.com:27017/?replicaSet=rs0';
const DB_NAME = 'app';
const DB_USER = 'app_user';
const DB_PASSWORD = 'replace-me';
const DB_CA_FILE = '/var/task/certs/rds.pem';
// With the driver layer, use /opt/certs/rds.pem.

export const handler = async () => {
  const db = new MongoClient(MONGODB_URI, {
    tls: true,
    authSource: 'admin',
    tlsCAFile: DB_CA_FILE,
    auth: { username: DB_USER, password: DB_PASSWORD },
    retryWrites: false,
    serverSelectionTimeoutMS: 5000,
    maxPoolSize: 1,
  });
  await db.connect();
  const run = randomUUID();
  const items = db.db(DB_NAME).collection('lambda_demo_items');
  try {
    await items.insertMany([
      { run, name: 'Apple', price: 2.5 },
      { run, name: 'Pear', price: 3 },
    ]);
    await items.updateOne({ run, name: 'Apple' }, { $set: { price: 4 } });
    await items.updateOne({ run, name: 'Peach' }, { $set: { price: 5 } }, { upsert: true });
    const rows = await items
      .find({ run, price: { $gte: 2 } })
      .sort({ name: 1 })
      .limit(10)
      .toArray();
    const totals = await items
      .aggregate([
        { $match: { run } },
        { $group: { _id: null, count: { $sum: 1 }, total: { $sum: '$price' } } },
      ])
      .toArray();
    await items.deleteOne({ run, name: 'Pear' });
    return { rows, totals };
  } finally {
    try {
      await items.deleteMany({ run });
    } finally {
      await db.close();
    }
  }
};
