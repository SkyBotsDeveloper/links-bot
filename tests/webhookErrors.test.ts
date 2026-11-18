import assert from "node:assert/strict";
import test from "node:test";
import { GrammyError } from "grammy";
import { isTerminalTelegramFailure } from "../src/webhookErrors";

function telegramError(errorCode: number): GrammyError {
  return new GrammyError(
    "Telegram request failed",
    {
      ok: false,
      error_code: errorCode,
      description: "Telegram request failed",
    },
    "sendMessage",
    {},
  );
}

test("terminal blocked-user errors are acknowledged", () => {
  assert.equal(isTerminalTelegramFailure(telegramError(403)), true);
});

test("other Telegram errors remain retryable", () => {
  assert.equal(isTerminalTelegramFailure(telegramError(429)), false);
  assert.equal(isTerminalTelegramFailure(new Error("database unavailable")), false);
});
