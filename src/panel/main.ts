/**
 * The Topic Tree panel: docked (side panel), floating (iframe in the page) or preview.
 * Keyboard-first (Vim-style modes), every action also reachable by mouse.
 */
import type { Action } from "../core/events";
import type { Tree, TreeNode } from "../core/tree";
import type { Msg, Snapshot } from "../shared";
import { extensionBridge, previewBridge, type Bridge } from "./bridge";
import { buildView, defaultCollapsed, edgePath, fuzzy, hintLabels, type DisplayRow, type View } from "./view";

const ROW = 26, LANE = 16, X0 = 12;
const params = new URLSearchParams(location.search);
const bridge: Bridge = !globalThis.chrome?.runtime?.id ? previewBridge()
  : extensionBridge(params.get("mode") === "float" ? "float" : "docked");

type Mode = "normal" | "visual" | "hints" | "find" | "renameBranch" | "renameNode"
          | "confirm" | "settings" | "sessions" | "help";

const ui = {
  snap: null as Snapshot | null,
  view: null as View | null,
  mode: "normal" as Mode,
  zoom: "nodes" as "nodes" | "branches",
  cursor: -1,
  cursorKey: "",
  stick: true,
  anchor: -1,
  expanded: new Set<string>(),
  collapsed: new Set<string>(),
  hints: new Map<string, string>(),   // label -> branch
  hintFor: "goto" as "goto" | "parent", // f jumps; v … p picks the parent of a new tangent
  pickNodes: [] as string[],          // the selected run waiting for its parent
  hintBuf: "",
  find: { q: "", sel: 0, results: [] as Array<{ kind: "branch" | "node"; id: string; text: string }> },
  listSel: 0,
  msg: "",
  err: false,
  dismissed: new Set<string>(),
};

// --- tiny DOM helper ------------------------------------------------------------------
type Child = Node | string | null | undefined | false;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, unknown> = {}, ...kids: Child[]) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v as EventListener);
    else if (k === "class") el.className = String(v);
    else if (k === "style") el.setAttribute("style", String(v));
    else (el as any)[k] = v;
  }
  for (const c of kids) if (c) el.append(c);
  return el;
}
const svg = (tag: string, attrs: Record<string, string | number>) => {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
};

// --- naming -----------------------------------------------------------------------------
const tree = (): Tree => ui.snap!.tree;
const nodeLabel = (n: TreeNode) => n.name ?? n.title;
function branchLabel(id: string): string {
  const t = tree(), b = t.branches[id];
  if (b.name) return b.name;
  const first = b.nodes[0] ? t.nodes[b.nodes[0]] : undefined;
  const base = first ? nodeLabel(first) : "empty";
  return b.kind === "tangent" ? `tangent: ${base}` : base;
}
function mainName(): string {
  const t = tree();
  let b = t.branches[t.current];
  while (b.kind === "tangent" && b.parentBranch) b = t.branches[b.parentBranch];
  return b.name ?? (b.nodes[0] ? nodeLabel(t.nodes[b.nodes[0]]) : t.mains.length > 1 ? "New topic" : "New session");
}

// --- actions ------------------------------------------------------------------------------
const DONE: Partial<Record<Action["type"], string>> = {
  tangent: "Tangent started: your next page goes on it.",
  newMain: "New topic started: your next search goes on it (m to go back).",
  main: "Back on the main branch.",
  up: "Up one level.",
};
const act = (action: Action) => {
  ui.stick = true;
  void bridge.send({ t: "action", action }).then(() => { const m = DONE[action.type]; if (m) say(m); });
};
const rowKey = (r: DisplayRow) => r.kind === "node" ? r.node : `${r.kind}:${r.branch}`;
const send = (m: Msg) => void bridge.send(m);
function say(text: string, err = false) { ui.msg = text; ui.err = err; renderFooter(); }

