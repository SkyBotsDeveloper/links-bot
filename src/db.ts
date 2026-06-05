import { Collection, Db, MongoClient, ObjectId } from "mongodb";

const DEFAULT_DB_NAME = "links_bot";

export interface LinkDocument {
  _id?: ObjectId;
  url: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  createdBy: number;
  removedAt?: Date;
  removedBy?: number;
}

export interface SettingsDocument {
  _id?: ObjectId;
  key: string;
  value: unknown;
  updatedAt: Date;
}

export interface UserDocument {
  _id: number;
  firstName?: string;
  lastName?: string;
  username?: string;
  languageCode?: string;
  isBot: boolean;
  firstSeenAt: Date;
  lastSeenAt: Date;
  startCount: number;
  messageCount: number;
  isBlocked: boolean;
  blockedAt?: Date;
  lastBroadcastAt?: Date;
}

export interface DatabaseHandle {
  client: MongoClient;
  db: Db;
  links: Collection<LinkDocument>;
  settings: Collection<SettingsDocument>;
  users: Collection<UserDocument>;
}

let handle: DatabaseHandle | undefined;
let connected = false;

export async function connectDatabase(mongodbUri: string): Promise<DatabaseHandle> {
  if (handle) {
    return handle;
  }

  const client = new MongoClient(mongodbUri, {
    appName: "links-bot",
    maxPoolSize: 10,
    minPoolSize: 0,
    serverSelectionTimeoutMS: 10_000,
  });

  await client.connect();
  connected = true;

  const db = client.db(inferDatabaseName(mongodbUri));
  handle = {
    client,
    db,
    links: db.collection<LinkDocument>("links"),
    settings: db.collection<SettingsDocument>("settings"),
    users: db.collection<UserDocument>("users"),
  };

  return handle;
}

export async function ensureIndexes(database: DatabaseHandle): Promise<void> {
  await Promise.all([
    database.links.createIndex({ isActive: 1, sortOrder: 1 }),
    database.links.createIndex({ url: 1 }),
    database.links.createIndex({ createdAt: -1 }),
    database.settings.createIndex({ key: 1 }, { unique: true }),
    database.users.createIndex({ lastSeenAt: -1 }),
    database.users.createIndex({ isBlocked: 1 }),
  ]);
}

export async function closeDatabase(): Promise<void> {
  if (!handle) {
    return;
  }

  await handle.client.close();
  handle = undefined;
  connected = false;
}

export function isMongoConnected(): boolean {
  return connected;
}

function inferDatabaseName(mongodbUri: string): string {
  try {
    const parsed = new URL(mongodbUri);
    const pathName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
    return pathName || DEFAULT_DB_NAME;
  } catch {
    return DEFAULT_DB_NAME;
  }
}
