/**
 * Tree -> what the panel shows: the compact display list (node rows plus one-line
 * chips for collapsed branches) with each node's y position, and the graph edges.
 * Pure, so it is unit-tested apart from the DOM.
 */
import { layout, type Edge, type Layout } from "../core/layout";
import type { Tree } from "../core/tree";

export type DisplayRow =
  | { kind: "node"; node: string; branch: string; lane: number; colour: string; layoutRow: number }
  | { kind: "chip"; branch: string; colour: string; count: number; lane: number };

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
export function buildView(t: Tree, collapsed: Set<string>): View {
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
  const colourOf = new Map(layout(t).branches.map(b => [b.branch, b.colour]));
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
    pushChips(r.node, r.lane);
  }
  return { rows, layout: l, edges: l.edges, yOf: row => yIndex.get(row) ?? 0 };
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
