/**
 * Service worker: records each window's line of thought, owns the event logs, and
 * mirrors every event to disk through the native host.
 *
 * Storage: chrome.storage.local  log:<session> (events) · sessions (index) · settings · flushed:<session>
 *          chrome.storage.session win:<windowId> (per-window state; a browser restart starts fresh)
 */
import { isTrackable, parseSearch, siteOf } from "./core/capture";
import type { Action, TopicEvent } from "./core/events";
import { apply, drift, emptyTree, replay, type Tree } from "./core/tree";
import { DEFAULT_SETTINGS, LEADER_KEYS, type Broadcast, type Msg, type SessionInfo, type Settings,
         type Snapshot, type TabMsg, type WinState } from "./shared";

const HOST = "com.ronald.topictree";
const trees = new Map<string, Tree>();
const logs = new Map<string, TopicEvent[]>();

// --- storage helpers ---------------------------------------------------------------
const local = chrome.storage.local;
const sess = chrome.storage.session;

async function settings(): Promise<Settings> {
  return { ...DEFAULT_SETTINGS, ...((await local.get("settings")).settings ?? {}) };
}
async function sessions(): Promise<SessionInfo[]> {
  return (await local.get("sessions")).sessions ?? [];
}
async function log(session: string): Promise<TopicEvent[]> {
  if (!logs.has(session)) logs.set(session, (await local.get(`log:${session}`))[`log:${session}`] ?? []);
  return logs.get(session)!;
}
async function tree(session: string): Promise<Tree> {
  if (!trees.has(session)) {
    const events = await log(session);
    trees.set(session, events.length ? replay(session, events) : emptyTree(session, Date.now()));
  }
  return trees.get(session)!;
}

const newSessionId = () => `${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}-${crypto.randomUUID().slice(0, 6)}`;

// synchronous copy of each window's state: sidePanel.open() must run inside the click's
// user gesture, so the icon/shortcut handlers can't await storage before calling it
const winCache = new Map<number, WinState>();

async function win(windowId: number): Promise<WinState> {
  const key = `win:${windowId}`;
  const stored = (await sess.get(key))[key] as WinState | undefined;
  if (stored) { winCache.set(windowId, stored); return stored; }
  const fresh: WinState = { session: newSessionId(), recording: true, panel: "hidden", lastShown: "docked" };
  await sess.set({ [key]: fresh });
  winCache.set(windowId, fresh);
  await indexSession(fresh.session);
  return fresh;
}
async function setWin(windowId: number, patch: Partial<WinState>) {
  const next = { ...(await win(windowId)), ...patch };
  await sess.set({ [`win:${windowId}`]: next });
  winCache.set(windowId, next);
  await badge(windowId, next);
  return next;
}
async function indexSession(id: string) {
  const list = await sessions();
  if (!list.some(s => s.id === id)) {
    list.push({ id, started: Date.now(), title: "Untitled session", nodes: 0 });
    await local.set({ sessions: list.slice(-200) });
  }
}

// --- recording ---------------------------------------------------------------------
type Capture = Omit<Extract<TopicEvent, { kind: "search" }>, "id" | "session" | "seq" | "ts" | "source">
             | Omit<Extract<TopicEvent, { kind: "page" }>, "id" | "session" | "seq" | "ts" | "source">
             | Omit<Extract<TopicEvent, { kind: "action" }>, "id" | "session" | "seq" | "ts" | "source">;

async function record(windowId: number, body: Capture, opts: { force?: boolean } = {}) {
  const state = await win(windowId);
  if (!state.recording && !opts.force) return;
  const events = await log(state.session);
  const event = { ...body, id: crypto.randomUUID().slice(0, 8), session: state.session,
                  seq: (events.at(-1)?.seq ?? 0) + 1, ts: Date.now(), source: "browser" } as TopicEvent;
  events.push(event);
  const t = apply(await tree(state.session), event);
  trees.set(state.session, t);
  await local.set({ [`log:${state.session}`]: events });
  await updateIndex(t);
  host.send(event, t);
  await checkDrift(windowId);
  await broadcast(windowId);
}

