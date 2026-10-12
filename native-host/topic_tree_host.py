"""Topic Tree native messaging host: mirrors the extension's event logs to disk.

Brave starts this on demand (no window) and talks over stdin/stdout: each message is
a 4-byte little-endian length followed by UTF-8 JSON.

In:  {"type": "event", "event": {...TopicEvent}, "tree": {...Tree}}
Out: {"session": "<id>", "seq": <highest seq on disk>}

Files, in %LOCALAPPDATA%\\TopicTree\\sessions\\:
  <session>.jsonl      the raw event log, append-only, one event per line (deduped by seq)
  <session>.tree.json  the latest derived tree, rewritten on each event
"""
from __future__ import annotations

import json
import os
import struct
import sys
import traceback
from pathlib import Path

ROOT = Path(os.environ.get("TOPIC_TREE_DIR") or Path(os.environ.get("LOCALAPPDATA", Path.home())) / "TopicTree")
SESSIONS = ROOT / "sessions"
LOG = ROOT / "host.log"
last_seq: dict[str, int] = {}


def read_message() -> dict | None:
    header = sys.stdin.buffer.read(4)
    if len(header) < 4:
        return None
    (length,) = struct.unpack("<I", header)
    return json.loads(sys.stdin.buffer.read(length).decode("utf-8"))


def write_message(msg: dict) -> None:
    data = json.dumps(msg).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("<I", len(data)) + data)
    sys.stdout.buffer.flush()


def safe(session: str) -> str:
    return "".join(c for c in session if c.isalnum() or c in "-_")[:80] or "unknown"


def seq_on_disk(session: str) -> int:
    if session not in last_seq:
        path = SESSIONS / f"{safe(session)}.jsonl"
        top = 0
        if path.exists():
            with path.open(encoding="utf-8") as f:
                for line in f:
                    try:
                        top = max(top, int(json.loads(line).get("seq", 0)))
                    except (ValueError, json.JSONDecodeError):
                        pass
        last_seq[session] = top
    return last_seq[session]


def delete(session: str) -> dict:
    """Remove a session's files. Names are sanitised, so this only ever touches SESSIONS."""
    name = safe(session)
    removed = 0
    for suffix in (".jsonl", ".tree.json"):
        path = SESSIONS / f"{name}{suffix}"
        if path.exists():
            path.unlink()
            removed += 1
    last_seq.pop(name, None)
    return {"deleted": session, "files": removed}


def handle(msg: dict) -> dict | None:
    if msg.get("type") == "delete":
        return delete(msg["session"])
    if msg.get("type") != "event":
        return None
    event, tree = msg["event"], msg.get("tree")
    session, seq = safe(event["session"]), int(event["seq"])
    SESSIONS.mkdir(parents=True, exist_ok=True)
    if seq > seq_on_disk(session):
        with (SESSIONS / f"{session}.jsonl").open("a", encoding="utf-8") as f:
            f.write(json.dumps(event, ensure_ascii=False) + "\n")
        last_seq[session] = seq
    if tree is not None:
        tmp = SESSIONS / f"{session}.tree.json.tmp"
        tmp.write_text(json.dumps(tree, ensure_ascii=False, indent=1), encoding="utf-8")
        os.replace(tmp, SESSIONS / f"{session}.tree.json")
    return {"session": event["session"], "seq": last_seq[session]}


README = """# Topic Tree data

One file pair per browsing session (one tree per window-session).

- `sessions/<session>.jsonl`: the raw event log, append-only, one JSON event per line, ordered by `seq`.
  - `{"kind":"search", "query", "engine", "url"}`: a web search
  - `{"kind":"page", "url", "title", "site", "fromSearch"?, "redirect"?}`: a page visit
    (consecutive pages on one site group into one node; `redirect` rewrites the previous page)
  - `{"kind":"action", "action":{"type": ...}}`: what the person did to the tree:
    `tangent` | `main` | `newMain` | `goto{branch}` | `renameBranch{branch,name}` |
    `renameNode{node,name}` | `split{node,page}` | `retro{nodes,to:"tangent"|"newMain"}`
  - every event has `id`, `session`, `seq`, `ts` (epoch ms), `source` ("browser")
- `sessions/<session>.tree.json`: the derived tree after the latest event:
  `branches{id: {kind main|tangent, name?, parentBranch?, forkNode?, nodes[], returned}}`,
  `nodes{id: {kind, title, name?, url?, site?, pages[{url,title,ts}], parent?, branch, ts}}`,
  `mains[]` (topics in order), `current`, `history[]` (branches left, newest last).

The tree is a pure function of the log (`src/core/tree.ts` in the repo), so analysis can use either.
"""


def main() -> None:
    ROOT.mkdir(parents=True, exist_ok=True)
    if not (ROOT / "README.md").exists():
        (ROOT / "README.md").write_text(README, encoding="utf-8")
    while True:
        msg = read_message()
        if msg is None:
            return
        try:
            reply = handle(msg)
            if reply:
                write_message(reply)
        except Exception:  # never die on one bad message; leave a trace
            with LOG.open("a", encoding="utf-8") as f:
                f.write(traceback.format_exc() + "\n")


if __name__ == "__main__":
    main()
