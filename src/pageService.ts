import type { DatabaseHandle } from "./db";
import { formatLinksPage, type RenderedMessage } from "./format";
import { getActiveLinkCount, getActiveLinksPage } from "./linkService";

export interface PageStats {
  totalActiveLinks: number;
  linksPerPage: number;
  completedPages: number;
  hasPendingNextPage: boolean;
  visibleButtonPages: number;
  pendingLinks: number;
  lockedPendingPage?: number;
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
  const completedPages = Math.floor(totalActiveLinks / linksPerPage);
  const pendingLinks = totalActiveLinks % linksPerPage;
  const hasPendingNextPage = pendingLinks > 0;
  const visibleButtonPages = completedPages + (hasPendingNextPage ? 1 : 0);

  return {
    totalActiveLinks,
    linksPerPage,
    completedPages,
    hasPendingNextPage,
    visibleButtonPages,
    pendingLinks,
    lockedPendingPage: hasPendingNextPage ? completedPages + 1 : undefined,
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
  if (stats.completedPages < 1) {
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
  if (page > stats.completedPages) {
    return undefined;
  }

  const cached = pageCache.get(page);
  if (cached) {
    return { rendered: cached, stats };
  }

  const links = await getActiveLinksPage(database, page, linksPerPage);
  if (links.length !== linksPerPage) {
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
