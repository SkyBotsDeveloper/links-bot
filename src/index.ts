import express from "express";
import { BotError, webhookCallback } from "grammy";
import type { Server } from "node:http";
import { loadAppConfig } from "./config";
import { closeDatabase, connectDatabase, ensureIndexes } from "./db";
import { createLinksBot } from "./bot";
import { runRecoveryMessages } from "./broadcastService";
import { startBackupScheduler } from "./backupService";
import { markUserBlocked } from "./userService";
import { isTerminalTelegramFailure } from "./webhookErrors";
import { logger } from "./utils/logger";

async function main(): Promise<void> {
  const config = loadAppConfig();
  const database = await connectDatabase(config.mongodbUri);
  await ensureIndexes(database);
  logger.info("MongoDB connected and indexes ensured.");
  const stopBackupScheduler = startBackupScheduler(database, config.mongodbUri);

  const bot = createLinksBot(config, database);
  const botInfo = await bot.api.getMe();
  logger.info(
    `Telegram bot identity verified: id=${botInfo.id}, username=@${botInfo.username ?? "unknown"}, firstName=${botInfo.first_name}`,
  );
  let server: Server | undefined;
  let pollingStarted = false;
  let shuttingDown = false;

  async function shutdown(signal: string, exitCode = 0): Promise<void> {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info(`Shutting down after ${signal}.`);
    await stopBackupScheduler();

    if (pollingStarted) {
      await bot.stop();
    }

    if (server) {
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }

    await closeDatabase();
    process.exit(exitCode);
  }

  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled promise rejection.", reason);
  });
  process.on("uncaughtException", (error) => {
    logger.error("Uncaught exception.", error);
    void shutdown("uncaughtException", 1);
  });

  const useWebhook = config.isProduction || Boolean(config.publicUrl);
  if (useWebhook) {
    if (!config.publicUrl) {
      throw new Error("PUBLIC_URL is required for webhook mode.");
    }

    logger.info("Mode: webhook.");
    await bot.init();
    const app = express();
    app.get("/health", (_req, res) => {
      res.json({
        ok: true,
        service: "links-bot",
        mode: "webhook",
      });
    });
    app.use(express.json({ limit: "1mb" }));
    const handleWebhook = webhookCallback(bot, "express");
    app.post(`/webhook/${config.webhookSecret}`, async (req, res) => {
      try {
        await handleWebhook(req, res);
      } catch (error) {
        if (isTerminalTelegramFailure(error)) {
          const userId = error instanceof BotError ? error.ctx.from?.id : undefined;
          if (userId !== undefined) {
            await markUserBlocked(database, userId);
          }
          logger.warn("Acknowledging a webhook update after a terminal Telegram 403.");
          if (!res.headersSent) {
            res.sendStatus(200);
          }
          return;
        }

        logger.error(
          "Webhook update failed; Telegram will retry it.",
          error instanceof Error ? error.message : "Unknown error",
        );
        if (!res.headersSent) {
          res.sendStatus(503);
        }
      }
    });

    server = await new Promise<Server>((resolve) => {
      const started = app.listen(config.port, () => resolve(started));
    });

    await bot.api.setWebhook(`${config.publicUrl}/webhook/${config.webhookSecret}`);
    logger.info(`links-bot listening on port ${config.port} in webhook mode.`);
    void runRecoveryMessages({ database, api: bot.api })
      .then((result) => {
        logger.info(
          `Recovery delivery finished: sent=${result.sent}, blocked=${result.blocked}, failed=${result.failed}, unknown=${result.unknown}.`,
        );
      })
      .catch((error) => {
        logger.error(
          "Recovery delivery stopped; claimed recipients remain persisted to prevent duplicates.",
          error instanceof Error ? error.message : "Unknown error",
        );
      });
    return;
  }

  await bot.api.deleteWebhook();
  logger.info("Mode: polling for local development.");
  pollingStarted = true;
  void bot
    .start({
      onStart: () => logger.info("links-bot started in polling mode."),
    })
    .catch((error) => {
      logger.error("Polling failed.", error);
      void shutdown("polling failure", 1);
    });
}

main().catch((error) => {
  logger.error("Startup failed.", error);
  void closeDatabase().finally(() => process.exit(1));
});
