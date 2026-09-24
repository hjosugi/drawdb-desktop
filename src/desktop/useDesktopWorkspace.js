import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  confirmCloseWithUnsavedChanges,
  assertValidDdbDiagram,
  desktopAvailable,
  makeAutoSaver,
  onAppExitRequested,
  onCloseRequested,
  onOpenFile,
  parseDdb,
  pickSave,
  readTextFile,
  requestAppExit,
  serializeDdb,
  showDesktopError,
  writeTextFile,
} from "../utils/desktopIO.js";
import {
  createHistorySnapshot,
  readHistorySettings,
  recoverLatestHistorySnapshot,
  shouldCreateTimedSnapshot,
} from "../utils/history.js";
import { t } from "../i18n/index.js";
import { createDiagramId, ddbFingerprint, usableDiagramId } from "./diagram.js";
import { recordRecentFile } from "./recentFiles.js";
import { registerDesktopRuntime } from "./runtime.js";
import { useDesktopEditorState } from "./useDesktopEditorState.js";

export function useDesktopWorkspace({
  diagramId,
  ready,
  setLastSaved,
  setTitle,
  title,
} = {}) {
  const {
    currentDiagram,
    filePath,
    openPersistedDiagram,
    persistAndApplyDiagram,
  } = useDesktopEditorState({ diagramId, title, setTitle, setLastSaved });
  const { clear: clearFilePath, setFile: setFilePath } = filePath;
  const fingerprint = useMemo(() => ddbFingerprint(currentDiagram), [currentDiagram]);
  const stateRef = useRef({ currentDiagram, filePath, fingerprint });
  const lastFingerprintRef = useRef(null);
  const lastAssociationRef = useRef(null);
  const lastHistorySnapshotAt = useRef(null);
  const handlingExitRef = useRef(false);

  stateRef.current = { currentDiagram, filePath, fingerprint };

  const writeDiagram = useCallback(async (path, diagram, reason) => {
    const settings = readHistorySettings();
    if (shouldCreateTimedSnapshot(lastHistorySnapshotAt.current, new Date(), settings)) {
      try {
        const entry = await createHistorySnapshot(diagram, {
          sourcePath: path,
          reason,
          settings,
        });
        if (entry) lastHistorySnapshotAt.current = entry.createdAt;
      } catch (error) {
        console.warn("drawDB history snapshot failed:", error);
      }
    }
    await writeTextFile(path, serializeDdb(diagram));
    stateRef.current.filePath.setDirty(false);
  }, []);

  const fileSaverRef = useRef(null);
  if (!fileSaverRef.current) {
    fileSaverRef.current = makeAutoSaver(async (diagram) => {
      const associated = stateRef.current.filePath;
      if (!associated.path || associated.kind !== "ddb") return;
      await writeDiagram(associated.path, diagram, "autosave");
    }, 800);
  }

  const flushAssociatedFile = useCallback(async () => {
    const associated = stateRef.current.filePath;
    if (!associated.path || associated.kind !== "ddb") return;
    if (associated.dirty && !fileSaverRef.current.hasPending()) {
      fileSaverRef.current.schedule(stateRef.current.currentDiagram);
    }
    await fileSaverRef.current.flush();
  }, []);

  const openExternalPath = useCallback(async (path) => {
    await flushAssociatedFile();
    const lower = path.toLowerCase();

    if (lower.endsWith(".ddbpack")) {
      const { importFromPack } = await import("../utils/ddbpack.js");
      const imported = await importFromPack(path, { merge: true });
      if (imported.diagramIds[0]) await openPersistedDiagram(imported.diagramIds[0]);
      clearFilePath();
      await recordRecentFile(path);
      return;
    }

    if (lower.endsWith(".xlsx")) {
      const { importExcelToDiagram } = await import("../utils/excelIO.js");
      const imported = await importExcelToDiagram(path, { database: "mysql" });
      await persistAndApplyDiagram({
        ...imported,
        diagramId: createDiagramId(),
        name: imported.name || fileNameWithoutExtension(path),
      });
      clearFilePath();
      return;
    }

    const text = await readTextFile(path);
    let diagram;
    try {
      diagram = assertValidDdbDiagram(parseDdb(text));
    } catch (parseError) {
      diagram = await recoverLatestHistorySnapshot({ sourcePath: path });
      if (!diagram) throw parseError;
    }
    const result = await persistAndApplyDiagram(diagram);
    setFilePath(path, result.diagramId);
    await recordRecentFile(path);
  }, [clearFilePath, flushAssociatedFile, openPersistedDiagram, persistAndApplyDiagram, setFilePath]);

  const saveBeforeExit = useCallback(async () => {
    const associated = stateRef.current.filePath;
    if (associated.path && associated.kind === "ddb") {
      await flushAssociatedFile();
      return true;
    }

    const current = stateRef.current.currentDiagram;
    const diagram = usableDiagramId(current.diagramId)
      ? current
      : { ...current, diagramId: createDiagramId() };
    const path = await pickSave(`${safeFileName(diagram.name)}.ddb`, "ddb");
    if (!path) return false;
    await writeDiagram(path, diagram, "save");
    if (!usableDiagramId(current.diagramId)) await persistAndApplyDiagram(diagram);
    associated.setFile(path, diagram.diagramId);
    await recordRecentFile(path);
    return true;
  }, [flushAssociatedFile, persistAndApplyDiagram, writeDiagram]);

  const finishExitRequest = useCallback(async () => {
    if (handlingExitRef.current) return;
    handlingExitRef.current = true;
    try {
      const associated = stateRef.current.filePath;
      const dirty = associated.dirty || fileSaverRef.current.hasPending();
      if (dirty) {
        const decision = await confirmCloseWithUnsavedChanges();
        if (decision === "cancel") {
          handlingExitRef.current = false;
          return;
        }
        if (decision === "save" && !(await saveBeforeExit())) {
          handlingExitRef.current = false;
          return;
        }
      }
      await requestAppExit();
    } catch (error) {
      handlingExitRef.current = false;
      await showDesktopError(error?.message || String(error), t("error.saveFailed"));
    }
  }, [saveBeforeExit]);

  useEffect(() => {
    if (
      !desktopAvailable()
      || !filePath.path
      || !usableDiagramId(filePath.diagramId)
      || !usableDiagramId(diagramId)
      || filePath.diagramId === diagramId
    ) return;

    void fileSaverRef.current.flush()
      .catch((error) => showDesktopError(error?.message || String(error), t("error.saveFailed")))
      .finally(() => clearFilePath());
  }, [clearFilePath, diagramId, filePath.diagramId, filePath.path]);

  useEffect(() => {
    if (!desktopAvailable()) return;
    const association = `${ready ? "ready" : "loading"}:${filePath.kind || ""}:${filePath.path || ""}`;
    if (lastAssociationRef.current !== association) {
      lastAssociationRef.current = association;
      lastFingerprintRef.current = fingerprint;
      return;
    }
    if (!ready || lastFingerprintRef.current === fingerprint) return;

    lastFingerprintRef.current = fingerprint;
    filePath.setDirty(true);
    if (filePath.path && filePath.kind === "ddb") {
      fileSaverRef.current.schedule(currentDiagram);
    }
  }, [currentDiagram, filePath, fingerprint, ready]);

  useEffect(() => {
    if (!desktopAvailable()) return () => {};
    let disposed = false;
    const unlisteners = [];

    void (async () => {
      try {
        unlisteners.push(await onAppExitRequested(finishExitRequest));
        unlisteners.push(await onCloseRequested((event) => {
          event.preventDefault();
          void finishExitRequest();
        }));
        unlisteners.push(await onOpenFile(async (path) => {
          try {
            await openExternalPath(path);
          } catch (error) {
            await showDesktopError(error?.message || String(error), t("error.openFailed"));
          }
        }));
      } catch (error) {
        if (!disposed) {
          await showDesktopError(error?.message || String(error), t("error.desktopIntegration"));
        }
      }
    })();

    return () => {
      disposed = true;
      for (const unlisten of unlisteners) {
        try {
          unlisten?.();
        } catch {
          // Listener may already have been removed during app shutdown.
        }
      }
    };
  }, [finishExitRequest, openExternalPath]);

  useEffect(() => {
    if (!desktopAvailable()) return () => {};
    return registerDesktopRuntime({
      flush: flushAssociatedFile,
      open: openExternalPath,
    });
  }, [flushAssociatedFile, openExternalPath]);
}

function fileNameWithoutExtension(path) {
  return String(path).split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") || "Imported diagram";
}

function safeFileName(value) {
  return String(value || "diagram").replace(/[\\/:*?"<>|]/g, "_").slice(0, 100) || "diagram";
}
