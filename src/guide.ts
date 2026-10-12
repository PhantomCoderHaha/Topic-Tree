/**
 * The guide's worked example: one research session told in steps. Each picture is
 * drawn by the real reducer and view code, so it matches what the panel shows.
 */
import type { Action, TopicEvent } from "./core/events";
import { replay, type Tree } from "./core/tree";
import { buildView, defaultCollapsed, edgePath } from "./panel/view";

type Step = string | Action; // "q:query" = a search, "p:site|title" = a page

interface Scene {
  title: string;
  did: string;          // what you did (HTML)
  keys?: string;        // the key(s) pressed (HTML)
  steps: Step[];        // events added in this scene
  note?: string;        // what to notice (HTML)
  banner?: "drift";
  select?: string[];    // titles shown as selected (visual mode)
  hideNew?: boolean;    // show the tree before this scene's events (for "select, then press")
}

const SCENES: Scene[] = [
  { title: "1. Start researching",
    did: "You want to sleep better. You search, open a result, and read two articles on the same site.",
    steps: ["q:how to sleep better", "p:sleepfoundation.org|Healthy Sleep Tips", "p:sleepfoundation.org|Sleep Hygiene"],
    note: "No keys needed. Searches are rings, pages are dots, and two pages on one site share a node (<b>×2</b>). This line is your <b>main branch</b>." },
  { title: "2. A side question comes up",
    did: "An article mentions <i>circadian rhythm</i>. You want to know what that is, so you go off on a <b>tangent</b> before searching.",
    keys: "<kbd>t</kbd> &nbsp;or on the page <kbd>Ctrl+Shift+Y</kbd> <kbd>t</kbd>",
    steps: [{ type: "tangent" }, "q:what is circadian rhythm", "p:en.wikipedia.org|Circadian rhythm - Wikipedia"],
    note: "The tangent gets its own lane and colour, forking off where you were." },
  { title: "3. Back to the main question",
    did: "Got it. You return to your main topic and keep reading about sleep.",
    keys: "<kbd>m</kbd>",
    steps: [{ type: "main" }, "p:hubermanlab.com|Toolkit for Sleep"],
    note: "The finished tangent folds into one <b>↳</b> line, so the main line stays easy to follow. Click it (or <kbd>l</kbd>) to unfold." },
  { title: "4. You drift without noticing",
    did: "You start comparing mattresses: three pages later you realise it's a detour. Nobody marks tangents perfectly, so you can fix it after.",
    steps: ["q:best mattress for back pain", "p:rtings.com|The 6 Best Mattresses", "p:reddit.com|r/Mattress: worth it?"],
    note: "Right now those pages sit on your main branch.", hideNew: false },
  { title: "5. Mark the detour afterwards",
    did: "Select the mattress pages and turn them into a tangent.",
    keys: "<kbd>v</kbd> then <kbd>j</kbd>/<kbd>k</kbd> to select, then <kbd>t</kbd> &nbsp;(or Shift-click, then <kbd>t</kbd>)",
    steps: [{ type: "retro", nodes: ["@best mattress for back pain", "@The 6 Best Mattresses", "@r/Mattress: worth it?"], to: "tangent" },
            { type: "main" }],
    note: "The detour moves to its own lane and folds away. Your main line is clean again." },
  { title: "6. Tangents inside tangents, and the drift alarm",
    did: "You go off on caffeine, then from there on coffee brewing… The alarm notices you've gone deep.",
    keys: "<kbd>t</kbd> … <kbd>t</kbd>",
    steps: [{ type: "tangent" }, "q:caffeine half life", "p:examine.com|Caffeine", { type: "tangent" },
            "q:best way to brew coffee", "p:youtube.com|James Hoffmann: Ultimate V60", "p:jameshoffmann.co.uk|Recipes"],
    banner: "drift",
    note: "When a tangent passes the steps or minutes set in ⚙, a banner offers the way back: <b>Return</b> (<kbd>m</kbd>) or <b>Keep going</b>. A tangent of a tangent takes another lane." },
  { title: "7. A completely new topic",
    did: "Back on sleep, you're done. Later you start researching something unrelated.",
    keys: "<kbd>m</kbd> then <kbd>M</kbd>",
    steps: [{ type: "main" }, { type: "newMain" }, "q:how to learn touch typing", "p:keybr.com|Typing practice"],
    note: "<kbd>M</kbd> starts a new main branch, marked <b>new topic</b>. Jump between branches with <kbd>f</kbd> (letter labels) or <kbd>/</kbd> (find by name), and name a branch with <kbd>r</kbd>." },
];

// --- build each scene's tree --------------------------------------------------------
function treeAt(upto: number): Tree {
  const events: TopicEvent[] = [];
  const byTitle = new Map<string, string>();
  let seq = 0;
  for (const scene of SCENES.slice(0, upto + 1)) {
    for (const s of scene.steps) {
      seq++;
      const base = { id: `g${seq}`, session: "guide", seq, ts: seq * 60000, source: "browser" as const };
      if (typeof s !== "string") {
        const a = s.type === "retro" ? { ...s, nodes: s.nodes.map(n => byTitle.get(n.slice(1)) ?? n) } : s;
        events.push({ ...base, kind: "action", action: a });
        continue;
      }
      const [kind, rest] = [s.slice(0, 1), s.slice(2)];
      if (kind === "q") { events.push({ ...base, kind: "search", query: rest }); byTitle.set(rest, `n${base.id}`); continue; }
      const [site, title] = rest.split("|");
      // only a page reached straight from a results page counts as "from the search"
      const fromSearch = events.at(-1)?.kind === "search";
      events.push({ ...base, kind: "page", url: `https://${site}/${title.length}`, title, site, fromSearch });
      byTitle.set(title, `n${base.id}`);
    }
  }
  return replay("guide", events);
}

