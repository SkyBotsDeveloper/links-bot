import type { ObjectId } from "mongodb";
import type { DatabaseHandle, LinkDocument } from "./db";

export interface LinkCounts {
  active: number;
  removed: number;
}

export interface RemovedLink {
  url: string;
}

export interface RemovedPage {
  removedCount: number;
  urls: string[];
}

let addQueue: Promise<void> = Promise.resolve();

export async function getLinkCounts(database: DatabaseHandle): Promise<LinkCounts> {
  const [active, removed] = await Promise.all([
    database.links.countDocuments({ isActive: true }),
    database.links.countDocuments({ isActive: false }),
  ]);

  return { active, removed };
}

export async function getActiveLinkCount(database: DatabaseHandle): Promise<number> {
  return database.links.countDocuments({ isActive: true });
}

export async function getActiveLinksPage(
  database: DatabaseHandle,
  page: number,
  linksPerPage: number,
): Promise<string[]> {
  const skip = (page - 1) * linksPerPage;
  const docs = await database.links
    .find(
      { isActive: true },
      {
        projection: { url: 1 },
        sort: { sortOrder: 1 },
        skip,
        limit: linksPerPage,
      },
    )
    .toArray();

  return docs.map((doc) => doc.url);
}

export async function addLink(
  database: DatabaseHandle,
  url: string,
  createdBy: number,
): Promise<number> {
  return addLinks(database, [url], createdBy);
}

export async function addLinks(
  database: DatabaseHandle,
  urls: string[],
  createdBy: number,
): Promise<number> {
  if (urls.length === 0) {
    return 0;
  }

  return withAddQueue(async () => {
    const firstSortOrder = await getNextSortOrder(database);
    const createdAt = new Date();
    const docs: LinkDocument[] = urls.map((url, index) => ({
      url,
      isActive: true,
      sortOrder: firstSortOrder + index,
      createdAt,
      createdBy,
    }));

    const result = await database.links.insertMany(docs, { ordered: true });
    return result.insertedCount;
  });
}

export async function removeLinkByPageNumber(
  database: DatabaseHandle,
  page: number,
  number: number,
  linksPerPage: number,
  removedBy: number,
): Promise<RemovedLink | undefined> {
  const skip = (page - 1) * linksPerPage + (number - 1);
  const target = await findActiveLinkAt(database, skip);
  if (!target?._id) {
    return undefined;
  }

  const now = new Date();
  const result = await database.links.updateOne(
    { _id: target._id, isActive: true },
    { $set: { isActive: false, removedAt: now, removedBy } },
  );

  return result.modifiedCount === 1 ? { url: target.url } : undefined;
}

export async function removePage(
  database: DatabaseHandle,
  page: number,
  linksPerPage: number,
  removedBy: number,
): Promise<RemovedPage> {
  const skip = (page - 1) * linksPerPage;
  const docs = await database.links
    .find(
      { isActive: true },
      {
        projection: { _id: 1, url: 1 },
        sort: { sortOrder: 1 },
        skip,
        limit: linksPerPage,
      },
    )
    .toArray();

  const ids = docs.map((doc) => doc._id).filter((id): id is ObjectId => Boolean(id));
  if (ids.length === 0) {
    return { removedCount: 0, urls: [] };
  }

  const now = new Date();
  const result = await database.links.updateMany(
    { _id: { $in: ids }, isActive: true },
    { $set: { isActive: false, removedAt: now, removedBy } },
  );

  return {
    removedCount: result.modifiedCount,
    urls: docs.map((doc) => doc.url),
  };
}

async function findActiveLinkAt(database: DatabaseHandle, skip: number): Promise<LinkDocument | null> {
  if (skip < 0) {
    return null;
  }

  return database.links.findOne(
    { isActive: true },
    {
      projection: { url: 1 },
      sort: { sortOrder: 1 },
      skip,
    },
  );
}

async function getNextSortOrder(database: DatabaseHandle): Promise<number> {
  const lastLink = await database.links.findOne(
    {},
    {
      projection: { sortOrder: 1 },
      sort: { sortOrder: -1 },
    },
  );

  return (lastLink?.sortOrder ?? 0) + 1;
}

async function withAddQueue<T>(operation: () => Promise<T>): Promise<T> {
  const previous = addQueue;
  let release: () => void = () => undefined;
  addQueue = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}
