import { MongoClient } from "mongodb";
import { inferBackupDatabaseName, parseEncryptionKey, restoreEncryptedBackup } from "./backupService";
import { logger } from "./utils/logger";

async function main(): Promise<void> {
  const backupUri = process.env.BACKUP_MONGODB_URI?.trim();
  const targetUri = process.env.MONGODB_URI?.trim();
  const backupId = process.argv[2]?.trim();
  if (!backupUri || !targetUri || !backupId) {
    throw new Error("Set BACKUP_MONGODB_URI and MONGODB_URI, then pass a backup ID.");
  }

  const key = parseEncryptionKey(process.env.BACKUP_ENCRYPTION_KEY);
  const backupClient = new MongoClient(backupUri, { appName: "links-bot-backup-restore", maxPoolSize: 2 });
  const targetClient = new MongoClient(targetUri, { appName: "links-bot-backup-restore", maxPoolSize: 2 });
  try {
    await Promise.all([backupClient.connect(), targetClient.connect()]);
    const backupDb = backupClient.db(inferBackupDatabaseName(backupUri));
    const targetDbName = decodeURIComponent(new URL(targetUri).pathname.replace(/^\/+/, "")) || "links_bot";
    const inserted = await restoreEncryptedBackup(
      backupDb,
      targetClient.db(targetDbName),
      backupId,
      key,
    );
    logger.info(`Safe restore completed for backup=${backupId}; inserted=${JSON.stringify(inserted)}.`);
  } finally {
    await Promise.allSettled([backupClient.close(), targetClient.close()]);
  }
}

main().catch((error) => {
  logger.error("Safe restore failed.", error instanceof Error ? error.message : "Unknown error");
  process.exitCode = 1;
});
