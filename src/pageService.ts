import type { DatabaseHandle } from "./db";
import { formatLinksPage, type RenderedMessage } from "./format";
import { getActiveLinkCount, getActiveLinksPage } from "./linkService";

export interface PageStats {
  totalActiveLinks: number;
  linksPerPage: number;
  totalPages: number;
  linksOnLastPage: number;
}

export interface PublicPageResult {
  rendered: RenderedMessage;
  stats: PageStats;
}

export interface StartPageResult {
  preparing: boolean;
  rendered?: RenderedMessage;
  stats: PageStats;
}

export interface OwnerPreviewResult {
  rendered: RenderedMessage;
  stats: PageStats;
  linkCount: number;
}

const pageCache = new Map<number, RenderedMessage>();

export function calculatePageStats(totalActiveLinks: number, linksPerPage: number): PageStats {
  const totalPages = Math.ceil(totalActiveLinks / linksPerPage);
  const remainder = totalActiveLinks % linksPerPage;
  const linksOnLastPage =
    totalActiveLinks === 0 ? 0 : remainder === 0 ? linksPerPage : remainder;

  return {
    totalActiveLinks,
    linksPerPage,
    totalPages,
    linksOnLastPage,
  };
}

export async function getPageStats(
  database: DatabaseHandle,
  linksPerPage: number,
): Promise<PageStats> {
  return calculatePageStats(await getActiveLinkCount(database), linksPerPage);
}

export async function getStartPage(
  database: DatabaseHandle,
  linksPerPage: number,
): Promise<StartPageResult> {
  const stats = await getPageStats(database, linksPerPage);
  if (stats.totalPages < 1) {
    return { preparing: true, stats };
  }

  const publicPage = await getPublicPage(database, 1, linksPerPage, stats);
  if (!publicPage) {
    return { preparing: true, stats };
  }

  return { preparing: false, rendered: publicPage.rendered, stats };
}

export async function getPublicPage(
  database: DatabaseHandle,
  page: number,
  linksPerPage: number,
  knownStats?: PageStats,
): Promise<PublicPageResult | undefined> {
  if (!Number.isInteger(page) || page < 1) {
    return undefined;
  }

  const stats = knownStats ?? (await getPageStats(database, linksPerPage));
  if (page > stats.totalPages) {
    return undefined;
  }

  const cached = pageCache.get(page);
  if (cached) {
    return { rendered: cached, stats };
  }

  const links = await getActiveLinksPage(database, page, linksPerPage);
  if (links.length === 0) {
    return undefined;
  }

  const rendered = formatLinksPage(links);
  pageCache.set(page, rendered);
  return { rendered, stats };
}

export async function getOwnerPreview(
  database: DatabaseHandle,
  page: number,
  linksPerPage: number,
): Promise<OwnerPreviewResult | undefined> {
  if (!Number.isInteger(page) || page < 1) {
    return undefined;
  }

  const [stats, links] = await Promise.all([
    getPageStats(database, linksPerPage),
    getActiveLinksPage(database, page, linksPerPage),
  ]);

  if (links.length === 0) {
    return undefined;
  }

  return {
    rendered: formatLinksPage(links, { ownerPreviewIncomplete: links.length < linksPerPage }),
    stats,
    linkCount: links.length,
  };
}

export function clearPageCache(): void {
  pageCache.clear();
}

export function getPageCacheSize(): number {
  return pageCache.size;
}
