import { normalizeDdbPayload, parseDdb, stableStringify } from "./desktopIO.js";

export const HISTORY_ROOT = "history";
export const HISTORY_FORMAT = "drawdb-history-snapshot";
export const HISTORY_VERSION = 1;
export const DEFAULT_HISTORY_SETTINGS = Object.freeze({
  enabled: true,
  maxGenerations: 50,
  maxBytes: 50 * 1024 * 1024,
  minIntervalMs: 5 * 60 * 1000,
});

let _fs = null;
async function fs() {
  if (!_fs) _fs = await import("@tauri-apps/plugin-fs");
  return _fs;
}

export function createTauriHistoryStorage({ root = HISTORY_ROOT } = {}) {
  const relative = (path = "") => [root, path].filter(Boolean).join("/");

  return {
    async ensureDir(path = "") {
      const { BaseDirectory, mkdir } = await fs();
      await mkdir(relative(path), { baseDir: BaseDirectory.AppData, recursive: true });
    },
    async readDir(path = "") {
      const { BaseDirectory, readDir } = await fs();
      try {
        return await readDir(relative(path), { baseDir: BaseDirectory.AppData });
      } catch (_) {
        return [];
      }
    },
    async readFile(path) {
      const { BaseDirectory, readFile } = await fs();
      return readFile(relative(path), { baseDir: BaseDirectory.AppData });
    },
    async writeFile(path, bytes) {
      const { BaseDirectory, writeFile } = await fs();
      await writeFile(relative(path), bytes, { baseDir: BaseDirectory.AppData });
    },
    async removeFile(path) {
      const { BaseDirectory, remove } = await fs();
      await remove(relative(path), { baseDir: BaseDirectory.AppData });
    },
    async size(path) {
      const { BaseDirectory, stat } = await fs();
      const info = await stat(relative(path), { baseDir: BaseDirectory.AppData });
      return info.size ?? 0;
    },
  };
}

export function normalizeHistorySettings(settings = {}) {
  const merged = { ...DEFAULT_HISTORY_SETTINGS, ...(settings || {}) };
  return {
    enabled: merged.enabled !== false,
    maxGenerations: clampInt(merged.maxGenerations, 1, 500, DEFAULT_HISTORY_SETTINGS.maxGenerations),
    maxBytes: clampInt(merged.maxBytes, 1024 * 1024, 1024 * 1024 * 1024, DEFAULT_HISTORY_SETTINGS.maxBytes),
    minIntervalMs: clampInt(merged.minIntervalMs, 10_000, 24 * 60 * 60 * 1000, DEFAULT_HISTORY_SETTINGS.minIntervalMs),
  };
}

export function readHistorySettings(storage = globalThis.localStorage) {
  try {
    return normalizeHistorySettings(JSON.parse(storage?.getItem("drawdb.history.settings") || "{}"));
  } catch (_) {
    return normalizeHistorySettings();
  }
}

export function writeHistorySettings(settings, storage = globalThis.localStorage) {
  const normalized = normalizeHistorySettings(settings);
  storage?.setItem("drawdb.history.settings", JSON.stringify(normalized));
  return normalized;
}

export function shouldCreateTimedSnapshot(lastSnapshotAt, now = new Date(), settings = {}) {
  const normalized = normalizeHistorySettings(settings);
  if (!normalized.enabled) return false;
  if (!lastSnapshotAt) return true;
  return new Date(now).getTime() - new Date(lastSnapshotAt).getTime() >= normalized.minIntervalMs;
}

export async function createHistorySnapshot(diagram, {
  storage = createTauriHistoryStorage(),
  settings = readHistorySettings(),
  sourcePath = "",
  reason = "save",
  now = new Date(),
} = {}) {
  const normalized = normalizeHistorySettings(settings);
  if (!normalized.enabled) return null;

  const createdAt = new Date(now).toISOString();
  const key = diagramHistoryKey(diagram, sourcePath);
  const payload = normalizeDdbPayload(diagram, createdAt);
  const snapshot = {
    $format: HISTORY_FORMAT,
    $version: HISTORY_VERSION,
    createdAt,
    database: payload.database || "",
    diagramId: payload.diagramId || "",
    name: payload.name || "Untitled",
    reason,
    relationshipCount: payload.relationships.length,
    sourcePath,
    tableCount: payload.tables.length,
    payload,
  };
  const file = snapshotFileName(snapshot);
  const path = `${key}/${file}`;
  const bytes = await gzipText(stableStringify(snapshot, 2));

  await storage.ensureDir(key);
  await storage.writeFile(path, bytes);
  await rotateHistory(storage, key, normalized);

  return snapshotEntry(snapshot, key, file, bytes.byteLength);
}

