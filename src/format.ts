import type { LinkCounts } from "./linkService";
import type { PageStats } from "./pageService";
import type { UserCounts } from "./userService";

export const TELEGRAM_MESSAGE_LIMIT = 4096;
export const PREPARING_MESSAGE =
  "🚧 Links collection abhi prepare ho raha hai. Please joined rahiye, first drop jaldi unlock hoga.";
export const NOT_ALLOWED_MESSAGE = "❌ Aapko is command ki permission nahi hai.";
export const OWNER_ONLY_MESSAGE = "❌ Ye command sirf Owner ke liye hai.";
export const ADMIN_ONLY_MESSAGE = "❌ Ye command sirf Owner/Sudo Admin ke liye hai.";
export const SUDO_USERNAME_NOT_FOUND_MESSAGE =
  "⚠️ Is username ka user ID nahi mila. Pehle us user se bot me /start karwao, ya direct numeric user ID use karo.";

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
  const ignored =
    ignoredLines === undefined ? [] : [`Galat lines ignore hue: ${ignoredLines}`];
  return [
    label,
    ...ignored,
    `Total links: ${counts.active}`,
    `Total pages: ${stats.totalPages}`,
  ].join("\n");
}

export function formatListPages(counts: LinkCounts, stats: PageStats): string {
  return [
    "📄 Link Pages",
    `Active links: ${counts.active}`,
    `Links per page: ${stats.linksPerPage}`,
    `Total pages: ${stats.totalPages}`,
    `Last page links: ${stats.linksOnLastPage}`,
    `Removed links: ${counts.removed}`,
  ].join("\n");
}

export function formatStats(input: {
  mongoConnected: boolean;
  counts: LinkCounts;
  stats: PageStats;
  userCounts: UserCounts;
  cacheEntries: number;
  uptimeSeconds: number;
  memoryUsage: NodeJS.MemoryUsage;
  botMode: "polling" | "webhook";
}): string {
  const memory = input.memoryUsage;
  return [
    "📊 Bot Stats",
    `MongoDB: ${input.mongoConnected ? "connected" : "not connected"}`,
    `Active links: ${input.counts.active}`,
    `Removed links: ${input.counts.removed}`,
    `Total pages: ${input.stats.totalPages}`,
    `Links per page: ${input.stats.linksPerPage}`,
    `Tracked users: ${input.userCounts.totalTracked}`,
    `Broadcast users: ${input.userCounts.activeBroadcastUsers}`,
    `Blocked users: ${input.userCounts.blockedUsers}`,
    `Cache entries: ${input.cacheEntries}`,
    `Uptime: ${formatDuration(input.uptimeSeconds)}`,
    `Memory: rss ${formatBytes(memory.rss)}, heap ${formatBytes(memory.heapUsed)}/${formatBytes(
      memory.heapTotal,
    )}`,
    `Bot mode: ${input.botMode}`,
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
    footer.push("", "⚠️ Admin preview: is page me abhi 50 se kam links hain.");
  }

  return [...header, ...links.map((url, index) => `${index + 1}. ${url}`), ...footer].join("\n");
}

function composeHtmlLinkPage(links: string[], ownerPreviewIncomplete: boolean | undefined): string {
  const lines = [
    "🔥 <b>VIRAL VIDEOS DROP</b>",
    "📂 ACCESS LINKS BELOW 👇",
    "",
    ...links.map((url, index) => `${index + 1}. <a href="${escapeHtmlAttribute(url)}">Link kholo</a>`),
    "",
    "✅ Stay Joined For Lifetime Free Updates",
    "👀 More Exclusive Content Coming Daily",
  ];

  if (ownerPreviewIncomplete) {
    lines.push("", "⚠️ Admin preview: is page me abhi 50 se kam links hain.");
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
