export const DDB_FORMAT = "drawdb-file";
export const DDB_VERSION = 1;

export function normalizeDdbPayload(diagram = {}, now = new Date()) {
  const name = diagram.name ?? diagram.title ?? "Untitled diagram";
  const areas = arrayOrEmpty(diagram.areas ?? diagram.subjectAreas);
  const transform = diagram.transform ?? {
    zoom: diagram.zoom,
    pan: diagram.pan,
  };
  const normalizedTransform = {
    zoom: numberOr(transform?.zoom, 1),
    pan: {
      x: numberOr(transform?.pan?.x, 0),
      y: numberOr(transform?.pan?.y, 0),
    },
  };

  return {
    $format: DDB_FORMAT,
    $version: DDB_VERSION,
    ...(nonEmptyString(diagram.diagramId) && { diagramId: diagram.diagramId }),
    name,
    // Keep the canonical upstream JSON aliases so files saved by the desktop
    // app can also be imported by the drawDB web editor.
    title: name,
    database: diagram.database ?? "generic",
    lastModified: dateString(now),
    tables: arrayOrEmpty(diagram.tables),
    relationships: arrayOrEmpty(diagram.relationships ?? diagram.references),
    notes: arrayOrEmpty(diagram.notes),
    areas,
    subjectAreas: areas,
    types: arrayOrEmpty(diagram.types),
    enums: arrayOrEmpty(diagram.enums),
    todos: arrayOrEmpty(diagram.todos ?? diagram.tasks),
    transform: normalizedTransform,
  };
}

export function stableJsonValue(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (!value || typeof value !== "object") return value;

  return Object.keys(value).sort().reduce((acc, key) => {
    if (value[key] !== undefined) acc[key] = stableJsonValue(value[key]);
    return acc;
  }, {});
}

export function stableStringify(value, space = 2) {
  return JSON.stringify(stableJsonValue(value), null, space);
}

export function serializeDdb(diagram, { pretty = true, stable = true, now = new Date() } = {}) {
  const payload = normalizeDdbPayload(diagram, now);
  const space = pretty ? 2 : 0;
  return stable ? stableStringify(payload, space) : JSON.stringify(payload, null, space);
}

export function parseDdb(text) {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("drawDB file must contain a JSON object");
  }
  if (parsed.$format && parsed.$format !== DDB_FORMAT) {
    throw new Error(`Unknown drawDB file format: ${parsed.$format}`);
  }
  return normalizeDdbPayload(parsed, parsed.lastModified ?? new Date());
}

export function validateDdbDiagram(diagram) {
  const errors = [];
  if (!diagram || typeof diagram !== "object" || Array.isArray(diagram)) {
    return { valid: false, errors: ["diagram must be an object"] };
  }

  if (!Array.isArray(diagram.tables)) {
    errors.push("tables must be an array");
  }
  if (diagram.relationships != null && !Array.isArray(diagram.relationships)) {
    errors.push("relationships must be an array");
  }
  if (errors.length > 0) return { valid: false, errors };

  const tableIdMap = new Map();
  for (const [tableIndex, table] of diagram.tables.entries()) {
    if (!table || typeof table !== "object") {
      errors.push(`tables[${tableIndex}] must be an object`);
      continue;
    }
    if (!table.name) errors.push(`tables[${tableIndex}].name is required`);
    if (!Array.isArray(table.fields)) {
      errors.push(`tables[${tableIndex}].fields must be an array`);
      continue;
    }
    const tableId = table.id ?? tableIndex;
    tableIdMap.set(tableId, table);
    const fieldNames = new Set();
    for (const [fieldIndex, field] of table.fields.entries()) {
      if (!field || typeof field !== "object") {
        errors.push(`tables[${tableIndex}].fields[${fieldIndex}] must be an object`);
        continue;
      }
      if (!field.name) errors.push(`tables[${tableIndex}].fields[${fieldIndex}].name is required`);
      if (!field.type) errors.push(`tables[${tableIndex}].fields[${fieldIndex}].type is required`);
      if (field.name) {
        const key = String(field.name).toLowerCase();
        if (fieldNames.has(key)) {
          errors.push(`tables[${tableIndex}] has duplicate field name: ${field.name}`);
        }
        fieldNames.add(key);
      }
    }
  }

  for (const [relIndex, relationship] of (diagram.relationships || []).entries()) {
    if (!relationship || typeof relationship !== "object") {
      errors.push(`relationships[${relIndex}] must be an object`);
      continue;
    }
    const startTable = tableIdMap.get(relationship.startTableId);
    const endTable = tableIdMap.get(relationship.endTableId);
    if (!startTable) errors.push(`relationships[${relIndex}].startTableId does not reference a table`);
    if (!endTable) errors.push(`relationships[${relIndex}].endTableId does not reference a table`);
    if (startTable && !hasField(startTable, relationship.startFieldId)) {
      errors.push(`relationships[${relIndex}].startFieldId does not reference a field`);
    }
    if (endTable && !hasField(endTable, relationship.endFieldId)) {
      errors.push(`relationships[${relIndex}].endFieldId does not reference a field`);
    }
  }

  return { valid: errors.length === 0, errors };
}

export function assertValidDdbDiagram(diagram) {
  const result = validateDdbDiagram(diagram);
  if (!result.valid) {
    throw new Error(`Invalid .ddb diagram:\n${result.errors.map((error) => `- ${error}`).join("\n")}`);
  }
  return diagram;
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function dateString(value) {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function hasField(table, fieldId) {
  if (!Array.isArray(table?.fields)) return false;
  return table.fields.some((field, index) => field?.id === fieldId || index === fieldId);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function numberOr(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