async function updateIndex(t: Tree) {
  const list = await sessions();
  const entry = list.find(s => s.id === t.session);
  if (!entry) return;
  const main = t.branches[t.mains[0]];
  const first = Object.values(t.nodes).sort((a, b) => a.ts - b.ts)[0];
  entry.title = main?.name ?? first?.title ?? "Untitled session";
  entry.nodes = Object.keys(t.nodes).length;
  await local.set({ sessions: list });
}

// per-tab memory: last committed URL (to tell "opened from a search") and pending page
const lastUrl = new Map<number, string>();
const openerOf = new Map<number, number>();
const pending = new Map<number, { url: string; fromSearch: boolean; redirect: boolean }>();
const lastQuery = new Map<number, string>(); // windowId -> last search query (back to results != new node)
// tabs navigated by clicking a node in the tree: a revisit, not new research. The next
// top-level commit in that tab (whatever URL it lands on after redirects) is not recorded.
const revisit = new Map<number, { until: number; seen: boolean }>();

chrome.tabs.onCreated.addListener(tab => {
  if (tab.id !== undefined && tab.openerTabId !== undefined) openerOf.set(tab.id, tab.openerTabId);
});
chrome.tabs.onRemoved.addListener(id => { lastUrl.delete(id); openerOf.delete(id); pending.delete(id); });

chrome.webNavigation.onCommitted.addListener(async d => {
  if (d.frameId !== 0 || !isTrackable(d.url)) return;
  const tab = await chrome.tabs.get(d.tabId).catch(() => undefined);
  if (!tab || tab.incognito) return;
  const previous = lastUrl.get(d.tabId) ?? (openerOf.has(d.tabId) ? lastUrl.get(openerOf.get(d.tabId)!) : undefined);
  lastUrl.set(d.tabId, d.url);
  if (d.transitionType === "reload" || d.transitionQualifiers.includes("forward_back")) return;
  const rv = revisit.get(d.tabId);
  if (rv) {
    // skip the revisit's own commit (a server redirect commits only its final URL),
    // plus any client-side redirects that follow it within a few seconds
    if (Date.now() < rv.until && (!rv.seen || d.transitionQualifiers.includes("client_redirect"))) {
      rv.seen = true;
      const search = parseSearch(d.url);
      if (search) lastQuery.set(tab.windowId, search.query);
      return;
    }
    revisit.delete(d.tabId);
  }

  const search = parseSearch(d.url);
  if (search) {
    if (lastQuery.get(tab.windowId) === search.query) return; // same results page again
    lastQuery.set(tab.windowId, search.query);
    await record(tab.windowId, { kind: "search", query: search.query, url: d.url, engine: search.engine });
    return;
  }
  // a server redirect commits only the final URL, so it is already "not a node";
  // a client redirect commits twice: the second one rewrites the first
  pending.set(d.tabId, {
    url: d.url,
    fromSearch: !!previous && !!parseSearch(previous) && d.transitionType === "link",
    redirect: d.transitionQualifiers.includes("client_redirect"),
  });
});

async function emitPage(tabId: number, url: string) {
  const p = pending.get(tabId);
  if (!p || p.url !== url) return;
  pending.delete(tabId);
  const tab = await chrome.tabs.get(tabId).catch(() => undefined);
  if (!tab) return;
  await record(tab.windowId, { kind: "page", url, title: tab.title || url, site: siteOf(url),
                               ...(p.fromSearch && { fromSearch: true }), ...(p.redirect && { redirect: true }) });
}
chrome.webNavigation.onCompleted.addListener(d => { if (d.frameId === 0) void emitPage(d.tabId, d.url); });
// single-page apps (YouTube etc.) change URL without a new document
chrome.webNavigation.onHistoryStateUpdated.addListener(d => {
  if (d.frameId !== 0 || !isTrackable(d.url) || lastUrl.get(d.tabId) === d.url) return;
  lastUrl.set(d.tabId, d.url);
  pending.set(d.tabId, { url: d.url, fromSearch: false, redirect: false });
  setTimeout(() => void emitPage(d.tabId, d.url), 1200); // let the title catch up
});

