import { useEffect, useRef } from "react";
import { normalizeLocale, t as translate } from "../i18n/index.js";

// Native application menu.
//
// Policy (#11): macOS gets a HIG-style native menu bar because every macOS app
// is expected to expose one (application menu, Cmd+Q, Cmd+W, Edit, Window,
// Help). On Windows and Linux the in-window drawDB menu stays canonical and no
// native menu bar is installed: a second menu bar would duplicate it, and GTK
// window accelerators would intercept Ctrl+C/Ctrl+V/Ctrl+Z before WebKitGTK
// delivers them to text fields and the diagram canvas. Both entry points call
// the same action handlers, so there is a single implementation per command.

const isTauri = () =>
  typeof window !== "undefined" && !!window.__TAURI_INTERNALS__;

/** Returns "macos", "windows" or "linux" for the running WebView. */
export function desktopPlatform(nav = globalThis.navigator) {
  const platform = nav?.userAgentData?.platform || nav?.platform || nav?.userAgent || "";
  if (/mac/i.test(platform)) return "macos";
  if (/win/i.test(platform)) return "windows";
  return "linux";
}

export function isMacPlatform(nav = globalThis.navigator) {
  return desktopPlatform(nav) === "macos";
}

export function shouldInstallNativeMenu(nav = globalThis.navigator) {
  return isTauri() && isMacPlatform(nav);
}

// Native menu commands implemented by useDesktopFileMenu. Editor commands such
// as zoom or save are supplied by ControlPanel, which owns those handlers.
export const DESKTOP_MENU_ACTIONS = Object.freeze([
  "app.checkUpdates",
  "file.clearRecent",
  "file.exportExcel",
  "file.exportPack",
  "file.exportSqlMySQL",
  "file.exportSqlOracle",
  "file.exportSqlPostgres",
  "file.history",
  "file.importExcel",
  "file.importPack",
  "file.importSql",
  "file.open",
  "file.openRecent",
]);

export const NATIVE_MENU_EDITOR_ACTIONS = Object.freeze([
  ...DESKTOP_MENU_ACTIONS,
  "file.new",
  "file.save",
  "file.saveAs",
  "help.docs",
  "help.reportBug",
  "help.shortcuts",
  "view.fitWindow",
  "view.zoomIn",
  "view.zoomOut",
]);

export function desktopLocale(language) {
  return normalizeLocale(language === "jp" ? "ja" : language);
}

const item = (action, text, accelerator, extra = {}) => ({
  type: "item",
  id: action,
  action,
  text,
  ...(accelerator ? { accelerator } : {}),
  ...extra,
});
const predefined = (kind, text) => ({ type: "predefined", item: kind, ...(text ? { text } : {}) });
const separator = () => ({ type: "separator" });
const submenu = (id, text, items, extra = {}) => ({ type: "submenu", id, text, items, ...extra });

/**
 * Builds a serializable description of the macOS menu bar. Kept free of Tauri
 * calls so structure, labels and accelerators are unit-testable.
 */
export function buildNativeMenuModel({
  t = translate,
  locale,
  appName = "drawDB",
  version,
  recentFiles = [],
} = {}) {
  const tr = (key, params) => t(key, params, locale);
  const recentItems = recentFiles.length
    ? [
        ...recentFiles.map((entry, index) =>
          item("file.openRecent", entry.name, undefined, {
            id: `file.openRecent.${index}`,
            arg: entry.path,
          })),
        separator(),
        item("file.clearRecent", tr("recent.clear")),
      ]
    : [item("file.noRecent", tr("recent.empty"), undefined, { enabled: false })];

  return [
    submenu("app", appName, [
      predefined({
        About: {
          name: appName,
          ...(version ? { version } : {}),
          license: "AGPL-3.0-only",
          website: "https://github.com/hjosugi/drawdb-desktop",
        },
      }, tr("nativeMenu.about", { app: appName })),
      item("app.checkUpdates", tr("menu.checkUpdates")),
      separator(),
      predefined("Services", tr("nativeMenu.services")),
      separator(),
      predefined("Hide", tr("nativeMenu.hide", { app: appName })),
      predefined("HideOthers", tr("nativeMenu.hideOthers")),
      predefined("ShowAll", tr("nativeMenu.showAll")),
      separator(),
      predefined("Quit", tr("nativeMenu.quit", { app: appName })),
    ]),
    submenu("file", tr("nativeMenu.file"), [
      item("file.new", tr("nativeMenu.new"), "CmdOrCtrl+N"),
      item("file.open", tr("menu.openDdb"), "CmdOrCtrl+O"),
      submenu("file.recent", tr("menu.recentFiles"), recentItems),
      separator(),
      item("file.save", tr("menu.saveDdb"), "CmdOrCtrl+S"),
      item("file.saveAs", tr("menu.saveAsDdb"), "CmdOrCtrl+Shift+S"),
      separator(),
      submenu("file.import", tr("nativeMenu.import"), [
        item("file.importExcel", tr("menu.openExcel")),
        item("file.importSql", tr("menu.openSqlDdl")),
        item("file.importPack", tr("menu.importPack")),
      ]),
      submenu("file.export", tr("nativeMenu.export"), [
        item("file.exportExcel", tr("menu.exportExcel")),
        item("file.exportSqlOracle", tr("menu.exportSqlOracle")),
        item("file.exportSqlMySQL", tr("menu.exportSqlMySQL")),
        item("file.exportSqlPostgres", tr("menu.exportSqlPostgres")),
        item("file.exportPack", tr("menu.exportPack")),
      ]),
      separator(),
      item("file.history", tr("menu.history")),
      separator(),
      predefined("CloseWindow", tr("nativeMenu.closeWindow")),
    ]),
    submenu("edit", tr("nativeMenu.edit"), [
      predefined("Undo", tr("nativeMenu.undo")),
      predefined("Redo", tr("nativeMenu.redo")),
      separator(),
      predefined("Cut", tr("nativeMenu.cut")),
      predefined("Copy", tr("nativeMenu.copy")),
      predefined("Paste", tr("nativeMenu.paste")),
      predefined("SelectAll", tr("nativeMenu.selectAll")),
    ]),
    submenu("view", tr("nativeMenu.view"), [
      item("view.zoomIn", tr("nativeMenu.zoomIn")),
      item("view.zoomOut", tr("nativeMenu.zoomOut")),
      item("view.fitWindow", tr("nativeMenu.fitWindow")),
      separator(),
      predefined("Fullscreen", tr("nativeMenu.fullscreen")),
    ]),
    submenu("window", tr("nativeMenu.window"), [
      predefined("Minimize", tr("nativeMenu.minimize")),
      predefined("Maximize", tr("nativeMenu.zoom")),
      separator(),
      predefined("BringAllToFront", tr("nativeMenu.bringAllToFront")),
    ], { role: "window" }),
    submenu("help", tr("nativeMenu.help"), [
      item("help.docs", tr("nativeMenu.docs")),
      item("help.shortcuts", tr("nativeMenu.shortcuts")),
      item("help.reportBug", tr("nativeMenu.reportBug")),
    ], { role: "help" }),
  ];
}

