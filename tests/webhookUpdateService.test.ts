import assert from "node:assert/strict";
import test from "node:test";
import type { DatabaseHandle, WebhookUpdateDocument } from "../src/db";
import {
  claimWebhookUpdate,
  markWebhookUpdateProcessed,
} from "../src/webhookUpdateService";

test("webhook updates are durably claimed once and processed retries are deduplicated", async () => {
  let record: WebhookUpdateDocument | undefined;
  const webhookUpdates = {
    insertOne: async (document: WebhookUpdateDocument) => {
      if (record) throw { code: 11000 };
      record = document;
      return { acknowledged: true, insertedId: document._id };
    },
    findOne: async () => record ?? null,
    updateOne: async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
      if (!record || filter._id !== record._id) return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
      if (filter.status === "processing" && record.status !== "processing") {
        return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
      }
      if (filter.status && typeof filter.status === "object") {
        const or = filter.$or as Array<Record<string, unknown>>;
        const canClaim = or.some((condition) =>
          condition.status === "pending" ? record?.status === "pending" : record?.status === "processing",
        );
        if (!canClaim || record.status === "processed") {
          return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
        }
      }
      Object.assign(record, (update.$set as Record<string, unknown>) ?? {});
      if ("$unset" in update) {
        for (const key of Object.keys(update.$unset as Record<string, unknown>)) delete (record as unknown as Record<string, unknown>)[key];
      }
      if ("$inc" in update) {
        for (const [key, amount] of Object.entries(update.$inc as Record<string, number>)) {
          (record as unknown as Record<string, number>)[key] = ((record as unknown as Record<string, number>)[key] ?? 0) + amount;
        }
      }
      return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
    },
  };
  const database = { webhookUpdates } as unknown as DatabaseHandle;
  const update = { update_id: 5001, message: { text: "hello" } };

  assert.equal(await claimWebhookUpdate(database, 5001, update), "claimed");
  assert.equal(record?.status, "processing");
  assert.equal(record?.update, update);
  assert.equal((await markWebhookUpdateProcessed(database, 5001)).modifiedCount, 1);
  assert.equal(record?.status, "processed");
  assert.equal(record?.update, undefined);
  assert.equal(await claimWebhookUpdate(database, 5001, update), "processed");
});
