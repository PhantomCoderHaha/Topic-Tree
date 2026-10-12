/**
 * The guide's worked example: one research session, told as scenarios you step through
 * frame by frame (‹ › or ← →). Every picture is drawn by the real reducer and view code,
 * so it matches what the panel shows.
 */
import type { Action, TopicEvent } from "./core/events";
import { replay, type Tree } from "./core/tree";
import { buildView, defaultCollapsed, edgePath } from "./panel/view";

/** "q:query" = a search · "p:site|title" = a page · an action. Guide-only extras:
 *  a tangent may carry `label` (so a later step can name it as a parent with "#label"),
 *  and retro nodes are given as "@title". */
type Step = string | (Action & { label?: string });

interface Frame {
  say: string;           // what happens in this frame (HTML)
  keys?: string;         // the key(s) pressed (HTML)
  steps: Step[];         // events this frame adds
  drift?: boolean;       // show the drift banner
}
interface Scene { title: string; frames: Frame[] }

const SCENES: Scene[] = [
  { title: "1. Start researching", frames: [
    { say: "You search <i>how to sleep better</i>. No keys needed: a search is a ring on your <b>main branch</b>.",
      steps: ["q:how to sleep better"] },
    { say: "You open a result. Pages are dots.", steps: ["p:sleepfoundation.org|Healthy Sleep Tips"] },
    { say: "You read another article on the same site. It joins the same node (<b>×2</b>), so one site doesn't flood the tree.",
      steps: ["p:sleepfoundation.org|Sleep Hygiene"] },
    { say: "Name the branch so you know what it's about at a glance. Click a row on it (or move there with <kbd>j</kbd>/<kbd>k</kbd>), press <kbd>r</kbd>, type a name, <kbd>Enter</kbd>. The name shows as a tag and in the header.",
      keys: "<kbd>r</kbd>, type <i>sleep</i>, <kbd>Enter</kbd>",
      steps: [{ type: "renameBranch", branch: "b-main-0", name: "sleep" }] },
  ] },
  { title: "2. A side question: start a tangent", frames: [
    { say: "An article mentions <i>circadian rhythm</i>. Before you search it, start a <b>tangent</b>. A dashed ring shows where it will go.",
      keys: "<kbd>t</kbd> &nbsp;(on a page: <kbd>Ctrl+Shift+Y</kbd> <kbd>t</kbd>)", steps: [{ type: "tangent", label: "circadian" }] },
    { say: "Your search lands on the tangent, in its own lane and colour.", steps: ["q:what is circadian rhythm"] },
    { say: "So does the page you read.", steps: ["p:en.wikipedia.org|Circadian rhythm - Wikipedia"] },
    { say: "Tangents can be named too: same key, <kbd>r</kbd>, with the cursor on the tangent. Its folded line will show the name later.",
      keys: "<kbd>r</kbd>, type <i>circadian rhythm</i>, <kbd>Enter</kbd>",
      steps: [{ type: "renameBranch", branch: "#circadian", name: "circadian rhythm" }] },
  ] },
  { title: "3. Back to the main question", frames: [
    { say: "Got it. Return to main. The finished tangent folds into one <b>↳</b> line (click it to unfold).",
      keys: "<kbd>m</kbd>", steps: [{ type: "main" }] },
    { say: "You keep reading, on the main line again.", steps: ["p:hubermanlab.com|Toolkit for Sleep"] },
  ] },
  { title: "4. Fix a detour you didn't mark", frames: [
    { say: "You start comparing mattresses, without marking a tangent…", steps: ["q:best mattress for back pain"] },
    { say: "…another page…", steps: ["p:rtings.com|The 6 Best Mattresses"] },
    { say: "…and another. Now you notice: this was a detour, and it's sitting on your main line.",
      steps: ["p:reddit.com|r/Mattress: worth it?"] },
    { say: "Select those three and mark them as a tangent. They move to their own lane and fold away; <kbd>m</kbd> puts you back on main.",
      keys: "<kbd>v</kbd> + <kbd>j</kbd>/<kbd>k</kbd> (or Shift-click), then <kbd>t</kbd>, then <kbd>m</kbd>",
      steps: [{ type: "retro", nodes: ["@best mattress for back pain", "@The 6 Best Mattresses", "@r/Mattress: worth it?"], to: "tangent" },
              { type: "main" }] },
  ] },
  { title: "5. A tangent inside a tangent, and stepping back one level", frames: [
    { say: "Side question: caffeine. Tangent, search, read.", keys: "<kbd>t</kbd>",
      steps: [{ type: "tangent" }, "q:caffeine half life", "p:examine.com|Caffeine"] },
    { say: "From there, coffee brewing: another tangent, this time <i>of the caffeine tangent</i>. It takes the next lane.",
      keys: "<kbd>t</kbd>", steps: [{ type: "tangent" }, "q:best way to brew coffee", "p:youtube.com|James Hoffmann: Ultimate V60"] },
    { say: "You've gone deep. The <b>drift alarm</b> offers the way back (limits are set in ⚙).",
      steps: ["p:jameshoffmann.co.uk|Recipes"], drift: true },
    { say: "Step back <b>one level</b>: the coffee tangent closes and you're on caffeine again, not all the way back at main.",
      keys: "<kbd>u</kbd>", steps: [{ type: "up" }] },
    { say: "Done with caffeine too. All the way back to main.", keys: "<kbd>m</kbd>", steps: [{ type: "main" }] },
  ] },
  { title: "6. It belongs under another tangent", frames: [
    { say: "A tangent on melatonin.", keys: "<kbd>t</kbd>",
      steps: [{ type: "tangent", label: "melatonin" }, "q:melatonin dosage", "p:healthline.com|Melatonin dosage guide"] },
    { say: "Back on main, you search a follow-up… which really belongs with melatonin.", keys: "<kbd>m</kbd>",
      steps: [{ type: "main" }, "q:melatonin side effects"] },
    { say: "Select it, press <kbd>p</kbd> (<i>tangent of…</i>) and type the melatonin branch's label. It moves under that tangent.",
      keys: "<kbd>v</kbd>, <kbd>p</kbd>, then the label, then <kbd>m</kbd>",
      steps: [{ type: "retro", nodes: ["@melatonin side effects"], to: "tangent", parent: "#melatonin" }, { type: "main" }] },
  ] },
  { title: "7. A new topic (and changing your mind)", frames: [
    { say: "Start a <b>new topic</b>. Until you search, it's just a dashed placeholder.", keys: "<kbd>n</kbd>", steps: [{ type: "newMain" }] },
    { say: "Changed your mind? Back to main: the empty topic disappears, nothing left behind.", keys: "<kbd>m</kbd>",
      steps: [{ type: "main" }] },
    { say: "Later, for real: new topic, then search. Now it's a second main line, marked <b>new topic</b>. Jump between branches with <kbd>f</kbd> or <kbd>/</kbd>; name one with <kbd>r</kbd>.",
      keys: "<kbd>n</kbd>", steps: [{ type: "newMain" }, "q:how to learn touch typing", "p:keybr.com|Typing practice"] },
  ] },
];

