const ENTRY_DIR = import.meta.dirname;
const APP_DIR = `${ENTRY_DIR}/../app`;
const SRC_DIR = `${ENTRY_DIR}/../src`;
const SINGLETON_ALREADY_EXISTS = 183;
const singletonResources: unknown[] = [];

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
    return `${APP_DIR}/${decoded.slice("/app/".length)}`;
  }
  if (decoded.startsWith("/src/")) {
    return `${SRC_DIR}/${decoded.slice("/src/".length)}`;
  }
  if (decoded === "/favicon.ico") {
    return `${APP_DIR}/favicon.ico`;
  }
  return null;
}

function acquireSingleton(): boolean {
  if (Deno.build.os !== "windows") {
    return true;
  }

  try {
    const windowsDirectory = Deno.env.get("SystemRoot") ?? "C:\\Windows";
    const kernel32 = Deno.dlopen(`${windowsDirectory}\\System32\\kernel32.dll`, {
      CreateMutexW: {
        parameters: ["pointer", "u8", "pointer"],
        result: "pointer",
      },
      GetLastError: {
        parameters: [],
        result: "u32",
      },
    } as const);
    const username = Deno.env.get("USERNAME") ?? "default";
    const name = `mogwai-todo-${username}`;
    const nameBuffer = new Uint16Array(name.length + 1);
    for (let index = 0; index < name.length; index += 1) {
      nameBuffer[index] = name.charCodeAt(index);
    }

    const mutex = kernel32.symbols.CreateMutexW(
      null,
      0,
      Deno.UnsafePointer.of(nameBuffer),
    );
    const lastError = kernel32.symbols.GetLastError();
    if (mutex === null) {
      kernel32.close();
      return true;
    }
    if (lastError === SINGLETON_ALREADY_EXISTS) {
      kernel32.close();
      return false;
    }

    // Keep the library and name buffer alive for the process lifetime.
    singletonResources.push(kernel32, nameBuffer, mutex);
    return true;
  } catch {
    // Do not block startup on platforms or environments without FFI support.
    return true;
  }
}

if (!acquireSingleton()) {
  Deno.exit(0);
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
