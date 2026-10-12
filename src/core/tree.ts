/**
 * Event log -> tree. Pure: the same events always give the same tree, so undo,
 * resume and re-marking are just "replay the log".
 *
 * Model: branches are ordered node lists. A main branch is a topic; a tangent forks
 * off a node of its parent branch and is expected to return. New nodes always go on
 * the current branch.
 */
import type { Action, PageEvent, SearchEvent, TopicEvent } from "./events";

export interface PageVisit { url: string; title: string; ts: number }

export interface TreeNode {
  id: string;
  kind: "search" | "page";
  title: string;            // query for a search, page title for a page
  name?: string;            // the person's own label
  url?: string;
  site?: string;
  pages: PageVisit[];       // a page node keeps every consecutive page on its site
  parent?: string;          // the search a page was opened from
  branch: string;
  ts: number;
}

export interface Branch {
  id: string;
  kind: "main" | "tangent";
  name?: string;
  parentBranch?: string;    // tangents only
  forkNode?: string;        // the node a tangent forked from (undefined: forked before any node)
  nodes: string[];
  returned: boolean;        // a tangent the person came back from
  createdTs: number;
  born: number;             // seq of the event that created it: stable order for colours
}

export interface Tree {
  session: string;
  branches: Record<string, Branch>;
  nodes: Record<string, TreeNode>;
  mains: string[];          // main branches in order (topic shifts)
  current: string;
  history: string[];        // branches left behind, most recent last (jump-back)
  lastNode?: string;        // last captured node, for same-site grouping
  seq: number;              // highest event seq applied
}

// ids derive from the event that created them, so a replay always gives the same ids
let eventId = "";
let sub = 0;
const newId = (prefix: string, _ts?: number) => `${prefix}${eventId}${sub++ ? `.${sub - 1}` : ""}`;

export function emptyTree(session: string, ts = 0): Tree {
  const id = `b-main-0`;
  return {
    session,
    branches: { [id]: { id, kind: "main", nodes: [], returned: false, createdTs: ts, born: 0 } },
    nodes: {},
    mains: [id],
    current: id,
    history: [],
    seq: 0,
  };
}

export function replay(session: string, events: TopicEvent[]): Tree {
  const sorted = [...events].sort((a, b) => a.seq - b.seq);
  return sorted.reduce(apply, emptyTree(session, sorted[0]?.ts ?? 0));
}

/** Applies one event; returns a new tree (inputs are not mutated). */
export function apply(tree: Tree, e: TopicEvent): Tree {
  if (e.seq <= tree.seq) return tree; // already applied (duplicate flush); seq starts at 1
  const t = structuredClone(tree);
  t.seq = e.seq;
  eventId = e.id;
  sub = 0;
  if (e.kind === "search") addSearch(t, e);
  else if (e.kind === "page") addPage(t, e);
  else act(t, e.action, e.ts);
  return t;
}

// --- capture ------------------------------------------------------------------------
function push(t: Tree, node: TreeNode) {
  t.nodes[node.id] = node;
  t.branches[t.current].nodes.push(node.id);
  t.lastNode = node.id;
}

function addSearch(t: Tree, e: SearchEvent) {
  push(t, { id: newId("n", e.ts), kind: "search", title: e.query, url: e.url,
            pages: [], branch: t.current, ts: e.ts });
}

function addPage(t: Tree, e: PageEvent) {
  const visit = { url: e.url, title: e.title, ts: e.ts };
  const last = t.lastNode ? t.nodes[t.lastNode] : undefined;
  if (e.redirect && last?.kind === "page") {
    // the page we just recorded only bounced here: rewrite it instead of adding a visit
    Object.assign(last.pages[last.pages.length - 1], visit);
    if (last.pages.length === 1) Object.assign(last, { title: e.title, url: e.url, site: e.site });
    return;
  }
  // consecutive pages on one site stay one node (until the person splits them)
  if (last && last.kind === "page" && last.site === e.site && last.branch === t.current && !e.fromSearch) {
    last.pages.push(visit);
    return;
  }
  const branch = t.branches[t.current];
  const parent = e.fromSearch
    ? [...branch.nodes].reverse().find(id => t.nodes[id].kind === "search")
    : undefined;
  push(t, { id: newId("n", e.ts), kind: "page", title: e.title, url: e.url, site: e.site,
            pages: [visit], parent, branch: t.current, ts: e.ts });
}

// --- actions ------------------------------------------------------------------------
function goTo(t: Tree, branch: string) {
  if (branch === t.current || !t.branches[branch]) return;
  t.history = [...t.history.filter(b => b !== t.current), t.current];
  t.current = branch;
  t.lastNode = undefined; // a jump never merges the next page into an old node
}

export function mainOf(t: Tree, branch: string): string {
  let b = t.branches[branch];
  while (b.kind === "tangent" && b.parentBranch) b = t.branches[b.parentBranch];
  return b.id;
}

function newBranch(t: Tree, kind: Branch["kind"], ts: number, from?: string): Branch {
  const parent = from ? t.branches[from] : undefined;
  const b: Branch = {
    id: newId(kind === "main" ? "b-main-" : "b-tan-", ts), kind, nodes: [], returned: false, createdTs: ts, born: t.seq,
    ...(parent && { parentBranch: parent.id, forkNode: parent.nodes.at(-1) }),
  };
  t.branches[b.id] = b;
  if (kind === "main") t.mains.push(b.id);
  return b;
}

