/**
 * Runs in every web page. Two jobs, both inside a closed shadow root so the page's
 * styles and scripts can't reach them:
 *  - the floating card: an iframe of the extension's own panel page (same UI as docked)
 *  - the leader key: after the shortcut, the next key press is a tree action, so you
 *    never leave the page you're reading
 */
import { LEADER_KEYS, type Msg, type TabMsg } from "./shared";

// injected on demand into tabs that were open before install: never run twice
const g = globalThis as { __topicTree?: boolean };
if (!g.__topicTree) { g.__topicTree = true; init(); }

function init() {

const send = (m: Msg) => chrome.runtime.sendMessage(m);
let host: HTMLDivElement | null = null;
let root: ShadowRoot | null = null;

function ensureRoot(): ShadowRoot {
  if (root) return root;
  host = document.createElement("div");
  host.style.cssText = "all:initial;position:fixed;z-index:2147483647;top:0;left:0;width:0;height:0";
  document.documentElement.appendChild(host);
  root = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = `
    .card{position:fixed;top:72px;right:16px;width:340px;height:440px;border-radius:10px;overflow:hidden;
          box-shadow:0 10px 30px rgba(0,0,0,.45);border:1px solid #333;background:#151515;display:flex;flex-direction:column}
    .grip{height:10px;cursor:move;background:#1f1f1f;flex:none}
    .grip:hover{background:#2a2a2a}
    iframe{border:0;width:100%;flex:1;color-scheme:dark}
    .toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1f1f1f;color:#e6e6e6;
           font:13px/1.4 "Segoe UI",system-ui,sans-serif;padding:8px 14px;border-radius:8px;border:1px solid #333;
           box-shadow:0 6px 20px rgba(0,0,0,.4)}
    .toast b{color:#78b6ff;font-weight:600}`;
  root.appendChild(style);
  return root;
}

// --- floating card -----------------------------------------------------------------
let card: HTMLDivElement | null = null;
function showCard(show: boolean) {
  if (!show) { card?.remove(); card = null; return; }
  if (card) return;
  const r = ensureRoot();
  card = document.createElement("div");
  card.className = "card";
  const grip = document.createElement("div");
  grip.className = "grip";
  grip.title = "Drag to move";
  const frame = document.createElement("iframe");
  frame.src = chrome.runtime.getURL("panel.html?mode=float");
  card.append(grip, frame);
  r.appendChild(card);
  drag(grip, card, frame);
}

function drag(handle: HTMLElement, box: HTMLElement, frame: HTMLIFrameElement) {
  handle.addEventListener("pointerdown", e => {
    const start = box.getBoundingClientRect();
    const dx = e.clientX - start.left, dy = e.clientY - start.top;
    frame.style.pointerEvents = "none"; // keep receiving moves while over the iframe
    handle.setPointerCapture(e.pointerId);
    const move = (m: PointerEvent) => {
      box.style.left = `${Math.max(0, Math.min(innerWidth - 80, m.clientX - dx))}px`;
      box.style.top = `${Math.max(0, Math.min(innerHeight - 40, m.clientY - dy))}px`;
      box.style.right = "auto";
    };
    const up = () => {
      frame.style.pointerEvents = "";
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
  });
}

// --- leader key ----------------------------------------------------------------------
let armed: number | undefined;
let toast: HTMLDivElement | null = null;
function arm() {
  const r = ensureRoot();
  toast?.remove();
  toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = "Topic Tree &nbsp; <b>t</b> tangent · <b>u</b> up · <b>m</b> main · <b>n</b> new topic · <b>b</b> previous branch · <b>Esc</b>";
  r.appendChild(toast);
  clearTimeout(armed);
  armed = window.setTimeout(disarm, 2500);
}
function disarm() {
  clearTimeout(armed);
  armed = undefined;
  toast?.remove();
  toast = null;
}
addEventListener("keydown", e => {
  if (armed === undefined) return;
  if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (e.key in LEADER_KEYS) void send({ t: "leaderKey", key: e.key });
  disarm();
}, true);

chrome.runtime.onMessage.addListener((m: TabMsg, _sender, reply) => {
  if (m.t === "card") showCard(m.show);
  if (m.t === "arm") arm();
  reply(true); // lets the background tell "script present" from "not injected"
});

void send({ t: "card?" }).then(show => showCard(!!show)).catch(() => {});
}