// --- events up to a frame -----------------------------------------------------------------
/** Every frame, in order, flattened: [sceneIndex, frameIndex]. */
const ORDER = SCENES.flatMap((s, i) => s.frames.map((_, j) => [i, j] as const));

function treeAt(scene: number, frame: number): Tree {
  const upto = ORDER.findIndex(([i, j]) => i === scene && j === frame);
  const events: TopicEvent[] = [];
  const byTitle = new Map<string, string>();
  const byLabel = new Map<string, string>();
  let seq = 0;
  for (const [i, j] of ORDER.slice(0, upto + 1)) {
    for (const s of SCENES[i].frames[j].steps) {
      seq++;
      const base = { id: `g${seq}`, session: "guide", seq, ts: seq * 60000, source: "browser" as const };
      if (typeof s !== "string") {
        const { label, ...action } = s;
        if (label) byLabel.set(label, `b-tan-${base.id}`);
        const a: Action = action.type === "renameBranch" && action.branch.startsWith("#")
          ? { ...action, branch: byLabel.get(action.branch.slice(1)) ?? action.branch }
          : action.type === "retro"
          ? { ...action, nodes: action.nodes.map(n => byTitle.get(n.slice(1)) ?? n),
              ...(action.parent && { parent: byLabel.get(action.parent.slice(1)) ?? action.parent }) }
          : action;
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

/** Node -> branch in the frame before, to spot nodes that are new *or moved* in this one. */
function previousNodes(scene: number, frame: number): Map<string, string> {
  const at = ORDER.findIndex(([i, j]) => i === scene && j === frame);
  if (at <= 0) return new Map();
  const [i, j] = ORDER[at - 1];
  return new Map(Object.values(treeAt(i, j).nodes).map(n => [n.id, n.branch]));
}

// --- draw a panel ----------------------------------------------------------------------------
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
function branchTitle(t: Tree, id: string): string {
  const b = t.branches[id];
  const first = b?.nodes[0] ? t.nodes[b.nodes[0]].title : "";
  if (b?.name) return b.name;
  return b?.kind === "tangent" ? `tangent: ${first}` : first;
}

function panel(t: Tree, frame: Frame, previous: Map<string, string>): HTMLElement {
  // keep open every branch something just landed in, so the change is visible
  const changed = new Set(Object.values(t.nodes).filter(n => previous.get(n.id) !== n.branch).map(n => n.id));
  const open = new Set<string>();
  for (const id of changed)
    for (let b = t.branches[t.nodes[id].branch]; b; b = b.parentBranch ? t.branches[b.parentBranch] : undefined!) {
      open.add(b.id);
      if (!b.parentBranch) break;
    }
  const v = buildView(t, defaultCollapsed(t, open));
  const box = el("div", "mock");
  const cur = t.branches[t.current];
  let main = cur;
  while (main.kind === "tangent" && main.parentBranch) main = t.branches[main.parentBranch];
  const head = el("div", "mock-head");
  head.append(el("span", "rec"), el("strong", "", main.name ?? (main.nodes[0] ? t.nodes[main.nodes[0]].title : "New topic")));
  if (cur.kind === "tangent") head.append(el("span", "sub", `› ${cur.nodes.length ? branchTitle(t, cur.id) : "new tangent"}`));
  box.append(head);
  if (frame.drift) box.append(el("div", "mock-drift", `5 steps · 22 min into this tangent. Back to ${branchTitle(t, main.id)}?   [Return (m)]  [Keep going]`));

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
    if (r.kind === "pending") {
      if (r.forkRow !== undefined) {
        const [fx, fy] = [X0 + (r.forkLane ?? 0) * LANE, r.forkRow * ROW + ROW / 2];
        g.append(svgEl("path", { d: edgePath(fx, fy, x, y, "fork", ROW), stroke: r.colour, "stroke-width": 2, fill: "none",
                                 "stroke-dasharray": "3 3", opacity: 0.7 }));
      }
      g.append(svgEl("circle", { cx: x, cy: y, r: 5, fill: "#151515", stroke: r.colour, "stroke-width": 2, "stroke-dasharray": "3 2" }));
      if (r.branchKind === "main") row.append(el("span", "topic", "new topic"));
      const label = el("span", "pending", r.branchKind === "main" ? "your next search goes here" : "Tangent started: your next page goes here");
      label.style.color = r.colour;
      row.append(label);
      row.classList.add("new", "here");
    } else if (r.kind === "chip") {
      g.append(svgEl("circle", { cx: x, cy: y, r: 3.5, fill: "#151515", stroke: r.colour, "stroke-width": 1.5, "stroke-dasharray": "2 2" }));
      const label = el("span", "chip", `↳ ${branchTitle(t, r.branch)}`);
      label.style.color = r.colour;
      row.append(label, el("span", "dim", ` ${r.count}`));
    } else {
      const n = t.nodes[r.node];
      if (r.node === headNode) g.append(svgEl("circle", { cx: x, cy: y, r: 8, fill: r.colour, opacity: 0.18 }));
      g.append(n.kind === "search"
        ? svgEl("circle", { cx: x, cy: y, r: 4.5, fill: "#151515", stroke: r.colour, "stroke-width": 2 })
        : svgEl("circle", { cx: x, cy: y, r: 4.5, fill: r.colour }));
      const b = Object.values(t.branches).find(b => b.nodes[0] === r.node);
      if (b?.name) {
        const tag = el("span", "tag", b.name);
        tag.style.background = r.colour;
        row.append(tag);
      } else if (b && b.kind === "main" && t.mains.indexOf(b.id) > 0) row.append(el("span", "topic", "new topic"));
      row.append(el("span", "", n.kind === "search" ? `“${n.title}”` : n.title));
      if (n.pages.length > 1) row.append(el("span", "dim", ` ×${n.pages.length}`));
      if (n.site) row.append(el("span", "dim", ` ${n.site}`));
      if (changed.has(r.node)) row.classList.add("new");
      if (r.node === headNode) row.classList.add("here");
    }
    graph.append(row);
  });
  graph.prepend(g);
  box.append(graph);
  return box;
}

// --- the stepper -------------------------------------------------------------------------------
function scene(si: number): HTMLElement {
  const s = SCENES[si];
  const card = el("section", "scene");
  card.tabIndex = 0;
  card.setAttribute("aria-label", `${s.title}: use the arrows or left/right keys to step through`);
  const text = el("div", "scene-text");
  const stage = el("div", "scene-stage");
  let fi = 0;

  const show = () => {
    const f = s.frames[fi];
    const say = el("p", "say");
    say.innerHTML = f.say;
    const keys = el("p", "keys");
    keys.innerHTML = f.keys ? `Press: ${f.keys}` : "No keys: just browse.";
    text.replaceChildren(el("h3", "", s.title), say, keys);

    const prev = el("button", "nav", "‹");
    prev.setAttribute("aria-label", "Previous step");
    prev.disabled = fi === 0;
    prev.onclick = () => { fi--; show(); };
    const next = el("button", "nav", "›");
    next.setAttribute("aria-label", "Next step");
    next.disabled = fi === s.frames.length - 1;
    next.onclick = () => { fi++; show(); };
    const dots = el("span", "dots");
    s.frames.forEach((_, k) => {
      const d = el("button", `dot ${k === fi ? "on" : ""}`);
      d.setAttribute("aria-label", `Step ${k + 1}`);
      d.onclick = () => { fi = k; show(); };
      dots.append(d);
    });
    const controls = el("div", "controls");
    controls.append(prev, dots, el("span", "step", `${fi + 1} / ${s.frames.length}`), next);
    stage.replaceChildren(panel(treeAt(si, fi), f, previousNodes(si, fi)), controls);
  };
  card.addEventListener("keydown", e => {
    if (e.key === "ArrowRight" && fi < s.frames.length - 1) { fi++; show(); e.preventDefault(); }
    if (e.key === "ArrowLeft" && fi > 0) { fi--; show(); e.preventDefault(); }
  });
  show();
  card.append(text, stage);
  return card;
}

const root = document.getElementById("example");
if (root) SCENES.forEach((_, i) => root.append(scene(i)));
