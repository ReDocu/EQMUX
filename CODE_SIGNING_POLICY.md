# Code signing policy

Free code signing provided by [SignPath.io](https://about.signpath.io),
certificate by [SignPath Foundation](https://signpath.org).
*(Pending — the application has not been submitted yet. Until it is approved, Windows builds are unsigned.)*

Release binaries are built from this repository by GitHub Actions (`.github/workflows/build.yml`) on GitHub-hosted runners.

## Team roles

- Committers and reviewers: [ReDocu](https://github.com/ReDocu)
- Approvers: [ReDocu](https://github.com/ReDocu)

External pull requests are merged only after review.

## Privacy policy

This program will not transfer any information to other networked systems
unless specifically requested by the user or the person installing or operating it.

EQMUX itself makes no network requests. The agent CLIs it launches (Claude Code, Codex) and pages you open
in the browser panel communicate on your behalf, under their own terms.

## What EQMUX writes, and what it does not

| Writes | Does not write |
|---|---|
| App data: `%APPDATA%\com.eqment.eqmux` (macOS: `~/Library/Application Support/com.eqment.eqmux`), including `hook-settings.json` | `~/.claude`, `~/.codex` |
| Logs: `~/.eqmux/logs` | The repository's `.claude/` and `.codex/` |
| The workspace's `.eqmux/` folder | Your `CLAUDE.md` / `AGENTS.md` |

Hooks and the status line are loaded only through session launch arguments (`--settings` for Claude Code, `-c` for Codex).
