import { InlineKeyboard } from "grammy";
import type { PageStats } from "./pageService";

export const CALLBACK_PAGE_PREFIX = "p:";
export const CALLBACK_LOCKED_PREFIX = "locked:";
export const CALLBACK_NOOP = "noop";

export function buildPublicKeyboard(currentPage: number, stats: PageStats): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const visiblePages = Math.max(stats.visibleButtonPages, 1);

  if (stats.completedPages === 0) {
    return keyboard.text(`🔒 Page 1/${visiblePages}`, `${CALLBACK_LOCKED_PREFIX}1`);
  }

  if (currentPage > 1) {
    keyboard.text("⬅️ Previous", `${CALLBACK_PAGE_PREFIX}${currentPage - 1}`);
  }

  keyboard.text(`Page ${currentPage}/${visiblePages}`, CALLBACK_NOOP);

  if (currentPage < visiblePages) {
    const nextPage = currentPage + 1;
    const isUnlocked = nextPage <= stats.completedPages;
    keyboard.text(
      isUnlocked ? "Next ➡️" : "🔒 Next",
      isUnlocked ? `${CALLBACK_PAGE_PREFIX}${nextPage}` : `${CALLBACK_LOCKED_PREFIX}${nextPage}`,
    );
  }

  return keyboard;
}
