const ROOT = Deno.cwd();
const APP_DIR = `${ROOT}/app`;

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
};

function contentType(path: string): string {
  for (const [ext, type] of Object.entries(CONTENT_TYPES)) {
    if (path.endsWith(ext)) {
      return type;
    }
  }
  return "application/octet-stream";
}

function toSafePath(urlPathname: string): string | null {
  const decoded = decodeURIComponent(urlPathname);
  if (decoded.includes("..")) {
    return null;
  }
  if (decoded === "/") {
    return `${APP_DIR}/index.html`;
  }
  if (decoded.startsWith("/app/")) {
    return `${ROOT}${decoded}`;
  }
  if (decoded.startsWith("/src/")) {
    return `${ROOT}${decoded}`;
  }
  if (decoded === "/favicon.ico") {
    return `${APP_DIR}/favicon.ico`;
  }
  return null;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const filePath = toSafePath(url.pathname);
  if (!filePath) {
    return new Response("Not Found", { status: 404 });
  }

  try {
    const file = await Deno.readFile(filePath);
    return new Response(file, {
      headers: {
        "content-type": contentType(filePath),
        "cache-control": "no-store",
      },
    });
  } catch {
    return new Response("Not Found", { status: 404 });
  }
});
