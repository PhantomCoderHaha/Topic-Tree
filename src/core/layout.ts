/**
 * Tree -> git-graph layout: one row per node in time order, one lane per branch.
 * Main branches share lane 0 (a topic shift draws a break); tangents take the
 * lowest lane free for their span, so finished tangents give their lane back.
 * Every renderer (the SVG panel, later the Claude mod's Svg and terminal text)
 * draws from this; none of them re-derive structure.
 */
import type { Tree } from "./tree";

export const PALETTE = ["#78b6ff", "#7bd88f", "#ffb454", "#c792ea", "#ff7a90", "#5ad4e6", "#f2e663"];

export interface Row { node: string; branch: string; row: number; lane: number; colour: string }
export interface Edge { from: [number, number]; to: [number, number]; colour: string;
                        kind: "line" | "fork" | "merge" }
export interface BranchMark { branch: string; lane: number; firstRow: number; lastRow: number;
                              colour: string; kind: "main" | "tangent"; topicBreak: boolean }
export interface Layout { rows: Row[]; edges: Edge[]; branches: BranchMark[]; lanes: number }

export function layout(t: Tree): Layout {
  const order = Object.values(t.nodes).sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : 1));
  const rowOf = new Map(order.map((n, i) => [n.id, i]));

  // colours: mains cycle from palette[0]; each tangent gets the next colour
  const colourOf = new Map<string, string>();
  let c = 1;
  for (const b of Object.values(t.branches).sort((x, y) => x.born - y.born || (x.id < y.id ? -1 : 1)))
    colourOf.set(b.id, b.kind === "main" ? PALETTE[0] : PALETTE[c++ % PALETTE.length || 1]);

  // spans: a tangent occupies its lane from its fork row to its last node
  const span = (id: string): [number, number] | null => {
    const b = t.branches[id];
    if (!b.nodes.length) return null;
    const rows = b.nodes.map(n => rowOf.get(n)!);
    const start = b.forkNode !== undefined ? rowOf.get(b.forkNode)! : Math.min(...rows);
    return [start, Math.max(...rows)];
  };
  const laneOf = new Map<string, number>();
  const taken: Array<Array<[number, number]>> = [[]];
  const tangents = Object.values(t.branches).filter(b => b.kind === "tangent")
    .map(b => ({ b, s: span(b.id) })).filter(x => x.s)
    .sort((x, y) => x.s![0] - y.s![0] || x.s![1] - y.s![1]);
  for (const { b, s } of tangents) {
    let lane = 1;
    while ((taken[lane] ??= []).some(([a, z]) => s![0] <= z && a <= s![1])) lane++;
    taken[lane].push(s!);
    laneOf.set(b.id, lane);
  }
  for (const m of t.mains) laneOf.set(m, 0);

  const rows: Row[] = order.map(n => ({ node: n.id, branch: n.branch, row: rowOf.get(n.id)!,
    lane: laneOf.get(n.branch) ?? 0, colour: colourOf.get(n.branch)! }));
  const at = (node: string): [number, number] => [rowOf.get(node)!, laneOf.get(t.nodes[node].branch) ?? 0];

  const edges: Edge[] = [];
  const marks: BranchMark[] = [];
  for (const b of Object.values(t.branches)) {
    if (!b.nodes.length) continue;
    const colour = colourOf.get(b.id)!;
    const nodes = [...b.nodes].sort((x, y) => rowOf.get(x)! - rowOf.get(y)!);
    for (let i = 1; i < nodes.length; i++)
      edges.push({ from: at(nodes[i - 1]), to: at(nodes[i]), colour, kind: "line" });
    if (b.kind === "tangent" && b.forkNode && t.nodes[b.forkNode])
      edges.push({ from: at(b.forkNode), to: at(nodes[0]), colour, kind: "fork" });
    if (b.kind === "tangent" && b.returned && b.parentBranch) {
      // merge into the parent's first node after the tangent ended
      const last = rowOf.get(nodes.at(-1)!)!;
      const next = t.branches[b.parentBranch].nodes.map(n => rowOf.get(n)!).filter(r => r > last).sort((x, y) => x - y)[0];
      if (next !== undefined) edges.push({ from: at(nodes.at(-1)!), to: [next, laneOf.get(b.parentBranch) ?? 0],
                                          colour, kind: "merge" });
    }
    const rs = nodes.map(n => rowOf.get(n)!);
    marks.push({ branch: b.id, lane: laneOf.get(b.id) ?? 0, firstRow: Math.min(...rs), lastRow: Math.max(...rs),
                 colour, kind: b.kind, topicBreak: b.kind === "main" && t.mains.indexOf(b.id) > 0 });
  }
  return { rows, edges, branches: marks, lanes: Math.max(1, ...[...laneOf.values()].map(l => l + 1)) };
}
