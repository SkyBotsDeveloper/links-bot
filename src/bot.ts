import { Bot, type Context } from "grammy";
import type { AppConfig } from "./config";
import type { DatabaseHandle } from "./db";
import {
  CALLBACK_LOCKED_PREFIX,
  CALLBACK_NOOP,
  CALLBACK_PAGE_PREFIX,
  buildPublicKeyboard,
} from "./keyboards";
import { LOCKED_PAGE_MESSAGE, PREPARING_MESSAGE } from "./format";
import { getPublicPage, getStartPage } from "./pageService";
import { registerOwnerCommands } from "./owner";
import {
  configureSafeTelegramApi,
  ignoreMessageNotModified,
} from "./utils/telegramSafe";
import { logger } from "./utils/logger";

export interface BotContext extends Context {
  appConfig: AppConfig;
  db: DatabaseHandle;
}

export function createLinksBot(appConfig: AppConfig, db: DatabaseHandle): Bot<BotContext> {
  const bot = new Bot<BotContext>(appConfig.botToken);
  configureSafeTelegramApi(bot);

  bot.use(async (ctx, next) => {
    ctx.appConfig = appConfig;
    ctx.db = db;
    await next();
  });

  bot.command("start", async (ctx) => {
    const startPage = await getStartPage(ctx.db, ctx.appConfig.linksPerPage);
    if (startPage.preparing || !startPage.rendered) {
      await ctx.reply(PREPARING_MESSAGE, {
        reply_markup: buildPublicKeyboard(1, startPage.stats),
      });
      return;
    }

    await ctx.reply(startPage.rendered.text, {
      parse_mode: startPage.rendered.parseMode,
      reply_markup: buildPublicKeyboard(1, startPage.stats),
      link_preview_options: { is_disabled: true },
    });
  });

  bot.callbackQuery(new RegExp(`^${CALLBACK_PAGE_PREFIX}(\\d+)$`), async (ctx) => {
    await ctx.answerCallbackQuery();
    const page = Number(ctx.match[1]);
    const publicPage = await getPublicPage(ctx.db, page, ctx.appConfig.linksPerPage);

    if (!publicPage) {
      return;
    }

    await ignoreMessageNotModified(() =>
      ctx.editMessageText(publicPage.rendered.text, {
        parse_mode: publicPage.rendered.parseMode,
        reply_markup: buildPublicKeyboard(page, publicPage.stats),
        link_preview_options: { is_disabled: true },
      }),
    );
  });

  bot.callbackQuery(new RegExp(`^${CALLBACK_LOCKED_PREFIX}(\\d+)$`), async (ctx) => {
    await ctx.answerCallbackQuery({
      text: LOCKED_PAGE_MESSAGE,
      show_alert: true,
    });
  });

  bot.callbackQuery(CALLBACK_NOOP, async (ctx) => {
    await ctx.answerCallbackQuery();
  });

  registerOwnerCommands(bot);

  bot.catch((error) => {
    logger.error("Bot handler failed.", error.error);
  });

  return bot;
}
