// @ts-check
// Schema comparison and migration SQL for desktop diagrams (#35).
//
// Elements are matched by id first and by name second, so two .ddb files of
// the same diagram compare by identity (renames are detected), while schemas
// imported separately from SQL or Excel (positional ids) still line up by
// table and column name. The migration SQL itself comes from upstream
// drawDB's generator (utils/migrations/diffToSQL.js), which already powers the
// web version's version-to-version migrations.
import { deepDiff } from "../utils/diff.js";
import { generateMigrationSQL } from "../utils/migrations/diffToSQL.js";
import { normalizeDdbPayload } from "../utils/ddb.js";
import { normalizeEditorDatabase } from "./diagram.js";

/** Dialects the migration generator supports, in menu order. */
export const MIGRATION_DIALECTS = Object.freeze([
  "postgresql",
  "mysql",
  "mariadb",
  "transactsql",
  "oraclesql",
  "sqlite",
]);

// Layout-only keys never produce DDL. forGenerator() already drops the
// diagram-level metadata, so element names still take part in the diff.
const IGNORED_KEYS = ["x", "y", "width", "height", "locked", "color"];

const clone = (value) => JSON.parse(JSON.stringify(value ?? null));
const lower = (value) => String(value ?? "").toLowerCase();

/**
 * Pairs `to` elements with `from` elements: same id and name, then same name,
 * then same id when that id's name disappeared (a rename). Unmatched `to`
 * elements get ids unused in `from`. Returns old-id → new-id for `to`.
 * @param {Array<{ id: any, name?: string }>} fromItems
 * @param {Array<{ id: any, name?: string }>} toItems
 * @param {(index: number) => any} freshId
 */
function alignIds(fromItems, toItems, freshId) {
  const mapping = new Map();
  const usedFrom = new Set();
  const byId = new Map(fromItems.map((item) => [item.id, item]));
  const byName = new Map();
  fromItems.forEach((item) => {
    if (!byName.has(lower(item.name))) byName.set(lower(item.name), item);
  });
  const toNames = new Set(toItems.map((item) => lower(item.name)));
  const pending = [];

  for (const item of toItems) {
    const sameId = byId.get(item.id);
    if (sameId && lower(sameId.name) === lower(item.name) && !usedFrom.has(sameId.id)) {
      mapping.set(item.id, sameId.id);
      usedFrom.add(sameId.id);
    } else pending.push(item);
  }
  const unmatched = [];
  for (const item of pending) {
    const sameName = byName.get(lower(item.name));
    if (sameName && !usedFrom.has(sameName.id)) {
      mapping.set(item.id, sameName.id);
      usedFrom.add(sameName.id);
    } else unmatched.push(item);
  }
  let counter = 0;
  for (const item of unmatched) {
    const sameId = byId.get(item.id);
    if (sameId && !usedFrom.has(sameId.id) && !toNames.has(lower(sameId.name))) {
      mapping.set(item.id, sameId.id);
      usedFrom.add(sameId.id);
      continue;
    }
    let id = freshId(counter++);
    while (byId.has(id)) id = freshId(counter++);
    mapping.set(item.id, id);
  }
  return mapping;
}

/**
 * Returns a copy of `to` whose table and field ids follow `from`.
 * @param {any} from
 * @param {any} to
 */
export function alignDiagram(from, to) {
  const aligned = clone(to);
  const tableIds = alignIds(from.tables || [], aligned.tables || [], (n) => `__new_table_${n}`);
  const fieldIds = new Map();

  for (const table of aligned.tables || []) {
    const originalId = table.id;
    table.id = tableIds.get(originalId);
    const previous = (from.tables || []).find((candidate) => candidate.id === table.id);
    const mapping = alignIds(previous?.fields || [], table.fields || [], (n) => `__new_field_${table.id}_${n}`);
    const byIndex = new Map();
    (table.fields || []).forEach((field, index) => {
      byIndex.set(index, field.id);
      field.id = mapping.get(field.id);
    });
    fieldIds.set(originalId, { mapping, byIndex, fields: table.fields || [] });
  }

  const resolveField = (tableId, fieldId) => {
    const entry = fieldIds.get(tableId);
    if (!entry) return fieldId;
    if (entry.mapping.has(fieldId)) return entry.mapping.get(fieldId);
    // Legacy diagrams reference fields by index.
    if (typeof fieldId === "number" && entry.byIndex.has(fieldId)) {
      return entry.mapping.get(entry.byIndex.get(fieldId));
    }
    return fieldId;
  };
  for (const relationship of aligned.relationships || []) {
    relationship.startFieldId = resolveField(relationship.startTableId, relationship.startFieldId);
    relationship.endFieldId = resolveField(relationship.endTableId, relationship.endFieldId);
    relationship.startTableId = tableIds.get(relationship.startTableId) ?? relationship.startTableId;
    relationship.endTableId = tableIds.get(relationship.endTableId) ?? relationship.endTableId;
  }
  const relationshipIds = alignIds(
    (from.relationships || []).map((relationship) => ({ ...relationship, name: relationshipKey(from, relationship) })),
    (aligned.relationships || []).map((relationship) => ({ ...relationship, name: relationshipKey(aligned, relationship) })),
    (n) => `__new_relationship_${n}`,
  );
  (aligned.relationships || []).forEach((relationship) => {
    relationship.id = relationshipIds.get(relationship.id);
  });
  return aligned;
}

