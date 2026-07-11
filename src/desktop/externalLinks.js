import { desktopAvailable } from "../utils/desktopIO.js";

const EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);

export function shouldOpenExternally(href, location = globalThis.location) {
  if (!href || !location?.href) return false;
  try {
    const url = new URL(href, location.href);
    if (!EXTERNAL_PROTOCOLS.has(url.protocol)) return false;
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.origin !== location.origin;
    }
    return true;
  } catch {
    return false;
  }
}

export async function openExternalUrl(url) {
  if (!desktopAvailable()) {
    globalThis.open?.(url, "_blank", "noopener,noreferrer");
    return;
  }
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(url);
}

export function installDesktopExternalLinkHandler(
  document = globalThis.document,
  location = globalThis.location,
) {
  if (!desktopAvailable() || !document) return () => {};

  const onClick = (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey) return;
    const anchor = event.target?.closest?.("a[href]");
    if (!anchor || !shouldOpenExternally(anchor.href, location)) return;
    event.preventDefault();
    event.stopPropagation();
    void openExternalUrl(anchor.href);
  };

  document.addEventListener("click", onClick, true);
  return () => document.removeEventListener("click", onClick, true);
}