// --- drift alarm -------------------------------------------------------------------
async function checkDrift(windowId: number) {
  const state = await win(windowId);
  const t = await tree(state.session);
  const d = drift(t, Date.now());
  const s = await settings();
  if (d && (d.nodes >= s.driftNodes || d.minutes >= s.driftMinutes) && state.alertedBranch !== t.current) {
    await setWin(windowId, { alertedBranch: t.current });
    await broadcast(windowId);
  }
}
chrome.alarms.create("drift", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(async () => {
  for (const w of await chrome.windows.getAll()) if (w.id !== undefined) await checkDrift(w.id);
});

// --- panel placement ---------------------------------------------------------------
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});

async function tellTabs(windowId: number, msg: TabMsg) {
  for (const tab of await chrome.tabs.query({ windowId }))
    if (tab.id !== undefined) chrome.tabs.sendMessage(tab.id, msg).catch(() => {}); // tabs without the script have no card to hide
}

/** Tabs opened before the extension was installed have no content script: inject it. */
async function ensureContent(tab: chrome.tabs.Tab): Promise<boolean> {
  if (tab.id === undefined || !tab.url || !isTrackable(tab.url)) return false;
  const alive = await chrome.tabs.sendMessage(tab.id, { t: "ping" } satisfies TabMsg).then(() => true, () => false);
  if (alive) return true;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    return true;
  } catch (err) {
    console.warn("Topic Tree: could not inject into", tab.url, err);
    return false;
  }
}

/** Show the floating card in the window's active tab. False when that page can't host one. */
async function showCardInActiveTab(windowId: number): Promise<boolean> {
  const [tab] = await chrome.tabs.query({ active: true, windowId });
  if (!tab || !(await ensureContent(tab))) return false;
  await chrome.tabs.sendMessage(tab.id!, { t: "card", show: true } satisfies TabMsg);
  return true;
}

async function place(windowId: number, panel: WinState["panel"]) {
  const before = await win(windowId);
  const state = await setWin(windowId, { panel, ...(panel !== "hidden" && { lastShown: panel }) });
  if (before.panel === "floating" && panel !== "floating") await tellTabs(windowId, { t: "card", show: false });
  if (panel === "floating") await showCardInActiveTab(windowId);
  if (before.panel === "docked" && panel !== "docked") post({ t: "close", windowId });
  return state;
}

// The icon: off -> record again; hidden -> bring back the last place (Windows taskbar style)
chrome.action.onClicked.addListener(tab => {
  const windowId = tab.windowId;
  const cached = winCache.get(windowId);
  const target = !cached ? "docked"
    : cached.panel === "hidden" || !cached.recording ? cached.lastShown : cached.panel;
  if (target === "docked") void chrome.sidePanel.open({ windowId }); // first, while the gesture is live
  void (async () => {
    if (!(await win(windowId)).recording) await setWin(windowId, { recording: true });
    await place(windowId, target);
  })();
});

// leader shortcut: arm the page so the next key is a tree action (focus stays in the page)
chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== "leader" || !tab?.id) return;
  if (tab.url && isTrackable(tab.url)) {
    void ensureContent(tab).then(ok => ok && chrome.tabs.sendMessage(tab.id!, { t: "arm" } satisfies TabMsg));
  } else { // brave:// pages etc. have no content script: open the panel instead
    void chrome.sidePanel.open({ windowId: tab.windowId });
    void place(tab.windowId, "docked");
  }
});

