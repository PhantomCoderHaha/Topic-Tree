import { describe, expect, it } from "vitest";
import { isTrackable, parseSearch, siteOf } from "../src/core/capture";
import type { Action, TopicEvent } from "../src/core/events";
import { replay } from "../src/core/tree";
import { buildView, defaultCollapsed, fuzzy, hintLabels } from "../src/panel/view";

function run(...steps: Array<string | Action>) {
  const evs: TopicEvent[] = steps.map((s, i) => {
    const base = { id: `e${i + 1}`, session: "s", seq: i + 1, ts: 1000 * (i + 1), source: "browser" as const };
    return typeof s === "string" ? { ...base, kind: "search", query: s } : { ...base, kind: "action", action: s };
  });
  return replay("s", evs);
}

describe("capture rules", () => {
  it("recognises searches on Google, Brave, Bing and DuckDuckGo", () => {
    expect(parseSearch("https://www.google.com/search?q=qualia&sca=1")).toEqual({ engine: "google", query: "qualia" });
    expect(parseSearch("https://www.google.com.au/search?q=a+b")).toEqual({ engine: "google", query: "a b" });
    expect(parseSearch("https://search.brave.com/search?q=x")).toEqual({ engine: "brave", query: "x" });
    expect(parseSearch("https://www.bing.com/search?q=y")).toEqual({ engine: "bing", query: "y" });
    expect(parseSearch("https://duckduckgo.com/?q=z")).toEqual({ engine: "duckduckgo", query: "z" });
    expect(parseSearch("https://www.google.com/maps")).toBeNull();
    expect(parseSearch("https://dankoe.com/search?q=focus")).toBeNull();
  });
  it("groups by site without www, and only tracks web pages", () => {
    expect(siteOf("https://www.dankoe.com/a")).toBe("dankoe.com");
    expect(isTrackable("brave://settings")).toBe(false);
    expect(isTrackable("https://x.com")).toBe(true);
  });
});

describe("compact view", () => {
  it("collapses returned tangents into one chip right after their fork node", () => {
    const t = run("a", { type: "tangent" }, "b", "c", { type: "main" }, "d");
    const v = buildView(t, defaultCollapsed(t, new Set()));
    expect(v.rows.map(r => r.kind === "node" ? t.nodes[r.node].title : r.kind === "chip" ? `chip:${r.count}` : r.kind))
      .toEqual(["a", "chip:2", "d"]);
  });
  it("keeps the tangent you're in expanded, and an expanded one stays open", () => {
    const t = run("a", { type: "tangent" }, "b");
    expect(defaultCollapsed(t, new Set()).size).toBe(0);
    const back = run("a", { type: "tangent" }, "b", { type: "main" });
    const tan = Object.values(back.branches).find(b => b.kind === "tangent")!.id;
    expect(defaultCollapsed(back, new Set([tan])).size).toBe(0);
  });
  it("a collapsed tangent hides its own sub-tangents and counts them", () => {
    const t = run("a", { type: "tangent" }, "b", { type: "tangent" }, "c", { type: "main" }, "d");
    const v = buildView(t, defaultCollapsed(t, new Set()));
    expect(v.rows.filter(r => r.kind === "chip").map(r => r.kind === "chip" && r.count)).toEqual([2]);
  });
  it("graph rows map to display positions around chips", () => {
    const t = run("a", { type: "tangent" }, "b", { type: "main" }, "d");
    const v = buildView(t, defaultCollapsed(t, new Set()));
    const d = v.rows.find(r => r.kind === "node" && t.nodes[r.node].title === "d")!;
    expect(d.kind === "node" && v.yOf(d.layoutRow)).toBe(2);
  });
});

describe("keyboard helpers", () => {
  it("hint labels are unique, single letters first", () => {
    expect(hintLabels(3)).toEqual(["a", "s", "d"]);
    const many = hintLabels(40);
    expect(new Set(many).size).toBe(40);
    expect(many[30]).toHaveLength(2);
  });
  it("fuzzy finds substrings first, then subsequences", () => {
    expect(fuzzy("consc", "consciousness")).toBeGreaterThan(fuzzy("cns", "consciousness"));
    expect(fuzzy("cns", "consciousness")).toBeGreaterThan(0);
    expect(fuzzy("xyz", "consciousness")).toBe(-1);
  });
});

describe("just-started branches", () => {
  it("shows a placeholder where the next node of an empty new tangent will go, forking from here", () => {
    const t = run("a", { type: "tangent" });
    const last = buildView(t, new Set()).rows.at(-1)!;
    expect(last.kind).toBe("pending");
    expect(last.kind === "pending" && [last.branchKind, last.forkRow, last.lane]).toEqual(["tangent", 0, 1]);
  });
  it("shows one for an empty new topic, and none once it has a node", () => {
    const empty = run("a", { type: "newMain" });
    const row = buildView(empty, new Set()).rows.at(-1)!;
    expect(row.kind === "pending" && row.branchKind).toBe("main");
    expect(buildView(run("a", { type: "newMain" }, "b"), new Set()).rows.some(r => r.kind === "pending")).toBe(false);
  });
});

describe("unfolded site nodes", () => {
  const pages = (): TopicEvent[] => ["a", "b", "c"].map((x, i) => ({
    id: `p${i}`, session: "s", seq: i + 1, ts: (i + 1) * 1000, source: "browser" as const,
    kind: "page" as const, url: `https://dankoe.com/${x}`, title: `Essay ${x}`, site: "dankoe.com" }));
  it("shows one row per page under an unfolded ×N node, and none when folded", () => {
    const t = replay("s", pages());
    const node = Object.keys(t.nodes)[0];
    expect(buildView(t, new Set()).rows.map(r => r.kind)).toEqual(["node"]);
    const open = buildView(t, new Set(), new Set([node])).rows;
    expect(open.map(r => r.kind === "page" ? r.index : r.kind)).toEqual(["node", 0, 1, 2]);
  });
  it("keeps graph rows aligned below the unfolded pages", () => {
    const evs = [...pages(), { id: "q", session: "s", seq: 9, ts: 9000, source: "browser" as const, kind: "search" as const, query: "next" }];
    const t = replay("s", evs);
    const node = Object.values(t.nodes).find(n => n.kind === "page")!.id;
    const v = buildView(t, new Set(), new Set([node]));
    const search = v.rows.find(r => r.kind === "node" && t.nodes[r.node].kind === "search")!;
    expect(search.kind === "node" && v.yOf(search.layoutRow)).toBe(4);
  });
});
