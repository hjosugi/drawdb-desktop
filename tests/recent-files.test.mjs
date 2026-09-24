import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
const listen = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args) => invoke(...args) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: (...args) => listen(...args) }));

const {
  MAX_RECENT_FILES,
  RECENT_FILES_CHANGED_EVENT,
  clearRecentFiles,
  fileName,
  isRecentFileCandidate,
  listRecentFiles,
  normalizeRecentFiles,
  onRecentFilesChanged,
  parentFolderName,
  prepareRecentFile,
  recentFilesMenuItems,
  recordRecentFile,
  removeRecentFile,
} = await import("../src/desktop/recentFiles.js");

const translate = (key, params = {}) =>
  `${key}${params.path ? `:${params.path}` : ""}`;

function installTauri() {
  globalThis.window = { __TAURI_INTERNALS__: {} };
}

describe("recent files model", () => {
  it("only remembers drawDB documents", () => {
    expect(isRecentFileCandidate("/docs/a.ddb")).toBe(true);
    expect(isRecentFileCandidate("C:\\docs\\A.DDBPACK")).toBe(true);
    expect(isRecentFileCandidate("/docs/a.xlsx")).toBe(false);
    expect(isRecentFileCandidate("")).toBe(false);
    expect(isRecentFileCandidate(null)).toBe(false);
  });

  it("normalizes backend rows and caps the list", () => {
    const rows = Array.from({ length: 12 }, (_, index) => ({
      path: `/docs/${index}.ddb`,
      openedAt: index,
      exists: index !== 1,
    }));
    const normalized = normalizeRecentFiles([null, { path: "" }, ...rows]);

    expect(normalized).toHaveLength(MAX_RECENT_FILES);
    expect(normalized[0]).toEqual({
      path: "/docs/0.ddb",
      name: "0.ddb",
      openedAt: 0,
      exists: true,
    });
    expect(normalized[1].exists).toBe(false);
    expect(normalizeRecentFiles("nope")).toEqual([]);
  });

  it("derives file and folder names for Windows and POSIX paths", () => {
    expect(fileName("C:\\Users\\me\\Docs\\shop.ddb")).toBe("shop.ddb");
    expect(parentFolderName("C:\\Users\\me\\Docs\\shop.ddb")).toBe("Docs");
    expect(fileName("/home/me/shop.ddbpack")).toBe("shop.ddbpack");
    expect(parentFolderName("/home/me/shop.ddbpack")).toBe("me");
    expect(parentFolderName("shop.ddb")).toBe("");
  });

  it("builds submenu items with a clear action and missing-file markers", () => {
    const onOpen = vi.fn();
    const onClear = vi.fn();
    const items = recentFilesMenuItems([
      { path: "/docs/a.ddb", name: "a.ddb", exists: true },
      { path: "/old/b.ddbpack", name: "b.ddbpack", exists: false },
    ], { t: translate, onOpen, onClear });

    expect(items.map((item) => item.name ?? "---")).toEqual([
      "a.ddb",
      "b.ddbpack",
      "---",
      "recent.clear",
    ]);
    expect(items[0].label).toBe("docs");
    expect(items[1].label).toBe("recent.missing");
    items[1].function();
    expect(onOpen).toHaveBeenCalledWith("/old/b.ddbpack");
    items[3].function();
    expect(onClear).toHaveBeenCalledOnce();
  });

  it("shows a disabled placeholder when nothing was opened yet", () => {
    const items = recentFilesMenuItems([], {
      t: translate,
      onOpen: vi.fn(),
      onClear: vi.fn(),
    });

    expect(items).toEqual([
      expect.objectContaining({ name: "recent.empty", disabled: true }),
    ]);
  });
});

describe("recent files backend bridge", () => {
  beforeEach(() => {
    invoke.mockReset();
    listen.mockReset();
  });

  afterEach(() => {
    delete globalThis.window;
  });

  it("is inert outside Tauri", async () => {
    expect(await listRecentFiles()).toEqual([]);
    expect(await recordRecentFile("/docs/a.ddb")).toBeNull();
    expect(await prepareRecentFile("/docs/a.ddb")).toBeNull();
    expect(await clearRecentFiles()).toEqual([]);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("records only documents and never throws on backend refusal", async () => {
    installTauri();
    invoke.mockResolvedValueOnce([{ path: "/docs/a.ddb", exists: true }]);

    expect(await recordRecentFile("/docs/a.ddb")).toEqual([
      { path: "/docs/a.ddb", name: "a.ddb", openedAt: 0, exists: true },
    ]);
    expect(invoke).toHaveBeenCalledWith("recent_files_add", { path: "/docs/a.ddb" });

    expect(await recordRecentFile("/docs/a.xlsx")).toBeNull();
    expect(invoke).toHaveBeenCalledTimes(1);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    invoke.mockRejectedValueOnce({ code: "RECENT_FILE_NOT_PERMITTED" });
    expect(await recordRecentFile("/elsewhere/b.ddb")).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("propagates structured not-found errors when reopening", async () => {
    installTauri();
    invoke.mockRejectedValueOnce({ code: "RECENT_FILE_NOT_FOUND", message: "gone" });

    await expect(prepareRecentFile("/docs/gone.ddb")).rejects.toEqual({
      code: "RECENT_FILE_NOT_FOUND",
      message: "gone",
    });
    expect(invoke).toHaveBeenCalledWith("recent_files_prepare_open", {
      path: "/docs/gone.ddb",
    });
  });

  it("lists, removes, and clears through backend commands", async () => {
    installTauri();
    invoke
      .mockResolvedValueOnce([{ path: "/docs/a.ddb" }, { path: "/docs/b.ddb" }])
      .mockResolvedValueOnce([{ path: "/docs/b.ddb" }])
      .mockResolvedValueOnce([]);

    expect((await listRecentFiles()).map((entry) => entry.name)).toEqual(["a.ddb", "b.ddb"]);
    expect((await removeRecentFile("/docs/a.ddb")).map((entry) => entry.path)).toEqual([
      "/docs/b.ddb",
    ]);
    expect(await clearRecentFiles()).toEqual([]);
    expect(invoke.mock.calls.map(([command]) => command)).toEqual([
      "recent_files_list",
      "recent_files_remove",
      "recent_files_clear",
    ]);
  });

  it("normalizes change events", async () => {
    installTauri();
    const unlisten = vi.fn();
    listen.mockImplementation(async (event, callback) => {
      callback({ payload: [{ path: "/docs/a.ddb", exists: false }] });
      return unlisten;
    });
    const handler = vi.fn();

    expect(await onRecentFilesChanged(handler)).toBe(unlisten);
    expect(listen).toHaveBeenCalledWith(RECENT_FILES_CHANGED_EVENT, expect.any(Function));
    expect(handler).toHaveBeenCalledWith([
      { path: "/docs/a.ddb", name: "a.ddb", openedAt: 0, exists: false },
    ]);
  });
});
