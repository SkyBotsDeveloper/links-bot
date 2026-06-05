import crypto from "node:crypto";
import dotenv from "dotenv";

dotenv.config();

const DEFAULT_LINKS_PER_PAGE = 50;
const DEFAULT_PORT = 3000;

export interface AppConfig {
  botToken: string;
  mongodbUri: string;
  ownerIds: Set<number>;
  ownerIdsList: number[];
  publicUrl?: string;
  webhookSecret: string;
  linksPerPage: number;
  nodeEnv: string;
  isProduction: boolean;
  port: number;
}

export interface SeedConfig {
  mongodbUri: string;
  linksPerPage: number;
}

export function loadAppConfig(): AppConfig {
  const botToken = requiredEnv("BOT_TOKEN");
  const mongodbUri = requiredEnv("MONGODB_URI");
  const ownerIdsList = parseOwnerIds(requiredEnv("OWNER_IDS"));
  const nodeEnv = process.env.NODE_ENV?.trim() || "development";
  const isProduction = nodeEnv === "production";
  const publicUrl = normalizePublicUrl(process.env.PUBLIC_URL);

  if (isProduction && !publicUrl) {
    throw new Error("PUBLIC_URL is required in production webhook mode.");
  }

  const linksPerPage = parsePositiveInt(
    process.env.LINKS_PER_PAGE,
    "LINKS_PER_PAGE",
    DEFAULT_LINKS_PER_PAGE,
  );
  const port = parsePositiveInt(process.env.PORT, "PORT", DEFAULT_PORT);

  return {
    botToken,
    mongodbUri,
    ownerIds: new Set(ownerIdsList),
    ownerIdsList,
    publicUrl,
    webhookSecret: deriveWebhookSecret(botToken),
    linksPerPage,
    nodeEnv,
    isProduction,
    port,
  };
}

export function loadSeedConfig(): SeedConfig {
  return {
    mongodbUri: requiredEnv("MONGODB_URI"),
    linksPerPage: parsePositiveInt(
      process.env.LINKS_PER_PAGE,
      "LINKS_PER_PAGE",
      DEFAULT_LINKS_PER_PAGE,
    ),
  };
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function parseOwnerIds(raw: string): number[] {
  const ids = raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => Number(part));

  if (ids.length === 0 || ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw new Error("OWNER_IDS must contain comma-separated numeric Telegram user IDs.");
  }

  return ids;
}

function parsePositiveInt(raw: string | undefined, name: string, fallback: number): number {
  if (!raw?.trim()) {
    return fallback;
  }

  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return value;
}

function normalizePublicUrl(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  if (!value) {
    return undefined;
  }

  const parsed = new URL(value);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("PUBLIC_URL must start with http:// or https://.");
  }

  return value.replace(/\/+$/, "");
}

function deriveWebhookSecret(botToken: string): string {
  return crypto.createHash("sha256").update(botToken).digest("hex").slice(0, 48);
}
