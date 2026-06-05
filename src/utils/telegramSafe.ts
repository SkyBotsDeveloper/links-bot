import { GrammyError, type Bot, type Context } from "grammy";
import { autoRetry } from "@grammyjs/auto-retry";
import { apiThrottler } from "@grammyjs/transformer-throttler";

/*
 * Telegram practical limits:
 * - Avoid more than 1 message per second to the same chat.
 * - Avoid group spam.
 * - The default broadcast limit is about 30 messages per second.
 *
 * This bot never broadcasts automatically, bulk add replies once, and
 * pagination edits the existing message instead of sending new messages.
 */
export function configureSafeTelegramApi<C extends Context>(bot: Bot<C>): void {
  bot.api.config.use(
    autoRetry({
      maxRetryAttempts: 3,
      maxDelaySeconds: 10,
    }),
  );

  bot.api.config.use(
    apiThrottler({
      global: {
        reservoir: 30,
        reservoirRefreshAmount: 30,
        reservoirRefreshInterval: 1_000,
      },
      group: {
        maxConcurrent: 1,
        minTime: 1_000,
      },
      out: {
        maxConcurrent: 1,
        minTime: 1_000,
      },
    }),
  );
}

export async function ignoreMessageNotModified(action: () => Promise<unknown>): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (isMessageNotModified(error)) {
      return;
    }
    throw error;
  }
}

function isMessageNotModified(error: unknown): boolean {
  return (
    error instanceof GrammyError &&
    error.error_code === 400 &&
    error.description.toLowerCase().includes("message is not modified")
  );
}
