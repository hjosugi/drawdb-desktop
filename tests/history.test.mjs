import { describe, expect, it } from "vitest";
import { makeShopDiagram } from "./fixtures/shopDiagram.mjs";
import { serializeDdb, stableStringify } from "../overlay/src/utils/desktopIO.js";
import {
  createHistorySnapshot,
  gzipText,
  gunzipText,
  listHistorySnapshots,
  readHistorySettings,
  recoverLatestHistorySnapshot,
  restoreHistorySnapshot,
  shouldCreateTimedSnapshot,
  summarizeDiagramDiff,
  writeHistorySettings,
} from "../overlay/src/utils/history.js";

function memoryStorage() {
  const files = new Map();
  return {
    files,
    async ensureDir() {},
    async readDir(path = "") {
      if (!path) {
        return [...new Set([...files.keys()].map((key) => key.split("/")[0]))]
          .filter(Boolean)
          .map((name) => ({ name }));
      }
      const prefix = path ? `${path}/` : "";
      return [...files.keys()]
        .filter((key) => key.startsWith(prefix))
        .map((key) => key.slice(prefix.length))
        .filter((name) => name && !name.includes("/"))
        .map((name) => ({ name }));
    },
    async readFile(path) {
      if (!files.has(path)) throw new Error(`missing file: ${path}`);
      return files.get(path);
    },
    async writeFile(path, bytes) {
      files.set(path, bytes);
    },
    async removeFile(path) {
      files.delete(path);
    },
    async size(path) {
      return files.get(path)?.byteLength ?? 0;
    },
  };
}

describe("desktop history snapshots", () => {
  it("gzip-compresses and restores snapshot text", async () => {
    const compressed = await gzipText("drawDB history");
    expect(compressed.byteLength).toBeGreaterThan(10);
    await expect(gunzipText(compressed)).resolves.toBe("drawDB history");
  });

  it("creates, rotates, lists, and restores local history snapshots", async () => {
    const storage = memoryStorage();
    const first = makeShopDiagram();
    const second = { ...first, name: "Shop v2", tables: first.tables.slice(0, 1) };
    const third = { ...first, name: "Shop v3", tables: [...first.tables, { id: "audit", name: "audit_log", fields: [] }] };
    const common = {
      storage,
      sourcePath: "/tmp/shop.ddb",
      settings: { maxGenerations: 2, maxBytes: 1024 * 1024, minIntervalMs: 10_000 },
    };

    await createHistorySnapshot(first, { ...common, now: new Date("2026-01-01T00:00:00.000Z"), reason: "save" });
    await createHistorySnapshot(second, { ...common, now: new Date("2026-01-01T00:01:00.000Z"), reason: "autosave" });
    await createHistorySnapshot(third, { ...common, now: new Date("2026-01-01T00:02:00.000Z"), reason: "restore-before" });

    const snapshots = await listHistorySnapshots({ diagram: first, sourcePath: common.sourcePath, storage });
    expect(snapshots.map((snapshot) => snapshot.reason)).toEqual(["restore-before", "autosave"]);
    expect([...storage.files.keys()]).toHaveLength(2);

    const restored = await restoreHistorySnapshot(snapshots[0], storage);
    expect(restored.name).toBe("Shop v3");
    expect(restored.tables.map((table) => table.name)).toContain("audit_log");
  });

  it("recovers the latest snapshot by source path after a corrupt file open", async () => {
    const storage = memoryStorage();
    const first = makeShopDiagram();
    const second = { ...first, name: "Recovered", tables: first.tables.slice(0, 1) };

    await createHistorySnapshot(first, {
      storage,
      sourcePath: "/tmp/shop.ddb",
      now: new Date("2026-01-01T00:00:00.000Z"),
      reason: "save",
    });
    await createHistorySnapshot(second, {
      storage,
      sourcePath: "/tmp/shop.ddb",
      now: new Date("2026-01-01T00:01:00.000Z"),
      reason: "autosave",
    });

    const recovered = await recoverLatestHistorySnapshot({ sourcePath: "/tmp/shop.ddb", storage });

    expect(recovered.name).toBe("Recovered");
    expect(recovered.tables).toHaveLength(1);
  });

  it("summarizes table and relationship changes", () => {
    const before = makeShopDiagram();
    const after = {
      ...before,
      tables: [
        { ...before.tables[0], comment: "changed" },
        { id: "payments", name: "payments", fields: [] },
      ],
      relationships: [],
    };

    const summary = summarizeDiagramDiff(before, after);

    expect(summary.tablesAdded).toEqual(["payments"]);
    expect(summary.tablesRemoved).toEqual(["orders"]);
    expect(summary.tablesChanged).toEqual(["users"]);
    expect(summary.relationshipsRemoved).toBe(1);
    expect(summary.lines.join("\n")).toContain("Tables changed: users");
  });

  it("checks timed snapshot intervals from normalized settings", () => {
    expect(shouldCreateTimedSnapshot(null, new Date("2026-01-01T00:00:00Z"))).toBe(true);
    expect(shouldCreateTimedSnapshot(
      "2026-01-01T00:00:00Z",
      new Date("2026-01-01T00:03:00Z"),
      { minIntervalMs: 5 * 60 * 1000 },
    )).toBe(false);
    expect(shouldCreateTimedSnapshot(
      "2026-01-01T00:00:00Z",
      new Date("2026-01-01T00:06:00Z"),
      { minIntervalMs: 5 * 60 * 1000 },
    )).toBe(true);
  });

  it("persists normalized history settings", () => {
    const store = new Map();
    const storage = {
      getItem: (key) => store.get(key) || "",
      setItem: (key, value) => store.set(key, value),
    };

    const written = writeHistorySettings({
      enabled: false,
      maxGenerations: 9999,
      maxBytes: 1,
      minIntervalMs: 1,
    }, storage);

    expect(written).toMatchObject({
      enabled: false,
      maxGenerations: 500,
      maxBytes: 1024 * 1024,
      minIntervalMs: 10_000,
    });
    expect(readHistorySettings(storage)).toEqual(written);
  });
});

describe("stable .ddb JSON", () => {
  it("pretty-prints deterministic JSON for file-friendly diffs", () => {
    const text = serializeDdb(makeShopDiagram(), { now: new Date("2026-01-01T00:00:00Z") });
    expect(text).toMatch(/^\{\n  "\$format": "drawdb-file"/);
    expect(text).toContain('\n  "tables": [');
    expect(JSON.parse(text).lastModified).toBe("2026-01-01T00:00:00.000Z");
  });

  it("sorts object keys recursively", () => {
    expect(stableStringify({ z: 1, a: { y: 2, b: 3 } }, 0)).toBe('{"a":{"b":3,"y":2},"z":1}');
  });
});
