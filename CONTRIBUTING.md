# Contributing

Thanks for helping. EQMUX is pre-1.0; bug reports are the most useful contribution right now.

## Issues

Use the templates (bug / idea). For bugs, attach **Settings › Copy diagnostics** output — it masks your user name and tokens.
Security problems go to [SECURITY.md](SECURITY.md), not issues.

## Building

Requirements: Node.js 20, Rust stable, and on Windows WebView2.

```sh
npm install
npm run tauri dev
```

Before a pull request:

```sh
npx tsc --noEmit
npm test
cd src-tauri && cargo test --lib
```

## Ground rules (from the design)

- The app never runs anything on its own. State changes come from a button the user presses.
- The app holds no API keys and calls no AI. It launches external CLIs.
- Files under `.eqmux/` are the source of truth; the database is a cache.
- The app does not edit engine settings (`~/.claude`, `~/.codex`).
- UI text goes in both Korean and English (`src/i18n/`).

Keep pull requests small and focused. Comments and docs in the code are mostly Korean; English is fine for new code.
