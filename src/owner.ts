import type { Bot } from "grammy";
import { getBroadcastProgress, runBroadcast, type BroadcastContent } from "./broadcastService";
import {
  NOT_ALLOWED_MESSAGE,
  SUDO_USERNAME_NOT_FOUND_MESSAGE,
  formatAddSummary,
  formatListPages,
  formatStats,
} from "./format";
import {
  HELP_CALLBACK_PREFIX,
  HELP_PERMISSION_MESSAGE,
  PUBLIC_HELP_MESSAGE,
  buildHelpKeyboard,
  getFullGuideMessages,
  getHelpMessage,
  parseHelpSection,
  type HelpSection,
} from "./helpService";
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
import {
  addSudoUser,
  formatSudoResolveError,
  isAdmin,
  isOwner,
  listActiveSudoUsers,
  removeSudoUser,
  requireAdmin,
  requireOwner,
  resolveSudoTarget,
} from "./sudoService";
import { getBroadcastTargetCount, getUserCounts } from "./userService";
import { cleanSingleUrl, extractUrlsFromText, stripCommandPrefix } from "./utils/urls";
import { ignoreMessageNotModified } from "./utils/telegramSafe";
import type { BotContext } from "./bot";

type AdminHandler = (ctx: BotContext, actorId: number) => Promise<void>;
type CommandName = string | string[];

const OWNER_ONLY_COMMANDS = ["addsudo", "rmsudo", "listsudo"];
const ADMIN_COMMANDS = [
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
  "broardcast",
  "broardacast",
  "broadcaststatus",
];

export function registerOwnerCommands(bot: Bot<BotContext>): void {
  bot.command("help", handleHelp);
  bot.callbackQuery(new RegExp(`^${HELP_CALLBACK_PREFIX}([a-z]+)$`), handleHelpCallback);

  adminCommand(bot, "addlink", handleAddLink);
  adminCommand(bot, "addlinks", handleAddLinks);
  adminCommand(bot, "removelink", handleRemoveLink);
  adminCommand(bot, "removepage", handleRemovePage);
  adminCommand(bot, "listpages", handleListPages);
  adminCommand(bot, "preview", handlePreview);
  adminCommand(bot, "stats", handleStats);
  adminCommand(bot, "reloadcache", handleReloadCache);
  adminCommand(bot, ["broadcast", "broardcast", "broardacast"], handleBroadcast);
  adminCommand(bot, "broadcaststatus", handleBroadcastStatus);

  ownerCommand(bot, "addsudo", handleAddSudo);
  ownerCommand(bot, "rmsudo", handleRemoveSudo);
  ownerCommand(bot, "listsudo", handleListSudo);
}

function adminCommand(bot: Bot<BotContext>, command: CommandName, handler: AdminHandler): void {
  bot.command(command, async (ctx) => {
    const actorId = await requireAdmin(ctx);
    if (!actorId) {
      return;
    }

    await handler(ctx, actorId);
  });
}

function ownerCommand(bot: Bot<BotContext>, command: CommandName, handler: AdminHandler): void {
  bot.command(command, async (ctx) => {
    const ownerId = await requireOwner(ctx);
    if (!ownerId) {
      return;
    }

    await handler(ctx, ownerId);
  });
}

export function isOwnerCommand(command: string): boolean {
  return OWNER_ONLY_COMMANDS.includes(command) || ADMIN_COMMANDS.includes(command);
}

async function handleHelp(ctx: BotContext): Promise<void> {
  const userId = ctx.from?.id;
  const sectionInput = getCommandPayload(ctx);
  const section = parseHelpSection(sectionInput);
  const hasSectionInput = sectionInput.length > 0;

  if (!userId || !(await isAdmin(ctx.appConfig, ctx.db, userId))) {
    await ctx.reply(hasSectionInput ? HELP_PERMISSION_MESSAGE : PUBLIC_HELP_MESSAGE);
    return;
  }

  if (!section) {
    await ctx.reply(
      ["⚠️ Galat help section.", "Example: /help links", "Ya main menu ke liye: /help"].join("\n"),
      { reply_markup: buildHelpKeyboard() },
    );
    return;
  }

  await sendHelpSection(ctx, section);
}

async function handleHelpCallback(ctx: BotContext): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId || !(await isAdmin(ctx.appConfig, ctx.db, userId))) {
    await ctx.answerCallbackQuery({ text: HELP_PERMISSION_MESSAGE, show_alert: true });
    return;
  }

  await ctx.answerCallbackQuery();
  const section = parseHelpSection(ctx.match?.[1] ?? "");
  if (!section) {
    return;
  }

  if (section === "all") {
    await ignoreMessageNotModified(() =>
      ctx.editMessageText(getHelpMessage("all"), {
        reply_markup: buildHelpKeyboard(),
        link_preview_options: { is_disabled: true },
      }),
    );
    for (const message of getFullGuideMessages()) {
      await ctx.reply(message, {
        link_preview_options: { is_disabled: true },
      });
    }
    return;
  }

  await ignoreMessageNotModified(() =>
    ctx.editMessageText(getHelpMessage(section), {
      reply_markup: buildHelpKeyboard(),
      link_preview_options: { is_disabled: true },
    }),
  );
}

