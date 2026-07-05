// PostgreSQL DDL parser (subset) -> drawDB diagram
// Handles: CREATE TYPE ... AS ENUM, CREATE TABLE (with SERIAL/NUMERIC/BYTEA/JSONB/
// multi-word types), inline + table-level PRIMARY KEY/UNIQUE, COMMENT ON TABLE/COLUMN,
// CREATE [UNIQUE] INDEX, ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY ... [ON DELETE/UPDATE].
import { normalizeConstraintAction, stripSqlComments } from "./common.js";

const PG_IDENT = String.raw`(?:"(?:[^"]|"")+"|[\w]+)`;
const PG_QUAL_IDENT = String.raw`(?:(?:"(?:[^"]|"")+"|[\w]+)\.)?(?:"(?:[^"]|"")+"|[\w]+)`;
const RE_CREATE_ENUM = new RegExp(`CREATE\\s+TYPE\\s+(${PG_QUAL_IDENT})\\s+AS\\s+ENUM\\s*\\(([^)]*)\\)\\s*;`, "gi");
const RE_CREATE_TABLE = new RegExp(`CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(${PG_QUAL_IDENT})\\s*\\(([\\s\\S]*?)\\)\\s*;`, "gi");
const RE_COMMENT_TBL = new RegExp(`COMMENT\\s+ON\\s+TABLE\\s+(${PG_QUAL_IDENT})\\s+IS\\s+'((?:[^']|'')*)'\\s*;`, "gi");
const RE_COMMENT_COL = new RegExp(`COMMENT\\s+ON\\s+COLUMN\\s+(${PG_QUAL_IDENT})\\.(${PG_IDENT})\\s+IS\\s+'((?:[^']|'')*)'\\s*;`, "gi");
const RE_CREATE_INDEX = new RegExp(`CREATE\\s+(UNIQUE\\s+)?INDEX\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(${PG_QUAL_IDENT})\\s+ON\\s+(${PG_QUAL_IDENT})\\s*(?:USING\\s+\\w+\\s*)?\\(([^)]+)\\)\\s*;`, "gi");
const RE_ALTER_FK = new RegExp(`ALTER\\s+TABLE\\s+(${PG_QUAL_IDENT})\\s+ADD\\s+CONSTRAINT\\s+(${PG_IDENT})\\s+FOREIGN\\s+KEY\\s*\\(([^)]+)\\)\\s+REFERENCES\\s+(${PG_QUAL_IDENT})\\s*\\(([^)]+)\\)(?:\\s+ON\\s+DELETE\\s+([A-Z\\s]+?))?(?:\\s+ON\\s+UPDATE\\s+([A-Z\\s]+?))?\\s*;`, "gi");
const RE_TABLE_FK = new RegExp(`^(?:CONSTRAINT\\s+(${PG_IDENT})\\s+)?FOREIGN\\s+KEY\\s*\\(([^)]+)\\)\\s+REFERENCES\\s+(${PG_QUAL_IDENT})\\s*\\(([^)]+)\\)`, "i");
const RE_INLINE_FK = new RegExp(`\\bREFERENCES\\s+(${PG_QUAL_IDENT})\\s*\\(([^)]+)\\)`, "i");

const unquote = (s) => {
  const last = String(s).trim().split(".").pop() || "";
  return last.replace(/^"|"$/g, "").replace(/""/g, '"');
};

export function fromPostgres(sql) {
  const source = stripSqlComments(sql);
  const tables = [];
  const relationships = [];
  const pendingFks = [];
  const tableMap = new Map();
  const enumMap = new Map(); // lower(name) -> [values]
  let m, id = 0;

  RE_CREATE_ENUM.lastIndex = 0;
  while ((m = RE_CREATE_ENUM.exec(source)) !== null) {
    const name = unquote(m[1]).toLowerCase();
    const values = m[2]
      .split(",")
      .map((s) => s.trim().replace(/^'|'$/g, "").replace(/''/g, "'"))
      .filter((s) => s.length > 0);
    enumMap.set(name, values);
  }

  RE_CREATE_TABLE.lastIndex = 0;
  while ((m = RE_CREATE_TABLE.exec(source)) !== null) {
    const name = unquote(m[1]);
    const t = parseTableBody(name, m[2], id++, enumMap, pendingFks);
    tables.push(t);
    tableMap.set(name.toLowerCase(), t);
  }

  RE_COMMENT_TBL.lastIndex = 0;
  while ((m = RE_COMMENT_TBL.exec(source)) !== null) {
    const t = tableMap.get(unquote(m[1]).toLowerCase());
    if (t) t.comment = m[2].replace(/''/g, "'");
  }
  RE_COMMENT_COL.lastIndex = 0;
  while ((m = RE_COMMENT_COL.exec(source)) !== null) {
    const t = tableMap.get(unquote(m[1]).toLowerCase());
    if (!t) continue;
    const colName = unquote(m[2]);
    const f = t.fields.find((x) => x.name.toLowerCase() === colName.toLowerCase());
    if (f) f.comment = m[3].replace(/''/g, "'");
  }
  RE_CREATE_INDEX.lastIndex = 0;
  while ((m = RE_CREATE_INDEX.exec(source)) !== null) {
    const t = tableMap.get(unquote(m[3]).toLowerCase());
    if (!t) continue;
    t.indices = t.indices || [];
    t.indices.push({
      id: t.indices.length,
      name: unquote(m[2]),
      fields: m[4].split(",").map((s) => unquote(s.trim())),
      unique: !!m[1],
    });
  }
  pendingFks.forEach((fk) => addRelationship(relationships, tableMap, fk));
  RE_ALTER_FK.lastIndex = 0;
  while ((m = RE_ALTER_FK.exec(source)) !== null) {
    addRelationship(relationships, tableMap, {
      name: unquote(m[2]),
      sourceTable: unquote(m[1]),
      sourceCols: splitCols(m[3]),
      targetTable: unquote(m[4]),
      targetCols: splitCols(m[5]),
      updateConstraint: normalizeConstraintAction(m[7]),
      deleteConstraint: normalizeConstraintAction(m[6]),
    });
  }

  return { tables, relationships };
}

