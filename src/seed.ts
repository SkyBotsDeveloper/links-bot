import { loadSeedConfig } from "./config";
import { closeDatabase, connectDatabase, ensureIndexes, type LinkDocument } from "./db";
import { logger } from "./utils/logger";

const SEED_LINKS = [
  "https://www.diskwala.com/app/6a22c9b469eabf87205116e0",
  "https://www.diskwala.com/app/6a22c9b469eabf87205116e2",
  "https://www.diskwala.com/app/6a22c9b469eabf87205116dc",
  "https://www.diskwala.com/app/6a22c9b469eabf87205116da",
  "https://www.diskwala.com/app/6a22c9b469eabf87205116d6",
  "https://www.diskwala.com/app/6a22c9b469eabf87205116ca",
  "https://www.diskwala.com/app/6a22c9b469eabf87205116de",
  "https://www.diskwala.com/app/6a22c9b469eabf87205116d0",
  "https://www.diskwala.com/app/6a22c9b469eabf87205116ce",
  "https://www.diskwala.com/app/6a22c9b469eabf87205116d8",
  "https://www.diskwala.com/app/6a22c9b469eabf87205116d4",
  "https://www.diskwala.com/app/6a22c9b469eabf87205116c8",
  "https://www.diskwala.com/app/6a22c9b469eabf87205116cc",
  "https://www.diskwala.com/app/6a22c9b469eabf87205116d2",
  "https://www.diskwala.com/app/6a22ca1a69eabf87205117fd",
  "https://www.diskwala.com/app/6a22ca1a69eabf8720511808",
  "https://www.diskwala.com/app/6a22ca1a69eabf872051180c",
  "https://www.diskwala.com/app/6a22ca1a69eabf87205117f3",
  "https://www.diskwala.com/app/6a22ca1a69eabf872051180a",
  "https://www.diskwala.com/app/6a22ca1a69eabf87205117f9",
  "https://www.diskwala.com/app/6a22ca1a69eabf87205117f7",
  "https://www.diskwala.com/app/6a22ca1a69eabf87205117fb",
  "https://www.diskwala.com/app/6a22ca1a69eabf872051180e",
  "https://www.diskwala.com/app/6a22ca1a69eabf87205117f1",
  "https://www.diskwala.com/app/6a22ca1a69eabf8720511806",
  "https://www.diskwala.com/app/6a22ca1a69eabf8720511802",
  "https://www.diskwala.com/app/6a22ca1a69eabf8720511804",
  "https://www.diskwala.com/app/6a22ca1a69eabf87205117ff",
  "https://www.diskwala.com/app/6a22ca1a69eabf87205117f5",
  "https://www.diskwala.com/app/6a22ca7c69eabf87205119c2",
  "https://www.diskwala.com/app/6a22ca7c69eabf87205119cd",
  "https://www.diskwala.com/app/6a22ca7c69eabf87205119c7",
  "https://www.diskwala.com/app/6a22ca7c69eabf87205119b4",
  "https://www.diskwala.com/app/6a22ca7c69eabf87205119b2",
  "https://www.diskwala.com/app/6a22ca7c69eabf87205119c0",
  "https://www.diskwala.com/app/6a22ca7c69eabf87205119b6",
  "https://www.diskwala.com/app/6a22ca7c69eabf87205119ba",
  "https://www.diskwala.com/app/6a22ca7c69eabf87205119c5",
  "https://www.diskwala.com/app/6a22ca7c69eabf87205119cb",
  "https://www.diskwala.com/app/6a22ca7c69eabf87205119be",
  "https://www.diskwala.com/app/6a22ca7c69eabf87205119c9",
  "https://www.diskwala.com/app/6a22ca7c69eabf87205119bc",
  "https://www.diskwala.com/app/6a22ca7c69eabf87205119b8",
  "https://www.diskwala.com/app/6a22ca7c69eabf87205119b0",
  "https://www.diskwala.com/app/6a22cab269eabf8720511c04",
  "https://www.diskwala.com/app/6a22cab269eabf8720511c0c",
  "https://www.diskwala.com/app/6a22cab269eabf8720511c06",
  "https://www.diskwala.com/app/6a22cab269eabf8720511c0a",
  "https://www.diskwala.com/app/6a22cab269eabf8720511c02",
  "https://www.diskwala.com/app/6a22cab269eabf8720511c08",
];

async function seed(): Promise<void> {
  const config = loadSeedConfig();
  const database = await connectDatabase(config.mongodbUri);
  await ensureIndexes(database);

  const existing = await database.links.countDocuments({});
  if (existing > 0) {
    logger.info(`Seed skipped. links collection already contains ${existing} document(s).`);
    return;
  }

  const now = new Date();
  const docs: LinkDocument[] = SEED_LINKS.map((url, index) => ({
    url,
    isActive: true,
    sortOrder: index + 1,
    createdAt: now,
    createdBy: 0,
  }));

  await database.links.insertMany(docs, { ordered: true });
  logger.info(`Seeded ${docs.length} links. Links per page: ${config.linksPerPage}.`);
}

seed()
  .catch((error) => {
    logger.error("Seed failed.", error);
    process.exitCode = 1;
  })
  .finally(() => {
    void closeDatabase();
  });