// a docked panel closed by the browser's own controls counts as hidden
chrome.runtime.onConnect.addListener(port => {
  const m = /^panel:(\d+)$/.exec(port.name);
  if (!m) return;
  const windowId = Number(m[1]);
  port.onDisconnect.addListener(async () => {
    if ((await win(windowId)).panel === "docked") await setWin(windowId, { panel: "hidden" });
  });
});

// --- messages ----------------------------------------------------------------------
async function snapshot(windowId: number): Promise<Snapshot> {
  const state = await win(windowId);
  const t = await tree(state.session);
  const d = drift(t, Date.now());
  return { windowId, state, tree: t, settings: await settings(), sessions: (await sessions()).slice().reverse(),
           drift: d && { ...d, alert: state.alertedBranch === t.current }, hostOk: host.ok };
}
function post(msg: Broadcast) { chrome.runtime.sendMessage(msg).catch(() => {}); }
async function broadcast(windowId: number) { post({ t: "snapshot", snapshot: await snapshot(windowId) }); }

async function handle(msg: Msg, sender: chrome.runtime.MessageSender): Promise<unknown> {
  const windowId = ("windowId" in msg && msg.windowId) || sender.tab?.windowId;
  switch (msg.t) {
    case "open": {
      const [tab] = await chrome.tabs.query({ active: true, windowId: windowId ?? undefined });
      if (tab?.id === undefined) return false;
      revisit.set(tab.id, { until: Date.now() + 5000, seen: false });
      await chrome.tabs.update(tab.id, { url: msg.url });
      return true;
    }
    case "canFloat?": {
      const [tab] = await chrome.tabs.query({ active: true, windowId: windowId ?? undefined });
      return !!tab?.url && isTrackable(tab.url);
    }
    case "card?":
      return windowId !== undefined && (await win(windowId)).panel === "floating" && (await win(windowId)).recording;
    case "settings":
      await local.set({ settings: msg.settings });
      return true;
    case "history": {
      const all = await sess.get(null);
      const activeIds = Object.entries(all).filter(([k]) => k.startsWith("win:")).map(([, v]) => (v as WinState).session);
      return { sessions: await sessions(), active: activeIds };
    }
    case "deleteSessions":
      await deleteSessions(msg.ids);
      return true;
    case "leaderKey": {
      if (windowId === undefined) return false;
      const a = LEADER_KEYS[msg.key];
      if (!a) return false;
      if (a === "back") {
        const t = await tree((await win(windowId)).session);
        const prev = t.history.at(-1);
        if (prev) await record(windowId, { kind: "action", action: { type: "goto", branch: prev } });
      } else await record(windowId, { kind: "action", action: a as Action });
      return true;
    }
  }
  if (windowId === undefined) return null;
  switch (msg.t) {
    case "get":
      return snapshot(windowId);
    case "action":
      await record(windowId, { kind: "action", action: msg.action });
      break;
    case "place":
      await place(windowId, msg.panel);
      break;
    case "stop":
      await setWin(windowId, { recording: false });
      await place(windowId, "hidden");
      break;
    case "resume":
      await setWin(windowId, { session: msg.session, recording: true, alertedBranch: undefined });
      break;
    case "newSession": {
      const id = newSessionId();
      await indexSession(id);
      await setWin(windowId, { session: id, recording: true, alertedBranch: undefined });
      break;
    }
    case "dismissDrift":
      break; // the alert stays dismissed for this tangent (alertedBranch already set)
  }
  await broadcast(windowId);
  return snapshot(windowId);
}
chrome.runtime.onMessage.addListener((msg: Msg, sender, reply) => {
  handle(msg, sender).then(reply, err => reply({ error: String(err) }));
  return true;
});

// --- history: deleting sessions ------------------------------------------------------
/** Removes sessions everywhere: extension storage, in-memory caches and (through the
 *  native host) their files on disk. A window using one starts a fresh session. */
