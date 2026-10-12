# Changelog

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
