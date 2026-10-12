# Changelog

## Unreleased

**Sign-in and redirect pages**
- Pages you only pass through (single sign-on chains like Microsoft/MCAS, "Redirecting…",
  "Continue", Cloudflare's "Just a moment…", client redirects, self-submitting SAML forms) no
  longer become nodes. Each shows briefly, then folds into the next page as a dim
  "via site › site" (hover for the URLs). Nothing is deleted, and older sessions replay with this.
- A redirect only folds the page it left in its own tab, never a page from another tab.

**Privacy**
- Secrets are stripped from URLs before anything is stored: sign-in pages keep only their origin
  and path, and every page loses OAuth codes, tokens, SAML requests, signatures, challenge tokens
  and `user:pass@`.
- Fewer extension files are exposed to websites (the guide is no longer web-accessible).

**Keys in the panel**
- Panel keys only work after you click the panel, press `Enter`, or open it from the toolbar icon.
  A blue line under the header shows they're on. Focus that lands in the panel by itself (Brave
  restoring the side panel, a new tab) no longer turns your typing into tree commands.
- The find/rename box no longer pulls focus back from the page whenever the tree updates (this
  blocked typing in the browser), and keeps what you typed.
- `r`/`e` no longer type their letter into the rename box.
- Renaming applies to the branch/node that was selected when you opened the box, even if new pages
  arrive while you type.

**Recording fixes**
- Events that arrive at the same moment are applied one at a time, so none can go missing from the
  tree.
- Search results pages that update their own address (Google does this) no longer add a duplicate
  page node next to the search.
- One session per window at start-up; devtools and popup windows no longer create empty sessions.
- The disk mirror writes the backlog before new events after reconnecting, so no event is skipped.

## 0.1.1 (2026-10-12)

- Guide: explains that double-clicking any node (or `Enter`) reopens that search or website, and that
  reopening isn't recorded.

## 0.1.0 (2026-10-12)

First release.

- Records searches and pages as a git-style tree: main branches, tangents in their own lanes,
  topic shifts. Consecutive pages on one site group into one node; redirects, reloads,
  back/forward and pages re-opened from the tree are not recorded.
- Keys: `t` tangent, `u` up one level, `m` main, `n` new topic, `b` previous branch, `f` jump,
  `/` find, `r`/`e` rename, `s` split, `v` select then `t` / `p` (tangent of…) / `m` / `n`,
  `l`/`h` fold, `z` branch view. `Ctrl+Shift+Y` + key from any page.
- An empty branch shows as a placeholder and disappears if you leave it unused.
- Drift alarm (steps or minutes on a tangent, configurable).
- Docked side panel, floating card, hide, stop recording (with confirmation).
- Sessions: resume, new session, history manager with search and click-to-select delete.
- Built-in guide with step-through examples.
- Optional disk mirror (`native-host/`, needs Python 3).
