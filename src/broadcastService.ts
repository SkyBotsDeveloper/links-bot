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

export interface BroadcastProgress {
  id: string;
  running: boolean;
  startedAt: Date;
  finishedAt?: Date;
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

let currentProgress: BroadcastProgress | undefined;

export function getBroadcastProgress(): BroadcastProgress | undefined {
  return currentProgress ? { ...currentProgress } : undefined;
}

export async function runTextBroadcast(input: {
  database: DatabaseHandle;
  api: Api;
  text: string;
}): Promise<BroadcastResult> {
  if (currentProgress?.running) {
    throw new Error("A broadcast is already running.");
  }

  const totalTargeted = await getBroadcastTargetCount(input.database);
  currentProgress = {
    id: `${Date.now()}`,
    running: true,
    startedAt: new Date(),
    totalTargeted,
    sent: 0,
    failed: 0,
    blocked: 0,
  };

  const cursor = getBroadcastTargetCursor(input.database);
  try {
    for await (const target of cursor) {
      await sendBroadcastToUser(input.database, input.api, target._id, input.text);
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

async function sendBroadcastToUser(
  database: DatabaseHandle,
  api: Api,
  userId: number,
  text: string,
): Promise<void> {
  for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt += 1) {
    try {
      await api.sendMessage(userId, text, {
        link_preview_options: { is_disabled: true },
      });
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