function parseTableBody(name, body, id, enumMap, pendingFks) {
  const fields = [];
  const pkCols = [];
  const lines = splitTopLevel(body);
  let fIdx = 0;
  for (const raw of lines) {
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
        ...constraintActions(line),
      });
      continue;
    }
    if (/^CONSTRAINT\s+/i.test(line) || /^PRIMARY\s+KEY\s*\(/i.test(line) ||
        /^UNIQUE\s*\(/i.test(line) || /^CHECK\s*\(/i.test(line)) {
      const pk = line.match(/PRIMARY\s+KEY\s*\(([^)]+)\)/i);
      if (pk) pk[1].split(",").forEach((c) => pkCols.push(unquote(c.trim())));
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
    const def = defM ? stripDefault(defM[1]) : "";
    const inlineFk = rest.match(RE_INLINE_FK);
    if (inlineFk) {
      pendingFks.push({
        name: `fk_${name}_${colName}`,
        sourceTable: name,
        sourceCols: [colName],
        targetTable: unquote(inlineFk[1]),
        targetCols: splitCols(inlineFk[2]),
        ...constraintActions(rest),
      });
    }
    fields.push({
      id: fIdx++, name: colName, type: norm.type, size: norm.size || "",
      notNull, primary: isPK, unique, increment: !!norm.increment,
      default: def, comment: "", check: "",
      ...(norm.values ? { values: norm.values } : {}),
    });
  }
  pkCols.forEach((pk) => {
    const f = fields.find((f) => f.name === pk);
    if (f) f.primary = true;
  });
  return {
    id, name,
    x: 20 + (id % 5) * 240, y: 20 + Math.floor(id / 5) * 220,
    fields, indices: [], comment: "", color: "#175e7a",
  };
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

function addRelationship(relationships, tableMap, fk) {
  const sT = tableMap.get(fk.sourceTable.toLowerCase());
  const eT = tableMap.get(fk.targetTable.toLowerCase());
  if (!sT || !eT) return;
  const startFieldId = sT.fields.findIndex((f) => f.name === fk.sourceCols[0]);
  const endFieldId = eT.fields.findIndex((f) => f.name === fk.targetCols[0]);
  if (startFieldId < 0 || endFieldId < 0) return;
  relationships.push({
    id: relationships.length,
    name: fk.name,
    startTableId: sT.id,
    startFieldId,
    endTableId: eT.id,
    endFieldId,
    cardinality: "one_to_many",
    updateConstraint: fk.updateConstraint,
    deleteConstraint: fk.deleteConstraint,
  });
}

function splitCols(cols) {
  return cols.split(",").map((s) => unquote(s.trim()));
}

function constraintActions(text) {
  const del = text.match(/\bON\s+DELETE\s+(CASCADE|SET\s+NULL|RESTRICT|NO\s+ACTION|SET\s+DEFAULT)/i);
  const upd = text.match(/\bON\s+UPDATE\s+(CASCADE|SET\s+NULL|RESTRICT|NO\s+ACTION|SET\s+DEFAULT)/i);
  return {
    deleteConstraint: normalizeConstraintAction(del?.[1]),
    updateConstraint: normalizeConstraintAction(upd?.[1]),
  };
}

function splitTopLevel(body) {
  const out = [];
  let depth = 0, buf = "", q = false;
  for (const ch of body) {
    if (ch === "'" && !q) q = true;
    else if (ch === "'" && q) q = false;
    if (!q) {
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      if (ch === "," && depth === 0) { out.push(buf); buf = ""; continue; }
    }
    buf += ch;
  }
  if (buf.trim()) out.push(buf);
  return out;
}

function stripDefault(s) {
  s = String(s).trim().replace(/::[\w".\s]+$/, "");
  if (/^nextval\(/i.test(s)) return "";
  if (s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
  return s;
}
