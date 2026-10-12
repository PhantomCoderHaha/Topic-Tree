import { describe, expect, it } from "vitest";
import type { Action, TopicEvent } from "../src/core/events";
import { layout } from "../src/core/layout";
import { apply, drift, mainOf, replay, type Tree } from "../src/core/tree";

/** A tiny script language for sessions: each entry becomes one event. */
function events(...steps: Array<string | Action>): TopicEvent[] {
  return steps.map((s, i) => {
    const base = { id: `e${i + 1}`, session: "s", seq: i + 1, ts: 1000 * (i + 1), source: "browser" as const };
    if (typeof s !== "string") return { ...base, kind: "action", action: s };
    const [kind, rest] = s.split(":");
    if (kind === "q") return { ...base, kind: "search", query: rest };
    const [site, page, flag] = rest.split("/");
    return { ...base, kind: "page", url: `https://${site}/${page}`, title: `${site} ${page}`, site,
             fromSearch: flag === "fs" };
  });
}
const titles = (t: Tree, branch: string) => t.branches[branch].nodes.map(id => t.nodes[id].title);
const run = (...steps: Array<string | Action>) => replay("s", events(...steps));

describe("capture", () => {
  it("adds every node to the current branch by default", () => {
    const t = run("q:consciousness", "p:wiki.org/qualia/fs");
    expect(titles(t, t.current)).toEqual(["consciousness", "wiki.org qualia"]);
  });

  it("keeps consecutive pages on one site as one node, a later return is a new node", () => {
    const t = run("p:dankoe.com/a", "p:dankoe.com/b", "p:youtube.com/x", "p:dankoe.com/c");
    const nodes = t.branches[t.current].nodes.map(id => t.nodes[id]);
    expect(nodes.map(n => [n.site, n.pages.length])).toEqual([["dankoe.com", 2], ["youtube.com", 1], ["dankoe.com", 1]]);
  });

  it("hangs a result opened from a search under that search, even after going back to the results", () => {
    const t = run("q:qualia", "p:a.com/1/fs", "p:b.com/2/fs");
    const [search, a, b] = t.branches[t.current].nodes.map(id => t.nodes[id]);
    expect(a.parent).toBe(search.id);
    expect(b.parent).toBe(search.id);
  });

  it("ignores an event it has already applied (duplicate disk flush)", () => {
    const evs = events("q:x", "q:y");
    const t = apply(replay("s", evs), evs[1]);
    expect(titles(t, t.current)).toEqual(["x", "y"]);
  });
});

describe("branching", () => {
  it("tangent then main: the tangent forks off the last node and is marked returned", () => {
    const t = run("q:main topic", { type: "tangent" }, "q:side idea", { type: "main" }, "q:back on main");
    const main = t.mains[0];
    expect(t.current).toBe(main);
    expect(titles(t, main)).toEqual(["main topic", "back on main"]);
    const tan = Object.values(t.branches).find(b => b.kind === "tangent")!;
    expect(titles(t, tan.id)).toEqual(["side idea"]);
    expect(tan.forkNode).toBe(t.branches[main].nodes[0]);
    expect(tan.returned).toBe(true);
  });

  it("a tangent of a tangent returns all the way to main", () => {
    const t = run("q:a", { type: "tangent" }, "q:b", { type: "tangent" }, "q:c", { type: "main" });
    expect(t.current).toBe(t.mains[0]);
    expect(Object.values(t.branches).filter(b => b.kind === "tangent").every(b => b.returned)).toBe(true);
  });

  it("newMain starts a new topic; goto returns to an earlier main or tangent", () => {
    let t = run("q:topic one", { type: "tangent" }, "q:side", { type: "newMain" }, "q:topic two");
    expect(t.mains).toHaveLength(2);
    expect(titles(t, t.mains[1])).toEqual(["topic two"]);
    const tan = Object.values(t.branches).find(b => b.kind === "tangent")!;
    t = apply(t, { id: "x", session: "s", seq: 99, ts: 99e3, source: "browser", kind: "action",
                   action: { type: "goto", branch: tan.id } });
    expect(t.current).toBe(tan.id);
    expect(t.history.at(-1)).toBe(t.mains[1]);
    expect(mainOf(t, tan.id)).toBe(t.mains[0]);
  });

  it("names branches and nodes", () => {
    const t = run("q:x", { type: "renameBranch", branch: "b-main-0", name: "consciousness" },
                  { type: "renameNode", node: "ne1", name: "start" });
    expect(t.branches["b-main-0"].name).toBe("consciousness");
    expect(t.nodes["ne1"].name).toBe("start");
  });

  it("same log, same ids: replay is deterministic", () => {
    const evs = events("q:a", { type: "tangent" }, "p:x.com/1");
    expect(replay("s", evs)).toEqual(replay("s", evs));
  });
});

