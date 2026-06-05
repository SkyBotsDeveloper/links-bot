import type { Bot } from "grammy";
import { getBroadcastProgress, runTextBroadcast } from "./broadcastService";
import {
  NOT_ALLOWED_MESSAGE,
  formatAddSummary,
  formatListPages,
  formatStats,
} from "./format";
import {
  addLink,
  addLinks,
  getLinkCounts,
  removeLinkByPageNumber,
  removePage,
} from "./linkService";
import {
  calculatePageStats,
  clearPageCache,
  getOwnerPreview,
  getPageCacheSize,
} from "./pageService";
import { isMongoConnected } from "./db";
import { getBroadcastTargetCount, getUserCounts } from "./userService";
import { cleanSingleUrl, extractUrlsFromText, stripCommandPrefix } from "./utils/urls";
import type { BotContext } from "./bot";

type OwnerHandler = (ctx: BotContext, ownerId: number) => Promise<void>;

const OWNER_COMMANDS = [
  "help",
  "addlink",
  "addlinks",
  "removelink",
  "removepage",
  "listpages",
  "preview",
  "stats",
  "reloadcache",
  "broadcast",
  "broadcaststatus",
];

export function registerOwnerCommands(bot: Bot<BotContext>): void {
  ownerCommand(bot, "help", showHelp);
  ownerCommand(bot, "addlink", handleAddLink);
  ownerCommand(bot, "addlinks", handleAddLinks);
  ownerCommand(bot, "removelink", handleRemoveLink);
  ownerCommand(bot, "removepage", handleRemovePage);
  ownerCommand(bot, "listpages", handleListPages);
  ownerCommand(bot, "preview", handlePreview);
  ownerCommand(bot, "stats", handleStats);
  ownerCommand(bot, "reloadcache", handleReloadCache);
  ownerCommand(bot, "broadcast", handleBroadcast);
  ownerCommand(bot, "broadcaststatus", handleBroadcastStatus);
}

function ownerCommand(bot: Bot<BotContext>, command: string, handler: OwnerHandler): void {
  bot.command(command, async (ctx) => {
    const ownerId = ctx.from?.id;
    if (!ownerId || !ctx.appConfig.ownerIds.has(ownerId)) {
      await ctx.reply(NOT_ALLOWED_MESSAGE);
      return;
    }

    await handler(ctx, ownerId);
  });
}

export function isOwnerCommand(command: string): boolean {
  return OWNER_COMMANDS.includes(command);
}

async function showHelp(ctx: BotContext): Promise<void> {
  await ctx.reply(
    [
      "Owner Commands:",
      "- /addlink <url>",
      "- /addlinks <many urls>",
      "- /addlinks as reply to a message containing many URLs",
      "- /removelink <page> <number>",
      "- /removepage <page>",
      "- /listpages",
      "- /preview <page>",
      "- /stats",
      "- /reloadcache",
      "- /broadcast <message>",
      "- Reply to a message with /broadcast",
      "- /broadcaststatus",
      "",
      "Examples:",
      "/addlink https://example.com/video",
      "/addlinks",
      "https://example.com/a",
      "https://example.com/b",
      "/removelink 1 12",
      "/removepage 2",
      "/preview 3",
      "/broadcast Hello everyone",
      "",
      "/broadcast sends a text message to all tracked users who have interacted with the bot and are not blocked.",
    ].join("\n"),
    { link_preview_options: { is_disabled: true } },
  );
}

async function handleAddLink(ctx: BotContext, ownerId: number): Promise<void> {
  const url = cleanSingleUrl(getCommandPayload(ctx));
  if (!url) {
    await ctx.reply("Usage: /addlink <http-or-https-url>");
    return;
  }

  await addLink(ctx.db, url, ownerId);
  clearPageCache();

  const counts = await getLinkCounts(ctx.db);
  const stats = calculatePageStats(counts.active, ctx.appConfig.linksPerPage);
  await ctx.reply(formatAddSummary("✅ Link added.", counts, stats), {
    link_preview_options: { is_disabled: true },
  });
}

async function handleAddLinks(ctx: BotContext, ownerId: number): Promise<void> {
  const payload = getCommandPayload(ctx);
  const replyText = getReplyText(ctx);
  const sourceText = payload || replyText;

  if (!sourceText) {
    await ctx.reply("Usage: /addlinks <many urls> or reply to a message with /addlinks");
    return;
  }

  const extracted = extractUrlsFromText(sourceText);
  if (extracted.urls.length === 0) {
    await ctx.reply(`No valid links found.\nIgnored ${extracted.invalidLines} invalid lines.`);
    return;
  }

  const added = await addLinks(ctx.db, extracted.urls, ownerId);
  clearPageCache();

  const counts = await getLinkCounts(ctx.db);
  const stats = calculatePageStats(counts.active, ctx.appConfig.linksPerPage);
  await ctx.reply(
    formatAddSummary(`✅ Added ${added} links.`, counts, stats, extracted.invalidLines),
    { link_preview_options: { is_disabled: true } },
  );
}