function rowAt(i = ui.cursor): DisplayRow | undefined { return ui.view?.rows[i]; }
function cursorNode(): TreeNode | undefined {
  const r = rowAt();
  return r?.kind === "node" ? tree().nodes[r.node] : undefined;
}
function cursorBranch(): string | undefined {
  const r = rowAt();
  return r ? r.branch : tree().current;
}
function goBranch(id: string) {
  ui.expanded.add(id);
  ui.collapsed.delete(id);
  act({ type: "goto", branch: id });
}
function back() {
  const prev = tree().history.at(-1);
  if (prev) goBranch(prev); else say("No previous branch yet.");
}

// --- render -------------------------------------------------------------------------------
const app = document.getElementById("app")!;

function render() {
  if (!ui.snap) return;
  const t = tree();
  const collapsed = new Set([...defaultCollapsed(t, ui.expanded), ...ui.collapsed].filter(b => !ui.expanded.has(b)));
  ui.view = buildView(t, collapsed);
  placeCursor();
  app.replaceChildren(header(), welcome() ?? "", driftBanner() ?? "", body(), footerEl(), overlay() ?? "");
  renderFooter();
  scrollCursorIntoView();
}

function placeCursor() {
  const rows = ui.view!.rows;
  const key = rowKey;
  if (ui.stick || ui.cursor < 0) {
    // follow the newest node of the current branch
    const cur = tree().branches[tree().current].nodes.at(-1);
    const i = cur ? rows.findIndex(r => r.kind === "node" && r.node === cur) : -1;
    ui.cursor = i >= 0 ? i : rows.length - 1;
  } else {
    const i = rows.findIndex(r => key(r) === ui.cursorKey);
    ui.cursor = i >= 0 ? i : Math.min(ui.cursor, rows.length - 1);
  }
  ui.cursorKey = rows[ui.cursor] ? key(rows[ui.cursor]) : "";
}

function header() {
  const s = ui.snap!;
  const t = tree();
  const inTangent = t.branches[t.current].kind === "tangent";
  const ctl = (label: string, title: string, on: () => void, cls = "") =>
    h("button", { class: `ctl ${cls}`, title, "aria-label": title, onclick: on }, label);
  const placeBtn = bridge.mode === "float"
    ? ctl("□", "Dock to the side (maximize)", () => { bridge.dock(); send({ t: "place", panel: "docked" }); })
    : ctl("❐", "Float as a card (restore down)", () => void floatCard());
  return h("header", {},
    h("div", { class: "title", title: s.hostOk ? "Recording · saved to disk" : "Recording · disk mirror not connected" },
      h("span", { class: `rec ${s.state.recording ? "" : "off"}` }),
      h("strong", {}, mainName()),
      inTangent && h("span", { class: "sub" },
        `› ${branchLabel(t.current)}`)),
    ctl("?", "Guide and keys", () => bridge.openGuide()),
    ctl("☰", "Sessions", () => openMode("sessions")),
    ctl("⚙", "Settings", () => openMode("settings")),
    ctl("−", "Hide (keeps recording)", () => { send({ t: "place", panel: "hidden" }); bridge.closeSelf(); }),
    placeBtn,
    ctl("✕", "Stop recording this session", () => openMode("confirm"), "close"));
}

/** First run only: point at the guide until dismissed. */
function welcome() {
  if (localStorage.getItem("tt-welcomed")) return null;
  const done = () => { localStorage.setItem("tt-welcomed", "1"); render(); };
  return h("div", { class: "drift welcome" },
    h("span", { innerHTML: "New here? Browse as usual. Press <kbd>t</kbd> when you go off on a side question, <kbd>m</kbd> to come back." }),
    h("button", { onclick: () => { bridge.openGuide(); done(); } }, "Guide"),
    h("button", { onclick: done }, "Got it"));
}

function driftBanner() {
  const d = ui.snap!.drift, t = tree();
  if (!d?.alert || ui.dismissed.has(t.current)) return null;
  const mins = Math.round(d.minutes);
  return h("div", { class: "drift", role: "status" },
    h("span", {}, `${d.nodes} steps${mins ? ` · ${mins} min` : ""} into this tangent. Back to ${mainName()}?`),
    h("button", { onclick: () => act({ type: "main" }) }, "Return (m)"),
    h("button", { onclick: () => { ui.dismissed.add(t.current); send({ t: "dismissDrift" }); render(); } }, "Keep going"));
}

