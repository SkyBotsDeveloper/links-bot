import type { UpdateResult } from "mongodb";
import type { DatabaseHandle, WebhookUpdateDocument } from "./db";

const WEBHOOK_LEASE_MS = 5 * 60_000;
const PROCESSED_RETENTION_MS = 30 * 24 * 60 * 60_000;

export type WebhookClaimResult = "claimed" | "processed" | "busy";

export async function claimWebhookUpdate(
  database: DatabaseHandle,
  updateId: number,
  update: unknown,
  now = new Date(),
): Promise<WebhookClaimResult> {
  try {
    await database.webhookUpdates.insertOne({
      _id: updateId,
      status: "processing",
      update,
      receivedAt: now,
      leaseUntil: new Date(now.getTime() + WEBHOOK_LEASE_MS),
      attempts: 1,
    });
    return "claimed";
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
  }

  const existing = await database.webhookUpdates.findOne({ _id: updateId });
  if (existing?.status === "processed") return "processed";

  const claim = await database.webhookUpdates.updateOne(
    {
      _id: updateId,
      status: { $ne: "processed" },
      $or: [
        { status: "pending" },
        { status: "processing", leaseUntil: { $lte: now } },
      ],
    },
    {
      $set: {
        status: "processing",
        update,
        leaseUntil: new Date(now.getTime() + WEBHOOK_LEASE_MS),
      },
      $inc: { attempts: 1 },
    },
  );
  return claim.modifiedCount === 1 ? "claimed" : "busy";
}

export async function markWebhookUpdateProcessed(
  database: DatabaseHandle,
  updateId: number,
  now = new Date(),
): Promise<UpdateResult<WebhookUpdateDocument>> {
  return database.webhookUpdates.updateOne(
    { _id: updateId, status: "processing" },
    {
      $set: {
        status: "processed",
        processedAt: now,
        expireAt: new Date(now.getTime() + PROCESSED_RETENTION_MS),
      },
      $unset: { update: "", leaseUntil: "" },
    },
  );
}

export async function markWebhookUpdatePending(
  database: DatabaseHandle,
  updateId: number,
): Promise<UpdateResult<WebhookUpdateDocument>> {
  return database.webhookUpdates.updateOne(
    { _id: updateId, status: "processing" },
    {
      $set: { status: "pending" },
      $unset: { leaseUntil: "" },
    },
  );
}

export async function refreshWebhookUpdateLease(
  database: DatabaseHandle,
  updateId: number,
  now = new Date(),
): Promise<UpdateResult<WebhookUpdateDocument>> {
  return database.webhookUpdates.updateOne(
    { _id: updateId, status: "processing" },
    { $set: { leaseUntil: new Date(now.getTime() + WEBHOOK_LEASE_MS) } },
  );
}

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === 11000;
}
