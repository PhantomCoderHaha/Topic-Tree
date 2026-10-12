/**
 * How the panel talks to the recorder. In the extension it is the background worker;
 * opened as a plain page (preview.html, for design work) it is an in-memory fake
 * with a sample session, so the UI can be developed and screenshotted outside Brave.
 */
import type { Action, TopicEvent } from "../core/events";
import { apply, drift, emptyTree, replay } from "../core/tree";
import { DEFAULT_SETTINGS, type Broadcast, type Msg, type PanelPlace, type Settings, type Snapshot } from "../shared";

export interface Bridge {
  mode: "docked" | "float" | "preview";
  start(onSnapshot: (s: Snapshot) => void): Promise<void>;
  send(msg: Msg): Promise<void>;
  canFloat(): Promise<boolean>;
  openGuide(): void;
  openHistory(): void;
  /** Must be called directly in a click handler: opening the side panel needs the gesture. */
  dock(): void;
  open(url: string): void;
  closeSelf(): void;
}

export function extensionBridge(mode: "docked" | "float"): Bridge {
  let windowId: number | undefined;
  let push: (s: Snapshot) => void = () => {};
  return {
    mode,
    async start(onSnapshot) {
      push = onSnapshot;
      windowId = (await chrome.windows.getCurrent()).id;
      if (mode === "docked") chrome.runtime.connect({ name: `panel:${windowId}` });
      chrome.runtime.onMessage.addListener((m: Broadcast) => {
        if (m.t === "snapshot" && m.snapshot.windowId === windowId) push(m.snapshot);
        if (m.t === "close" && m.windowId === windowId && mode === "docked") window.close();
      });
      push(await chrome.runtime.sendMessage({ t: "get", windowId } satisfies Msg));
    },
    async send(msg) {
      const reply = await chrome.runtime.sendMessage({ ...msg, windowId } as Msg);
      if (reply && "tree" in reply) push(reply as Snapshot);
    },
    canFloat() { return chrome.runtime.sendMessage({ t: "canFloat?", windowId } satisfies Msg); },
    openGuide() { void chrome.tabs.create({ url: chrome.runtime.getURL("guide.html"), windowId }); },
    openHistory() { void chrome.tabs.create({ url: chrome.runtime.getURL("history.html"), windowId }); },
    dock() {
      if (windowId !== undefined) void chrome.sidePanel.open({ windowId });
    },
    open(url) { void chrome.runtime.sendMessage({ t: "open", windowId, url } satisfies Msg); },
    closeSelf() { if (mode === "docked") window.close(); },
  };
}

/** A sample session that exercises every visual: tangents, chips, a topic shift, names. */
function sampleEvents(): TopicEvent[] {
  const steps: Array<[string, string?, string?, string?] | Action> = [
    ["q", "what is consciousness"],
    ["p", "en.wikipedia.org", "Consciousness - Wikipedia", "fs"],
    ["p", "plato.stanford.edu", "Consciousness (Stanford Encyclopedia of Philosophy)"],
    { type: "tangent" },
    ["q", "qualia examples"],
    ["p", "en.wikipedia.org", "Qualia - Wikipedia", "fs"],
    { type: "main" },
    ["p", "dankoe.com", "The Art of Focus - Dan Koe"],
    ["p", "dankoe.com", "How to think deeply - Dan Koe"],
    { type: "tangent" },
    ["q", "hard problem of consciousness chalmers"],
    ["p", "consc.net", "Facing Up to the Problem of Consciousness"],
    { type: "tangent" },
    ["q", "david chalmers interview"],
    ["p", "youtube.com", "David Chalmers on the hard problem"],
  ];
  let seq = 0;
  return steps.map(s => {
    const base = { id: `x${++seq}`, session: "preview", seq, ts: Date.now() - (40 - seq) * 60000, source: "browser" as const };
    if (!Array.isArray(s)) return { ...base, kind: "action", action: s };
    if (s[0] === "q") return { ...base, kind: "search", query: s[1]!, engine: "google" };
    return { ...base, kind: "page", url: `https://${s[1]}/`, title: s[2]!, site: s[1]!, fromSearch: s[3] === "fs" };
  });
}

export function previewBridge(): Bridge {
  const events = sampleEvents();
  let tree = replay("preview", events);
  tree.branches[tree.mains[0]].name = "consciousness";
  let settings: Settings = { ...DEFAULT_SETTINGS, driftNodes: 3 };
  let panel: PanelPlace = "docked";
  let recording = true;
  let push: (s: Snapshot) => void = () => {};
  const snap = (): Snapshot => {
    const d = drift(tree, Date.now());
    return {
      windowId: 1, tree, settings, hostOk: false,
      state: { session: "preview", recording, panel, lastShown: "docked" },
      sessions: [{ id: "preview", started: Date.now() - 3.6e6, title: "consciousness", nodes: Object.keys(tree.nodes).length },
                 { id: "older", started: Date.now() - 9e7, title: "n8n webhooks", nodes: 14 }],
      drift: d && { ...d, alert: d.nodes >= settings.driftNodes || d.minutes >= settings.driftMinutes },
    };
  };
  return {
    mode: "preview",
    async start(on) { push = on; push(snap()); },
    async send(msg) {
      if (msg.t === "action") {
        const seq = (events.at(-1)?.seq ?? 0) + 1;
        const e: TopicEvent = { id: `x${seq}`, session: "preview", seq, ts: Date.now(), source: "browser",
                                kind: "action", action: msg.action };
        events.push(e);
        tree = apply(tree, e);
      }
      if (msg.t === "settings") settings = msg.settings;
      if (msg.t === "place") panel = msg.panel;
      if (msg.t === "stop") recording = false;
      if (msg.t === "newSession") tree = emptyTree("preview2", Date.now());
      push(snap());
    },
    async canFloat() { return true; },
    openGuide() { window.open("guide.html"); },
    openHistory() { window.open("history.html"); },
    dock() { panel = "docked"; },
    open(url) { console.log("open", url); },
    closeSelf() { console.log("close panel"); },
  };
}
