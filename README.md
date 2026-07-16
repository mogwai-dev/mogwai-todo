# 06_todo_desktop

Local-first desktop todo app (Tauri) with Deno + Rust.

## Features

- Date switch with JST 03:00 business-day rollover
- Show selected day + previous 2 days
- Singleton memo (same memo across all dates)
- 26-week contribution heatmap
- Fully local persistence using browser storage
- Optional Rust (WASM) core for contribution-rate/level calculation
- Contribution refresh on app startup and todo updates
- Holiday-based contribution exclusion (weekend/public/company)
- All data stays local in browser storage (no external API calls)

## Runtime stack

- Frontend: React + Vite
- Runtime: Deno tasks (npm compatibility mode)
- Native core (optional): Rust -> WebAssembly
- Desktop shell: Tauri (Rust)

## Runtime version management (mise)

This repository includes `/.mise.toml` and manages runtimes with mise.

```bash
mise install
mise current
```

If you use shell activation, entering this directory automatically switches to
the configured versions.

## Prerequisites

- mise (recommended)
- Deno 2.x+ (managed by mise)
- Rust toolchain (`cargo`) (managed by mise)
- `wasm-pack` (for generating JS/WASM bindings)
- Windows: Visual Studio Build Tools (MSVC + Windows SDK)

## Run as desktop app (Tauri)

```bash
deno task desktop:dev
```

## Build desktop installer/bundle

```bash
deno task desktop:build
```

Bundle outputs are generated under `src-tauri/target/release/bundle`.

## Distribute via GitHub Releases

This repository includes a GitHub Actions workflow at
`.github/workflows/release-tauri.yml`.

When you push a tag that starts with `v` (for example `v0.1.0`), the workflow:

- Builds the Tauri desktop bundle on `windows-latest`
- Creates/updates the GitHub Release for that tag
- Uploads installer artifacts (`.msi`, `.exe`) and signature files (`.sig`)

Example release flow:

```bash
git tag v0.1.0
git push origin v0.1.0
```

After the workflow completes, your company users can download installers from:

- `https://github.com/<owner>/<repo>/releases`

## Internal frontend tasks (for Tauri only)

The following tasks are used internally by Tauri and are not intended as the
primary operation mode.

```bash
deno task frontend:dev
deno task frontend:build
```

## Desktop local-only notes

- App data stays local (localStorage)
- No external API integration is used
- Tauri security CSP is set to self-origin only in production

## Build Rust WASM core

When Rust WASM is not built yet, the app automatically uses TypeScript fallback.

```bash
deno task wasm
```

This command generates runtime bridge files under `src/rust/pkg`.

## Holiday exclusion behavior

- Weekend exclusion: toggle on/off
- Japanese public holiday exclusion: toggle on/off
- Company holiday exclusion: add date list and toggle each date
- Excluded days are shown in muted gray on the contribution calendar

## Optional next step

For stronger enterprise persistence/audit requirements, replace
`src/storage/localStore.ts` with a local SQLite adapter in Tauri.
