import { GrammyError, type Api } from "grammy";
import type { DatabaseHandle } from "./db";
import {
  getBroadcastTargetCount,
  getBroadcastTargetCursor,
  markUserBlocked,
  markUserBroadcasted,
} from "./userService";

const BROADCAST_DELAY_MS = 45;
const MAX_RETRY_ATTEMPTS = 3;
const RECOVERY_CONCURRENCY = 10;

export type BroadcastContent =
  | { kind: "text"; text: string }
  | { kind: "copy"; fromChatId: number | string; messageId: number };

export interface BroadcastProgress {
  id: string;
  running: boolean;
  startedAt: Date;
  finishedAt?: Date;
  mode: "text" | "copy";
  totalTargeted: number;
  sent: number;
  failed: number;
  blocked: number;
}

export interface BroadcastResult {
  sent: number;
  failed: number;
  blocked: number;
  totalTargeted: number;
}

export interface RecoveryResult {
  sent: number;
  blocked: number;
  failed: number;
  unknown: number;
}

let currentProgress: BroadcastProgress | undefined;

export function getBroadcastProgress(): BroadcastProgress | undefined {
  return currentProgress ? { ...currentProgress } : undefined;
}

export async function runBroadcast(input: {
  database: DatabaseHandle;
  api: Api;
  content: BroadcastContent;
}): Promise<BroadcastResult> {
  if (currentProgress?.running) {
    throw new Error("Ek broadcast already chal raha hai.");
  }

  const totalTargeted = await getBroadcastTargetCount(input.database);
  currentProgress = {
    id: `${Date.now()}`,
    running: true,
    startedAt: new Date(),
    mode: input.content.kind,
    totalTargeted,
    sent: 0,
    failed: 0,
    blocked: 0,
  };

  const cursor = getBroadcastTargetCursor(input.database);
  try {
    for await (const target of cursor) {
      await sendBroadcastToUser(input.database, input.api, target._id, input.content);
      await delay(BROADCAST_DELAY_MS);
    }
  } finally {
    await cursor.close();
    if (currentProgress) {
      currentProgress.running = false;
      currentProgress.finishedAt = new Date();
    }
  }

  return {
    sent: currentProgress?.sent ?? 0,
    failed: currentProgress?.failed ?? 0,
    blocked: currentProgress?.blocked ?? 0,
    totalTargeted,
  };
}

export async function runTextBroadcast(input: {
  database: DatabaseHandle;
  api: Api;
  text: string;
}): Promise<BroadcastResult> {
  return runBroadcast({
    database: input.database,
    api: input.api,
    content: { kind: "text", text: input.text },
  });
}

export async function runRecoveryMessages(input: {
  database: DatabaseHandle;
  api: Api;
}): Promise<RecoveryResult> {
  const result: RecoveryResult = { sent: 0, blocked: 0, failed: 0, unknown: 0 };
  // Any pre-existing claim belongs to an earlier worker. Do not resend it:
  // Telegram may have accepted the message before that worker stopped.
  const stale = await input.database.users.updateMany(
    { recoveryMessageStatus: "sending" },
    { $set: { recoveryMessageStatus: "unknown" } },
  );
  result.unknown = stale.modifiedCount;

  const eligible = {
    startCount: { $gt: 0 },
    isBlocked: { $ne: true },
    isBot: { $ne: true },
    recoveryOptIn: { $ne: false },
    recoveryMessageStatus: { $exists: false },
  };
  const cursor = input.database.users.find(eligible, { projection: { _id: 1 } });
  let batch: Array<{ _id: number }> = [];
  try {
    for await (const target of cursor) {
      batch.push(target);
      if (batch.length >= RECOVERY_CONCURRENCY) {
        await processRecoveryBatch(batch, input.database, input.api, eligible, result);
        batch = [];
      }
    }
    if (batch.length > 0) {
      await processRecoveryBatch(batch, input.database, input.api, eligible, result);
    }
  } finally {
    await cursor.close();
  }
  return result;
}

async function processRecoveryBatch(
  targets: Array<{ _id: number }>,
  database: DatabaseHandle,
  api: Api,
  eligible: Record<string, unknown>,
  result: RecoveryResult,
): Promise<void> {
  await Promise.all(
    targets.map(async (target) => {
      const claim = await database.users.updateOne(
        { _id: target._id, ...eligible },
        { $set: { recoveryMessageStatus: "sending", recoveryMessageStartedAt: new Date() } },
      );
      if (claim.modifiedCount !== 1) return;

      let done = false;
      for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt += 1) {
        try {
          await api.sendMessage(target._id, "Hello! The bot is back online.");
          await database.users.updateOne(
            { _id: target._id, recoveryMessageStatus: "sending" },
            { $set: { recoveryMessageStatus: "sent", recoveryMessageSentAt: new Date() } },
          );
          result.sent += 1;
          done = true;
          break;
        } catch (error) {
          if (isRetryAfter(error)) {
            await delay(error.parameters.retry_after * 1_000);
            continue;
          }

          if (isBlockedOrInactive(error)) {
            await database.users.updateOne(
              { _id: target._id, recoveryMessageStatus: "sending" },
              {
                $set: {
                  recoveryMessageStatus: "blocked",
                  isBlocked: true,
                  blockedAt: new Date(),
                },
              },
            );
            result.blocked += 1;
          } else {
            await database.users.updateOne(
              { _id: target._id, recoveryMessageStatus: "sending" },
              { $set: { recoveryMessageStatus: "failed" } },
            );
            result.failed += 1;
          }
          done = true;
          break;
        }
      }

      if (!done) {
        const exhausted = await database.users.updateOne(
          { _id: target._id, recoveryMessageStatus: "sending" },
          { $set: { recoveryMessageStatus: "failed" } },
        );
        if (exhausted.modifiedCount === 1) result.failed += 1;
      }
      await delay(BROADCAST_DELAY_MS);
    }),
  );
}

async function sendBroadcastToUser(
  database: DatabaseHandle,
  api: Api,
  userId: number,
  content: BroadcastContent,
): Promise<void> {
  for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt += 1) {
    try {
      if (content.kind === "text") {
        await api.sendMessage(userId, content.text, {
          link_preview_options: { is_disabled: true },
        });
      } else {
        await api.copyMessage(userId, content.fromChatId, content.messageId);
      }

      await markUserBroadcasted(database, userId);
      if (currentProgress) {
        currentProgress.sent += 1;
      }
      return;
    } catch (error) {
      if (isRetryAfter(error)) {
        await delay(error.parameters.retry_after * 1_000);
        continue;
      }

      if (isBlockedOrInactive(error)) {
        await markUserBlocked(database, userId);
        if (currentProgress) {
          currentProgress.blocked += 1;
        }
        return;
      }

      if (attempt === MAX_RETRY_ATTEMPTS) {
        if (currentProgress) {
          currentProgress.failed += 1;
        }
        return;
      }

      await delay(500 * attempt);
    }
  }
}

function isRetryAfter(error: unknown): error is GrammyError & { parameters: { retry_after: number } } {
  return (
    error instanceof GrammyError &&
    typeof error.parameters?.retry_after === "number" &&
    error.parameters.retry_after > 0
  );
}

function isBlockedOrInactive(error: unknown): boolean {
  if (!(error instanceof GrammyError)) {
    return false;
  }

  const description = error.description.toLowerCase();
  return (
    error.error_code === 403 ||
    description.includes("bot was blocked") ||
    description.includes("chat not found") ||
    description.includes("user is deactivated")
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
