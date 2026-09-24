// Frontend half of the desktop logging pipeline (#13).
//
// Uncaught errors, unhandled promise rejections, console.error and
// console.warn are forwarded to tauri-plugin-log, which writes rotated files
// in the OS log directory next to the Rust-side records (including panics).
//
// Privacy policy: log records never contain diagram contents. Messages are
// truncated, and home-directory prefixes are replaced with "~" so user names
// in file paths are not written to disk or into bug reports.

export const MAX_LOG_MESSAGE_LENGTH = 4000;

const isTauri = () =>
  typeof window !== "undefined" && !!window.__TAURI_INTERNALS__;

// Drive-letter forms first so "C:/Users/x" does not leave a dangling "C:".
const HOME_PATTERNS = [
  /\b[A-Za-z]:\\Users\\[^\\\s"'`]+/gi,
  /\b[A-Za-z]:\/Users\/[^/\s"'`]+/gi,
  /\/home\/[^/\s"'`]+/g,
  /\/Users\/[^/\s"'`]+/g,
];

let knownHomes = [];

/** Registers the real home directory so names containing spaces are redacted. */
export function setKnownHomeDirectories(homes) {
  knownHomes = (Array.isArray(homes) ? homes : [homes])
    .map((home) => String(home || "").replace(/[\\/]+$/, ""))
    .filter((home) => home.length > 1)
    .sort((a, b) => b.length - a.length);
}

export function redactHomePaths(text, homes = knownHomes) {
  let value = String(text);
  for (const home of homes) value = value.split(home).join("~");
  return HOME_PATTERNS.reduce((result, pattern) => result.replace(pattern, "~"), value);
}

function describe(value) {
  if (value instanceof Error) {
    const stack = typeof value.stack === "string" ? value.stack : "";
    return stack.includes(value.message) ? stack : `${value.name}: ${value.message}\n${stack}`.trim();
  }
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    if (typeof value.code === "string" && typeof value.message === "string") {
      return `${value.code}: ${value.message}`;
    }
    try {
      return JSON.stringify(value);
    } catch {
      return Object.prototype.toString.call(value);
    }
  }
  return String(value);
}

/** Formats console-style arguments into one sanitized log line. */
export function formatLogMessage(parts, { maxLength = MAX_LOG_MESSAGE_LENGTH } = {}) {
  const text = redactHomePaths(parts.map(describe).join(" ").trim());
  return text.length > maxLength ? `${text.slice(0, maxLength)}… [truncated]` : text;
}

/**
 * Installs the bridge. `logger` receives `(level, message)`; by default it is
 * tauri-plugin-log. Returns a disposer that restores console and listeners.
 */
export function installFrontendLogBridge({
  target = globalThis,
  consoleObject = globalThis.console,
  logger = pluginLogger(),
} = {}) {
  if (!consoleObject || !logger) return () => {};
  let forwarding = false;
  const original = {
    error: consoleObject.error,
    warn: consoleObject.warn,
  };

  const forward = (level, parts) => {
    if (forwarding) return;
    forwarding = true;
    try {
      const message = formatLogMessage(parts);
      if (message) {
        void Promise.resolve(logger(level, message)).catch((failure) => {
          original.warn?.call(consoleObject, "drawDB log bridge failed:", failure);
        });
      }
    } finally {
      forwarding = false;
    }
  };

  consoleObject.error = (...parts) => {
    original.error?.apply(consoleObject, parts);
    forward("error", parts);
  };
  consoleObject.warn = (...parts) => {
    original.warn?.apply(consoleObject, parts);
    forward("warn", parts);
  };

  const onError = (event) => {
    const location = event?.filename
      ? ` (${event.filename}:${event.lineno ?? 0}:${event.colno ?? 0})`
      : "";
    forward("error", [`Uncaught ${describe(event?.error ?? event?.message)}${location}`]);
  };
  const onRejection = (event) => {
    forward("error", [`Unhandled promise rejection: ${describe(event?.reason)}`]);
  };
  target.addEventListener?.("error", onError);
  target.addEventListener?.("unhandledrejection", onRejection);

  return () => {
    consoleObject.error = original.error;
    consoleObject.warn = original.warn;
    target.removeEventListener?.("error", onError);
    target.removeEventListener?.("unhandledrejection", onRejection);
  };
}

function pluginLogger() {
  if (!isTauri()) return null;
  void import("@tauri-apps/api/path")
    .then(({ homeDir }) => homeDir())
    .then((home) => setKnownHomeDirectories(home))
    .catch(() => {});
  let plugin = null;
  return async (level, message) => {
    plugin ??= await import("@tauri-apps/plugin-log");
    await (level === "warn" ? plugin.warn(message) : plugin.error(message));
  };
}

export async function openLogFolder() {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("open_log_dir");
}