function body() {
  const scroll = h("div", { class: "scroll", id: "scroll" });
  if (ui.zoom === "branches") { scroll.append(branchList()); return scroll; }
  const v = ui.view!;
  if (!v.rows.length) {
    scroll.append(h("div", { class: "empty", innerHTML:
      "Your line of thought appears here as you search and read.<br><br>" +
      "<kbd>t</kbd> start a tangent &nbsp; <kbd>m</kbd> back to main &nbsp; <kbd>M</kbd> new topic<br>" +
      "<kbd>?</kbd> all keys" }));
    return scroll;
  }
  const lanes = Math.max(v.layout.lanes, ...v.rows.map(r => r.lane + 1));
  const gutter = X0 + lanes * LANE;
  const graph = h("div", { class: "graph" });
  const g = svg("svg", { width: gutter, height: v.rows.length * ROW });
  const xy = (row: number, lane: number) => [X0 + lane * LANE, v.yOf(row) * ROW + ROW / 2];
  for (const e of v.edges) {
    const [x1, y1] = xy(...e.from), [x2, y2] = xy(...e.to);
    const d = edgePath(x1, y1, x2, y2, e.kind, ROW);
    g.append(svg("path", { d, stroke: e.colour, "stroke-width": 2, fill: "none", opacity: e.kind === "merge" ? 0.55 : 1,
                           "stroke-dasharray": e.kind === "merge" ? "3 3" : "" }));
  }
  const t = tree();
  const head = t.branches[t.current].nodes.at(-1);
  const firstOf = new Map<string, string>();
  for (const b of Object.values(t.branches)) if (b.nodes[0]) firstOf.set(b.nodes[0], b.id);
  const labels = ui.mode === "hints" ? [...ui.hints].reduce((m, [l, b]) => m.set(b, l), new Map<string, string>()) : null;
  const sel = selection();

  v.rows.forEach((r, i) => {
    const [x, y] = [X0 + r.lane * LANE, i * ROW + ROW / 2];
    let row: HTMLElement;
    if (r.kind === "pending") {
      if (r.forkRow !== undefined) {
        const [fx, fy] = [X0 + (r.forkLane ?? 0) * LANE, r.forkRow * ROW + ROW / 2];
        g.append(svg("path", { d: edgePath(fx, fy, x, y, "fork", ROW), stroke: r.colour, "stroke-width": 2, fill: "none",
                               "stroke-dasharray": "3 3", opacity: 0.7 }));
      }
      g.append(svg("circle", { cx: x, cy: y, r: 5, fill: "var(--bg)", stroke: r.colour, "stroke-width": 2, "stroke-dasharray": "3 2" }));
      row = h("div", { class: `row pending ${r.branchKind}`, style: `padding-left:${gutter}px` },
        r.branchKind === "main" && h("span", { class: "topic" }, "new topic"),
        h("span", { class: "label", style: `color:${r.colour}` },
          r.branchKind === "main" ? "your next search goes here · m to go back" : "Tangent started: your next page goes here"));
    } else if (r.kind === "chip") {
      g.append(svg("circle", { cx: x, cy: y, r: 3.5, fill: "var(--bg)", stroke: r.colour, "stroke-width": 1.5,
                               "stroke-dasharray": "2 2" }));
      row = h("div", { class: "row chip", style: `padding-left:${gutter}px` },
        labels?.get(r.branch) && h("span", { class: "hint" }, labels.get(r.branch)!),
        h("span", { class: "label", style: `color:${r.colour}` }, branchLabel(r.branch)),
        h("span", { class: "count" }, `${r.count}`));
      row.addEventListener("click", () => { ui.expanded.add(r.branch); ui.collapsed.delete(r.branch); render(); });
    } else {
      const n = t.nodes[r.node];
      const isHead = r.node === head;
      if (isHead) g.append(svg("circle", { cx: x, cy: y, r: 8, fill: r.colour, opacity: 0.18 }));
      g.append(n.kind === "search"
        ? svg("circle", { cx: x, cy: y, r: 4.5, fill: "var(--bg)", stroke: r.colour, "stroke-width": 2 })
        : svg("circle", { cx: x, cy: y, r: 4.5, fill: r.colour }));
      const startsBranch = firstOf.get(r.node);
      const b = startsBranch ? t.branches[startsBranch] : undefined;
      row = h("div", { class: `row ${sel.has(i) ? "sel" : ""}`, style: `padding-left:${gutter}px`,
                       title: [n.title, ...n.pages.map(p => p.url)].join("\n") },
        labels?.get(r.branch) && b && h("span", { class: "hint" }, labels.get(r.branch)!),
        b?.name && h("span", { class: "tag", style: `background:${r.colour}` }, b.name),
        b && !b.name && b.kind === "main" && t.mains.indexOf(b.id) > 0 && h("span", { class: "topic" }, "new topic"),
        h("span", { class: `label ${n.name ? "named" : ""}` }, n.kind === "search" ? `“${nodeLabel(n)}”` : nodeLabel(n)),
        n.pages.length > 1 && h("span", { class: "count" }, `×${n.pages.length}`),
        n.site && h("span", { class: "site" }, n.site));
      row.addEventListener("dblclick", () => openNode(n));
    }
    row.addEventListener("click", e => {
      if ((e as MouseEvent).shiftKey && r.kind === "node") { ui.anchor = ui.anchor < 0 ? ui.cursor : ui.anchor; ui.mode = "visual"; }
      ui.stick = false;
      ui.cursor = i;
      ui.cursorKey = rowKey(r);
      render();
    });
    if (i === ui.cursor) row.classList.add("cursor");
    graph.append(row);
  });
  graph.prepend(g);
  scroll.append(graph);
  return scroll;
}

