// @ts-check
// PostgreSQL DDL parser (subset) -> drawDB diagram
// Handles: CREATE TYPE ... AS ENUM, CREATE TABLE (with SERIAL/NUMERIC/BYTEA/JSONB/
// multi-word types), inline + table-level PRIMARY KEY/UNIQUE, COMMENT ON TABLE/COLUMN,
// CREATE [UNIQUE] INDEX, ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY ... [ON DELETE/UPDATE].
import {
  addRelationship,
  applyCommentStatements,
  applyIndexStatements,
  eachMatch,
  identifierPattern,
  makeImportedTable,
  markPrimaryKeys,
  normalizeConstraintAction,
  parseStringList,
  referentialActions,
  splitColumnList,
  splitTopLevel,
  stripSqlComments,
  stripStringLiteral,
  unquoteIdentifier,
} from "./common.js";

const IDENTIFIERS = identifierPattern(['"']);
const { ident: PG_IDENT, qualified: PG_QUAL_IDENT } = IDENTIFIERS;
const RE_CREATE_ENUM = new RegExp(`CREATE\\s+TYPE\\s+(${PG_QUAL_IDENT})\\s+AS\\s+ENUM\\s*\\(([^)]*)\\)\\s*;`, "gi");
const RE_CREATE_TABLE = new RegExp(`CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(${PG_QUAL_IDENT})\\s*\\(([\\s\\S]*?)\\)\\s*;`, "gi");
const RE_ALTER_FK = new RegExp(`ALTER\\s+TABLE\\s+(${PG_QUAL_IDENT})\\s+ADD\\s+CONSTRAINT\\s+(${PG_IDENT})\\s+FOREIGN\\s+KEY\\s*\\(([^)]+)\\)\\s+REFERENCES\\s+(${PG_QUAL_IDENT})\\s*\\(([^)]+)\\)(?:\\s+ON\\s+DELETE\\s+([A-Z\\s]+?))?(?:\\s+ON\\s+UPDATE\\s+([A-Z\\s]+?))?\\s*;`, "gi");
const RE_TABLE_FK = new RegExp(`^(?:CONSTRAINT\\s+(${PG_IDENT})\\s+)?FOREIGN\\s+KEY\\s*\\(([^)]+)\\)\\s+REFERENCES\\s+(${PG_QUAL_IDENT})\\s*\\(([^)]+)\\)`, "i");
const RE_INLINE_FK = new RegExp(`\\bREFERENCES\\s+(${PG_QUAL_IDENT})\\s*\\(([^)]+)\\)`, "i");

const unquote = (s) => unquoteIdentifier(s);
const splitCols = (cols) => splitColumnList(cols, unquote);

/**
 * @param {string} sql DDL script
 * @returns {import("../../types/drawdb").ImportedSchema}
 */
export function fromPostgres(sql) {
  const source = stripSqlComments(sql);
  const tables = [];
  const relationships = [];
  const pendingFks = [];
  const tableMap = new Map();
  const enumMap = new Map(); // lower(name) -> [values]

  eachMatch(RE_CREATE_ENUM, source, (m) => {
    enumMap.set(unquote(m[1]).toLowerCase(), parseStringList(m[2]));
  });
  eachMatch(RE_CREATE_TABLE, source, (m) => {
    const name = unquote(m[1]);
    const t = parseTableBody(name, m[2], tables.length, enumMap, pendingFks);
    tables.push(t);
    tableMap.set(name.toLowerCase(), t);
  });
  applyCommentStatements(source, tableMap, IDENTIFIERS, unquote);
  applyIndexStatements(source, tableMap, IDENTIFIERS, unquote);
  pendingFks.forEach((fk) => addRelationship(relationships, tableMap, fk));
  eachMatch(RE_ALTER_FK, source, (m) => {
    addRelationship(relationships, tableMap, {
      name: unquote(m[2]),
      sourceTable: unquote(m[1]),
      sourceCols: splitCols(m[3]),
      targetTable: unquote(m[4]),
      targetCols: splitCols(m[5]),
      updateConstraint: normalizeConstraintAction(m[7]),
      deleteConstraint: normalizeConstraintAction(m[6]),
    });
  });

  return { tables, relationships };
}

