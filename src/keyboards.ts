import { InlineKeyboard } from "grammy";
import type { PageStats } from "./pageService";

export const CALLBACK_PAGE_PREFIX = "p:";
export const CALLBACK_NOOP = "noop";

export function buildPublicKeyboard(currentPage: number, stats: PageStats): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  if (currentPage > 1) {
    keyboard.text("⬅️ Previous", `${CALLBACK_PAGE_PREFIX}${currentPage - 1}`);
  }

  keyboard.text(`Page ${currentPage}/${stats.totalPages}`, CALLBACK_NOOP);

  if (currentPage < stats.totalPages) {
    keyboard.text("Next ➡️", `${CALLBACK_PAGE_PREFIX}${currentPage + 1}`);
  }

  return keyboard;
}
