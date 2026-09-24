import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DESKTOP_MENU_ACTIONS,
  NATIVE_MENU_EDITOR_ACTIONS,
  desktopLocale,
  desktopPlatform,
  buildNativeMenuModel,
  collectNativeMenuActions,
  dispatchNativeMenuAction,
  isMacPlatform,
  shouldInstallNativeMenu,
  toTauriMenuOptions,
} from "../src/desktop/nativeMenu.js";

function find(model, id) {
  for (const node of model) {
    if (node.id === id) return node;
    if (node.type === "submenu") {
      const nested = find(node.items, id);
      if (nested) return nested;
    }
  }
  return null;
}

describe("native menu model", () => {
  afterEach(() => {
    delete globalThis.window;
  });

  it("detects macOS from navigator data", () => {
    expect(isMacPlatform({ userAgentData: { platform: "macOS" } })).toBe(true);
    expect(isMacPlatform({ platform: "MacIntel" })).toBe(true);
    expect(isMacPlatform({ platform: "Win32" })).toBe(false);
    expect(isMacPlatform({ userAgent: "Mozilla/5.0 (X11; Linux x86_64)" })).toBe(false);
    expect(isMacPlatform(undefined)).toBe(false);
  });

  it("classifies desktop platforms and maps drawDB language codes", () => {
    expect(desktopPlatform({ platform: "Win32" })).toBe("windows");
    expect(desktopPlatform({ platform: "MacIntel" })).toBe("macos");
    expect(desktopPlatform({ platform: "Linux aarch64" })).toBe("linux");
    expect(desktopLocale("jp")).toBe("ja");
    expect(desktopLocale("en")).toBe("en");
    expect(desktopLocale("fr")).toBe("en");
  });

  it("installs the native menu bar only inside Tauri on macOS", () => {
    expect(shouldInstallNativeMenu({ platform: "MacIntel" })).toBe(false);
    globalThis.window = { __TAURI_INTERNALS__: {} };
    expect(shouldInstallNativeMenu({ platform: "MacIntel" })).toBe(true);
    expect(shouldInstallNativeMenu({ platform: "Win32" })).toBe(false);
    expect(shouldInstallNativeMenu({ platform: "Linux x86_64" })).toBe(false);
  });

  it("follows the macOS menu bar layout", () => {
    const model = buildNativeMenuModel({ locale: "en", version: "1.9.0" });

    expect(model.map((node) => node.id)).toEqual([
      "app",
      "file",
      "edit",
      "view",
      "window",
      "help",
    ]);
    expect(model[0].text).toBe("drawDB");
    expect(model[0].items[0].item.About).toMatchObject({ name: "drawDB", version: "1.9.0" });
    expect(model[0].items.at(-1)).toMatchObject({ type: "predefined", item: "Quit", text: "Quit drawDB" });
    expect(find(model, "window").role).toBe("window");
    expect(find(model, "help").role).toBe("help");
    expect(find(model, "edit").items.filter((node) => node.type === "predefined").map((node) => node.item))
      .toEqual(["Undo", "Redo", "Cut", "Copy", "Paste", "SelectAll"]);
    expect(find(model, "file").items.at(-1)).toMatchObject({ item: "CloseWindow" });
  });

  it("assigns standard accelerators to document commands", () => {
    const model = buildNativeMenuModel({ locale: "en" });
    const accelerators = Object.fromEntries(
      ["file.new", "file.open", "file.save", "file.saveAs"]
        .map((id) => [id, find(model, id).accelerator]),
    );

    expect(accelerators).toEqual({
      "file.new": "CmdOrCtrl+N",
      "file.open": "CmdOrCtrl+O",
      "file.save": "CmdOrCtrl+S",
      "file.saveAs": "CmdOrCtrl+Shift+S",
    });
    const all = [];
    const visit = (nodes) => nodes.forEach((node) => {
      if (node.accelerator) all.push(node.accelerator);
      if (node.items) visit(node.items);
    });
    visit(model);
    expect(new Set(all).size).toBe(all.length);
  });

  it("localizes labels for Japanese", () => {
    const model = buildNativeMenuModel({ locale: "ja" });

    expect(find(model, "file").text).toBe("ファイル");
    expect(find(model, "file.save").text).toBe("保存");
    expect(find(model, "file.recent").text).toBe("最近使ったファイル");
    expect(model[0].items.at(-1).text).toBe("drawDBを終了");
  });

  it("lists recent files with a clear command", () => {
    const empty = buildNativeMenuModel({ locale: "en" });
    expect(find(empty, "file.recent").items).toEqual([
      expect.objectContaining({ action: "file.noRecent", enabled: false }),
    ]);

    const model = buildNativeMenuModel({
      locale: "en",
      recentFiles: [
        { path: "/docs/a.ddb", name: "a.ddb" },
        { path: "/docs/b.ddbpack", name: "b.ddbpack" },
      ],
    });
    const recent = find(model, "file.recent").items;
    expect(recent.map((node) => node.text ?? node.type)).toEqual([
      "a.ddb",
      "b.ddbpack",
      "separator",
      "Clear Recent Files",
    ]);
    expect(recent[1]).toMatchObject({
      id: "file.openRecent.1",
      action: "file.openRecent",
      arg: "/docs/b.ddbpack",
    });
  });

  it("has a handler for every enabled command", () => {
    const model = buildNativeMenuModel({
      locale: "en",
      recentFiles: [{ path: "/docs/a.ddb", name: "a.ddb" }],
    });

    expect(collectNativeMenuActions(model)).toEqual([...NATIVE_MENU_EDITOR_ACTIONS].sort());
  });

  it("wires every command to the owner of its handler", () => {
    const fileMenu = readFileSync("src/desktop/useDesktopFileMenu.jsx", "utf8");
    const controlPanel = readFileSync("src/components/EditorHeader/ControlPanel.jsx", "utf8");

    for (const action of DESKTOP_MENU_ACTIONS) {
      expect(fileMenu).toContain(`"${action}":`);
    }
    for (const action of NATIVE_MENU_EDITOR_ACTIONS.filter((id) => !DESKTOP_MENU_ACTIONS.includes(id))) {
      expect(controlPanel).toContain(`"${action}":`);
    }
    expect(controlPanel).toContain("useNativeMenu({");
    expect(controlPanel).toContain("enabled: desktop.inAppWindowShortcuts");
  });

  it("converts the model into Tauri menu options with action callbacks", () => {
    const onAction = vi.fn();
    const options = toTauriMenuOptions(
      buildNativeMenuModel({ locale: "en", recentFiles: [{ path: "/a.ddb", name: "a.ddb" }] }),
      onAction,
    );
    const file = options.find((entry) => entry.id === "file");
    const save = file.items.find((entry) => entry.id === "file.save");

    expect(save).toMatchObject({ text: "Save", accelerator: "CmdOrCtrl+S", enabled: true });
    save.action();
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ action: "file.save" }));
    expect(file.items).toContainEqual({ item: "Separator" });
    expect(file.items.at(-1)).toEqual({ item: "CloseWindow", text: "Close Window" });
  });

  it("dispatches actions with their argument and reports missing handlers", async () => {
    const openRecent = vi.fn();
    expect(dispatchNativeMenuAction(
      { action: "file.openRecent", arg: "/docs/a.ddb" },
      { "file.openRecent": openRecent },
    )).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(openRecent).toHaveBeenCalledWith("/docs/a.ddb");

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(dispatchNativeMenuAction({ action: "file.unknown" }, {})).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("logs handler failures instead of throwing into the menu event loop", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    dispatchNativeMenuAction({ action: "file.save" }, {
      "file.save": () => {
        throw new Error("disk full");
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(error).toHaveBeenCalledWith(
      "drawDB native menu action failed: file.save",
      expect.any(Error),
    );
    error.mockRestore();
  });
});

describe("exclusive desktop actions", () => {
  it("coalesces requests while a dialog-backed action is in flight", async () => {
    const { createExclusiveRunner } = await import("../src/desktop/runtime.js");
    const run = createExclusiveRunner();
    let release;
    const first = vi.fn(() => new Promise((resolve) => {
      release = resolve;
    }));
    const second = vi.fn(async () => "second");

    const a = run(first);
    const b = run(second);
    await Promise.resolve();
    expect(first).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled();
    release("first");
    await expect(a).resolves.toBe("first");
    await expect(b).resolves.toBe("first");

    await expect(run(second)).resolves.toBe("second");
  });

  it("releases the lock after a failure", async () => {
    const { createExclusiveRunner } = await import("../src/desktop/runtime.js");
    const run = createExclusiveRunner();

    await expect(run(async () => {
      throw new Error("cancelled");
    })).rejects.toThrow("cancelled");
    await expect(run(async () => "next")).resolves.toBe("next");
  });
});