/** Lists every action id referenced by a model, for handler coverage checks. */
export function collectNativeMenuActions(model) {
  const actions = new Set();
  const visit = (nodes) => {
    for (const node of nodes) {
      if (node.type === "item" && node.action && node.enabled !== false) actions.add(node.action);
      if (node.type === "submenu") visit(node.items);
    }
  };
  visit(model);
  return [...actions].sort();
}

/** Runs the handler registered for a menu node; returns whether one ran. */
export function dispatchNativeMenuAction(node, handlers) {
  const handler = handlers?.[node.action];
  if (typeof handler !== "function") {
    console.warn(`drawDB native menu action has no handler: ${node.action}`);
    return false;
  }
  void Promise.resolve()
    .then(() => (node.arg === undefined ? handler() : handler(node.arg)))
    .catch((error) => console.error(`drawDB native menu action failed: ${node.action}`, error));
  return true;
}

/** Converts the model into Tauri menu option objects. */
export function toTauriMenuOptions(model, onAction) {
  return model.map((node) => {
    if (node.type === "separator") return { item: "Separator" };
    if (node.type === "predefined") {
      return node.text ? { item: node.item, text: node.text } : { item: node.item };
    }
    if (node.type === "submenu") {
      return {
        id: node.id,
        text: node.text,
        items: toTauriMenuOptions(node.items, onAction),
      };
    }
    return {
      id: node.id,
      text: node.text,
      enabled: node.enabled !== false,
      ...(node.accelerator ? { accelerator: node.accelerator } : {}),
      action: () => onAction(node),
    };
  });
}

export async function installNativeMenu(model, onAction) {
  const { Menu } = await import("@tauri-apps/api/menu");
  const menu = await Menu.new({ items: toTauriMenuOptions(model, onAction) });
  for (const node of model) {
    if (node.type !== "submenu" || !node.role) continue;
    const entry = await menu.get(node.id);
    if (node.role === "window") await entry?.setAsWindowsMenuForNSApp?.();
    if (node.role === "help") await entry?.setAsHelpMenuForNSApp?.();
  }
  await menu.setAsAppMenu();
  return menu;
}

/**
 * Installs and refreshes the macOS menu bar. Handlers are read through a ref so
 * the menu always calls the latest editor callbacks without being rebuilt on
 * every render; it is rebuilt only when labels or recent files change.
 */
export function useNativeMenu({ handlers, locale, recentFiles }) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const recentKey = JSON.stringify((recentFiles || []).map((entry) => [entry.path, entry.name]));

  useEffect(() => {
    if (!shouldInstallNativeMenu()) return () => {};
    let disposed = false;
    void (async () => {
      try {
        let version;
        try {
          const { getVersion } = await import("@tauri-apps/api/app");
          version = await getVersion();
        } catch {
          version = undefined;
        }
        if (disposed) return;
        const model = buildNativeMenuModel({
          locale,
          version,
          recentFiles: JSON.parse(recentKey).map(([path, name]) => ({ path, name })),
        });
        await installNativeMenu(model, (node) =>
          dispatchNativeMenuAction(node, handlersRef.current));
      } catch (error) {
        console.error("drawDB could not install the native menu:", error);
      }
    })();
    return () => {
      disposed = true;
    };
  }, [locale, recentKey]);
}
