import { Bot, GrammyError, type Context } from "grammy";
import type { AppConfig } from "./config";
import type { DatabaseHandle } from "./db";
import {
  CALLBACK_NOOP,
  CALLBACK_PAGE_PREFIX,
  buildPublicKeyboard,
} from "./keyboards";
import { PREPARING_MESSAGE } from "./format";
import { getPublicPage, getStartPage } from "./pageService";
import { registerOwnerCommands } from "./owner";
import { markUserBlocked, trackUserInteraction } from "./userService";
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

  bot.use(async (ctx, next) => {
    if (ctx.from) {
      await trackUserInteraction(ctx.db, ctx.from, { isStart: isStartCommand(ctx) });
    }
    await next();
  });

  bot.command("start", async (ctx) => {
    const startPage = await getStartPage(ctx.db, ctx.appConfig.linksPerPage);
    if (startPage.preparing || !startPage.rendered) {
      await ctx.reply(PREPARING_MESSAGE);
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

  bot.callbackQuery(CALLBACK_NOOP, async (ctx) => {
    await ctx.answerCallbackQuery();
  });

  registerOwnerCommands(bot);

  bot.catch((error) => {
    const caught = error.error;
    if (caught instanceof GrammyError) {
      logger.error(
        `Bot handler failed: method=${caught.method}, code=${caught.error_code}, description=${caught.description}`,
      );
      if (caught.error_code === 403 && error.ctx.from) {
        void markUserBlocked(db, error.ctx.from.id).catch((markError) => {
          logger.error("Failed to mark blocked user after Telegram 403.", safeErrorMessage(markError));
        });
      }
      return;
    }

    logger.error("Bot handler failed.", safeErrorMessage(caught));
  });

  return bot;
}

function isStartCommand(ctx: BotContext): boolean {
  const text = ctx.message?.text;
  return text ? /^\/start(?:@[a-zA-Z0-9_]+)?(?:\s|$)/u.test(text) : false;
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}