function branchTreeOrder(): Array<{ id: string; depth: number }> {
  const t = tree();
  const out: Array<{ id: string; depth: number }> = [];
  const walk = (id: string, depth: number) => {
    out.push({ id, depth });
    for (const b of Object.values(t.branches).filter(b => b.parentBranch === id).sort((a, b) => a.createdTs - b.createdTs))
      walk(b.id, depth + 1);
  };
  for (const m of t.mains) walk(m, 0);
  return out;
}

function branchList() {
  const t = tree();
  const colours = new Map(ui.view!.layout.branches.map(b => [b.branch, b.colour]));
  const list = branchTreeOrder();
  ui.listSel = Math.max(0, Math.min(ui.listSel, list.length - 1));
  const labels = ui.mode === "hints" ? [...ui.hints].reduce((m, [l, b]) => m.set(b, l), new Map<string, string>()) : null;
  return h("div", { class: "graph blist" }, ...list.map(({ id, depth }, i) => {
    const b = t.branches[id];
    const row = h("div", { class: `row ${i === ui.listSel ? "cursor" : ""}`, style: `padding-left:${12 + depth * 18}px` },
      labels?.get(id) && h("span", { class: "hint" }, labels.get(id)!),
      h("span", { class: "swatch", style: `background:${colours.get(id) ?? "#555"}` }),
      h("span", { class: `label ${id === t.current ? "named" : ""}` }, branchLabel(id)),
      h("span", { class: "count" }, `${b.nodes.length}`));
    row.addEventListener("click", () => { ui.listSel = i; render(); });
    row.addEventListener("dblclick", () => goBranch(id));
    return row;
  }));
}

