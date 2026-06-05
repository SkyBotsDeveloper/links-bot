import type { AppConfig } from "./config";
import type { DatabaseHandle, SudoUserDocument } from "./db";
import {
  ADMIN_ONLY_MESSAGE,
  OWNER_ONLY_MESSAGE,
  SUDO_USERNAME_NOT_FOUND_MESSAGE,
} from "./format";
import type { BotContext } from "./bot";

export interface SudoTarget {
  userId: number;
  username?: string;
  firstName?: string;
  lastName?: string;
}

export type SudoResolveResult =
  | { ok: true; target: SudoTarget }
  | { ok: false; reason: "invalid" | "username_not_found" };

let sudoIdCache: Set<number> | undefined;
let sudoIdCachePromise: Promise<Set<number>> | undefined;

export function isOwner(config: AppConfig, userId: number): boolean {
  return config.ownerIds.has(userId);
}

export async function isSudo(database: DatabaseHandle, userId: number): Promise<boolean> {
  return (await getActiveSudoIds(database)).has(userId);
}

export async function isAdmin(
  config: AppConfig,
  database: DatabaseHandle,
  userId: number,
): Promise<boolean> {
  return isOwner(config, userId) || (await isSudo(database, userId));
}

export async function requireOwner(ctx: BotContext): Promise<number | undefined> {
  const userId = ctx.from?.id;
  if (!userId || !isOwner(ctx.appConfig, userId)) {
    await ctx.reply(OWNER_ONLY_MESSAGE);
    return undefined;
  }

  return userId;
}

export async function requireAdmin(ctx: BotContext): Promise<number | undefined> {
  const userId = ctx.from?.id;
  if (!userId || !(await isAdmin(ctx.appConfig, ctx.db, userId))) {
    await ctx.reply(ADMIN_ONLY_MESSAGE);
    return undefined;
  }

  return userId;
}

export function invalidateSudoCache(): void {
  sudoIdCache = undefined;
  sudoIdCachePromise = undefined;
}

export async function resolveSudoTarget(
  database: DatabaseHandle,
  input: string,
): Promise<SudoResolveResult> {
  const trimmed = input.trim();
  if (!trimmed) {
    return { ok: false, reason: "invalid" };
  }

  if (/^\d+$/u.test(trimmed)) {
    const userId = Number(trimmed);
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      return { ok: false, reason: "invalid" };
    }

    const tracked = await database.users.findOne(
      { _id: userId },
      { projection: { username: 1, firstName: 1, lastName: 1 } },
    );
    return {
      ok: true,
      target: {
        userId,
        username: tracked?.username,
        firstName: tracked?.firstName,
        lastName: tracked?.lastName,
      },
    };
  }

  if (!trimmed.startsWith("@")) {
    return { ok: false, reason: "invalid" };
  }

  const username = trimmed.slice(1).trim();
  if (!/^[a-zA-Z0-9_]{5,32}$/u.test(username)) {
    return { ok: false, reason: "invalid" };
  }

  const regex = new RegExp(`^${escapeRegExp(username)}$`, "i");
  const [tracked, sudo] = await Promise.all([
    database.users.findOne(
      { username: regex },
      { projection: { _id: 1, username: 1, firstName: 1, lastName: 1 } },
    ),
    database.sudoUsers.findOne(
      { username: regex, isActive: true },
      { projection: { _id: 1, username: 1, firstName: 1, lastName: 1 } },
    ),
  ]);
  const match = tracked ?? sudo;
  if (!match) {
    return { ok: false, reason: "username_not_found" };
  }

  return {
    ok: true,
    target: {
      userId: match._id,
      username: match.username,
      firstName: match.firstName,
      lastName: match.lastName,
    },
  };
}

export async function addSudoUser(
  database: DatabaseHandle,
  target: SudoTarget,
  addedBy: number,
): Promise<"added" | "already_active"> {
  const existing = await database.sudoUsers.findOne(
    { _id: target.userId, isActive: true },
    { projection: { _id: 1 } },
  );
  if (existing) {
    return "already_active";
  }

  const now = new Date();
  await database.sudoUsers.updateOne(
    { _id: target.userId },
    {
      $set: {
        username: target.username,
        firstName: target.firstName,
        lastName: target.lastName,
        addedBy,
        addedAt: now,
        isActive: true,
      },
      $unset: {
        removedBy: "",
        removedAt: "",
      },
    },
    { upsert: true },
  );
  invalidateSudoCache();
  return "added";
}

export async function removeSudoUser(
  database: DatabaseHandle,
  target: SudoTarget,
  removedBy: number,
): Promise<boolean> {
  const result = await database.sudoUsers.updateOne(
    { _id: target.userId, isActive: true },
    {
      $set: {
        isActive: false,
        removedBy,
        removedAt: new Date(),
      },
    },
  );
  if (result.modifiedCount === 0) {
    return false;
  }

  invalidateSudoCache();
  return true;
}

export async function listActiveSudoUsers(
  database: DatabaseHandle,
): Promise<SudoUserDocument[]> {
  return database.sudoUsers
    .find({ isActive: true }, { sort: { addedAt: 1 } })
    .toArray();
}

export function formatSudoResolveError(result: Extract<SudoResolveResult, { ok: false }>): string {
  if (result.reason === "username_not_found") {
    return SUDO_USERNAME_NOT_FOUND_MESSAGE;
  }

  return [
    "⚠️ Galat format.",
    "Example: /addsudo 123456789",
    "Ya: /addsudo @username",
  ].join("\n");
}

async function getActiveSudoIds(database: DatabaseHandle): Promise<Set<number>> {
  if (sudoIdCache) {
    return sudoIdCache;
  }

  sudoIdCachePromise ??= database.sudoUsers
    .find({ isActive: true }, { projection: { _id: 1 } })
    .toArray()
    .then((docs) => new Set(docs.map((doc) => doc._id)));

  sudoIdCache = await sudoIdCachePromise;
  sudoIdCachePromise = undefined;
  return sudoIdCache;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