async function sendHelpSection(ctx: BotContext, section: HelpSection): Promise<void> {
  if (section === "all") {
    await ctx.reply(getHelpMessage("all"), {
      reply_markup: buildHelpKeyboard(),
      link_preview_options: { is_disabled: true },
    });
    for (const message of getFullGuideMessages()) {
      await ctx.reply(message, {
        link_preview_options: { is_disabled: true },
      });
    }
    return;
  }

  await ctx.reply(getHelpMessage(section), {
    reply_markup: buildHelpKeyboard(),
    link_preview_options: { is_disabled: true },
  });
}

async function handleAddSudo(ctx: BotContext, ownerId: number): Promise<void> {
  const payload = getCommandPayload(ctx);
  const resolved = await resolveSudoTarget(ctx.db, payload);
  if (!resolved.ok) {
    await ctx.reply(formatSudoResolveError(resolved));
    return;
  }

  if (isOwner(ctx.appConfig, resolved.target.userId)) {
    await ctx.reply("ℹ️ Ye user Owner hai, sudo add karne ki zarurat nahi.");
    return;
  }

  const result = await addSudoUser(ctx.db, resolved.target, ownerId);
  if (result === "already_active") {
    await ctx.reply("ℹ️ Ye user pehle se sudo admin hai.");
    return;
  }

  await ctx.reply(
    [
      "✅ Sudo admin add ho gaya.",
      `User ID: ${resolved.target.userId}`,
      "Ab ye admin commands use kar sakta hai.",
    ].join("\n"),
  );
}

async function handleRemoveSudo(ctx: BotContext, ownerId: number): Promise<void> {
  const payload = getCommandPayload(ctx);
  const resolved = await resolveSudoTarget(ctx.db, payload);
  if (!resolved.ok) {
    await ctx.reply(
      resolved.reason === "username_not_found"
        ? "⚠️ Ye user active sudo admin nahi hai."
        : ["⚠️ Galat format.", "Example: /rmsudo 123456789", "Ya: /rmsudo @username"].join("\n"),
    );
    return;
  }

  if (isOwner(ctx.appConfig, resolved.target.userId)) {
    await ctx.reply("❌ Owner ko sudo se remove nahi kiya ja sakta.");
    return;
  }

  const removed = await removeSudoUser(ctx.db, resolved.target, ownerId);
  await ctx.reply(removed ? "✅ Sudo admin remove ho gaya." : "⚠️ Ye user active sudo admin nahi hai.");
}

async function handleListSudo(ctx: BotContext): Promise<void> {
  const sudoUsers = await listActiveSudoUsers(ctx.db);
  if (sudoUsers.length === 0) {
    await ctx.reply("Abhi koi sudo admin add nahi hai.");
    return;
  }

  await ctx.reply(
    [
      "👑 Active Sudo Admins",
      ...sudoUsers.map((user, index) => {
        const username = user.username ? ` @${user.username}` : "";
        return `${index + 1}. ${user._id}${username} | added: ${formatDate(user.addedAt)}`;
      }),
    ].join("\n"),
  );
}

async function handleAddLink(ctx: BotContext, actorId: number): Promise<void> {
  const url = cleanSingleUrl(getCommandPayload(ctx));
  if (!url) {
    await ctx.reply("⚠️ Galat format.\nExample: /addlink https://example.com/video");
    return;
  }

  await addLink(ctx.db, url, actorId);
  clearPageCache();

  const counts = await getLinkCounts(ctx.db);
  const stats = calculatePageStats(counts.active, ctx.appConfig.linksPerPage);
  await ctx.reply(formatAddSummary("✅ Link add ho gaya.", counts, stats), {
    link_preview_options: { is_disabled: true },
  });
}

async function handleAddLinks(ctx: BotContext, actorId: number): Promise<void> {
  const payload = getCommandPayload(ctx);
  const replyText = getReplyText(ctx);
  const sourceText = payload || replyText;

  if (!sourceText) {
    await ctx.reply(
      [
        "⚠️ Galat format.",
        "Example:",
        "/addlinks",
        "https://example.com/a",
        "https://example.com/b",
        "",
        "Ya links wale message par reply karke /addlinks bhejo.",
      ].join("\n"),
    );
    return;
  }

  const extracted = extractUrlsFromText(sourceText);
  if (extracted.urls.length === 0) {
    await ctx.reply(`⚠️ Koi valid link nahi mila.\nGalat lines ignore hue: ${extracted.invalidLines}`);
    return;
  }

  const added = await addLinks(ctx.db, extracted.urls, actorId);
  clearPageCache();

  const counts = await getLinkCounts(ctx.db);
  const stats = calculatePageStats(counts.active, ctx.appConfig.linksPerPage);
  await ctx.reply(
    formatAddSummary(`✅ ${added} links add ho gaye.`, counts, stats, extracted.invalidLines),
    { link_preview_options: { is_disabled: true } },
  );
}