function act(t: Tree, a: Action, ts: number) {
  switch (a.type) {
    case "tangent":
      goTo(t, newBranch(t, "tangent", ts, t.current).id);
      break;
    case "main": {
      const main = mainOf(t, t.current);
      // every tangent on the way back up counts as returned
      for (let b = t.branches[t.current]; b.kind === "tangent" && b.parentBranch; b = t.branches[b.parentBranch])
        b.returned = true;
      goTo(t, main);
      break;
    }
    case "up": {
      const b = t.branches[t.current];
      if (b.kind !== "tangent" || !b.parentBranch) break; // already on a main branch
      b.returned = true;
      goTo(t, b.parentBranch);
      break;
    }
    case "newMain":
      goTo(t, newBranch(t, "main", ts).id);
      break;
    case "goto":
      goTo(t, a.branch);
      break;
    case "renameBranch":
      if (t.branches[a.branch]) t.branches[a.branch].name = a.name;
      break;
    case "renameNode":
      if (t.nodes[a.node]) t.nodes[a.node].name = a.name;
      break;
    case "split":
      split(t, a.node, a.page);
      break;
    case "retro":
      retro(t, a.nodes, a.to, ts);
      break;
  }
}

function split(t: Tree, nodeId: string, page: number) {
  const node = t.nodes[nodeId];
  if (!node || node.kind !== "page" || page < 1 || page >= node.pages.length) return;
  const moved = node.pages.splice(page);
  const first = moved[0];
  const fresh: TreeNode = { id: newId("n", first.ts), kind: "page", title: first.title, url: first.url,
                            site: node.site, pages: moved, branch: node.branch, ts: first.ts };
  t.nodes[fresh.id] = fresh;
  const list = t.branches[node.branch].nodes;
  list.splice(list.indexOf(nodeId) + 1, 0, fresh.id);
  if (t.lastNode === nodeId) t.lastNode = fresh.id;
}

/** Re-mark a contiguous run of one branch's nodes as a tangent (it forked off the
 *  node before the run) or as a new main branch (a topic shift). */
function retro(t: Tree, ids: string[], to: "tangent" | "newMain" | "main", ts: number) {
  if (!ids.length || !t.nodes[ids[0]]) return;
  const from = t.branches[t.nodes[ids[0]].branch];
  const idx = ids.map(id => from.nodes.indexOf(id)).sort((x, y) => x - y);
  const contiguous = idx[0] >= 0 && idx.every((v, i) => v === idx[0] + i);
  if (!contiguous) return;
  if (to === "main") return backToMain(t, from.id, from.nodes.slice(idx[0], idx[0] + ids.length));
  const run = from.nodes.slice(idx[0], idx[0] + ids.length);
  const isTail = idx[0] + ids.length === from.nodes.length;

  const b: Branch = to === "tangent"
    ? { id: newId("b-tan-", ts), kind: "tangent", parentBranch: from.id,
        forkNode: from.nodes[idx[0] - 1], nodes: run, returned: !isTail, createdTs: t.nodes[run[0]].ts, born: t.seq }
    : { id: newId("b-main-", ts), kind: "main", nodes: run, returned: false, createdTs: t.nodes[run[0]].ts, born: t.seq };
  t.branches[b.id] = b;
  if (to === "newMain") t.mains.splice(t.mains.indexOf(mainOf(t, from.id)) + 1, 0, b.id);
  from.nodes.splice(idx[0], ids.length);
  for (const id of run) t.nodes[id].branch = b.id;
  // tangents that forked off a moved node now hang off the new branch
  for (const other of Object.values(t.branches))
    if (other.kind === "tangent" && other.forkNode && run.includes(other.forkNode)) other.parentBranch = b.id;
  // still working at the end of the run: carry on in the re-marked branch
  if (isTail && t.current === from.id) goTo(t, b.id);
}

/** Undo a tangent mark: move a run of a tangent's nodes back onto its main branch, in
 *  time order. A tangent left empty is removed; tangents that forked off a moved node
 *  now hang off the main branch. */
function backToMain(t: Tree, fromId: string, run: string[]) {
  const from = t.branches[fromId];
  if (from.kind !== "tangent") return;
  const main = t.branches[mainOf(t, fromId)];
  from.nodes = from.nodes.filter(id => !run.includes(id));
  for (const id of run) t.nodes[id].branch = main.id;
  main.nodes = [...main.nodes, ...run].sort((a, b) => t.nodes[a].ts - t.nodes[b].ts || (a < b ? -1 : 1));
  for (const b of Object.values(t.branches))
    if (b.kind === "tangent" && b.forkNode && run.includes(b.forkNode)) b.parentBranch = main.id;
  if (!from.nodes.length) {
    for (const b of Object.values(t.branches)) if (b.parentBranch === fromId) b.parentBranch = from.parentBranch;
    delete t.branches[fromId];
    t.history = t.history.filter(b => b !== fromId);
    if (t.current === fromId) t.current = main.id;
  }
}

/** Drift = how far the person is into the current tangent. */
export function drift(t: Tree, now: number): { nodes: number; minutes: number } | null {
  const b = t.branches[t.current];
  if (b.kind !== "tangent") return null;
  const count = b.nodes.reduce((n, id) => n + Math.max(1, t.nodes[id].pages.length), 0);
  return { nodes: count, minutes: (now - b.createdTs) / 60000 };
}
