import express from "express";
import type { Server } from "node:http";
import { loadAppConfig } from "./config";
import { closeDatabase, connectDatabase, ensureIndexes } from "./db";
import { createLinksBot } from "./bot";
import { runRecoveryMessages } from "./broadcastService";
import { startBackupScheduler } from "./backupService";
import { markUserBlocked } from "./userService";
import { isTerminalTelegramFailure } from "./webhookErrors";
import {
  claimWebhookUpdate,
  markWebhookUpdatePending,
  markWebhookUpdateProcessed,
  refreshWebhookUpdateLease,
} from "./webhookUpdateService";
import { takeWebhookHandlerError } from "./webhookHandlerState";
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
    app.post(`/webhook/${config.webhookSecret}`, async (req, res) => {
      const update = req.body as { update_id?: unknown };
      if (
        !update ||
        !Number.isSafeInteger(update.update_id) ||
        (update.update_id as number) < 0
      ) {
        res.sendStatus(400);
        return;
      }

      const updateId = update.update_id as number;
      try {
        const claim = await claimWebhookUpdate(database, updateId, req.body);
        if (claim === "processed") {
          res.sendStatus(200);
          return;
        }
        if (claim === "busy") {
          res.sendStatus(503);
          return;
        }

        const leaseTimer = setInterval(() => {
          void refreshWebhookUpdateLease(database, updateId).catch((error) => {
            logger.error("Webhook update lease refresh failed.", safeErrorMessage(error));
          });
        }, 30_000);
        try {
          await bot.handleUpdate(req.body as Parameters<typeof bot.handleUpdate>[0]);
        } finally {
          clearInterval(leaseTimer);
        }

        const handlerError = takeWebhookHandlerError(req.body);
        if (handlerError !== undefined && !isTerminalTelegramFailure(handlerError)) {
          await markWebhookUpdatePending(database, updateId);
          logger.error(
            "Webhook update failed; Telegram will retry it.",
            getErrorMessage(handlerError),
          );
          res.sendStatus(503);
          return;
        }
        if (handlerError !== undefined) {
          const userId = getErrorFromUserId(handlerError);
          if (userId !== undefined) await markUserBlocked(database, userId);
        }
        const processed = await markWebhookUpdateProcessed(database, updateId);
        if (processed.modifiedCount !== 1) {
          throw new Error("Webhook update completion was not durably recorded.");
        }
        res.sendStatus(200);
      } catch (error) {
        const handlerError = takeWebhookHandlerError(req.body) ?? error;
        if (isTerminalTelegramFailure(handlerError)) {
          const userId = getErrorFromUserId(handlerError);
          if (userId !== undefined) await markUserBlocked(database, userId);
          await markWebhookUpdateProcessed(database, updateId);
          logger.warn("Acknowledging a webhook update after a terminal Telegram 403.");
          if (!res.headersSent) res.sendStatus(200);
          return;
        }

        await markWebhookUpdatePending(database, updateId).catch(() => undefined);
        logger.error(
          "Webhook update failed; Telegram will retry it.",
          getErrorMessage(handlerError),
        );
        if (!res.headersSent) res.sendStatus(503);
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

function getErrorFromUserId(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("ctx" in error)) return undefined;
  const context = (error as { ctx?: { from?: { id?: number } } }).ctx;
  return context?.from?.id;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "error" in error) {
    const nested = (error as { error: unknown }).error;
    return nested instanceof Error ? nested.message : "Telegram update processing error";
  }
  return "Unknown error";
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}
