// PostgreSQL DDL parser (subset) -> drawDB diagram
// Handles: CREATE TYPE ... AS ENUM, CREATE TABLE (with SERIAL/NUMERIC/BYTEA/JSONB/
// multi-word types), inline + table-level PRIMARY KEY/UNIQUE, COMMENT ON TABLE/COLUMN,
// CREATE [UNIQUE] INDEX, ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY ... [ON DELETE/UPDATE].
const RE_CREATE_ENUM  = /CREATE\s+TYPE\s+([\w.""]+)\s+AS\s+ENUM\s*\(([^)]*)\)\s*;/gi;
const RE_CREATE_TABLE = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w.""]+)\s*\(([\s\S]*?)\)\s*;/gi;
const RE_COMMENT_TBL  = /COMMENT\s+ON\s+TABLE\s+([\w.""]+)\s+IS\s+'((?:[^']|'')*)'\s*;/gi;
const RE_COMMENT_COL  = /COMMENT\s+ON\s+COLUMN\s+([\w.""]+)\.([\w""]+)\s+IS\s+'((?:[^']|'')*)'\s*;/gi;
const RE_CREATE_INDEX = /CREATE\s+(UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w.""]+)\s+ON\s+([\w.""]+)\s*(?:USING\s+\w+\s*)?\(([^)]+)\)\s*;/gi;
const RE_ALTER_FK     = /ALTER\s+TABLE\s+([\w.""]+)\s+ADD\s+CONSTRAINT\s+([\w.""]+)\s+FOREIGN\s+KEY\s*\(([^)]+)\)\s+REFERENCES\s+([\w.""]+)\s*\(([^)]+)\)(?:\s+ON\s+DELETE\s+([A-Z\s]+?))?(?:\s+ON\s+UPDATE\s+([A-Z\s]+?))?\s*;/gi;

const unquote = (s) =>
  String(s).replace(/^"|"$/g, "").replace(/""/g, '"').replace(/^.*\./, "");

export function fromPostgres(sql) {
  const tables = [];
  const relationships = [];
  const tableMap = new Map();
  const enumMap = new Map(); // lower(name) -> [values]
  let m, id = 0;

  RE_CREATE_ENUM.lastIndex = 0;
  while ((m = RE_CREATE_ENUM.exec(sql)) !== null) {
    const name = unquote(m[1]).toLowerCase();
    const values = m[2]
      .split(",")
      .map((s) => s.trim().replace(/^'|'$/g, "").replace(/''/g, "'"))
      .filter((s) => s.length > 0);
    enumMap.set(name, values);
  }

  RE_CREATE_TABLE.lastIndex = 0;
  while ((m = RE_CREATE_TABLE.exec(sql)) !== null) {
    const name = unquote(m[1]);
    const t = parseTableBody(name, m[2], id++, enumMap);
    tables.push(t);
    tableMap.set(name.toLowerCase(), t);
  }

  RE_COMMENT_TBL.lastIndex = 0;
  while ((m = RE_COMMENT_TBL.exec(sql)) !== null) {
    const t = tableMap.get(unquote(m[1]).toLowerCase());
    if (t) t.comment = m[2].replace(/''/g, "'");
  }
  RE_COMMENT_COL.lastIndex = 0;
  while ((m = RE_COMMENT_COL.exec(sql)) !== null) {
    const t = tableMap.get(unquote(m[1]).toLowerCase());
    if (!t) continue;
    const colName = unquote(m[2]);
    const f = t.fields.find((x) => x.name.toLowerCase() === colName.toLowerCase());
    if (f) f.comment = m[3].replace(/''/g, "'");
  }
  RE_CREATE_INDEX.lastIndex = 0;
  while ((m = RE_CREATE_INDEX.exec(sql)) !== null) {
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
  RE_ALTER_FK.lastIndex = 0;
  while ((m = RE_ALTER_FK.exec(sql)) !== null) {
    const sT = tableMap.get(unquote(m[1]).toLowerCase());
    const eT = tableMap.get(unquote(m[4]).toLowerCase());
    if (!sT || !eT) continue;
    const sCols = m[3].split(",").map((s) => unquote(s.trim()));
    const eCols = m[5].split(",").map((s) => unquote(s.trim()));
    relationships.push({
      id: relationships.length,
      name: unquote(m[2]),
      startTableId: sT.id,
      startFieldId: sT.fields.findIndex((f) => f.name === sCols[0]),
      endTableId: eT.id,
      endFieldId: eT.fields.findIndex((f) => f.name === eCols[0]),
      cardinality: "one_to_many",
      updateConstraint: m[7] ? m[7].trim().toUpperCase().replace(/\s+/g, " ") : "NO ACTION",
      deleteConstraint: m[6] ? m[6].trim().toUpperCase().replace(/\s+/g, " ") : "NO ACTION",
    });
  }

  return { tables, relationships };
}

function parseTableBody(name, body, id, enumMap) {
  const fields = [];
  const pkCols = [];
  const lines = splitTopLevel(body);
  let fIdx = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/^CONSTRAINT\s+/i.test(line) || /^PRIMARY\s+KEY\s*\(/i.test(line) ||
        /^UNIQUE\s*\(/i.test(line) || /^FOREIGN\s+KEY\b/i.test(line) || /^CHECK\s*\(/i.test(line)) {
      const pk = line.match(/PRIMARY\s+KEY\s*\(([^)]+)\)/i);
      if (pk) pk[1].split(",").forEach((c) => pkCols.push(unquote(c.trim())));
      continue;
    }
    const colM = line.match(/^("[^"]+"|[A-Za-z_][\w$]*)\s+([\s\S]+)$/);
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
  const m = rest.match(/^("[^"]+"|[A-Za-z_][A-Za-z0-9_]*)\s*(?:\(([^)]*)\))?/);
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
