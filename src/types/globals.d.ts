// Ambient declarations for runtime globals and untyped upstream modules used
// by the type-checked desktop modules.
import type { Table as DexieTable } from "dexie";

declare global {
  interface Window {
    /** Present when the page runs inside the Tauri WebView. */
    __TAURI_INTERNALS__?: unknown;
  }

  interface Navigator {
    /** User-Agent Client Hints (Chromium/WebView2 only). */
    userAgentData?: { platform?: string };
  }
}

declare module "dexie" {
  // Tables declared by src/data/db.js (upstream drawDB IndexedDB schema).
  interface Dexie {
    diagrams: DexieTable<any, number>;
    templates: DexieTable<any, number>;
  }
}

export {};
