# 06_todo_desktop

Local-first desktop todo app. This branch (`tauri-migration`) rebuilds the
desktop shell with **Tauri**, reusing the same vanilla HTML/CSS/JS frontend
(and all fixes made while the app was on Deno Desktop). `master` still uses
Deno Desktop; pick whichever shell works in your environment.

## Features

- Date switch with JST 03:00 business-day rollover
- Show selected day + previous 2 business days
- Singleton memo (same memo across all dates)
- 26-week contribution heatmap
- Holiday-based contribution exclusion (weekend/public/company/forced)
- All data stays local in browser storage (no external API calls)
- Single-instance app (focuses the existing window instead of opening a
  second one)

## Runtime stack

- Runtime/UI shell: Tauri 2 (Rust + WebView2 on Windows)
- UI: Vanilla HTML/CSS/JS served from `app/`, unchanged from the Deno Desktop
  build
- Core domain logic: TypeScript/JS modules under `src/domain` and
  `src/storage` (localStorage-backed, no Rust IPC required)

## Runtime version management (mise)

This repository includes `/.mise.toml` and manages runtimes with mise
(`deno` and `rust`).

```bash
mise install
mise current
```

If you use shell activation, entering this directory automatically switches to
the configured versions.

## Prerequisites

- mise (recommended) or Deno 2.9.3 + Rust stable installed manually
- Tauri CLI: `cargo install tauri-cli --locked` (provides `cargo tauri`)
- Windows: WebView2 runtime (preinstalled on modern Windows)

## Run as desktop app

```bash
deno task tauri:dev
```

This assembles `dist/` from `app/` and `src/` (see
`desktop/build-tauri-dist.ts`) and launches the Tauri window pointed at it.

## Build desktop installer/bundle

```bash
deno task tauri:build
```

Outputs are generated under `src-tauri/target/release/bundle/` (e.g.
`msi/*.msi`, `nsis/*.exe`).

## Distribute via GitHub Releases

This repository includes a GitHub Actions workflow at
`.github/workflows/release-tauri.yml`.

When you push a tag that starts with `v` (for example `v0.3.0`), the workflow:

- Builds the Tauri desktop bundle on `windows-latest`
- Creates/updates the GitHub Release for that tag
- Uploads installer artifacts (`.msi`, `.exe`)

Example release flow:

```bash
git tag v0.3.0
git push origin v0.3.0
```

After the workflow completes, your company users can download installers from:

- `https://github.com/<owner>/<repo>/releases`

## Desktop local-only notes

- App data stays local (localStorage, persisted per-app by WebView2)
- No external API integration is used
- Desktop app is packaged as a native executable/installer by Tauri

## Holiday exclusion behavior

- Weekend exclusion: toggle on/off
- Japanese public holiday exclusion: toggle on/off
- Company holiday exclusion: add date list and toggle each date
- Excluded days are shown in muted gray on the contribution calendar

## Deno Desktop (previous shell, on `master`)

The `master` branch still runs on Deno Desktop (`deno task desktop:dev` /
`deno task desktop:build`). See that branch's README for details. This
branch keeps those tasks available too, in case Deno Desktop is preferred in
a given environment.

## Optional next step

For stronger enterprise persistence/audit requirements, replace
`src/storage/localStore.ts` with a local database adapter and bridge it via a
Tauri command in `src-tauri/src/lib.rs`.
