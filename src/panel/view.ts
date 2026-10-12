/**
 * Tree -> what the panel shows: the compact display list (node rows plus one-line
 * chips for collapsed branches) with each node's y position, and the graph edges.
 * Pure, so it is unit-tested apart from the DOM.
 */
import { layout, type Edge, type Layout } from "../core/layout";
import type { Tree } from "../core/tree";

export type DisplayRow =
  | { kind: "node"; node: string; branch: string; lane: number; colour: string; layoutRow: number }
  | { kind: "chip"; branch: string; colour: string; count: number; lane: number }
  | { kind: "page"; node: string; index: number; branch: string; colour: string; lane: number }
  | { kind: "pending"; branch: string; colour: string; lane: number; forkRow?: number; forkLane?: number;
      branchKind: "main" | "tangent" };

export interface View { rows: DisplayRow[]; layout: Layout; edges: Edge[]; yOf: (layoutRow: number) => number }

/** Returned tangents start collapsed, except the one you're in or on the way to. */
export function defaultCollapsed(t: Tree, expanded: Set<string>): Set<string> {
  const onPath = new Set<string>();
  for (let b = t.branches[t.current]; b; b = b.parentBranch ? t.branches[b.parentBranch] : undefined!) {
    onPath.add(b.id);
    if (!b.parentBranch) break;
  }
  return new Set(Object.values(t.branches)
    .filter(b => b.kind === "tangent" && b.returned && !onPath.has(b.id) && !expanded.has(b.id))
    .map(b => b.id));
}

/** Hide collapsed branches (and everything that forks off them); count what they hold. */
/** `openNodes`: grouped page nodes (×N) shown unfolded, one row per page. */
export function buildView(t: Tree, collapsed: Set<string>, openNodes: Set<string> = new Set()): View {
  const hiddenBranches = new Set<string>();
  const isHidden = (id: string): boolean => {
    for (let b = t.branches[id]; b; b = b.parentBranch ? t.branches[b.parentBranch] : undefined!) {
      if (collapsed.has(b.id)) return true;
      if (!b.parentBranch) return false;
    }
    return false;
  };
  for (const id of Object.keys(t.branches)) if (isHidden(id)) hiddenBranches.add(id);

  const visible: Tree = structuredClone(t);
  for (const id of hiddenBranches) {
    for (const n of visible.branches[id].nodes) delete visible.nodes[n];
    visible.branches[id] = { ...visible.branches[id], nodes: [] };
  }
  const l = layout(visible);
  const colourOf = new Map(Object.entries(layout(t).colours));
  const total = (id: string): number => t.branches[id].nodes.length
    + Object.values(t.branches).filter(b => b.parentBranch === id).reduce((n, b) => n + total(b.id), 0);

  // chips sit right after the node their branch forked from (top-level collapsed ones only)
  const chipsAfter = new Map<string, string[]>();
  for (const id of collapsed) {
    const b = t.branches[id];
    if (!b || !b.parentBranch || hiddenBranches.has(b.parentBranch) || !total(id)) continue;
    const key = b.forkNode ?? `start:${b.parentBranch}`;
    chipsAfter.set(key, [...(chipsAfter.get(key) ?? []), id]);
  }

  const rows: DisplayRow[] = [];
  const yIndex = new Map<number, number>();
  const pushChips = (key: string, lane: number) => {
    for (const id of chipsAfter.get(key) ?? [])
      rows.push({ kind: "chip", branch: id, colour: colourOf.get(id)!, count: total(id), lane: lane + 1 });
  };
  for (const main of t.mains) pushChips(`start:${main}`, 0);
  for (const r of l.rows) {
    yIndex.set(r.row, rows.length);
    rows.push({ kind: "node", node: r.node, branch: r.branch, lane: r.lane, colour: r.colour, layoutRow: r.row });
    const n = t.nodes[r.node];
    if (openNodes.has(r.node) && n.pages.length > 1)
      n.pages.forEach((_, index) => rows.push({ kind: "page", node: r.node, index, branch: r.branch, lane: r.lane, colour: r.colour }));
    pushChips(r.node, r.lane);
  }
  // the branch you just started has no nodes yet: show where the next one will go
  const cur = t.branches[t.current];
  if (!cur.nodes.length) {
    const fork = cur.forkNode ? l.rows.find(r => r.node === cur.forkNode) : undefined;
    rows.push({ kind: "pending", branch: cur.id, colour: colourOf.get(cur.id) ?? "#78b6ff",
                lane: cur.kind === "main" ? 0 : Math.max(1, l.lanes), branchKind: cur.kind,
                forkRow: fork ? yIndex.get(fork.row) : undefined, forkLane: fork?.lane });
  }
  return { rows, layout: l, edges: l.edges, yOf: row => yIndex.get(row) ?? 0 };
}

/**
 * What a rename box is for, fixed when it opens: the cursor follows new pages, so
 * reading it again at Enter would rename whatever arrived while you were typing.
 * A page row names its node; any row names its branch; no row names the current branch.
 */
export function renameTarget(t: Tree, row: DisplayRow | undefined, kind: "branch" | "node"):
    { branch: string } | { node: string } | null {
  if (kind === "node") return row?.kind === "node" || row?.kind === "page" ? { node: row.node } : null;
  return { branch: row ? row.branch : t.current };
}

/**
 * What a key press in the panel does. Until you engage the panel (click it, press
 * Enter, or open it from the icon) letters are not commands: focus that arrived by
 * itself must not turn your typing into tree actions. Modifier combos pass through.
 */
export function keyGate(engaged: boolean, key: string, modifier: boolean): "act" | "engage" | "hint" | "ignore" {
  if (engaged) return "act";
  if (modifier) return "ignore";
  if (key === "Enter") return "engage";
  return key.length === 1 || key.startsWith("Arrow") ? "hint" : "ignore";
}

/** Labels for hint mode: home row first, then two-letter combinations. */
export function hintLabels(n: number): string[] {
  const keys = "asdfghjklqwertyuiopzxcvbnm".split("");
  if (n <= keys.length) return keys.slice(0, n);
  const out: string[] = [];
  for (const a of keys) for (const b of keys) { out.push(a + b); if (out.length === n) return out; }
  return out;
}

/** Subsequence fuzzy score (higher is better); -1 when the query doesn't match. */
export function fuzzy(query: string, text: string): number {
  const q = query.toLowerCase(), s = text.toLowerCase();
  if (!q) return 0;
  if (s.includes(q)) return 1000 - s.indexOf(q);
  let i = 0, score = 0, last = -2;
  for (let j = 0; j < s.length && i < q.length; j++) {
    if (s[j] === q[i]) { score += j === last + 1 ? 5 : 1; last = j; i++; }
  }
  return i === q.length ? score : -1;
}

/** SVG path for a graph edge: straight within a lane, a curve where a tangent forks or merges. */
export function edgePath(x1: number, y1: number, x2: number, y2: number, kind: "line" | "fork" | "merge", row: number): string {
  if (x1 === x2) return `M${x1} ${y1}V${y2}`;
  if (kind === "fork") return `M${x1} ${y1}C${x1} ${y1 + row * 0.7} ${x2} ${y1 + row * 0.3} ${x2} ${y1 + row}V${y2}`;
  return `M${x1} ${y1}V${y2 - row}C${x1} ${y2 - row * 0.3} ${x2} ${y2 - row * 0.7} ${x2} ${y2}`;
}
