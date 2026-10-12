/**
 * History manager: past sessions grouped by day, searchable, multi-select delete.
 * Opened in a tab from the panel's Sessions dialog. Outside the extension (history.html
 * served for design work) it runs on sample data.
 */
import type { Msg, SessionInfo } from "./shared";

const inExtension = !!globalThis.chrome?.runtime?.id;
let sessions: SessionInfo[] = [];
let active = new Set<string>();          // sessions open in some window right now
const selected = new Set<string>();
let cursor = 0;
let query = "";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function load() {
  if (inExtension) {
    const r = await chrome.runtime.sendMessage({ t: "history" } satisfies Msg) as { sessions: SessionInfo[]; active: string[] };
    sessions = r.sessions;
    active = new Set(r.active);
  } else {
    const day = 864e5, now = Date.now();
    sessions = [
      { id: "a", started: now - 2 * 36e5, title: "consciousness", nodes: 12 },
      { id: "b", started: now - 5 * 36e5, title: "chrome web store developer", nodes: 7 },
      { id: "c", started: now - day - 3e6, title: "n8n webhooks", nodes: 14 },
      { id: "d", started: now - 3 * day, title: "how to sleep better", nodes: 9 },
      { id: "e", started: now - 3 * day - 7e6, title: "Untitled session", nodes: 0 },
    ];
    active = new Set(["a"]);
  }
  sessions.sort((x, y) => y.started - x.started);
  render();
}

function dayLabel(ts: number): string {
  const d = new Date(ts), today = new Date();
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(today) - start(d)) / 864e5);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

const shown = () => sessions.filter(s => s.title.toLowerCase().includes(query.toLowerCase()));

function render() {
  const list = $("list");
  const items = shown();
  cursor = Math.max(0, Math.min(cursor, items.length - 1));
  list.replaceChildren();
  if (!items.length) {
    list.append(Object.assign(document.createElement("div"), { className: "empty",
      textContent: sessions.length ? "No sessions match." : "No sessions yet." }));
  }
  let lastDay = "";
  items.forEach((s, i) => {
    const day = dayLabel(s.started);
    if (day !== lastDay) { list.append(Object.assign(document.createElement("h2"), { textContent: day })); lastDay = day; }
    const row = document.createElement("div");
    row.className = `item ${i === cursor ? "cursor" : ""}`;
    const box = Object.assign(document.createElement("input"), { type: "checkbox", checked: selected.has(s.id) });
    box.setAttribute("aria-label", `Select ${s.title}`);
    box.addEventListener("change", () => { toggle(s.id, box.checked); });
    const title = Object.assign(document.createElement("span"), { className: "title", textContent: s.title });
    const meta = Object.assign(document.createElement("span"), { className: "meta",
      textContent: `${s.nodes} node${s.nodes === 1 ? "" : "s"} · ${new Date(s.started).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` });
    const acts = Object.assign(document.createElement("span"), { className: "acts" });
    const open = Object.assign(document.createElement("button"), { textContent: "Open" });
    open.addEventListener("click", e => { e.stopPropagation(); void openSession(s.id); });
    const del = Object.assign(document.createElement("button"), { textContent: "Delete" });
    del.addEventListener("click", e => { e.stopPropagation(); confirmDelete([s.id]); });
    acts.append(open, del);
    row.append(box, title);
    if (active.has(s.id)) row.append(Object.assign(document.createElement("span"), { className: "now", textContent: "open now" }));
    row.append(meta, acts);
    row.addEventListener("click", () => { cursor = i; render(); });
    row.addEventListener("dblclick", () => void openSession(s.id));
    list.append(row);
  });
  const visibleSelected = items.filter(s => selected.has(s.id)).length;
  const all = $<HTMLInputElement>("all");
  all.checked = !!items.length && visibleSelected === items.length;
  all.indeterminate = visibleSelected > 0 && visibleSelected < items.length;
  $("count").textContent = selected.size ? `${selected.size} selected` : `${items.length} session${items.length === 1 ? "" : "s"}`;
  $<HTMLButtonElement>("del").disabled = !selected.size;
  document.querySelector(".item.cursor")?.scrollIntoView({ block: "nearest" });
}

