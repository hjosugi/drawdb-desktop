// @ts-check
import {
  assertValidDdbDiagram,
  normalizeDdbPayload,
  stableStringify,
} from "../utils/ddb.js";

export function createDiagramId(crypto = globalThis.crypto) {
  if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
  const random = Math.random().toString(36).slice(2);
  return `drawdb-${Date.now().toString(36)}-${random}`;
}

/**
 * @param {{
 *   diagramId?: string, title?: string, database?: string,
 *   tables?: any[], relationships?: any[], notes?: any[], areas?: any[],
 *   types?: any[], enums?: any[], todos?: any[],
 *   transform?: import("../types/drawdb").Transform,
 * }} state
 */
export function editorStateToDdb({
  diagramId,
  title,
  database,
  tables,
  relationships,
  notes,
  areas,
  types,
  enums,
  todos,
  transform,
}) {
  return normalizeDdbPayload({
    diagramId: usableDiagramId(diagramId) ? diagramId : undefined,
    name: title,
    database,
    tables,
    relationships,
    notes,
    areas,
    types,
    enums,
    todos,
    transform,
  });
}

export function ddbToDatabaseRow(diagram, { now = new Date() } = {}) {
  const payload = normalizeDdbPayload(diagram, diagram.lastModified ?? now);
  assertValidDdbDiagram(payload);
  return {
    diagramId: payload.diagramId,
    database: normalizeEditorDatabase(payload.database),
    name: payload.name,
    gistId: "",
    loadedFromGistId: "",
    lastModified: now,
    tables: payload.tables,
    references: payload.relationships,
    notes: payload.notes,
    areas: payload.areas,
    todos: payload.todos,
    pan: payload.transform.pan,
    zoom: payload.transform.zoom,
    types: payload.types,
    enums: payload.enums,
  };
}

export async function upsertDdbDiagram(table, diagram, {
  createId = createDiagramId,
  now = new Date(),
} = {}) {
  const diagramId = usableDiagramId(diagram?.diagramId)
    ? diagram.diagramId
    : createId();
  const payload = normalizeDdbPayload({ ...diagram, diagramId }, diagram.lastModified ?? now);
  const row = ddbToDatabaseRow(payload, { now });
  const existing = await table.where("diagramId").equals(diagramId).first();

  if (existing) {
    await table.update(existing.id, row);
    return { created: false, diagramId, payload, rowId: existing.id };
  }

  const rowId = await table.add(row);
  return { created: true, diagramId, payload, rowId };
}

export function ddbFingerprint(diagram) {
  const payload = normalizeDdbPayload(diagram, "1970-01-01T00:00:00.000Z");
  delete payload.lastModified;
  return stableStringify(payload, 0);
}

export function detectSqlDialect(text) {
  if (/\bIDENTITY\s*\(\s*\d+\s*,\s*\d+\s*\)|\bNVARCHAR\b|\bUNIQUEIDENTIFIER\b|\bDATETIME2\b|\bsp_addextendedproperty\b|\[dbo\]|^\s*GO\s*$/im.test(text)) {
    return "mssql";
  }
  if (/\b(SERIAL|BIGSERIAL|SMALLSERIAL|BYTEA|JSONB)\b|AS\s+ENUM|nextval\(|::[a-z]/i.test(text)) {
    return "postgres";
  }
  if (/VARCHAR2|NUMBER\s*\(|GENERATED\s+(?:ALWAYS|BY\s+DEFAULT)\s+AS\s+IDENTITY/i.test(text)) {
    return "oracle";
  }
  return "mysql";
}

export function normalizeEditorDatabase(value) {
  const database = String(value || "generic").toLowerCase();
  const aliases = {
    oracle: "oraclesql",
    postgres: "postgresql",
    postgresql: "postgresql",
    sqlserver: "transactsql",
    mssql: "transactsql",
  };
  return aliases[database] ?? database;
}

export function usableDiagramId(value) {
  return typeof value === "string" && value.trim() !== "" && value !== "blank";
}
