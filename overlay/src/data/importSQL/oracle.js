// Oracle DDL parser (subset) → drawDB diagram
const RE_CREATE_TABLE = /CREATE\s+TABLE\s+([\w\."]+)\s*\(([\s\S]*?)\)\s*;/gi;
const RE_COMMENT_TBL  = /COMMENT\s+ON\s+TABLE\s+([\w\."]+)\s+IS\s+'((?:[^']|'')*)'\s*;/gi;
const RE_COMMENT_COL  = /COMMENT\s+ON\s+COLUMN\s+([\w\."]+)\.([\w"]+)\s+IS\s+'((?:[^']|'')*)'\s*;/gi;
const RE_ALTER_FK     = /ALTER\s+TABLE\s+([\w\."]+)\s+ADD\s+CONSTRAINT\s+([\w"]+)\s+FOREIGN\s+KEY\s*\(([^)]+)\)\s+REFERENCES\s+([\w\."]+)\s*\(([^)]+)\)(?:\s+ON\s+DELETE\s+(CASCADE|SET\s+NULL))?\s*;/gi;
const RE_CREATE_INDEX = /CREATE\s+(UNIQUE\s+)?INDEX\s+([\w"]+)\s+ON\s+([\w\."]+)\s*\(([^)]+)\)\s*;/gi;

const unquote = (s) => String(s).replace(/^"|"$/g, "").replace(/""/g, '"').replace(/^.*\./, "");

export function fromOracle(sql) {
  const tables = [];
  const relationships = [];
  const tableMap = new Map();
  let m, id = 0;
  while ((m = RE_CREATE_TABLE.exec(sql)) !== null) {
    const name = unquote(m[1]);
    const t = parseTableBody(name, m[2], id++);
    tables.push(t);
    tableMap.set(name.toLowerCase(), t);
  }
  while ((m = RE_COMMENT_TBL.exec(sql)) !== null) {
    const t = tableMap.get(unquote(m[1]).toLowerCase());
    if (t) t.comment = m[2].replace(/''/g, "'");
  }
  while ((m = RE_COMMENT_COL.exec(sql)) !== null) {
    const t = tableMap.get(unquote(m[1]).toLowerCase());
    if (!t) continue;
    const colName = unquote(m[2]);
    const f = t.fields.find(x => x.name.toLowerCase() === colName.toLowerCase());
    if (f) f.comment = m[3].replace(/''/g, "'");
  }
  while ((m = RE_CREATE_INDEX.exec(sql)) !== null) {
    const unique = !!m[1];
    const ixName = unquote(m[2]);
    const t = tableMap.get(unquote(m[3]).toLowerCase());
    if (!t) continue;
    const cols = m[4].split(",").map(s => unquote(s.trim()));
    t.indices = t.indices || [];
    t.indices.push({ id: t.indices.length, name: ixName, fields: cols, unique });
  }
  while ((m = RE_ALTER_FK.exec(sql)) !== null) {
    const sT = tableMap.get(unquote(m[1]).toLowerCase());
    const eT = tableMap.get(unquote(m[4]).toLowerCase());
    if (!sT || !eT) continue;
    const sCols = m[3].split(",").map(s => unquote(s.trim()));
    const eCols = m[5].split(",").map(s => unquote(s.trim()));
    relationships.push({
      id: relationships.length, name: unquote(m[2]),
      startTableId: sT.id, startFieldId: sT.fields.findIndex(f => f.name === sCols[0]),
      endTableId: eT.id, endFieldId: eT.fields.findIndex(f => f.name === eCols[0]),
      cardinality: "one_to_many", updateConstraint: "NO ACTION",
      deleteConstraint: m[6] ? m[6].toUpperCase().replace(/\s+/, " ") : "NO ACTION",
    });
  }
  return { tables, relationships };
}

function parseTableBody(name, body, id) {
  const fields = [];
  const pkCols = [];
  const lines = splitTopLevel(body);
  let fIdx = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/^CONSTRAINT\s+/i.test(line)) {
      const pk = line.match(/PRIMARY\s+KEY\s*\(([^)]+)\)/i);
      if (pk) pk[1].split(",").forEach(c => pkCols.push(unquote(c.trim())));
      continue;
    }
    if (/^PRIMARY\s+KEY\s*\(/i.test(line)) {
      const pk = line.match(/PRIMARY\s+KEY\s*\(([^)]+)\)/i);
      if (pk) pk[1].split(",").forEach(c => pkCols.push(unquote(c.trim())));
      continue;
    }
    const colM = line.match(/^("[^"]+"|\w+)\s+(.+)$/);
    if (!colM) continue;
    const colName = unquote(colM[1]);
    const rest = colM[2];
    const typeM = rest.match(/^([A-Z0-9_]+(?:\s*\([^)]*\))?)/i);
    const type = typeM ? typeM[1].trim() : "VARCHAR2";
    const upper = rest.toUpperCase();
    const isPK = /PRIMARY\s+KEY/.test(upper);
    const notNull = /NOT\s+NULL/.test(upper);
    const unique = /\bUNIQUE\b/.test(upper);
    const increment = /AS\s+IDENTITY/.test(upper);
    const defM = rest.match(/DEFAULT\s+([^,\s]+(?:\s+[^,\s]+)*?)(?=\s+(?:NOT|PRIMARY|UNIQUE|GENERATED|$))/i);
    const def = defM ? stripDefault(defM[1]) : "";
    const { baseType, size } = splitType(type);
    fields.push({
      id: fIdx++, name: colName, type: baseType.toUpperCase(),
      size, notNull, primary: isPK, unique, increment,
      default: def, comment: "", check: "",
    });
  }
  pkCols.forEach(pk => {
    const f = fields.find(f => f.name === pk);
    if (f) f.primary = true;
  });
  return { id, name,
    x: 20 + (id % 5) * 240, y: 20 + Math.floor(id / 5) * 220,
    fields, indices: [], comment: "", color: "#175e7a" };
}

function splitTopLevel(body) {
  const out = []; let depth = 0; let buf = "";
  for (const ch of body) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(buf); buf = ""; continue; }
    buf += ch;
  }
  if (buf.trim()) out.push(buf);
  return out;
}
function splitType(t) {
  const m = t.match(/^([A-Z0-9_]+)\s*\(([^)]*)\)$/i);
  if (!m) return { baseType: t.trim(), size: "" };
  return { baseType: m[1].trim(), size: m[2].trim() };
}
function stripDefault(s) {
  s = String(s).trim();
  if (s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
  return s;
}
