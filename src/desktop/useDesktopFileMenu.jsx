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
import { DesktopError, ErrorCode, notifyError } from "./errors.js";
import { openLogFolder } from "./logging.js";
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

  const runAction = useCallback(async (
    action,
    errorTitle = t("error.desktopIntegration"),
    kind = undefined,
  ) =>
    exclusiveRef.current(async () => {
      try {
        return await action();
      } catch (error) {
        await notifyError(error, { title: errorTitle, kind });
        return null;
      }
    }), []);

  const openDdb = useCallback(async () => runAction(async () => {
    const path = await pickOpen("ddb");
    if (path) await openDesktopPath(path);
  }, t("error.openFailed"), "ddb"), [runAction]);

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
  }, t("error.openFailed"), "xlsx"), [runAction]);

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
    if (parsed.tables.length === 0) throw new DesktopError(ErrorCode.SQL_NO_TABLES);
    await persistAndApplyDiagram({
      ...parsed,
      database: normalizeEditorDatabase(dialect),
      diagramId: createDiagramId(),
      name: fileNameWithoutExtension(path),
      transform: { zoom: 1, pan: { x: 0, y: 0 } },
    });
    filePath.clear();
  }, t("error.openFailed"), "sql"), [filePath, persistAndApplyDiagram, runAction]);

  const exportSql = useCallback(async (dialect) => runAction(async () => {
    const path = await pickSave(`${safeFileName(currentDiagram.name)}_${dialect}.sql`, "sql");
    if (path) await writeTextFile(path, await exportSqlText(dialect, currentDiagram));
  }, t("error.saveFailed")), [currentDiagram, runAction]);

  const importPack = useCallback(async () => runAction(async () => {
    const path = await pickOpen("pack");
    if (path) await openDesktopPath(path);
  }, t("error.openFailed"), "pack"), [runAction]);

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
      await notifyError(error, { title: t("error.openFailed") });
    }
  }, []);

  const clearRecent = useCallback(() => runAction(
    () => clearRecentFiles(),
    t("error.desktopIntegration"),
  ), [runAction]);

  const openLogs = useCallback(() => runAction(
    () => openLogFolder(),
    t("error.desktopIntegration"),
  ), [runAction]);

  // Desktop messages follow drawDB's i18next language, so neither the
  // update check nor the language items keep a separate desktop locale.
  const checkUpdates = useCallback(async (manual = false) => {
    const { checkForAppUpdates } = await import("../utils/appUpdates.js");
    return checkForAppUpdates({ manual, onProgress: setUpdateProgress });
  }, []);

  const changeLanguage = useCallback((locale) => setLocale(locale), []);

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

  const locale = desktopLocale(i18n.language);
  const fileMenu = useMemo(() => {
    if (!available) return {};
    const tr = (key) => t(key, {}, locale);
    return {
      desktop_files: {
        name: tr("menu.desktopFiles"),
        function: () => {},
        children: [
          { name: tr("menu.openDdb"), function: openDdb },
          { name: tr("menu.saveDdb"), function: () => saveDdb() },
          { name: tr("menu.saveAsDdb"), function: () => saveDdb({ saveAs: true }) },
          { divider: true },
          { name: tr("menu.openExcel"), function: openExcel },
          { name: tr("menu.exportExcel"), function: exportExcel },
          { name: tr("menu.openSqlDdl"), function: openSql },
          { name: tr("menu.exportSqlOracle"), function: () => exportSql("oracle") },
          { name: tr("menu.exportSqlMySQL"), function: () => exportSql("mysql") },
          { name: tr("menu.exportSqlPostgres"), function: () => exportSql("postgres") },
          { divider: true },
          { name: tr("menu.importPack"), function: importPack },
          { name: tr("menu.exportPack"), function: exportPack },
          { name: tr("menu.history"), function: () => setHistoryOpen(true) },
          { divider: true },
          { name: tr("menu.languageEnglish"), function: () => changeLanguage("en") },
          { name: tr("menu.languageJapanese"), function: () => changeLanguage("ja") },
          { name: tr("menu.checkUpdates"), function: () => checkUpdates(true) },
          { name: tr("menu.openLogFolder"), function: openLogs },
        ],
      },
      desktop_recent_files: {
        name: tr("menu.recentFiles"),
        function: () => {},
        children: recentFilesMenuItems(recentFiles, {
          t: (key, params) => t(key, params, locale),
          onOpen: openRecent,
          onClear: clearRecent,
        }),
      },
    };
  }, [
    available,
    locale,
    changeLanguage,
    checkUpdates,
    clearRecent,
    exportExcel,
    exportPack,
    exportSql,
    importPack,
    openDdb,
    openExcel,
    openLogs,
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
    "help.openLogs": openLogs,
  }), [
    checkUpdates,
    clearRecent,
    exportExcel,
    exportPack,
    exportSql,
    importPack,
    openDdb,
    openExcel,
    openLogs,
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
    locale,
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