function parseTableBody(name, body, id, enumMap, pendingFks) {
  const fields = [];
  const pkCols = [];
  for (const raw of splitTopLevel(body)) {
    const line = raw.trim();
    if (!line) continue;
    const fk = line.match(RE_TABLE_FK);
    if (fk) {
      pendingFks.push({
        name: fk[1] ? unquote(fk[1]) : `fk_${name}_${pendingFks.length + 1}`,
        sourceTable: name,
        sourceCols: splitCols(fk[2]),
        targetTable: unquote(fk[3]),
        targetCols: splitCols(fk[4]),
        ...referentialActions(line),
      });
      continue;
    }
    if (/^CONSTRAINT\s+/i.test(line) || /^PRIMARY\s+KEY\s*\(/i.test(line) ||
        /^UNIQUE\s*\(/i.test(line) || /^CHECK\s*\(/i.test(line)) {
      const pk = line.match(/PRIMARY\s+KEY\s*\(([^)]+)\)/i);
      if (pk) pkCols.push(...splitCols(pk[1]));
      continue;
    }
    const colM = line.match(new RegExp(`^(${PG_IDENT})\\s+([\\s\\S]+)$`));
    if (!colM) continue;
    const colName = unquote(colM[1]);
    const rest = colM[2];
    const ext = extractType(rest);
    const norm = normalizeType(ext.raw, ext.size, enumMap);
    const upper = rest.toUpperCase();
    const isPK = /\bPRIMARY\s+KEY\b/.test(upper);
    const notNull = /\bNOT\s+NULL\b/.test(upper) || norm.increment;
    const unique = /\bUNIQUE\b/.test(upper) && !isPK;
    const defM = rest.match(/DEFAULT\s+('(?:[^']|'')*'|[^\s,]+)/i);
    const def = defM ? stripPostgresDefault(defM[1]) : "";
    const inlineFk = rest.match(RE_INLINE_FK);
    if (inlineFk) {
      pendingFks.push({
        name: `fk_${name}_${colName}`,
        sourceTable: name,
        sourceCols: [colName],
        targetTable: unquote(inlineFk[1]),
        targetCols: splitCols(inlineFk[2]),
        ...referentialActions(rest),
      });
    }
    fields.push({
      id: fields.length, name: colName, type: norm.type, size: norm.size || "",
      notNull, primary: isPK, unique, increment: !!norm.increment,
      default: def, comment: "", check: "",
      ...(norm.values ? { values: norm.values } : {}),
    });
  }
  markPrimaryKeys(fields, pkCols);
  return makeImportedTable({ id, name, fields });
}

const MULTIWORD = [
  [/^double\s+precision/i, "DOUBLE PRECISION"],
  [/^timestamp(?:\s+with(?:out)?\s+time\s+zone)?/i, "TIMESTAMP"],
  [/^time(?:\s+with(?:out)?\s+time\s+zone)?/i, "TIME"],
  [/^character\s+varying/i, "VARCHAR"],
];

function extractType(rest) {
  for (const [re, canon] of MULTIWORD) {
    const mm = rest.match(re);
    if (mm) {
      const after = rest.slice(mm[0].length).match(/^\s*\(([^)]*)\)/);
      return { raw: canon, size: after ? after[1].trim() : "" };
    }
  }
  const m = rest.match(new RegExp(`^(${PG_IDENT})\\s*(?:\\(([^)]*)\\))?`));
  if (!m) return { raw: "VARCHAR", size: "" };
  return { raw: unquote(m[1]), size: m[2] ? m[2].trim() : "" };
}

function normalizeType(raw, size, enumMap) {
  const key = String(raw).replace(/^"|"$/g, "").toLowerCase();
  if (enumMap.has(key)) {
    return { type: "ENUM", size: "", increment: false, values: enumMap.get(key).slice() };
  }
  const u = String(raw).toUpperCase();
  switch (u) {
    case "SMALLSERIAL": case "SERIAL2": return { type: "SMALLINT", size: "", increment: true };
    case "SERIAL": case "SERIAL4": return { type: "INT", size: "", increment: true };
    case "BIGSERIAL": case "SERIAL8": return { type: "BIGINT", size: "", increment: true };
    case "INT2": case "SMALLINT": return { type: "SMALLINT", size: "" };
    case "INT": case "INT4": case "INTEGER": return { type: "INT", size: "" };
    case "INT8": case "BIGINT": return { type: "BIGINT", size: "" };
    case "NUMERIC": case "DECIMAL": return { type: "DECIMAL", size };
    case "REAL": case "FLOAT4": return { type: "FLOAT", size: "" };
    case "DOUBLE PRECISION": case "FLOAT8": return { type: "DOUBLE", size: "" };
    case "MONEY": return { type: "DECIMAL", size: "19,2" };
    case "VARCHAR": case "CHARACTER VARYING": return { type: "VARCHAR", size };
    case "CHAR": case "CHARACTER": case "BPCHAR": return { type: "CHAR", size };
    case "TEXT": return { type: "TEXT", size: "" };
    case "BYTEA": return { type: "BLOB", size: "" };
    case "DATE": return { type: "DATE", size: "" };
    case "TIME": return { type: "TIME", size: "" };
    case "TIMESTAMP": case "TIMESTAMPTZ": return { type: "TIMESTAMP", size: "" };
    case "BOOLEAN": case "BOOL": return { type: "BOOLEAN", size: "" };
    case "JSON": case "JSONB": return { type: "JSON", size: "" };
    case "UUID": return { type: "UUID", size: "" };
    default: return { type: u, size };
  }
}

function stripPostgresDefault(value) {
  const text = String(value).trim().replace(/::[\w".\s]+$/, "");
  if (/^nextval\(/i.test(text)) return "";
  return stripStringLiteral(text);
}
