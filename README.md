# 06_todo_desktop

Local-first desktop todo app rebuilt with Deno Desktop.

## Features

- Date switch with JST 03:00 business-day rollover
- Show selected day + previous 2 business days
- Singleton memo (same memo across all dates)
- 26-week contribution heatmap
- Holiday-based contribution exclusion (weekend/public/company/forced)
- All data stays local in browser storage (no external API calls)

## Runtime stack

- Runtime/UI shell: Deno Desktop (`deno desktop`)
- UI: Vanilla HTML/CSS/JS
- Core domain logic: TypeScript modules under `src/domain` and `src/storage`

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
- Deno 2.9.3 (managed by mise)

## Run as desktop app

```bash
deno task desktop:dev
```

## Build desktop installer/bundle

```bash
deno task desktop:build
```

Outputs are generated in workspace root:

- `out/TodoDesktop/` (contains `laufey_webview.exe`, `TodoDesktop.dll`, `TodoDesktop.bat`)
- `out/TodoDesktop.msi`

For local runnable EXE output, launch:

- `deno task desktop:run:portable`


This launcher uses an absolute runtime path and is more stable than double-clicking generated files.

(`laufey_webview.exe` directly may fail with runtime library resolution.)

## Distribute via GitHub Releases

This repository includes a GitHub Actions workflow at
`.github/workflows/release-desktop.yml`.

When you push a tag that starts with `v` (for example `v0.1.0`), the workflow:

- Builds desktop artifacts with `deno desktop` on `windows-latest`
- Creates/updates the GitHub Release for that tag
- Uploads installer artifacts (`.msi`, `.exe`)

Example release flow:

```bash
git tag v0.1.0
git push origin v0.1.0
```

After the workflow completes, your company users can download installers from:

- `https://github.com/<owner>/<repo>/releases`

## Desktop local-only notes

- App data stays local (localStorage)
- No external API integration is used
- Desktop app is packaged as a native executable/installer by `deno desktop`

## Holiday exclusion behavior

- Weekend exclusion: toggle on/off
- Japanese public holiday exclusion: toggle on/off
- Company holiday exclusion: add date list and toggle each date
- Excluded days are shown in muted gray on the contribution calendar

## Optional next step

For stronger enterprise persistence/audit requirements, replace
`src/storage/localStore.ts` with a local database adapter and bridge it from
`desktop/main.ts`.