export async function listHistorySnapshots({
  diagram,
  sourcePath = "",
  storage = createTauriHistoryStorage(),
} = {}) {
  const key = diagramHistoryKey(diagram || {}, sourcePath);
  const entries = await storage.readDir(key);
  const files = entries
    .map((entry) => entry.name)
    .filter((name) => typeof name === "string" && name.endsWith(".ddb.json.gz"));

  const snapshots = [];
  for (const file of files) {
    try {
      const path = `${key}/${file}`;
      const bytes = await storage.readFile(path);
      const snapshot = await decodeSnapshot(bytes);
      snapshots.push(snapshotEntry(snapshot, key, file, byteLength(bytes)));
    } catch (err) {
      console.warn("drawDB history: skipped unreadable snapshot", file, err);
    }
  }
  return snapshots.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function readHistorySnapshot(entry, storage = createTauriHistoryStorage()) {
  const bytes = await storage.readFile(entry.path || `${entry.key}/${entry.file}`);
  return decodeSnapshot(bytes);
}

export async function restoreHistorySnapshot(entry, storage = createTauriHistoryStorage()) {
  const snapshot = await readHistorySnapshot(entry, storage);
  return parseDdb(stableStringify(snapshot.payload, 2));
}

export function summarizeDiagramDiff(before = {}, after = {}) {
  const beforeTables = keyedTables(before.tables);
  const afterTables = keyedTables(after.tables);
  const added = [...afterTables.keys()].filter((key) => !beforeTables.has(key)).map((key) => afterTables.get(key).name || key);
  const removed = [...beforeTables.keys()].filter((key) => !afterTables.has(key)).map((key) => beforeTables.get(key).name || key);
  const changed = [...afterTables.keys()].filter((key) => (
    beforeTables.has(key) && stableStringify(beforeTables.get(key), 0) !== stableStringify(afterTables.get(key), 0)
  )).map((key) => afterTables.get(key).name || key);

  const beforeRelationships = new Set((before.relationships || []).map((relationship) => relationshipKey(relationship)));
  const afterRelationships = new Set((after.relationships || []).map((relationship) => relationshipKey(relationship)));
  const relationshipsAdded = [...afterRelationships].filter((key) => !beforeRelationships.has(key)).length;
  const relationshipsRemoved = [...beforeRelationships].filter((key) => !afterRelationships.has(key)).length;

  const lines = [];
  if (added.length) lines.push(`Tables added: ${added.join(", ")}`);
  if (removed.length) lines.push(`Tables removed: ${removed.join(", ")}`);
  if (changed.length) lines.push(`Tables changed: ${changed.join(", ")}`);
  if (relationshipsAdded) lines.push(`Relationships added: ${relationshipsAdded}`);
  if (relationshipsRemoved) lines.push(`Relationships removed: ${relationshipsRemoved}`);
  if (!lines.length) lines.push("No table or relationship changes detected.");

  return {
    tablesAdded: added,
    tablesRemoved: removed,
    tablesChanged: changed,
    relationshipsAdded,
    relationshipsRemoved,
    lines,
  };
}

export async function gzipText(text, CompressionStreamCtor = globalThis.CompressionStream) {
  if (typeof CompressionStreamCtor !== "function") {
    throw new Error("CompressionStream gzip support is required for drawDB history snapshots.");
  }
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStreamCtor("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function gunzipText(bytes, DecompressionStreamCtor = globalThis.DecompressionStream) {
  if (typeof DecompressionStreamCtor !== "function") {
    throw new Error("DecompressionStream gzip support is required for drawDB history snapshots.");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStreamCtor("gzip"));
  return new Response(stream).text();
}

async function rotateHistory(storage, key, settings) {
  const entries = await storage.readDir(key);
  const records = await Promise.all(entries
    .map((entry) => entry.name)
    .filter((name) => typeof name === "string" && name.endsWith(".ddb.json.gz"))
    .map(async (file) => {
      const path = `${key}/${file}`;
      return {
        file,
        path,
        createdAt: snapshotTimeFromFile(file),
        size: await safeSize(storage, path),
      };
    }));

  records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  let kept = 0;
  let bytes = 0;
  for (const record of records) {
    kept += 1;
    bytes += record.size;
    if (kept > settings.maxGenerations || bytes > settings.maxBytes) {
      await storage.removeFile(record.path);
    }
  }
}

async function decodeSnapshot(bytes) {
  const snapshot = JSON.parse(await gunzipText(bytes));
  if (snapshot.$format !== HISTORY_FORMAT) {
    throw new Error(`Unknown history snapshot format: ${snapshot.$format}`);
  }
  return snapshot;
}

function snapshotEntry(snapshot, key, file, bytes) {
  return {
    bytes,
    createdAt: snapshot.createdAt,
    database: snapshot.database,
    diagramId: snapshot.diagramId,
    file,
    key,
    name: snapshot.name,
    path: `${key}/${file}`,
    reason: snapshot.reason,
    relationshipCount: snapshot.relationshipCount,
    sourcePath: snapshot.sourcePath,
    tableCount: snapshot.tableCount,
  };
}

function diagramHistoryKey(diagram = {}, sourcePath = "") {
  const seed = diagram.diagramId || sourcePath || diagram.name || "untitled";
  const label = diagram.diagramId || basename(sourcePath) || diagram.name || "untitled";
  return `${safeSegment(label)}-${fnv1a(String(seed))}`;
}

function snapshotFileName(snapshot) {
  const stamp = snapshot.createdAt.replace(/[:.]/g, "-");
  const reason = safeSegment(snapshot.reason || "save");
  const hash = fnv1a(stableStringify(snapshot.payload, 0));
  return `${stamp}--${reason}--${hash}.ddb.json.gz`;
}

function snapshotTimeFromFile(file) {
  return String(file).split("--")[0] || "";
}

function keyedTables(tables = []) {
  return new Map(tables.map((table, index) => [table.id || table.name || `table-${index}`, table]));
}

function relationshipKey(relationship = {}) {
  return [
    relationship.id,
    relationship.startTableId,
    relationship.startFieldId,
    relationship.endTableId,
    relationship.endFieldId,
    relationship.name,
  ].filter(Boolean).join(":");
}

function safeSegment(value) {
  return String(value || "untitled")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "untitled";
}

function basename(path) {
  return String(path || "").split(/[\\/]/).filter(Boolean).pop() || "";
}

function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

async function safeSize(storage, path) {
  try {
    if (typeof storage.size === "function") return await storage.size(path);
  } catch (_) {
    // Fall back to reading the file when stat is unavailable in a test adapter.
  }
  return byteLength(await storage.readFile(path));
}

function byteLength(bytes) {
  return bytes.byteLength ?? bytes.length ?? 0;
}

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
