// Assembles the static frontend bundle consumed by the Tauri shell.
// Mirrors the `/app/...` and `/src/...` absolute paths used by app/index.html
// and app/app.js so the same frontend works unmodified under Tauri's
// asset protocol (which serves `frontendDist` as the site root).

const ROOT = new URL("../", import.meta.url);
const DIST_DIR = new URL("dist/", ROOT);

const FILES: [string, string][] = [
  ["app/index.html", "index.html"],
  ["app/styles.css", "app/styles.css"],
  ["app/app.js", "app/app.js"],
  ["src/domain/dateLogic.js", "src/domain/dateLogic.js"],
  ["src/domain/holidayLogic.js", "src/domain/holidayLogic.js"],
  ["src/storage/localStore.js", "src/storage/localStore.js"],
];

await Deno.remove(DIST_DIR, { recursive: true }).catch(() => {});

for (const [source, dest] of FILES) {
  const sourceUrl = new URL(source, ROOT);
  const destUrl = new URL(dest, DIST_DIR);
  await Deno.mkdir(new URL(".", destUrl), { recursive: true });
  await Deno.copyFile(sourceUrl, destUrl);
}

console.log(`Assembled Tauri frontend bundle at ${DIST_DIR.pathname}`);