async function handleRemoveLink(ctx: BotContext, ownerId: number): Promise<void> {
  const args = parsePositiveArgs(getCommandPayload(ctx), 2);
  if (!args) {
    await ctx.reply(`Usage: /removelink <page> <number 1-${ctx.appConfig.linksPerPage}>`);
    return;
  }

  const [page, number] = args;
  if (number > ctx.appConfig.linksPerPage) {
    await ctx.reply(`Number must be between 1 and ${ctx.appConfig.linksPerPage}.`);
    return;
  }

  const removed = await removeLinkByPageNumber(
    ctx.db,
    page,
    number,
    ctx.appConfig.linksPerPage,
    ownerId,
  );

  if (!removed) {
    await ctx.reply("No active link found at that page position.");
    return;
  }

  clearPageCache();
  const counts = await getLinkCounts(ctx.db);
  const stats = calculatePageStats(counts.active, ctx.appConfig.linksPerPage);
  await ctx.reply(
    [
      "✅ Link removed.",
      `Removed URL: ${removed.url}`,
      `Total links: ${counts.active}`,
      `Total pages: ${stats.totalPages}`,
      `Links on last page: ${stats.linksOnLastPage}/${stats.linksPerPage}`,
    ].join("\n"),
    { link_preview_options: { is_disabled: true } },
  );
}

async function handleRemovePage(ctx: BotContext, ownerId: number): Promise<void> {
  const args = parsePositiveArgs(getCommandPayload(ctx), 1);
  if (!args) {
    await ctx.reply("Usage: /removepage <page>");
    return;
  }

  const [page] = args;
  const removed = await removePage(ctx.db, page, ctx.appConfig.linksPerPage, ownerId);
  if (removed.removedCount === 0) {
    await ctx.reply("No active links found on that page.");
    return;
  }

  clearPageCache();
  await ctx.reply(`✅ Page ${page} removed. Removed ${removed.removedCount} links.`, {
    link_preview_options: { is_disabled: true },
  });
}

async function handleListPages(ctx: BotContext): Promise<void> {
  const counts = await getLinkCounts(ctx.db);
  const stats = calculatePageStats(counts.active, ctx.appConfig.linksPerPage);
  await ctx.reply(formatListPages(counts, stats));
}

async function handlePreview(ctx: BotContext): Promise<void> {
  const args = parsePositiveArgs(getCommandPayload(ctx), 1);
  if (!args) {
    await ctx.reply("Usage: /preview <page>");
    return;
  }

  const preview = await getOwnerPreview(ctx.db, args[0], ctx.appConfig.linksPerPage);
  if (!preview) {
    await ctx.reply("No active links found on that page.");
    return;
  }

  await ctx.reply(preview.rendered.text, {
    parse_mode: preview.rendered.parseMode,
    link_preview_options: { is_disabled: true },
  });
}

async function handleStats(ctx: BotContext): Promise<void> {
  const [counts, userCounts] = await Promise.all([getLinkCounts(ctx.db), getUserCounts(ctx.db)]);
  const stats = calculatePageStats(counts.active, ctx.appConfig.linksPerPage);

  await ctx.reply(
    formatStats({
      mongoConnected: isMongoConnected(),
      counts,
      stats,
      userCounts,
      cacheEntries: getPageCacheSize(),
      uptimeSeconds: process.uptime(),
      memoryUsage: process.memoryUsage(),
      botMode: getBotMode(ctx),
    }),
  );
}

async function handleReloadCache(ctx: BotContext): Promise<void> {
  clearPageCache();
  await ctx.reply("✅ Cache cleared.");
}

async function handleBroadcast(ctx: BotContext): Promise<void> {
  const payload = getCommandPayload(ctx);
  const replyText = getReplyText(ctx);
  const message = (payload || replyText).trim();

  if (!message) {
    await ctx.reply("Usage: /broadcast <message> or reply to a text/caption message with /broadcast");
    return;
  }

  if (getBroadcastProgress()?.running) {
    await ctx.reply("A broadcast is already running. Use /broadcaststatus to check progress.");
    return;
  }

  const targetCount = await getBroadcastTargetCount(ctx.db);
  await ctx.reply(`📣 Broadcast started to ${targetCount} users.`);

  const result = await runTextBroadcast({
    database: ctx.db,
    api: ctx.api,
    text: message,
  });

  await ctx.reply(
    [
      "📣 Broadcast finished.",
      `Sent: ${result.sent}`,
      `Failed: ${result.failed}`,
      `Blocked: ${result.blocked}`,
      `Total targeted: ${result.totalTargeted}`,
    ].join("\n"),
  );
}

async function handleBroadcastStatus(ctx: BotContext): Promise<void> {
  const progress = getBroadcastProgress();
  if (!progress) {
    await ctx.reply("No broadcast has been started since this process booted.");
    return;
  }

  await ctx.reply(
    [
      `Broadcast status: ${progress.running ? "running" : "finished"}`,
      `Sent: ${progress.sent}`,
      `Failed: ${progress.failed}`,
      `Blocked: ${progress.blocked}`,
      `Total targeted: ${progress.totalTargeted}`,
    ].join("\n"),
  );
}

function getCommandPayload(ctx: BotContext): string {
  const text = ctx.message?.text ?? "";
  return stripCommandPrefix(text).trim();
}

function getReplyText(ctx: BotContext): string {
  const reply = ctx.message?.reply_to_message;
  return (reply?.text ?? reply?.caption ?? "").trim();
}

function getBotMode(ctx: BotContext): "polling" | "webhook" {
  return ctx.appConfig.isProduction || ctx.appConfig.publicUrl ? "webhook" : "polling";
}

function parsePositiveArgs(payload: string, expectedCount: 1): [number] | undefined;
function parsePositiveArgs(payload: string, expectedCount: 2): [number, number] | undefined;
function parsePositiveArgs(payload: string, expectedCount: 1 | 2): [number] | [number, number] | undefined {
  const values = payload
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => Number(part));

  if (
    values.length !== expectedCount ||
    values.some((value) => !Number.isInteger(value) || value < 1)
  ) {
    return undefined;
  }

  return expectedCount === 1 ? [values[0] as number] : [values[0] as number, values[1] as number];
}
