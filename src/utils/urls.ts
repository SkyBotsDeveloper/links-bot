const HTTP_URL_RE = /https?:\/\/[^\s<>"'`]+/gi;
const TRAILING_PUNCTUATION_RE = /[),.;\]]+$/;

export interface ExtractedUrls {
  urls: string[];
  invalidLines: number;
}

export function cleanSingleUrl(input: string): string | undefined {
  const match = input.match(HTTP_URL_RE)?.[0];
  if (!match) {
    return undefined;
  }

  const cleaned = cleanUrlCandidate(match);
  return isValidHttpUrl(cleaned) ? cleaned : undefined;
}

export function extractUrlsFromText(text: string): ExtractedUrls {
  const urls: string[] = [];
  let invalidLines = 0;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = stripCommandPrefix(rawLine).trim();
    if (!line) {
      continue;
    }

    const matches = [...line.matchAll(HTTP_URL_RE)];
    let validOnLine = 0;

    for (const match of matches) {
      const cleaned = cleanUrlCandidate(match[0]);
      if (isValidHttpUrl(cleaned)) {
        urls.push(cleaned);
        validOnLine += 1;
      }
    }

    if (validOnLine === 0) {
      invalidLines += 1;
    }
  }

  return { urls, invalidLines };
}

export function stripCommandPrefix(text: string): string {
  return text.replace(/^\/[a-zA-Z0-9_]+(?:@[a-zA-Z0-9_]+)?\s*/u, "");
}

export function isValidHttpUrl(input: string): boolean {
  try {
    const parsed = new URL(input);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

function cleanUrlCandidate(input: string): string {
  return input.trim().replace(TRAILING_PUNCTUATION_RE, "");
}
