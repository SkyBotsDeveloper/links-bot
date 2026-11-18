import { BotError, GrammyError } from "grammy";

export function getTelegramError(error: unknown): unknown {
  return error instanceof BotError ? error.error : error;
}

export function isTerminalTelegramFailure(error: unknown): boolean {
  const cause = getTelegramError(error);
  return cause instanceof GrammyError && cause.error_code === 403;
}