function footerEl() { return h("footer", { id: "footer" }); }
function renderFooter() {
  const f = document.getElementById("footer");
  if (!f) return;
  if (ui.mode === "find" || ui.mode === "renameBranch" || ui.mode === "renameNode") {
    if (f.querySelector("input")) return; // keep the field (and its focus) while typing
    const isFind = ui.mode === "find";
    const input = h("input", {
      value: isFind ? ui.find.q : ui.mode === "renameBranch" ? (tree().branches[cursorBranch()!]?.name ?? "") : (cursorNode()?.name ?? ""),
      placeholder: isFind ? "Find a branch or node…" : ui.mode === "renameBranch" ? "Branch name" : "Node name",
      oninput: (e: Event) => { if (isFind) { ui.find.q = (e.target as HTMLInputElement).value; ui.find.sel = 0; runFind(); } },
      onkeydown: (e: KeyboardEvent) => inputKey(e, input as HTMLInputElement),
    }) as HTMLInputElement;
    f.replaceChildren(h("span", {}, isFind ? "/" : "name:"), input);
    input.focus();
    input.select();
    if (isFind) runFind();
    return;
  }
  document.querySelector(".results")?.remove();
  const modeText: Partial<Record<Mode, string>> = {
    visual: "<b>VISUAL</b> j/k extend · <kbd>t</kbd> tangent · <kbd>p</kbd> tangent of… · <kbd>m</kbd> back to main · <kbd>n</kbd> new topic · <kbd>Esc</kbd>",
    hints: "Type the label of a branch · <kbd>Esc</kbd>",
  };
  f.replaceChildren(h("span", {
    class: `msg ${ui.err ? "err" : ""}`,
    innerHTML: ui.msg ? escapeHtml(ui.msg) : modeText[ui.mode]
      ?? "<kbd>t</kbd> tangent · <kbd>u</kbd> up · <kbd>m</kbd> main · <kbd>n</kbd> new topic · <kbd>f</kbd> jump · <kbd>?</kbd> keys",
  }));
}
const escapeHtml = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

function overlay() {
  const s = ui.snap!;
  const close = () => { ui.mode = "normal"; render(); };
  const wrap = (dialog: HTMLElement) => {
    const o = h("div", { class: "overlay" }, dialog);
    o.addEventListener("click", e => { if (e.target === o) close(); });
    return o;
  };
  if (ui.mode === "confirm") return wrap(h("div", { class: "dialog", role: "alertdialog" },
    h("h3", {}, "Stop recording this session?"),
    h("p", {}, "The tree so far is kept, and you can resume it later. Click the extension icon to record again."),
    h("div", { class: "actions" },
      h("button", { class: "btn", onclick: close }, "Cancel"),
      h("button", { class: "btn primary", onclick: stop, autofocus: true }, "Stop recording"))));
  if (ui.mode === "settings") {
    const nodes = h("input", { type: "number", min: 1, value: s.settings.driftNodes }) as HTMLInputElement;
    const mins = h("input", { type: "number", min: 1, value: s.settings.driftMinutes }) as HTMLInputElement;
    const save = () => { send({ t: "settings", settings: { driftNodes: +nodes.value || 8, driftMinutes: +mins.value || 15 } }); close(); };
    return wrap(h("div", { class: "dialog", onkeydown: (e: KeyboardEvent) => { if (e.key === "Enter") save(); } },
      h("h3", {}, "Settings"),
      h("p", {}, "The drift alarm fires when a tangent reaches either limit."),
      h("label", {}, "Steps on a tangent", nodes),
      h("label", {}, "Minutes on a tangent", mins),
      h("p", { style: "margin-top:12px" }, s.hostOk ? "Saving to disk: connected." : "Saving to disk: not connected (run native-host/install-host.ps1)."),
      h("div", { class: "actions" }, h("button", { class: "btn", onclick: close }, "Cancel"),
        h("button", { class: "btn primary blue", onclick: save }, "Save"))));
  }
  if (ui.mode === "sessions") {
    ui.listSel = Math.max(0, Math.min(ui.listSel, s.sessions.length - 1));
    return wrap(h("div", { class: "dialog", style: "width:min(340px,92%)" },
      h("h3", {}, "Sessions"),
      h("p", {}, "Resume an earlier tree in this window."),
      h("div", { class: "list" }, ...s.sessions.map((x, i) => h("div", {
        class: `item ${i === ui.listSel ? "on" : ""}`,
        onclick: () => resume(x.id),
      }, h("span", {}, x.id === s.state.session ? `● ${x.title}` : x.title),
         h("span", { class: "meta" }, `${x.nodes} · ${new Date(x.started).toLocaleDateString()}`)))),
      h("div", { class: "actions" }, h("button", { class: "btn", onclick: close }, "Close"),
        h("button", { class: "btn primary blue", onclick: () => { send({ t: "newSession" }); close(); } }, "New session"))));
  }
  if (ui.mode === "help") {
    const k = (keys: string, what: string) => h("div", { innerHTML: `<kbd>${keys}</kbd> ${what}` });
    return wrap(h("div", { class: "dialog", style: "width:min(420px,94%)" }, h("h3", {}, "Keys"),
      h("div", { class: "help" },
        k("t", "new tangent from here"), k("u", "close tangent, up one level"), k("m", "back to main"), k("n", "new topic (main branch)"),
        k("b", "previous branch"), k("f", "jump to a branch by label"), k("/", "find branch or node"),
        k("j k", "move"), k("g G", "top / bottom"), k("h l", "collapse / expand"),
        k("r", "name branch"), k("e", "name node"), k("s", "split last page into its own node"),
        k("v", "select past nodes → t / p / m / n"), k("z", "branch view"), k("Enter", "open page"),
        k("Ctrl+Shift+Y", "from any page: then t u m n b")),
      h("div", { class: "actions", style: "margin-top:12px" },
        h("button", { class: "btn", onclick: () => bridge.openGuide() }, "Full guide"),
        h("button", { class: "btn", onclick: close }, "Close"))));
  }
  return null;
}

