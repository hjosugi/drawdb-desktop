// @ts-check
import { useCallback, useContext, useMemo } from "react";
import { State } from "../data/constants.js";
import { db } from "../data/db.js";
import {
  useAreas,
  useDiagram,
  useEnums,
  useLayout,
  useNavigateWithParams,
  useNotes,
  useSaveState,
  useTransform,
  useTypes,
  useUndoRedo,
} from "../hooks/index.js";
import { FilePathContext } from "../context/FilePathContext.jsx";
import { normalizeDdbPayload } from "../utils/ddb.js";
import {
  editorStateToDdb,
  normalizeEditorDatabase,
  upsertDdbDiagram,
} from "./diagram.js";

/**
 * @typedef {{
 *   diagramId?: string,
 *   title?: string,
 *   setTitle?: (title: string) => void,
 *   setLastSaved?: (value: string) => void,
 * }} DesktopEditorOptions
 */

/**
 * Bridges the drawDB editor contexts and the desktop file/database layer.
 * @param {DesktopEditorOptions} [options]
 */
export function useDesktopEditorState({
  diagramId,
  title,
  setTitle,
  setLastSaved,
} = {}) {
  const {
    database,
    relationships,
    setDatabase,
    setRelationships,
    setTables,
    tables,
  } = useDiagram();
  const { areas, setAreas } = useAreas();
  const { notes, setNotes } = useNotes();
  const { types, setTypes } = useTypes();
  const { enums, setEnums } = useEnums();
  const { transform, setTransform } = useTransform();
  const { setRedoStack, setUndoStack } = /** @type {{
    setRedoStack: (stack: unknown[]) => void,
    setUndoStack: (stack: unknown[]) => void,
  }} */ (/** @type {unknown} */ (useUndoRedo()));
  // Upstream contexts are untyped JavaScript; describe the members used here.
  const { setSaveState } = /** @type {{ setSaveState: (state: unknown) => void }} */ (
    /** @type {unknown} */ (useSaveState())
  );
  const { setLayout } = /** @type {{ setLayout: (update: (previous: any) => any) => void }} */ (
    /** @type {unknown} */ (useLayout())
  );
  const filePath = useContext(FilePathContext);
  const navigate = useNavigateWithParams();

  const currentDiagram = useMemo(() => editorStateToDdb({
    diagramId,
    title,
    database,
    tables,
    relationships,
    notes,
    areas,
    types,
    enums,
    transform,
  }), [
    areas,
    database,
    diagramId,
    enums,
    notes,
    relationships,
    tables,
    title,
    transform,
    types,
  ]);

  const applyDiagram = useCallback((diagram) => {
    const payload = normalizeDdbPayload(diagram, diagram.lastModified ?? new Date());
    setDatabase(normalizeEditorDatabase(payload.database));
    setTitle?.(payload.name);
    setTables(payload.tables);
    setRelationships(payload.relationships);
    setNotes(payload.notes);
    setAreas(payload.areas);
    setTypes(payload.types);
    setEnums(payload.enums);
    setTransform(payload.transform);
    setUndoStack([]);
    setRedoStack([]);
    setLayout((previous) => ({ ...previous, readOnly: false }));
    setSaveState(State.SAVED);
    setLastSaved?.(new Date().toLocaleString());
    return payload;
  }, [
    setAreas,
    setDatabase,
    setEnums,
    setLastSaved,
    setLayout,
    setNotes,
    setRedoStack,
    setRelationships,
    setSaveState,
    setTables,
    setTitle,
    setTransform,
    setTypes,
    setUndoStack,
  ]);

  const persistAndApplyDiagram = useCallback(async (diagram, options = {}) => {
    const result = await upsertDdbDiagram(db.diagrams, diagram, options);
    applyDiagram(result.payload);
    navigate(`/editor/diagrams/${result.diagramId}`, { replace: true });
    return result;
  }, [applyDiagram, navigate]);

  const openPersistedDiagram = useCallback(async (targetDiagramId) => {
    const row = await db.diagrams.where("diagramId").equals(targetDiagramId).first();
    if (!row) return null;
    applyDiagram(row);
    navigate(`/editor/diagrams/${targetDiagramId}`, { replace: true });
    return row;
  }, [applyDiagram, navigate]);

  return {
    applyDiagram,
    currentDiagram,
    filePath,
    openPersistedDiagram,
    persistAndApplyDiagram,
  };
}
