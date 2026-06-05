import express from "express";
import { webhookCallback } from "grammy";
import type { Server } from "node:http";
import { loadAppConfig } from "./config";
import { closeDatabase, connectDatabase, ensureIndexes } from "./db";
import { createLinksBot } from "./bot";
import { logger } from "./utils/logger";

async function main(): Promise<void> {
  const config = loadAppConfig();
  const database = await connectDatabase(config.mongodbUri);
  await ensureIndexes(database);

  const bot = createLinksBot(config, database);
  let server: Server | undefined;
  let pollingStarted = false;
  let shuttingDown = false;

  async function shutdown(signal: string, exitCode = 0): Promise<void> {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info(`Shutting down after ${signal}.`);

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
    app.post(`/webhook/${config.webhookSecret}`, webhookCallback(bot, "express"));

    server = await new Promise<Server>((resolve) => {
      const started = app.listen(config.port, () => resolve(started));
    });

    await bot.api.setWebhook(`${config.publicUrl}/webhook/${config.webhookSecret}`);
    logger.info(`links-bot listening on port ${config.port} in webhook mode.`);
    return;
  }

  await bot.api.deleteWebhook();
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