async function handleRemoveLink(ctx: BotContext, actorId: number): Promise<void> {
  const args = parsePositiveArgs(getCommandPayload(ctx), 2);
  if (!args) {
    await ctx.reply(
      `⚠️ Galat format.\nExample: /removelink 1 2\nNumber 1 se ${ctx.appConfig.linksPerPage} ke beech hona chahiye.`,
    );
    return;
  }

  const [page, number] = args;
  if (number > ctx.appConfig.linksPerPage) {
    await ctx.reply(`⚠️ Number 1 se ${ctx.appConfig.linksPerPage} ke beech hona chahiye.`);
    return;
  }

  const removed = await removeLinkByPageNumber(
    ctx.db,
    page,
    number,
    ctx.appConfig.linksPerPage,
    actorId,
  );

  if (!removed) {
    await ctx.reply("⚠️ Is page/number par active link nahi mila.");
    return;
  }

  clearPageCache();
  const counts = await getLinkCounts(ctx.db);
  const stats = calculatePageStats(counts.active, ctx.appConfig.linksPerPage);
  await ctx.reply(
    [
      "✅ Link remove ho gaya.",
      `Removed URL: ${removed.url}`,
      `Total links: ${counts.active}`,
      `Total pages: ${stats.totalPages}`,
    ].join("\n"),
    { link_preview_options: { is_disabled: true } },
  );
}

async function handleRemovePage(ctx: BotContext, actorId: number): Promise<void> {
  const args = parsePositiveArgs(getCommandPayload(ctx), 1);
  if (!args) {
    await ctx.reply("⚠️ Galat format.\nExample: /removepage 2");
    return;
  }

  const [page] = args;
  const removed = await removePage(ctx.db, page, ctx.appConfig.linksPerPage, actorId);
  if (removed.removedCount === 0) {
    await ctx.reply("⚠️ Is page par active links nahi mile.");
    return;
  }

  clearPageCache();
  await ctx.reply(`✅ Page ${page} remove ho gaya. Removed links: ${removed.removedCount}`, {
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
    await ctx.reply("⚠️ Galat format.\nExample: /preview 1");
    return;
  }

  const preview = await getOwnerPreview(ctx.db, args[0], ctx.appConfig.linksPerPage);
  if (!preview) {
    await ctx.reply("⚠️ Is page par active links nahi mile.");
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
  await ctx.reply("✅ Cache clear ho gaya.");
}

async function handleBroadcast(ctx: BotContext): Promise<void> {
  const content = getBroadcastContent(ctx);
  if (!content) {
    await ctx.reply(
      [
        "⚠️ Broadcast ka message nahi mila.",
        "",
        "Use:",
        " /broadcast Your message",
        "",
        "Ya kisi text/photo/video/sticker/document par reply karke:",
        " /broadcast",
      ].join("\n"),
    );
    return;
  }

  if (getBroadcastProgress()?.running) {
    await ctx.reply("⚠️ Ek broadcast already chal raha hai. /broadcaststatus se status check karo.");
    return;
  }

  const targetCount = await getBroadcastTargetCount(ctx.db);
  if (targetCount === 0) {
    await ctx.reply("⚠️ Abhi broadcast ke liye koi tracked user nahi hai.");
    return;
  }

  await ctx.reply(["📣 Broadcast start ho gaya.", `Target users: ${targetCount}`, "Thoda time lag sakta hai."].join("\n"));

  const result = await runBroadcast({
    database: ctx.db,
    api: ctx.api,
    content,
  });

  await ctx.reply(
    [
      "✅ Broadcast complete ho gaya.",
      "",
      `Total target: ${result.totalTargeted}`,
      `Sent: ${result.sent}`,
      `Fail hua: ${result.failed}`,
      `Blocked: ${result.blocked}`,
    ].join("\n"),
  );
}

async function handleBroadcastStatus(ctx: BotContext): Promise<void> {
  const progress = getBroadcastProgress();
  if (!progress) {
    await ctx.reply("Abhi tak is process me koi broadcast start nahi hua.");
    return;
  }

  await ctx.reply(
    [
      `📣 Broadcast status: ${progress.running ? "chal raha hai" : "complete"}`,
      `Mode: ${progress.mode}`,
      `Total target: ${progress.totalTargeted}`,
      `Sent: ${progress.sent}`,
      `Fail hua: ${progress.failed}`,
      `Blocked: ${progress.blocked}`,
    ].join("\n"),
  );
}

function getBroadcastContent(ctx: BotContext): BroadcastContent | undefined {
  const payload = getCommandPayload(ctx);
  if (payload) {
    return { kind: "text", text: payload };
  }

  const reply = ctx.message?.reply_to_message;
  const chatId = ctx.chat?.id;
  if (!reply || chatId === undefined) {
    return undefined;
  }

  return {
    kind: "copy",
    fromChatId: chatId,
    messageId: reply.message_id,
  };
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

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
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

export const permissionMessagesForTests = {
  notAllowed: NOT_ALLOWED_MESSAGE,
  usernameNotFound: SUDO_USERNAME_NOT_FOUND_MESSAGE,
};
