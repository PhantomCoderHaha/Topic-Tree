/**
 * The standard input event. Every source (Brave now, the Claude Code mod later)
 * emits exactly this shape; the tree is a pure function of a session's events,
 * so the log is the source of truth and the file on disk (one event per line).
 */
export type Source = "browser" | "claude";

interface Base {
  id: string;        // unique per event
  session: string;   // one tree per session
  seq: number;       // monotonically increasing per session (dedupes disk flushes)
  ts: number;        // epoch ms
  source: Source;
}

/** A query the person typed: a web search, or (later) a prompt to Claude. */
export interface SearchEvent extends Base {
  kind: "search";
  query: string;
  url?: string;
  engine?: string;   // google | brave | bing | claude
}

/** A page the person landed on (redirects never become events). */
export interface PageEvent extends Base {
  kind: "page";
  url: string;
  title: string;
  site: string;          // hostname without "www."
  fromSearch?: boolean;  // opened from a search results page: hangs under that search
}

/** Something the person did to the tree. */
export interface ActionEvent extends Base {
  kind: "action";
  action: Action;
}

export type Action =
  | { type: "tangent" }                                   // branch off temporarily from here
  | { type: "main" }                                      // return to the main branch
  | { type: "newMain" }                                   // topic shift: start a new main branch
  | { type: "goto"; branch: string }                      // jump to any branch (tangent or earlier main)
  | { type: "renameBranch"; branch: string; name: string }
  | { type: "renameNode"; node: string; name: string }
  | { type: "split"; node: string; page: number }         // pages[page..] become their own node
  | { type: "retro"; nodes: string[]; to: "tangent" | "newMain" }; // re-mark past nodes

export type TopicEvent = SearchEvent | PageEvent | ActionEvent;
