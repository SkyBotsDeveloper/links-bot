import type { DatabaseHandle, UserDocument } from "./db";

export interface TelegramUserInfo {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface UserCounts {
  totalTracked: number;
  activeBroadcastUsers: number;
  blockedUsers: number;
}

export async function trackUserInteraction(
  database: DatabaseHandle,
  user: TelegramUserInfo,
  options: { isStart: boolean },
): Promise<void> {
  const now = new Date();
  await database.users.updateOne(
    { _id: user.id },
    {
      $setOnInsert: {
        _id: user.id,
        firstSeenAt: now,
      },
      $set: {
        firstName: user.first_name,
        lastName: user.last_name,
        username: user.username,
        languageCode: user.language_code,
        isBot: user.is_bot,
        lastSeenAt: now,
        isBlocked: false,
      },
      $unset: {
        blockedAt: "",
      },
      $inc: {
        messageCount: 1,
        startCount: options.isStart ? 1 : 0,
      },
    },
    { upsert: true },
  );
}

export async function getUserCounts(database: DatabaseHandle): Promise<UserCounts> {
  const [totalTracked, activeBroadcastUsers, blockedUsers] = await Promise.all([
    database.users.countDocuments({}),
    database.users.countDocuments({ isBlocked: false, isBot: false }),
    database.users.countDocuments({ isBlocked: true }),
  ]);

  return { totalTracked, activeBroadcastUsers, blockedUsers };
}

export async function getBroadcastTargetCount(database: DatabaseHandle): Promise<number> {
  return database.users.countDocuments({ isBlocked: false, isBot: false });
}

export function getBroadcastTargetCursor(database: DatabaseHandle) {
  return database.users.find(
    { isBlocked: false, isBot: false },
    {
      projection: { _id: 1 },
      sort: { lastSeenAt: -1 },
    },
  );
}

export async function markUserBroadcasted(
  database: DatabaseHandle,
  userId: number,
  at = new Date(),
): Promise<void> {
  await database.users.updateOne(
    { _id: userId },
    {
      $set: {
        lastBroadcastAt: at,
        isBlocked: false,
      },
      $unset: {
        blockedAt: "",
      },
    },
  );
}

export async function markUserBlocked(
  database: DatabaseHandle,
  userId: number,
  at = new Date(),
): Promise<void> {
  await database.users.updateOne(
    { _id: userId },
    {
      $set: {
        isBlocked: true,
        blockedAt: at,
      },
    },
  );
}

export type BroadcastTarget = Pick<UserDocument, "_id">;
