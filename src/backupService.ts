import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { gunzip, gzip } from "node:zlib";
import { promisify } from "node:util";
import { BSON, MongoClient, type AnyBulkWriteOperation, type Db, type Document } from "mongodb";
import type { DatabaseHandle } from "./db";
import { logger } from "./utils/logger";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
const BACKUP_VERSION = 1;
const CHUNK_SIZE = 500;
const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1_000;

interface BackupManifest {
  _id: string;
  version: number;
  status: "writing" | "complete" | "failed";
  createdAt: Date;
  completedAt?: Date;
  collections?: Record<string, { documents: number; chunks: number }>;
  errorCode?: string;
}

interface BackupChunk {
  backupId: string;
  collection: string;
  index: number;
  documentCount: number;
  iv: Buffer;
  authTag: Buffer;
  checksum: string;
  payload: Buffer;
}

export async function encryptBackupChunk(
  serialized: string,
  key: Buffer,
  backupId: string,
  collection: string,
  index: number,
): Promise<Omit<BackupChunk, "backupId" | "collection" | "index" | "documentCount">> {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`${backupId}:${collection}:${index}`));
  const compressed = await gzipAsync(Buffer.from(serialized));
  const payload = Buffer.concat([cipher.update(compressed), cipher.final()]);
  return {
    iv,
    authTag: cipher.getAuthTag(),
    checksum: createHash("sha256").update(serialized).digest("hex"),
    payload,
  };
}

export async function decryptBackupChunk(
  chunk: Pick<BackupChunk, "backupId" | "collection" | "index" | "iv" | "authTag" | "checksum" | "payload">,
  key: Buffer,
): Promise<unknown[]> {
  const decipher = createDecipheriv("aes-256-gcm", key, asBuffer(chunk.iv));
  decipher.setAAD(Buffer.from(`${chunk.backupId}:${chunk.collection}:${chunk.index}`));
  decipher.setAuthTag(asBuffer(chunk.authTag));
  const compressed = Buffer.concat([
    decipher.update(asBuffer(chunk.payload)),
    decipher.final(),
  ]);
  const serialized = (await gunzipAsync(compressed)).toString("utf8");
  const checksum = createHash("sha256").update(serialized).digest("hex");
  if (checksum !== chunk.checksum) throw new Error("Backup integrity check failed.");
  const documents = BSON.EJSON.parse(serialized);
  if (!Array.isArray(documents)) throw new Error("Backup chunk has an invalid document list.");
  return documents as unknown[];
}

function asBuffer(value: Buffer | Uint8Array | { buffer: Uint8Array; position?: number }): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  const end = typeof value.position === "number" ? value.position : value.buffer.byteLength;
  return Buffer.from(value.buffer.subarray(0, end));
}

export async function createEncryptedBackup(
  source: DatabaseHandle,
  backupDb: Db,
  key: Buffer,
): Promise<{ backupId: string; collections: Record<string, { documents: number; chunks: number }> }> {
  const backupId = `${new Date().toISOString().replace(/[:.]/gu, "-")}-${randomBytes(6).toString("hex")}`;
  const manifests = backupDb.collection<BackupManifest>("backup_manifests");
  const chunks = backupDb.collection<BackupChunk>("backup_chunks");
  await manifests.insertOne({
    _id: backupId,
    version: BACKUP_VERSION,
    status: "writing",
    createdAt: new Date(),
  });

  const collections: Record<string, { documents: number; chunks: number }> = {};
  try {
    const names = (await source.db.listCollections({}, { nameOnly: true }).toArray())
      .map(({ name }) => name)
      .filter((name) => name !== "backup_manifests" && name !== "backup_chunks")
      .sort();

    for (const name of names) {
      let buffer: unknown[] = [];
      let documentCount = 0;
      let chunkIndex = 0;
      const cursor = source.db.collection(name).find({}).batchSize(CHUNK_SIZE);
      const flush = async (): Promise<void> => {
        if (buffer.length === 0) return;
        const serialized = BSON.EJSON.stringify(buffer, { relaxed: false });
        const encrypted = await encryptBackupChunk(serialized, key, backupId, name, chunkIndex);
        await chunks.insertOne({
          backupId,
          collection: name,
          index: chunkIndex,
          documentCount: buffer.length,
          ...encrypted,
        });
        documentCount += buffer.length;
        chunkIndex += 1;
        buffer = [];
      };
      try {
        for await (const document of cursor) {
          buffer.push(document);
          if (buffer.length >= CHUNK_SIZE) await flush();
        }
        await flush();
      } finally {
        await cursor.close();
      }
      collections[name] = { documents: documentCount, chunks: chunkIndex };
    }

    await verifyEncryptedBackup(backupDb, backupId, key, collections);
    await manifests.updateOne(
      { _id: backupId, status: "writing" },
      { $set: { status: "complete", completedAt: new Date(), collections } },
    );
    return { backupId, collections };
  } catch (error) {
    await manifests.updateOne(
      { _id: backupId, status: "writing" },
      { $set: { status: "failed", errorCode: safeErrorCode(error) } },
    );
    throw error;
  }
}

