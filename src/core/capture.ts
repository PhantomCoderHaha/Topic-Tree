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

// --- pass-through pages (sign-in hops, "Redirecting…") ------------------------------
const AUTH_HOST = /(^|\.)(login\.microsoftonline\.com|login\.live\.com|login\.windows\.net|mcas\.ms|accounts\.google\.com|appleid\.apple\.com|okta\.com|oktapreview\.com|auth0\.com|onelogin\.com|duosecurity\.com|pingone\.com|shibboleth\.[a-z.]+)$|^(login|sso|auth|signin|idp|adfs|cas)\./;
const AUTH_PATH = /\/(saml2?|oauth2?|sso|login|signin|sign-in|authorize|aad_login)(\/|$|\?)/i;
const AUTH_TITLE = /^(sign[ -]?in|log[ -]?in|signing in|welcome|verify|two-step|confirm (your )?identity)\b/i;
const BOUNCE_TITLE = /^(redirecting|continue|loading|please wait|working|one moment|just a moment)\b/i;

/** Sign-in steps can take a while (typing a password, a passkey); a bounce page can't. */
export const HOP_WINDOW = { auth: 120_000, bounce: 10_000 };

/** How a page looks as a pass-through step: a sign-in step, a bounce, or neither. */
export function hopKind(url: string, title: string): "auth" | "bounce" | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (AUTH_HOST.test(u.hostname) || AUTH_PATH.test(u.pathname) || AUTH_TITLE.test(title.trim())) return "auth";
  if (BOUNCE_TITLE.test(title.trim())) return "bounce";
  return null;
}

/** Was this page only passed through on the way to the next one, `dwell` ms later? */
export function isHop(url: string, title: string, dwell: number): boolean {
  const k = hopKind(url, title);
  return !!k && dwell <= HOP_WINDOW[k];
}

// --- secrets never reach the log ----------------------------------------------------
const SECRET_PARAM = /^(code|state|nonce|token|access_token|id_token|refresh_token|session_state|samlrequest|samlresponse|relaystate|signature|sigalg|sig|ticket|otp|password|passwd|pwd|secret|client_secret|api_?key|key|auth|authorization|assertion|wresult|wctx|x-amz-[a-z-]+|jwt|__cf_chl_[a-z_]+)$/i;

/**
 * The URL as it may be stored: sign-in pages keep only origin + path (their query is
 * all request blobs and one-time codes), every other page loses secret-looking params
 * (OAuth `code`, tokens, SAML blobs, signatures) and any fragment carrying a token.
 */
export function cleanUrl(url: string): string {
  let u: URL;
  try { u = new URL(url); } catch { return url; }
  if (u.username || u.password) { u.username = ""; u.password = ""; }
  if (hopKind(url, "") === "auth") return u.origin + u.pathname;
  for (const k of [...u.searchParams.keys()]) if (SECRET_PARAM.test(k)) u.searchParams.delete(k);
  if (/(^|[#&])(access_token|id_token|code|token)=/i.test(u.hash)) u.hash = "";
  return u.toString();
}