// --- modes ----------------------------------------------------------------------------------
function openMode(m: Mode, hintFor: "goto" | "parent" = "goto") {
  ui.mode = m;
  ui.msg = "";
  ui.hintFor = hintFor;
  if (m === "hints") {
    const branches = ui.zoom === "branches" ? branchTreeOrder().map(x => x.id)
      : [...new Set(ui.view!.rows.map(r => r.branch))];
    const labels = hintLabels(branches.length);
    ui.hints = new Map(branches.map((b, i) => [labels[i], b]));
    ui.hintBuf = "";
  }
  if (m === "find") ui.find = { q: "", sel: 0, results: [] };
  if (m === "sessions") ui.listSel = Math.max(0, ui.snap!.sessions.findIndex(s => s.id === ui.snap!.state.session));
  render();
}
async function floatCard() {
  if (!(await bridge.canFloat())) {
    return say("This page can't show a floating card (browser pages). Open a website, then try again.", true);
  }
  send({ t: "place", panel: "floating" });
  bridge.closeSelf();
}
function stop() { send({ t: "stop" }); ui.mode = "normal"; bridge.closeSelf(); render(); }
function resume(id: string) { send({ t: "resume", session: id }); ui.mode = "normal"; ui.stick = true; render(); }

function runFind() {
  const t = tree(), q = ui.find.q;
  const items = [
    ...Object.keys(t.branches).map(id => ({ kind: "branch" as const, id, text: branchLabel(id) })),
    ...Object.values(t.nodes).map(n => ({ kind: "node" as const, id: n.id, text: nodeLabel(n) })),
  ];
  ui.find.results = items.map(x => ({ x, s: fuzzy(q, x.text) })).filter(r => r.s >= 0)
    .sort((a, b) => b.s - a.s).slice(0, 12).map(r => r.x);
  document.querySelector(".results")?.remove();
  if (!ui.find.results.length) return;
  const box = h("div", { class: "results" }, ...ui.find.results.map((r, i) => h("div", {
    class: `item ${i === ui.find.sel ? "on" : ""}`, onmousedown: () => { ui.find.sel = i; pickFind(); },
  }, h("span", { class: "kind" }, r.kind), h("span", { class: "label" }, r.text))));
  app.append(box);
}
function pickFind() {
  const r = ui.find.results[ui.find.sel];
  ui.mode = "normal";
  if (!r) return render();
  const t = tree();
  const branch = r.kind === "branch" ? r.id : t.nodes[r.id].branch;
  if (r.kind === "node") { ui.stick = false; ui.cursorKey = r.id; }
  if (branch !== t.current) goBranch(branch); else render();
}

