import type { LinkCounts } from "./linkService";
import type { PageStats } from "./pageService";

export const TELEGRAM_MESSAGE_LIMIT = 4096;
export const PREPARING_MESSAGE =
  "🚧 Links collection abhi prepare ho raha hai. Please joined rahiye, first drop jaldi unlock hoga.";
export const LOCKED_PAGE_MESSAGE = "🔒 Ye page 50 links complete hone ke baad unlock hoga.";
export const NOT_ALLOWED_MESSAGE = "❌ Not allowed.";

export interface RenderedMessage {
  text: string;
  parseMode?: "HTML";
}

export function formatLinksPage(
  links: string[],
  options: { ownerPreviewIncomplete?: boolean } = {},
): RenderedMessage {
  const fullText = composePlainLinksPage(links, options.ownerPreviewIncomplete, false);
  if (fullText.length <= TELEGRAM_MESSAGE_LIMIT) {
    return { text: fullText };
  }

  const compactText = composePlainLinksPage(links, options.ownerPreviewIncomplete, true);
  if (compactText.length <= TELEGRAM_MESSAGE_LIMIT) {
    return { text: compactText };
  }

  return {
    text: composeHtmlLinkPage(links, options.ownerPreviewIncomplete),
    parseMode: "HTML",
  };
}

export function formatAddSummary(
  label: string,
  counts: LinkCounts,
  stats: PageStats,
  ignoredLines?: number,
): string {
  const ignored = ignoredLines === undefined ? [] : [`Ignored ${ignoredLines} invalid lines.`];
  return [
    label,
    ...ignored,
    `Total links: ${counts.active}`,
    `Unlocked pages: ${stats.completedPages}`,
    `Pending next page: ${stats.pendingLinks}/${stats.linksPerPage}`,
  ].join("\n");
}

export function formatListPages(counts: LinkCounts, stats: PageStats): string {
  return [
    `Total active links: ${counts.active}`,
    `Links per page: ${stats.linksPerPage}`,
    `Unlocked public pages: ${stats.completedPages}`,
    `Pending links in next page: ${stats.pendingLinks}`,
    `Locked pending page number: ${stats.lockedPendingPage ?? "none"}`,
    `Total removed links: ${counts.removed}`,
  ].join("\n");
}

export function formatStats(input: {
  mongoConnected: boolean;
  counts: LinkCounts;
  stats: PageStats;
  cacheEntries: number;
  uptimeSeconds: number;
  memoryUsage: NodeJS.MemoryUsage;
}): string {
  const memory = input.memoryUsage;
  return [
    `MongoDB connected: ${input.mongoConnected ? "yes" : "no"}`,
    `Active links: ${input.counts.active}`,
    `Removed links: ${input.counts.removed}`,
    `Unlocked pages: ${input.stats.completedPages}`,
    `Pending links: ${input.stats.pendingLinks}`,
    `Cache entries: ${input.cacheEntries}`,
    `Uptime: ${formatDuration(input.uptimeSeconds)}`,
    `Memory: rss ${formatBytes(memory.rss)}, heap ${formatBytes(memory.heapUsed)}/${formatBytes(
      memory.heapTotal,
    )}`,
  ].join("\n");
}

function composePlainLinksPage(
  links: string[],
  ownerPreviewIncomplete: boolean | undefined,
  compact: boolean,
): string {
  const header = compact
    ? ["🔥 VIRAL VIDEOS DROP", "📂 ACCESS LINKS BELOW 👇", ""]
    : [
        "╭━━━🔥 VIRAL VIDEOS DROP 🔥━━━╮",
        "       💎 50 VIDEOS COLLECTION 💎",
        "╰━━━━━━━━━━━━━━━━━━━━━━╯",
        "",
        "📂 ACCESS LINKS BELOW 👇",
        "",
      ];

  const footer = compact
    ? ["", "✅ Stay Joined For Lifetime Free Updates", "👀 More Exclusive Content Coming Daily"]
    : [
        "",
        "⚠️ Daily FREE viral videos milte rahenge",
        "",
        "✅ Stay Joined For Lifetime Free Updates",
        "❌ Leave / Mute Mat Karna",
        "",
        "👀 More Exclusive Content Coming Daily",
        "━━━━━━━━━━━━━━",
      ];

  if (ownerPreviewIncomplete) {
    footer.push("", "⚠️ Owner preview: this page is incomplete and locked for normal users.");
  }

  return [...header, ...links.map((url, index) => `${index + 1}. ${url}`), ...footer].join("\n");
}

function composeHtmlLinkPage(links: string[], ownerPreviewIncomplete: boolean | undefined): string {
  const lines = [
    "🔥 <b>VIRAL VIDEOS DROP</b>",
    "📂 ACCESS LINKS BELOW 👇",
    "",
    ...links.map((url, index) => `${index + 1}. <a href="${escapeHtmlAttribute(url)}">Open link</a>`),
    "",
    "✅ Stay Joined For Lifetime Free Updates",
    "👀 More Exclusive Content Coming Daily",
  ];

  if (ownerPreviewIncomplete) {
    lines.push("", "⚠️ Owner preview: this page is incomplete and locked for normal users.");
  }

  return lines.join("\n");
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatBytes(value: number): string {
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatDuration(totalSeconds: number): string {
  const seconds = Math.floor(totalSeconds % 60);
  const minutes = Math.floor((totalSeconds / 60) % 60);
  const hours = Math.floor(totalSeconds / 3600);
  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}