function toggle(id: string, on = !selected.has(id)) {
  if (on) selected.add(id); else selected.delete(id);
  render();
}

async function openSession(id: string) {
  if (!inExtension) return toast("Opened (preview).");
  const win = await chrome.windows.getCurrent();
  await chrome.runtime.sendMessage({ t: "resume", windowId: win.id, session: id } satisfies Msg);
  active.add(id);
  render();
  toast("Opened in this window's tree.");
}

function confirmDelete(ids: string[]) {
  if (!ids.length) return;
  const names = ids.map(id => sessions.find(s => s.id === id)?.title ?? id);
  const openNow = ids.filter(id => active.has(id)).length;
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `<div class="dialog" role="alertdialog">
    <h3>Delete ${ids.length === 1 ? `“${escapeHtml(names[0])}”` : `${ids.length} sessions`}?</h3>
    <p>This removes ${ids.length === 1 ? "it" : "them"} from Topic Tree and deletes the saved files on this computer. This can't be undone.${
      openNow ? ` ${openNow === 1 ? "A window is" : "Windows are"} using ${ids.length === 1 ? "it" : "one of them"} right now and will start a fresh session.` : ""}</p>
    <div class="actions"><button id="no">Cancel</button><button class="danger" id="yes">Delete</button></div></div>`;
  document.body.append(overlay);
  const close = () => { overlay.remove(); document.removeEventListener("keydown", keys, true); };
  const yes = async () => {
    close();
    if (inExtension) await chrome.runtime.sendMessage({ t: "deleteSessions", ids } satisfies Msg);
    sessions = sessions.filter(s => !ids.includes(s.id));
    for (const id of ids) { selected.delete(id); active.delete(id); }
    render();
    toast(`Deleted ${ids.length} session${ids.length === 1 ? "" : "s"}.`);
  };
  const keys = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Escape") close();
    if (e.key === "Enter") { e.preventDefault(); void yes(); }
  };
  document.addEventListener("keydown", keys, true);
  overlay.querySelector<HTMLButtonElement>("#no")!.onclick = close;
  overlay.querySelector<HTMLButtonElement>("#yes")!.onclick = () => void yes();
  overlay.addEventListener("click", e => { if (e.target === overlay) close(); });
  overlay.querySelector<HTMLButtonElement>("#yes")!.focus();
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
function toast(text: string) {
  document.querySelector(".toast")?.remove();
  const t = Object.assign(document.createElement("div"), { className: "toast", textContent: text });
  document.body.append(t);
  setTimeout(() => t.remove(), 2200);
}

$("q").addEventListener("input", e => { query = (e.target as HTMLInputElement).value; cursor = 0; render(); });
$("all").addEventListener("change", e => {
  const on = (e.target as HTMLInputElement).checked;
  for (const s of shown()) if (on) selected.add(s.id); else selected.delete(s.id);
  render();
});
$("del").addEventListener("click", () => confirmDelete([...selected]));
document.addEventListener("keydown", e => {
  const typing = (e.target as HTMLElement).tagName === "INPUT" && (e.target as HTMLInputElement).type === "search";
  if (typing) { if (e.key === "Escape" || e.key === "Enter") (e.target as HTMLElement).blur(); return; }
  const items = shown();
  if (e.key === "/") { e.preventDefault(); $("q").focus(); }
  else if (e.key === "j" || e.key === "ArrowDown") { cursor++; render(); }
  else if (e.key === "k" || e.key === "ArrowUp") { cursor = Math.max(0, cursor - 1); render(); }
  else if (e.key === "x" || e.key === " ") { e.preventDefault(); if (items[cursor]) toggle(items[cursor].id); }
  else if (e.key === "Enter" && items[cursor]) void openSession(items[cursor].id);
  else if (e.key === "Delete" || e.key === "Backspace") confirmDelete(selected.size ? [...selected] : items[cursor] ? [items[cursor].id] : []);
});

void load();
