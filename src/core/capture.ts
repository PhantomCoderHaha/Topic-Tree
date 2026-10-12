/** Pure URL classification for the browser recorder (no chrome.* here, so it's testable). */

const ENGINES: Array<{ engine: string; host: RegExp; path: RegExp; param: string }> = [
  { engine: "google", host: /(^|\.)google\.[a-z.]+$/, path: /^\/search/, param: "q" },
  { engine: "brave", host: /^search\.brave\.com$/, path: /^\/search/, param: "q" },
  { engine: "bing", host: /(^|\.)bing\.com$/, path: /^\/search/, param: "q" },
  { engine: "duckduckgo", host: /(^|\.)duckduckgo\.com$/, path: /^\/$/, param: "q" },
];

/** A web search results page -> its engine and query; anything else -> null. */
export function parseSearch(url: string): { engine: string; query: string } | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  for (const e of ENGINES) {
    if (e.host.test(u.hostname) && e.path.test(u.pathname)) {
      const query = u.searchParams.get(e.param)?.trim();
      if (query) return { engine: e.engine, query };
    }
  }
  return null;
}

/** Hostname without "www.", used to group consecutive pages of one site. */
export function siteOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

/** Only real web pages are part of a line of thought. */
export function isTrackable(url: string): boolean {
  return /^https?:\/\//.test(url);
}
