import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { BSON } from "mongodb";
import { decryptBackupChunk, encryptBackupChunk, restoreEncryptedBackup } from "../src/backupService";

test("encrypted backup chunks round-trip and reject integrity changes", async () => {
  const key = randomBytes(32);
  const serialized = BSON.EJSON.stringify([{ _id: 42, createdAt: new Date("2024-01-01T00:00:00Z") }]);
  const encrypted = await encryptBackupChunk(serialized, key, "backup-1", "users", 0);
  const chunk = {
    backupId: "backup-1",
    collection: "users",
    index: 0,
    documentCount: 1,
    ...encrypted,
  };

  const restored = await decryptBackupChunk(chunk, key);
  assert.equal((restored[0] as { _id: number })._id, 42);
  assert.ok((restored[0] as { createdAt: Date }).createdAt instanceof Date);
  const mongoBinaryChunk = {
    ...chunk,
    iv: new BSON.Binary(chunk.iv),
    authTag: new BSON.Binary(chunk.authTag),
    payload: new BSON.Binary(chunk.payload),
  };
  assert.equal((await decryptBackupChunk(mongoBinaryChunk as never, key)).length, 1);
  await assert.rejects(() => decryptBackupChunk({ ...chunk, checksum: "0".repeat(64) }, key));
});

test("safe backup restore inserts missing records and preserves existing ones", async () => {
  const key = randomBytes(32);
  const backupId = "backup-restore-test";
  const serialized = BSON.EJSON.stringify([
    { _id: 1, value: "from-backup" },
    { _id: 2, value: "new-record" },
  ]);
  const chunk = {
    backupId,
    collection: "users",
    index: 0,
    documentCount: 2,
    ...(await encryptBackupChunk(serialized, key, backupId, "users", 0)),
  };
  const docs = new Map<number, Record<string, unknown>>([[1, { _id: 1, value: "live-value" }]]);
  const backupDb = {
    collection: (name: string) => name === "backup_manifests"
      ? { findOne: async () => ({ _id: backupId, version: 1, status: "complete", collections: { users: { documents: 2, chunks: 1 } } }) }
      : { find: () => ({ sort() { return this; }, async *[Symbol.asyncIterator]() { yield chunk; }, close: async () => undefined }) },
  };
  const target = {
    collection: () => ({
      bulkWrite: async (operations: Array<{ updateOne: { filter: { _id: number }; update: { $setOnInsert: Record<string, unknown> } } }>) => {
        let upsertedCount = 0;
        for (const operation of operations) {
          const { _id } = operation.updateOne.filter;
          if (!docs.has(_id)) {
            docs.set(_id, operation.updateOne.update.$setOnInsert);
            upsertedCount += 1;
          }
        }
        return { upsertedCount };
      },
    }),
  };

  const first = await restoreEncryptedBackup(backupDb as never, target as never, backupId, key);
  const second = await restoreEncryptedBackup(backupDb as never, target as never, backupId, key);

  assert.equal(first.users, 1);
  assert.equal(second.users, 0);
  assert.deepEqual(docs.get(1), { _id: 1, value: "live-value" });
  assert.deepEqual(docs.get(2), { _id: 2, value: "new-record" });
});
