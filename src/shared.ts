/** Types shared by the background worker, the panel and the content script. */
import type { Action } from "./core/events";
import type { Tree } from "./core/tree";

export type PanelPlace = "docked" | "floating" | "hidden";

export interface WinState {
  session: string;
  recording: boolean;
  panel: PanelPlace;
  lastShown: "docked" | "floating";   // what the toolbar icon brings back
  alertedBranch?: string;             // the tangent the drift alarm already fired for
}

export interface Settings { driftNodes: number; driftMinutes: number }
export const DEFAULT_SETTINGS: Settings = { driftNodes: 8, driftMinutes: 15 };

export interface SessionInfo { id: string; started: number; title: string; nodes: number }

export interface Snapshot {
  windowId: number;
  state: WinState;
  tree: Tree;
  settings: Settings;
  sessions: SessionInfo[];
  drift: { nodes: number; minutes: number; alert: boolean } | null;
  hostOk: boolean;
}

export type Msg =
  | { t: "get"; windowId?: number }
  | { t: "action"; windowId?: number; action: Action }
  | { t: "place"; windowId?: number; panel: PanelPlace }
  | { t: "stop"; windowId?: number }
  | { t: "resume"; windowId?: number; session: string }
  | { t: "newSession"; windowId?: number }
  | { t: "settings"; settings: Settings }
  | { t: "dismissDrift"; windowId?: number }
  | { t: "leaderKey"; key: string }
  | { t: "card?" }
  | { t: "canFloat?"; windowId?: number };

/** Background -> content script */
export type TabMsg = { t: "card"; show: boolean } | { t: "arm" } | { t: "ping" };

/** Background -> extension pages */
export type Broadcast = { t: "snapshot"; snapshot: Snapshot } | { t: "close"; windowId: number };

export const LEADER_KEYS: Record<string, Action | "back"> = {
  t: { type: "tangent" },
  m: { type: "main" },
  M: { type: "newMain" },
  b: "back",
};