/** Structural key for a relationship: table.column -> table.column. */
function relationshipKey(diagram, relationship) {
  const table = (id) => (diagram.tables || []).find((candidate) => candidate.id === id);
  const column = (tableId, fieldId) => {
    const fields = table(tableId)?.fields || [];
    return (fields.find((field) => field.id === fieldId) ?? fields[fieldId])?.name;
  };
  return [
    table(relationship.startTableId)?.name,
    column(relationship.startTableId, relationship.startFieldId),
    table(relationship.endTableId)?.name,
    column(relationship.endTableId, relationship.endFieldId),
  ].map(lower).join(".");
}

/** Converts a .ddb payload into the shape the upstream generator expects. */
function forGenerator(diagram) {
  const payload = normalizeDdbPayload(diagram, "1970-01-01T00:00:00.000Z");
  return {
    tables: clone(payload.tables),
    relationships: clone(payload.relationships),
    types: clone(payload.types),
    enums: clone(payload.enums),
  };
}

const SEGMENT = /^([a-zA-Z]+)(?:\[id=([^,\]]*),name=([^,\]]*)(?:,type=([^\]]*))?\])?$/;
const KIND = { tables: "table", fields: "field", indices: "index", relationships: "relationship", types: "type", enums: "enum" };

function parsePath(path) {
  return path.split("#").map((segment) => {
    const match = segment.match(SEGMENT);
    return match
      ? { key: match[1], id: match[2], name: match[3], type: match[4], element: match[2] !== undefined }
      : { key: segment, element: false };
  });
}

function sizeNumber(value) {
  const number = Number.parseInt(String(value ?? "").split(",")[0], 10);
  return Number.isFinite(number) ? number : null;
}

/**
 * Flattens the upstream diff into a list of changes.
 * @returns {Array<{
 *   action: "added" | "removed" | "modified",
 *   kind: string,
 *   table: string,
 *   name: string,
 *   property?: string,
 *   from?: unknown,
 *   to?: unknown,
 *   destructive: boolean,
 * }>}
 */
export function summarizeChanges(diff) {
  const changes = [];
  for (const [path, change] of Object.entries(diff)) {
    const segments = parsePath(path);
    const elements = segments.filter((segment) => segment.element);
    const last = segments[segments.length - 1];
    const target = last.element ? last : elements[elements.length - 1];
    if (!target) continue;
    const property = last.element ? undefined : last.key;
    const kind = KIND[target.key] || target.key;
    const tableSegment = segments[0]?.key === "tables" ? segments[0] : null;
    const table = tableSegment?.name ?? "";
    const name = target.name ?? "";
    const from = change?.from ?? null;
    const to = change?.to ?? null;

    /** @type {"added" | "removed" | "modified"} */
    let action = "modified";
    if (!property && from == null && to != null) action = "added";
    else if (!property && from != null && to == null) action = "removed";

    let destructive = false;
    if (action === "removed" && ["table", "field"].includes(kind)) destructive = true;
    if (action === "modified" && kind === "field") {
      if (property === "type") destructive = true;
      if (property === "size") {
        const before = sizeNumber(from);
        const after = sizeNumber(to);
        destructive = before !== null && after !== null && after < before;
      }
      if (property === "notNull" && to === true) destructive = true;
      if (property === "unique" && to === true) destructive = true;
      if (property === "primary" && to === true) destructive = true;
    }
    changes.push({ action, kind, table, name, ...(property ? { property } : {}), from, to, destructive });
  }
  const order = { table: 0, field: 1, index: 2, relationship: 3, type: 4, enum: 5 };
  return changes.sort((a, b) =>
    a.table.localeCompare(b.table)
    || (order[a.kind] ?? 9) - (order[b.kind] ?? 9)
    || a.name.localeCompare(b.name));
}

/**
 * Compares two diagrams and produces the change list and migration SQL
 * (`up` migrates `from` → `to`, `down` reverts it).
 * @param {any} from older schema
 * @param {any} to newer schema
 * @param {{ database?: string }} [options]
 */
export function compareDiagrams(from, to, { database } = {}) {
  const before = forGenerator(from);
  const after = alignDiagram(before, forGenerator(to));
  const dialect = resolveDialect(database ?? to?.database ?? from?.database);
  const diff = {};
  deepDiff(before, after, diff, IGNORED_KEYS);
  const changes = summarizeChanges(diff);
  const sql = changes.length
    ? generateMigrationSQL(diff, dialect, { from: before, to: after })
    : { up: "", down: "" };
  return {
    dialect,
    changes,
    destructive: changes.filter((change) => change.destructive),
    sql,
  };
}

/** Maps a diagram database to a dialect supported by the generator. */
export function resolveDialect(database) {
  const normalized = normalizeEditorDatabase(database);
  return MIGRATION_DIALECTS.includes(normalized) ? normalized : "postgresql";
}

/** Text of a migration file with both directions. */
export function migrationScript({ up, down }, { dialect, fromLabel, toLabel, now = new Date() }) {
  return [
    "-- Generated by drawDB Desktop (schema comparison)",
    `-- Dialect: ${dialect}`,
    `-- From: ${fromLabel}`,
    `-- To: ${toLabel}`,
    `-- Generated: ${now.toISOString()}`,
    "",
    "-- Up",
    up || "-- (no changes)",
    "",
    "-- Down",
    ...(down || "-- (no changes)").split("\n").map((line) => (line.startsWith("--") ? line : `-- ${line}`)),
    "",
  ].join("\n");
}