async function deleteSessions(ids: string[]) {
  const gone = new Set(ids);
  await local.set({ sessions: (await sessions()).filter(s => !gone.has(s.id)) });
  await local.remove(ids.flatMap(id => [`log:${id}`, `flushed:${id}`]));
  for (const id of ids) { logs.delete(id); trees.delete(id); host.remove(id); }
  for (const [k, v] of Object.entries(await sess.get(null))) {
    if (!k.startsWith("win:") || !gone.has((v as WinState).session)) continue;
    const windowId = Number(k.slice(4));
    const fresh = newSessionId();
    await indexSession(fresh);
    await setWin(windowId, { session: fresh, alertedBranch: undefined });
    await broadcast(windowId);
  }
}

// --- badge -------------------------------------------------------------------------
async function badge(windowId: number, state?: WinState) {
  const s = state ?? (await win(windowId));
  for (const tab of await chrome.tabs.query({ windowId })) {
    if (tab.id === undefined) continue;
    await chrome.action.setBadgeText({ tabId: tab.id, text: s.recording ? "" : "off" });
    await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: "#6b6b6b" });
    await chrome.action.setTitle({ tabId: tab.id,
      title: s.recording ? "Topic Tree: recording" : "Topic Tree: not recording (click to record)" });
  }
}
chrome.tabs.onActivated.addListener(async ({ windowId }) => {
  void badge(windowId);
  const s = await win(windowId); // the floating card follows you to the tab you switch to
  if (s.panel === "floating" && s.recording) await showCardInActiveTab(windowId);
});
chrome.windows.onCreated.addListener(w => { if (w.id !== undefined) void win(w.id); });

// --- disk mirror through the native host -------------------------------------------
const host = {
  port: null as chrome.runtime.Port | null,
  ok: false,
  connect() {
    try {
      this.port = chrome.runtime.connectNative(HOST);
    } catch { this.ok = false; return; }
    this.ok = true;
    this.port.onMessage.addListener(async (m: { session?: string; seq?: number }) => {
      if (m?.session && typeof m.seq === "number") await local.set({ [`flushed:${m.session}`]: m.seq });
    });
    this.port.onDisconnect.addListener(() => {
      this.ok = false;
      this.port = null;
      setTimeout(() => this.connect(), 30000); // retry; the backlog flushes on reconnect
    });
    void this.flushBacklog();
  },
  remove(session: string) {
    if (this.port) { try { this.port.postMessage({ type: "delete", session }); return; } catch { this.ok = false; } }
    void local.get("pendingDeletes").then(r =>
      local.set({ pendingDeletes: [...new Set([...(r.pendingDeletes ?? []), session])] }));
  },
  send(event: TopicEvent, t: Tree) {
    if (!this.port) return;
    try { this.port.postMessage({ type: "event", event, tree: t }); } catch { this.ok = false; }
  },
  async flushBacklog() {
    const pendingDeletes: string[] = (await local.get("pendingDeletes")).pendingDeletes ?? [];
    for (const s of pendingDeletes) this.port?.postMessage({ type: "delete", session: s });
    if (pendingDeletes.length) await local.remove("pendingDeletes");
    for (const s of await sessions()) {
      const done = (await local.get(`flushed:${s.id}`))[`flushed:${s.id}`] ?? 0;
      const events = (await log(s.id)).filter(e => e.seq > done);
      if (!events.length) continue;
      let t = await tree(s.id);
      for (const e of events) this.send(e, t);
    }
  },
};
host.connect();

// first install: open the guide
chrome.runtime.onInstalled.addListener(d => {
  if (d.reason === "install") void chrome.tabs.create({ url: chrome.runtime.getURL("guide.html") });
});

// warm the synchronous cache after a service-worker restart
void sess.get(null).then(all => {
  for (const [k, v] of Object.entries(all)) if (k.startsWith("win:")) winCache.set(Number(k.slice(4)), v as WinState);
});