function inputKey(e: KeyboardEvent, input: HTMLInputElement) {
  e.stopPropagation();
  if (e.key === "Escape") { ui.mode = "normal"; render(); return; }
  if (ui.mode === "find" && (e.key === "ArrowDown" || e.key === "ArrowUp" || (e.ctrlKey && (e.key === "j" || e.key === "k")))) {
    e.preventDefault();
    const down = e.key === "ArrowDown" || e.key === "j";
    ui.find.sel = Math.max(0, Math.min(ui.find.results.length - 1, ui.find.sel + (down ? 1 : -1)));
    runFind();
    return;
  }
  if (e.key !== "Enter") return;
  if (ui.mode === "find") return pickFind();
  const name = input.value.trim();
  const branch = cursorBranch(), node = cursorNode();
  const which = ui.mode;
  ui.mode = "normal";
  if (name && which === "renameBranch" && branch) act({ type: "renameBranch", branch, name });
  if (name && which === "renameNode" && node) act({ type: "renameNode", node: node.id, name });
  render();
}

function selection(): Set<number> {
  if (ui.mode !== "visual" || ui.anchor < 0) return new Set();
  const [a, b] = [Math.min(ui.anchor, ui.cursor), Math.max(ui.anchor, ui.cursor)];
  return new Set(Array.from({ length: b - a + 1 }, (_, i) => a + i));
}
/** The selected rows as one continuous run of one branch's nodes, or an error message. */
function selectedRun(): { branch: string; nodes: string[] } | string {
  const rows = [...selection()].map(i => ui.view!.rows[i]).filter((r): r is Extract<DisplayRow, { kind: "node" }> => r.kind === "node");
  if (!rows.length) return "Select some nodes first.";
  const branch = rows[0].branch;
  if (rows.some(r => r.branch !== branch)) return "Select nodes from one branch only.";
  const order = tree().branches[branch].nodes;
  const idx = rows.map(r => order.indexOf(r.node)).sort((a, b) => a - b);
  if (idx.some((v, i) => v !== idx[0] + i)) return "Select a continuous run of nodes.";
  return { branch, nodes: rows.map(r => r.node) };
}

function retro(to: "tangent" | "newMain" | "main") {
  const run = selectedRun();
  ui.mode = "normal";
  ui.anchor = -1;
  if (typeof run === "string") { render(); return say(run, true); }
  if (to === "main" && tree().branches[run.branch].kind !== "tangent") return say("These are already on a main branch.", true);
  act({ type: "retro", nodes: run.nodes, to });
  say(to === "tangent" ? "Marked as a tangent." : to === "main" ? "Moved back to main." : "Marked as a new topic.");
}

/** v … p: the selected run becomes a tangent of a branch you pick by its label. */
function pickParent() {
  const run = selectedRun();
  ui.anchor = -1;
  if (typeof run === "string") { ui.mode = "normal"; render(); return say(run, true); }
  ui.pickNodes = run.nodes;
  openMode("hints", "parent");
  say("Tangent of which branch? Type its label.");
}

function openNode(n?: TreeNode) {
  const url = n?.pages.at(-1)?.url ?? n?.url;
  if (url) bridge.open(url);
}

function move(delta: number) {
  ui.stick = false;
  if (ui.zoom === "branches") { ui.listSel += delta; render(); return; }
  ui.cursor = Math.max(0, Math.min(ui.view!.rows.length - 1, ui.cursor + delta));
  const r = rowAt();
  ui.cursorKey = r ? rowKey(r) : "";
  render();
}
function scrollCursorIntoView() {
  const el = document.querySelector(".row.cursor");
  el?.scrollIntoView({ block: "nearest" });
}