describe("split and retro-marking", () => {
  it("split promotes pages[i..] of a site node to their own node, right after it", () => {
    const t = run("p:dankoe.com/a", "p:dankoe.com/b", "p:dankoe.com/c", { type: "split", node: "ne1", page: 1 });
    const nodes = t.branches[t.current].nodes.map(id => t.nodes[id]);
    expect(nodes.map(n => n.pages.map(p => p.url.split("/").pop()))).toEqual([["a"], ["b", "c"]]);
  });

  it("retro: a middle run on main becomes a returned tangent", () => {
    const t = run("q:a", "q:b", "q:c", "q:d", "q:e", { type: "retro", nodes: ["ne3", "ne4"], to: "tangent" });
    const main = t.mains[0];
    expect(titles(t, main)).toEqual(["a", "b", "e"]);
    const tan = Object.values(t.branches).find(b => b.kind === "tangent")!;
    expect(titles(t, tan.id)).toEqual(["c", "d"]);
    expect(tan.forkNode).toBe("ne2");
    expect(tan.returned).toBe(true);
    expect(t.current).toBe(main);
  });

  it("retro: the tail becomes the current tangent (I only just noticed I drifted)", () => {
    const t = run("q:a", "q:b", "q:c", { type: "retro", nodes: ["ne2", "ne3"], to: "tangent" });
    const tan = Object.values(t.branches).find(b => b.kind === "tangent")!;
    expect(t.current).toBe(tan.id);
    expect(tan.returned).toBe(false);
  });

  it("retro: the tail becomes a new main branch (a topic shift I didn't mark)", () => {
    const t = run("q:a", "q:b", "q:c", { type: "retro", nodes: ["ne2", "ne3"], to: "newMain" });
    expect(t.mains).toHaveLength(2);
    expect(titles(t, t.mains[0])).toEqual(["a"]);
    expect(titles(t, t.mains[1])).toEqual(["b", "c"]);
    expect(t.current).toBe(t.mains[1]);
  });

  it("retro refuses a non-contiguous selection", () => {
    const before = run("q:a", "q:b", "q:c");
    const after = run("q:a", "q:b", "q:c", { type: "retro", nodes: ["ne1", "ne3"], to: "tangent" });
    expect(titles(after, after.mains[0])).toEqual(titles(before, before.mains[0]));
  });
});

describe("drift", () => {
  it("counts nodes (and pages) and minutes on the current tangent only", () => {
    const t = run("q:a", { type: "tangent" }, "p:x.com/1", "p:x.com/2", "q:b");
    expect(drift(t, 6000)).toEqual({ nodes: 3, minutes: (6000 - 2000) / 60000 });
    expect(drift(run("q:a"), 0)).toBeNull();
  });
});

describe("layout", () => {
  it("main on lane 0, tangent on lane 1 with fork and merge edges", () => {
    const t = run("q:a", { type: "tangent" }, "q:b", { type: "main" }, "q:c");
    const l = layout(t);
    expect(l.rows.map(r => [t.nodes[r.node].title, r.row, r.lane])).toEqual([["a", 0, 0], ["b", 1, 1], ["c", 2, 0]]);
    expect(l.edges.map(e => e.kind).sort()).toEqual(["fork", "line", "merge"]);
    expect(l.lanes).toBe(2);
  });

  it("a finished tangent gives its lane back; overlapping tangents get separate lanes", () => {
    const t = run("q:a", { type: "tangent" }, "q:t1", { type: "main" }, "q:b",
                  { type: "tangent" }, "q:t2", { type: "tangent" }, "q:t3");
    const lanes = Object.fromEntries(layout(t).rows.map(r => [t.nodes[r.node].title, r.lane]));
    expect(lanes).toEqual({ a: 0, t1: 1, b: 0, t2: 1, t3: 2 });
  });

  it("marks topic shifts on later mains", () => {
    const t = run("q:a", { type: "newMain" }, "q:b");
    expect(layout(t).branches.filter(b => b.topicBreak).map(b => b.branch)).toEqual([t.mains[1]]);
  });
});

describe("up one level", () => {
  it("closes a nested tangent and returns to the tangent it forked from, not to main", () => {
    const t = run("q:a", { type: "tangent" }, "q:b", { type: "tangent" }, "q:c", { type: "up" }, "q:b2");
    const [outer, inner] = Object.values(t.branches).filter(b => b.kind === "tangent").sort((x, y) => x.born - y.born);
    expect(t.current).toBe(outer.id);
    expect(inner.returned).toBe(true);
    expect(outer.returned).toBe(false);
    expect(titles(t, outer.id)).toEqual(["b", "b2"]);
  });
  it("does nothing on a main branch", () => {
    const t = run("q:a", { type: "up" });
    expect(t.current).toBe(t.mains[0]);
  });
});

describe("retro back to main", () => {
  it("moves selected tangent nodes back onto main in time order and keeps the rest of the tangent", () => {
    const t = run("q:a", { type: "tangent" }, "q:b", "q:c", { type: "main" }, "q:d",
                  { type: "retro", nodes: ["ne3"], to: "main" });
    expect(titles(t, t.mains[0])).toEqual(["a", "b", "d"]);
    const tan = Object.values(t.branches).find(b => b.kind === "tangent")!;
    expect(titles(t, tan.id)).toEqual(["c"]);
  });
  it("removes a tangent left empty and moves you to main if you were in it", () => {
    const t = run("q:a", { type: "tangent" }, "q:b", "q:c", { type: "retro", nodes: ["ne3", "ne4"], to: "main" });
    expect(Object.values(t.branches).some(b => b.kind === "tangent")).toBe(false);
    expect(t.current).toBe(t.mains[0]);
    expect(titles(t, t.mains[0])).toEqual(["a", "b", "c"]);
  });
  it("re-parents a sub-tangent that forked off a moved node, and ignores nodes already on main", () => {
    const t = run("q:a", { type: "tangent" }, "q:b", { type: "tangent" }, "q:c", { type: "main" },
                  { type: "retro", nodes: ["ne3"], to: "main" }, { type: "retro", nodes: ["ne1"], to: "main" });
    const sub = Object.values(t.branches).find(b => b.kind === "tangent")!;
    expect(sub.parentBranch).toBe(t.mains[0]);
    expect(titles(t, t.mains[0])).toEqual(["a", "b"]);
  });
});