// --- draw a static panel ---------------------------------------------------------------
const ROW = 24, LANE = 15, X0 = 12;
const NS = "http://www.w3.org/2000/svg";
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = "") {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}
function svgEl(tag: string, attrs: Record<string, string | number>) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

function panel(t: Tree, scene: Scene, previous: Set<string>): HTMLElement {
  const v = buildView(t, defaultCollapsed(t, new Set()));
  const box = el("div", "mock");
  const main = t.branches[t.mains.at(-1)!];
  const head = el("div", "mock-head");
  head.append(el("span", "rec"), el("strong", "", main.nodes[0] ? t.nodes[main.nodes[0]].title : "New session"));
  const cur = t.branches[t.current];
  if (cur.kind === "tangent") head.append(el("span", "sub", `› tangent: ${t.nodes[cur.nodes[0]]?.title ?? ""}`));
  box.append(head);
  if (scene.banner === "drift") box.append(el("div", "mock-drift", "5 steps · 22 min into this tangent. Back to how to sleep better?   [Return (m)]  [Keep going]"));

  const lanes = Math.max(v.layout.lanes, ...v.rows.map(r => r.lane + 1));
  const gutter = X0 + lanes * LANE;
  const graph = el("div", "mock-graph");
  const g = svgEl("svg", { width: gutter, height: v.rows.length * ROW });
  for (const e of v.edges) {
    const [x1, y1] = [X0 + e.from[1] * LANE, v.yOf(e.from[0]) * ROW + ROW / 2];
    const [x2, y2] = [X0 + e.to[1] * LANE, v.yOf(e.to[0]) * ROW + ROW / 2];
    g.append(svgEl("path", { d: edgePath(x1, y1, x2, y2, e.kind, ROW), stroke: e.colour, "stroke-width": 2, fill: "none",
                             opacity: e.kind === "merge" ? 0.55 : 1, "stroke-dasharray": e.kind === "merge" ? "3 3" : "" }));
  }
  const headNode = cur.nodes.at(-1);
  v.rows.forEach((r, i) => {
    const [x, y] = [X0 + r.lane * LANE, i * ROW + ROW / 2];
    const row = el("div", "mock-row");
    row.style.paddingLeft = `${gutter}px`;
    if (r.kind === "chip") {
      g.append(svgEl("circle", { cx: x, cy: y, r: 3.5, fill: "#151515", stroke: r.colour, "stroke-width": 1.5, "stroke-dasharray": "2 2" }));
      const label = el("span", "chip", `↳ tangent: ${t.nodes[t.branches[r.branch].nodes[0]]?.title ?? ""}`);
      label.style.color = r.colour;
      row.append(label, el("span", "dim", ` ${r.count}`));
    } else {
      const n = t.nodes[r.node];
      if (r.node === headNode) g.append(svgEl("circle", { cx: x, cy: y, r: 8, fill: r.colour, opacity: 0.18 }));
      g.append(n.kind === "search"
        ? svgEl("circle", { cx: x, cy: y, r: 4.5, fill: "#151515", stroke: r.colour, "stroke-width": 2 })
        : svgEl("circle", { cx: x, cy: y, r: 4.5, fill: r.colour }));
      const b = Object.values(t.branches).find(b => b.nodes[0] === r.node);
      if (b && b.kind === "main" && t.mains.indexOf(b.id) > 0) row.append(el("span", "topic", "new topic"));
      row.append(el("span", "", n.kind === "search" ? `“${n.title}”` : n.title));
      if (n.pages.length > 1) row.append(el("span", "dim", ` ×${n.pages.length}`));
      if (n.site) row.append(el("span", "dim", ` ${n.site}`));
      if (!previous.has(r.node)) row.classList.add("new");
      if (r.node === headNode) row.classList.add("here");
    }
    graph.append(row);
  });
  graph.prepend(g);
  box.append(graph);
  return box;
}

function render() {
  const root = document.getElementById("example");
  if (!root) return;
  let previous = new Set<string>();
  SCENES.forEach((scene, i) => {
    const t = treeAt(i);
    const card = el("section", "scene");
    const text = el("div", "scene-text");
    text.append(el("h3", "", scene.title));
    const did = el("p");
    did.innerHTML = scene.did;
    text.append(did);
    if (scene.keys) { const k = el("p", "keys"); k.innerHTML = `Press: ${scene.keys}`; text.append(k); }
    if (scene.note) { const n = el("p", "dim"); n.innerHTML = scene.note; text.append(n); }
    card.append(text, panel(t, scene, previous));
    root.append(card);
    previous = new Set(Object.keys(t.nodes));
  });
}
render();
