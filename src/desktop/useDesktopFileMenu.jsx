import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Toast } from "@douyinfe/semi-ui";
import HistoryBrowser from "../components/HistoryBrowser.jsx";
import { setLocale, t } from "../i18n/index.js";
import {
  closeCurrentWindow,
  desktopAvailable,
  pickOpen,
  pickSave,
  readTextFile,
  serializeDdb,
  showDesktopError,
  writeTextFile,
} from "../utils/desktopIO.js";
import {
  createHistorySnapshot,
  readHistorySettings,
} from "../utils/history.js";
import {
  createDiagramId,
  detectSqlDialect,
  normalizeEditorDatabase,
  usableDiagramId,
} from "./diagram.js";
import {
  clearRecentFiles,
  prepareRecentFile,
  recentFilesMenuItems,
  recordRecentFile,
  useRecentFiles,
} from "./recentFiles.js";
import { desktopLocale, desktopPlatform } from "./nativeMenu.js";
import {
  createExclusiveRunner,
  flushDesktopFile,
  openDesktopPath,
} from "./runtime.js";
import { useDesktopEditorState } from "./useDesktopEditorState.js";

export function useDesktopFileMenu({
  diagramId,
  setLastSaved,
  setTitle,
  title,
} = {}) {
  const { i18n } = useTranslation();
  const {
    currentDiagram,
    filePath,
    persistAndApplyDiagram,
  } = useDesktopEditorState({ diagramId, title, setTitle, setLastSaved });
  const [historyOpen, setHistoryOpen] = useState(false);
  const [updateProgress, setUpdateProgress] = useState(null);
  const available = desktopAvailable();
  const recentFiles = useRecentFiles();
  const exclusiveRef = useRef(null);
  if (!exclusiveRef.current) exclusiveRef.current = createExclusiveRunner();
  const platform = desktopPlatform();

  const runAction = useCallback(async (action, errorTitle = t("error.desktopIntegration")) =>
    exclusiveRef.current(async () => {
      try {
        return await action();
      } catch (error) {
        await showDesktopError(error?.message || String(error), errorTitle);
        return null;
      }
    }), []);

  const openDdb = useCallback(async () => runAction(async () => {
    const path = await pickOpen("ddb");
    if (path) await openDesktopPath(path);
  }, t("error.openFailed")), [runAction]);

  const saveDdb = useCallback(async ({ saveAs = false } = {}) => {
    if (!available) return false;
    const result = await runAction(async () => {
      const existingPath = filePath.kind === "ddb" ? filePath.path : null;
      const path = !saveAs && existingPath
        ? existingPath
        : await pickSave(`${safeFileName(currentDiagram.name)}.ddb`, "ddb");
      if (!path) return false;

      const payload = {
        ...currentDiagram,
        diagramId: usableDiagramId(currentDiagram.diagramId)
          ? currentDiagram.diagramId
          : createDiagramId(),
      };
      try {
        await createHistorySnapshot(payload, {
          sourcePath: path,
          reason: saveAs ? "save-as" : "save",
          settings: readHistorySettings(),
        });
      } catch (error) {
        console.warn("drawDB history snapshot failed:", error);
      }
      await writeTextFile(path, serializeDdb(payload));
      if (!usableDiagramId(currentDiagram.diagramId)) {
        await persistAndApplyDiagram(payload);
      }
      filePath.setFile(path, payload.diagramId);
      setLastSaved?.(new Date().toLocaleString());
      await recordRecentFile(path);
      return true;
    }, t("error.saveFailed"));
    return result === true;
  }, [
    available,
    currentDiagram,
    filePath,
    persistAndApplyDiagram,
    runAction,
    setLastSaved,
  ]);

  const openExcel = useCallback(async () => runAction(async () => {
    const path = await pickOpen("xlsx");
    if (path) await openDesktopPath(path);
  }, t("error.openFailed")), [runAction]);

  const exportExcel = useCallback(async () => runAction(async () => {
    const path = await pickSave(`${safeFileName(currentDiagram.name)}.xlsx`, "xlsx");
    if (path) {
      const { exportDiagramToExcel } = await import("../utils/excelIO.js");
      await exportDiagramToExcel(path, currentDiagram);
    }
  }, t("error.saveFailed")), [currentDiagram, runAction]);

  const openSql = useCallback(async () => runAction(async () => {
    const path = await pickOpen("sql");
    if (!path) return;
    await flushDesktopFile();
    const sql = await readTextFile(path);
    const dialect = detectSqlDialect(sql);
    const parsed = await importSql(dialect, sql);
    await persistAndApplyDiagram({
      ...parsed,
      database: normalizeEditorDatabase(dialect),
      diagramId: createDiagramId(),
      name: fileNameWithoutExtension(path),
      transform: { zoom: 1, pan: { x: 0, y: 0 } },
    });
    filePath.clear();
  }, t("error.openFailed")), [filePath, persistAndApplyDiagram, runAction]);

  const exportSql = useCallback(async (dialect) => runAction(async () => {
    const path = await pickSave(`${safeFileName(currentDiagram.name)}_${dialect}.sql`, "sql");
    if (path) await writeTextFile(path, await exportSqlText(dialect, currentDiagram));
  }, t("error.saveFailed")), [currentDiagram, runAction]);

  const importPack = useCallback(async () => runAction(async () => {
    const path = await pickOpen("pack");
    if (path) await openDesktopPath(path);
  }, t("error.openFailed")), [runAction]);

  const exportPack = useCallback(async () => runAction(async () => {
    const path = await pickSave("drawdb-project.ddbpack", "pack");
    if (path) {
      const { exportAllToPack } = await import("../utils/ddbpack.js");
      await exportAllToPack(path);
      await recordRecentFile(path);
    }
  }, t("error.saveFailed")), [runAction]);

  const openRecent = useCallback(async (path) => {
    try {
      const stored = await prepareRecentFile(path);
      await openDesktopPath(stored || path);
    } catch (error) {
      if (error?.code === "RECENT_FILE_NOT_FOUND") {
        Toast.error(t("recent.notFound", { path }));
        return;
      }
      await showDesktopError(error?.message || String(error), t("error.openFailed"));
    }
  }, []);

  const clearRecent = useCallback(() => runAction(
    () => clearRecentFiles(),
    t("error.desktopIntegration"),
  ), [runAction]);

  const checkUpdates = useCallback(async (manual = false) => {
    setLocale(i18n.language === "jp" ? "ja" : i18n.language);
    const { checkForAppUpdates } = await import("../utils/appUpdates.js");
    return checkForAppUpdates({ manual, onProgress: setUpdateProgress });
  }, [i18n.language]);

  const changeLanguage = useCallback(async (locale) => {
    setLocale(locale);
    await i18n.changeLanguage(locale === "ja" ? "jp" : "en");
  }, [i18n]);

  const restoreFromHistory = useCallback(async (payload) => {
    if (filePath.path && filePath.kind === "ddb") {
      try {
        await createHistorySnapshot(currentDiagram, {
          sourcePath: filePath.path,
          reason: "restore-before",
          settings: readHistorySettings(),
        });
      } catch (error) {
        console.warn("drawDB history snapshot failed:", error);
      }
    }
    await persistAndApplyDiagram({
      ...payload,
      diagramId: usableDiagramId(currentDiagram.diagramId)
        ? currentDiagram.diagramId
        : payload.diagramId,
    });
    filePath.setDirty(true);
    setHistoryOpen(false);
  }, [currentDiagram, filePath, persistAndApplyDiagram]);

  useEffect(() => {
    if (!available) return () => {};
    const timer = window.setTimeout(() => {
      void checkUpdates();
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [available, checkUpdates]);

  const fileMenu = useMemo(() => available ? {
    desktop_files: {
      name: t("menu.desktopFiles"),
      function: () => {},
      children: [
        { name: t("menu.openDdb"), function: openDdb },
        { name: t("menu.saveDdb"), function: () => saveDdb() },
        { name: t("menu.saveAsDdb"), function: () => saveDdb({ saveAs: true }) },
        { divider: true },
        { name: t("menu.openExcel"), function: openExcel },
        { name: t("menu.exportExcel"), function: exportExcel },
        { name: t("menu.openSqlDdl"), function: openSql },
        { name: t("menu.exportSqlOracle"), function: () => exportSql("oracle") },
        { name: t("menu.exportSqlMySQL"), function: () => exportSql("mysql") },
        { name: t("menu.exportSqlPostgres"), function: () => exportSql("postgres") },
        { divider: true },
        { name: t("menu.importPack"), function: importPack },
        { name: t("menu.exportPack"), function: exportPack },
        { name: t("menu.history"), function: () => setHistoryOpen(true) },
        { divider: true },
        { name: t("menu.languageEnglish"), function: () => changeLanguage("en") },
        { name: t("menu.languageJapanese"), function: () => changeLanguage("ja") },
        { name: t("menu.checkUpdates"), function: () => checkUpdates(true) },
      ],
    },
    desktop_recent_files: {
      name: t("menu.recentFiles"),
      function: () => {},
      children: recentFilesMenuItems(recentFiles, {
        t,
        onOpen: openRecent,
        onClear: clearRecent,
      }),
    },
  } : {}, [
    available,
    changeLanguage,
    checkUpdates,
    clearRecent,
    exportExcel,
    exportPack,
    exportSql,
    importPack,
    openDdb,
    openExcel,
    openRecent,
    openSql,
    recentFiles,
    saveDdb,
  ]);

  const menuActions = useMemo(() => ({
    "app.checkUpdates": () => checkUpdates(true),
    "file.clearRecent": clearRecent,
    "file.exportExcel": exportExcel,
    "file.exportPack": exportPack,
    "file.exportSqlMySQL": () => exportSql("mysql"),
    "file.exportSqlOracle": () => exportSql("oracle"),
    "file.exportSqlPostgres": () => exportSql("postgres"),
    "file.history": () => setHistoryOpen(true),
    "file.importExcel": openExcel,
    "file.importPack": importPack,
    "file.importSql": openSql,
    "file.open": openDdb,
    "file.openRecent": openRecent,
  }), [
    checkUpdates,
    clearRecent,
    exportExcel,
    exportPack,
    exportSql,
    importPack,
    openDdb,
    openExcel,
    openRecent,
    openSql,
  ]);

  const overlays = available ? (
    <>
      {historyOpen ? (
        <HistoryBrowser
          currentDiagram={currentDiagram}
          sourcePath={filePath.path}
          onRestore={restoreFromHistory}
          onClose={() => setHistoryOpen(false)}
        />
      ) : null}
      {updateProgress?.status === "downloading" ? (
        <div
          role="status"
          aria-live="polite"
          className="fixed right-4 top-4 z-[10000] rounded-md bg-gray-900 px-4 py-3 text-sm text-white shadow-lg"
        >
          {updateProgress.percent == null
            ? t("update.downloading")
            : t("update.downloadingProgress", { percent: updateProgress.percent })}
        </div>
      ) : null}
    </>
  ) : null;

  return {
    available,
    closeWindow: closeCurrentWindow,
    fileMenu,
    locale: desktopLocale(i18n.language),
    menuActions,
    // macOS shortcuts come from the native menu bar; Windows and Linux use
    // in-app hotkeys because the in-window menu is canonical there.
    inAppWindowShortcuts: available && platform !== "macos",
    inAppQuitShortcut: available && platform === "linux",
    openDdb,
    overlays,
    recentFiles,
    saveDdb,
  };
}

function fileNameWithoutExtension(path) {
  return String(path).split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") || "Imported diagram";
}

function safeFileName(value) {
  return String(value || "diagram").replace(/[\\/:*?"<>|]/g, "_").slice(0, 100) || "diagram";
}

async function importSql(dialect, sql) {
  if (dialect === "oracle") {
    const { fromOracle } = await import("../data/importSQL/oracle.js");
    return fromOracle(sql);
  }
  if (dialect === "postgres") {
    const { fromPostgres } = await import("../data/importSQL/postgres.js");
    return fromPostgres(sql);
  }
  const { fromMySQL } = await import("../data/importSQL/mysqlEnhanced.js");
  return fromMySQL(sql);
}

async function exportSqlText(dialect, diagram) {
  if (dialect === "oracle") {
    const { toOracle } = await import("../data/exportSQL/oracle.js");
    return toOracle(diagram);
  }
  if (dialect === "postgres") {
    const { toPostgres } = await import("../data/exportSQL/postgres.js");
    return toPostgres(diagram);
  }
  const { toMySQL } = await import("../data/exportSQL/mysqlEnhanced.js");
  return toMySQL(diagram);
}
