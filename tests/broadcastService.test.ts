import assert from "node:assert/strict";
import test from "node:test";
import type { Api } from "grammy";
import type { DatabaseHandle } from "../src/db";
import { runBroadcast, runRecoveryMessages } from "../src/broadcastService";

test("media broadcasts copy the owner's complete message to each eligible user", async () => {
  const recipientIds = [101, 202];
  const copied: Array<[number, number | string, number]> = [];
  const collection = {
    countDocuments: async () => recipientIds.length,
    find: () => ({
      async *[Symbol.asyncIterator]() {
        for (const _id of recipientIds) yield { _id };
      },
      close: async () => undefined,
    }),
    updateOne: async () => ({ acknowledged: true, matchedCount: 1, modifiedCount: 1 }),
  };
  const database = { users: collection } as unknown as DatabaseHandle;
  const api = {
    copyMessage: async (chatId: number, fromChatId: number | string, messageId: number) => {
      copied.push([chatId, fromChatId, messageId]);
      return { message_id: copied.length };
    },
  } as unknown as Api;

  const result = await runBroadcast({
    database,
    api,
    content: { kind: "copy", fromChatId: 999, messageId: 77 },
  });

  assert.deepEqual(copied, [
    [101, 999, 77],
    [202, 999, 77],
  ]);
  assert.equal(result.sent, 2);
  assert.equal(result.failed, 0);
  assert.equal(result.blocked, 0);
});

test("recovery delivery persists status and skips a recipient after a restart", async () => {
  const user = { _id: 303, startCount: 1, isBlocked: false, isBot: false } as Record<string, unknown>;
  let deliveries = 0;
  const collection = {
    updateMany: async () => ({ acknowledged: true, matchedCount: 0, modifiedCount: 0 }),
    find: () => ({
      async *[Symbol.asyncIterator]() {
        if (user.recoveryMessageStatus === undefined) yield { _id: user._id };
      },
      close: async () => undefined,
    }),
    updateOne: async (filter: Record<string, unknown>, update: { $set: Record<string, unknown> }) => {
      if (
        filter._id !== user._id ||
        (filter.recoveryMessageStatus === "sending" && user.recoveryMessageStatus !== "sending") ||
        (filter.recoveryMessageStatus !== "sending" && user.recoveryMessageStatus !== undefined)
      ) {
        return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
      }
      Object.assign(user, update.$set);
      return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
    },
  };
  const database = { users: collection } as unknown as DatabaseHandle;
  const api = {
    sendMessage: async (_chatId: number, text: string) => {
      assert.equal(text, "Hello! The bot is back online.");
      deliveries += 1;
      return { message_id: deliveries };
    },
  } as unknown as Api;

  const first = await runRecoveryMessages({ database, api });
  const second = await runRecoveryMessages({ database, api });

  assert.equal(first.sent, 1);
  assert.equal(second.sent, 0);
  assert.equal(deliveries, 1);
  assert.equal(user.recoveryMessageStatus, "sent");
});
