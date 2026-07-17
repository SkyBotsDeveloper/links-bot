const HTTP_URL_RE = /https?:\/\/[^\s<>"'`]+/gi;
const TRAILING_PUNCTUATION_RE = /[),.;\]]+$/;

export function cleanSingleUrl(input: string): string | undefined {
  const match = input.match(HTTP_URL_RE)?.[0];
  if (!match) {
    return undefined;
  }

  const cleaned = cleanUrlCandidate(match);
  return isValidHttpUrl(cleaned) ? cleaned : undefined;
}

export function extractLinkLinesFromText(text: string): string[] {
  const lines: string[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = stripCommandPrefix(rawLine).trim();
    if (line) {
      lines.push(line);
    }
  }

  return lines;
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