// --- keyboard ---------------------------------------------------------------------------------
document.addEventListener("keydown", e => {
  if (!ui.snap || (e.target as HTMLElement).tagName === "INPUT") return;
  const k = e.key;
  if (k === "Escape") {
    if (ui.mode !== "normal") { ui.mode = "normal"; ui.anchor = -1; ui.msg = ""; render(); }
    return;
  }
  if (ui.mode === "confirm") { if (k === "Enter") stop(); return; }
  if (ui.mode === "settings" || ui.mode === "help") return;
  if (ui.mode === "sessions") {
    if (k === "j" || k === "ArrowDown") { ui.listSel++; render(); }
    if (k === "k" || k === "ArrowUp") { ui.listSel = Math.max(0, ui.listSel - 1); render(); }
    if (k === "Enter") resume(ui.snap.sessions[ui.listSel].id);
    return;
  }
  if (ui.mode === "hints") {
    if (k.length !== 1) return;
    ui.hintBuf += k;
    const hit = ui.hints.get(ui.hintBuf);
    if (hit && ui.hintFor === "parent") {
      ui.mode = "normal";
      act({ type: "retro", nodes: ui.pickNodes, to: "tangent", parent: hit });
      say(`Marked as a tangent of ${branchLabel(hit)}.`);
      return;
    }
    if (hit) { ui.mode = "normal"; goBranch(hit); return; }
    if (![...ui.hints.keys()].some(l => l.startsWith(ui.hintBuf))) { ui.mode = "normal"; say("No such label.", true); render(); }
    return;
  }
  if (ui.mode === "visual") {
    if (k === "j" || k === "ArrowDown") return move(1);
    if (k === "k" || k === "ArrowUp") return move(-1);
    if (k === "t") return retro("tangent");
    if (k === "n" || k === "M") return retro("newMain");
    if (k === "m") return retro("main");
    if (k === "p") return pickParent();
    return;
  }
  ui.msg = "";
  ui.err = false;
  switch (k) {
    case "j": case "ArrowDown": return move(1);
    case "k": case "ArrowUp": return move(-1);
    case "g": ui.stick = false; ui.cursor = 0; ui.cursorKey = ""; return render();
    case "G": ui.stick = true; return render();
    case "t": return act({ type: "tangent" });
    case "m": return act({ type: "main" });
    case "u": return act({ type: "up" });
    case "n": case "M": return act({ type: "newMain" });
    case "b": case "`": return back();
    case "o": if (e.ctrlKey) { e.preventDefault(); return back(); } return;
    case "f": return openMode("hints");
    case "/": e.preventDefault(); return openMode("find");
    case "r": return openMode("renameBranch");
    case "e": case "R": return cursorNode() ? openMode("renameNode") : say("Put the cursor on a node first.", true);
    case "s": {
      const n = cursorNode();
      if (!n || n.pages.length < 2) return say("Nothing to split: this node has one page.", true);
      return act({ type: "split", node: n.id, page: n.pages.length - 1 });
    }
    case "v": ui.anchor = ui.cursor; ui.mode = "visual"; return render();
    case "h": {
      const b = cursorBranch();
      if (b && tree().branches[b]?.kind === "tangent") { ui.expanded.delete(b); ui.collapsed.add(b); ui.stick = false; render(); }
      return;
    }
    case "l": {
      const r = rowAt();
      if (r?.kind === "chip") { ui.expanded.add(r.branch); ui.collapsed.delete(r.branch); render(); }
      return;
    }
    case "z": ui.zoom = ui.zoom === "nodes" ? "branches" : "nodes"; return render();
    case "Enter":
      if (ui.zoom === "branches") { const x = branchTreeOrder()[ui.listSel]; if (x) goBranch(x.id); return; }
      return openNode(cursorNode());
    case "?": return openMode("help");
  }
});

void bridge.start(s => { ui.snap = s; render(); });