export async function verifyEncryptedBackup(
  backupDb: Db,
  backupId: string,
  key: Buffer,
  expected: Record<string, { documents: number; chunks: number }>,
): Promise<void> {
  const chunks = backupDb.collection<BackupChunk>("backup_chunks");
  for (const [collection, summary] of Object.entries(expected)) {
    let documentCount = 0;
    let chunkCount = 0;
    const cursor = chunks.find({ backupId, collection }).sort({ index: 1 });
    for await (const chunk of cursor) {
      const documents = await decryptBackupChunk(chunk, key);
      if (documents.length !== chunk.documentCount || chunk.index !== chunkCount) {
        throw new Error("Backup chunk reconciliation failed.");
      }
      documentCount += documents.length;
      chunkCount += 1;
    }
    await cursor.close();
    if (documentCount !== summary.documents || chunkCount !== summary.chunks) {
      throw new Error("Backup collection reconciliation failed.");
    }
  }
}

export async function restoreEncryptedBackup(
  backupDb: Db,
  target: Db,
  backupId: string,
  key: Buffer,
): Promise<Record<string, number>> {
  const manifest = await backupDb.collection<BackupManifest>("backup_manifests").findOne({
    _id: backupId,
    version: BACKUP_VERSION,
    status: "complete",
  });
  if (!manifest?.collections) throw new Error("No complete compatible backup exists for that ID.");
  await verifyEncryptedBackup(backupDb, backupId, key, manifest.collections);

  const restored: Record<string, number> = {};
  const chunks = backupDb.collection<BackupChunk>("backup_chunks");
  for (const name of Object.keys(manifest.collections)) {
    let inserted = 0;
    const cursor = chunks.find({ backupId, collection: name }).sort({ index: 1 });
    for await (const chunk of cursor) {
      const documents = await decryptBackupChunk(chunk, key) as Array<Record<string, unknown>>;
      if (name !== "settings" && documents.some((document) => document._id === undefined)) {
        throw new Error(`Backup collection ${name} contains a document without _id.`);
      }
      if (documents.length > 0) {
        const operations: AnyBulkWriteOperation<Document>[] = documents.map((document) => ({
          updateOne: {
            filter: name === "settings" && document.key !== undefined
              ? { key: document.key as Document["key"] }
              : { _id: document._id as Document["_id"] },
            update: { $setOnInsert: document },
            upsert: true,
          },
        }));
        const result = await target.collection<Document>(name).bulkWrite(operations, { ordered: false });
        inserted += result.upsertedCount;
      }
    }
    await cursor.close();
    restored[name] = inserted;
  }
  return restored;
}

export function startBackupScheduler(source: DatabaseHandle, sourceUri: string): () => Promise<void> {
  const backupUri = process.env.BACKUP_MONGODB_URI?.trim();
  if (!backupUri) {
    logger.warn("Encrypted backups are disabled; BACKUP_MONGODB_URI is not configured.");
    return async () => undefined;
  }

  let key: Buffer;
  try {
    key = parseEncryptionKey(process.env.BACKUP_ENCRYPTION_KEY);
    if (new URL(backupUri).hostname === new URL(sourceUri).hostname) {
      throw new Error("BACKUP_MONGODB_URI must use a separate MongoDB cluster.");
    }
  } catch (error) {
    logger.error("Encrypted backups are disabled due to invalid backup configuration.", safeErrorCode(error));
    return async () => undefined;
  }

  const client = new MongoClient(backupUri, {
    appName: "links-bot-encrypted-backup",
    maxPoolSize: 2,
    serverSelectionTimeoutMS: 10_000,
  });
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  let retry = 0;

  const schedule = (delayMs: number): void => {
    if (!stopped) timer = setTimeout(() => void backupOnce(), delayMs);
  };

  const backupOnce = async (): Promise<void> => {
    try {
      await client.connect();
      const backupDb = client.db(inferBackupDatabaseName(backupUri));
      await backupDb.collection("backup_manifests").createIndex({ status: 1, createdAt: -1 });
      await backupDb.collection("backup_chunks").createIndex(
        { backupId: 1, collection: 1, index: 1 },
        { unique: true },
      );
      await backupDb.collection<BackupManifest>("backup_manifests").updateMany(
        { status: "writing" },
        { $set: { status: "failed", errorCode: "InterruptedBackupReconciled" } },
      );
      const result = await createEncryptedBackup(source, backupDb, key);
      retry = 0;
      logger.info(
        `Encrypted backup verified: id=${result.backupId}, collections=${Object.keys(result.collections).length}.`,
      );
      schedule(BACKUP_INTERVAL_MS);
    } catch (error) {
      retry += 1;
      const backoff = Math.min(60 * 60_000, 60_000 * 2 ** Math.min(retry - 1, 6));
      logger.error(
        `Encrypted backup failed; retry ${retry} scheduled in ${Math.round(backoff / 1000)}s.`,
        safeErrorCode(error),
      );
      schedule(backoff);
    }
  };

  void backupOnce();
  return async () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    await client.close();
  };
}

export function parseEncryptionKey(raw: string | undefined): Buffer {
  if (!raw) throw new Error("BACKUP_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  const key = Buffer.from(raw.trim(), "base64");
  if (key.length !== 32) throw new Error("BACKUP_ENCRYPTION_KEY must decode to exactly 32 bytes.");
  return key;
}

export function inferBackupDatabaseName(uri: string): string {
  const name = decodeURIComponent(new URL(uri).pathname.replace(/^\/+/, ""));
  return name || "links_bot_backups";
}

function safeErrorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    return String((error as { code: unknown }).code).slice(0, 80);
  }
  return error instanceof Error ? error.name : "UnknownError";
}

