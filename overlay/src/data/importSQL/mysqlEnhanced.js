// MySQL DDL parser (subset) → drawDB diagram
const RE_CREATE_TABLE = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([\w$]+)`?\s*\(([\s\S]*?)\)\s*(ENGINE\s*=[^;]*)?;/gi;
const RE_ALTER_FK     = /ALTER\s+TABLE\s+`?([\w$]+)`?\s+ADD\s+CONSTRAINT\s+`?([\w$]+)`?\s+FOREIGN\s+KEY\s*\(([^)]+)\)\s+REFERENCES\s+`?([\w$]+)`?\s*\(([^)]+)\)(?:\s+ON\s+DELETE\s+([A-Z\s]+?))?(?:\s+ON\s+UPDATE\s+([A-Z\s]+?))?\s*;/gi;
const unq = (s) => String(s).replace(/^`|`$/g, "");

export function fromMySQL(sql) {
  const tables = [];
  const relationships = [];
  const tableMap = new Map();
  let id = 0, m;
  while ((m = RE_CREATE_TABLE.exec(sql)) !== null) {
    const name = unq(m[1]);
    const t = parseTable(name, m[2], id++);
    tables.push(t);
    tableMap.set(name.toLowerCase(), t);
  }
  while ((m = RE_ALTER_FK.exec(sql)) !== null) {
    const sT = tableMap.get(unq(m[1]).toLowerCase());
    const eT = tableMap.get(unq(m[4]).toLowerCase());
    if (!sT || !eT) continue;
    const sCols = m[3].split(",").map(s => unq(s.trim()));
    const eCols = m[5].split(",").map(s => unq(s.trim()));
    relationships.push({
      id: relationships.length, name: unq(m[2]),
      startTableId: sT.id, startFieldId: sT.fields.findIndex(f => f.name === sCols[0]),
      endTableId: eT.id, endFieldId: eT.fields.findIndex(f => f.name === eCols[0]),
      cardinality: "one_to_many",
      deleteConstraint: m[6] ? m[6].trim().toUpperCase() : "NO ACTION",
      updateConstraint: m[7] ? m[7].trim().toUpperCase() : "NO ACTION",
    });
  }
  return { tables, relationships };
}

function parseTable(name, body, id) {
  const fields = [];
  const pkCols = [];
  const indices = [];
  let fIdx = 0;
  const lines = splitTopLevel(body);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/^PRIMARY\s+KEY/i.test(line)) {
      const pk = line.match(/PRIMARY\s+KEY\s*\(([^)]+)\)/i);
      if (pk) pk[1].split(",").forEach(c => pkCols.push(unq(c.trim())));
      continue;
    }
    if (/^(UNIQUE\s+)?KEY\s+/i.test(line)) {
      const ix = line.match(/^(UNIQUE\s+)?KEY\s+`?([\w$]+)`?\s*\(([^)]+)\)/i);
      if (ix) indices.push({ id: indices.length, name: ix[2],
        fields: ix[3].split(",").map(s => unq(s.trim())), unique: !!ix[1] });
      continue;
    }
    if (/^CONSTRAINT\s+/i.test(line)) continue;
    const colM = line.match(/^`?([\w$]+)`?\s+(.+)$/);
    if (!colM) continue;
    const colName = colM[1];
    const rest = colM[2];
    let type = "VARCHAR", size = "";
    const tM = rest.match(/^([A-Z0-9_]+)(?:\s*\(([^)]*)\))?/i);
    if (tM) { type = tM[1].toUpperCase(); size = tM[2] || ""; }
    const upper = rest.toUpperCase();
    const notNull   = /\bNOT NULL\b/.test(upper);
    const increment = /\bAUTO_INCREMENT\b/.test(upper);
    const isPK      = /\bPRIMARY KEY\b/.test(upper);
    const unique    = /\bUNIQUE\b/.test(upper) && !isPK;
    const defM = rest.match(/DEFAULT\s+('(?:[^']|'')*'|[^\s,]+)/i);
    const def  = defM ? unqLit(defM[1]) : "";
    const cmtM = rest.match(/COMMENT\s+'((?:[^']|'')*)'/i);
    const cmt  = cmtM ? cmtM[1].replace(/''/g, "'") : "";
    let values = undefined;
    if (type === "ENUM" || type === "SET") {
      values = (size || "").split(",").map(s => s.trim().replace(/^'|'$/g, "").replace(/''/g, "'"));
      size = "";
    }
    fields.push({ id: fIdx++, name: colName, type, size,
      notNull, primary: isPK, unique, increment,
      default: def, comment: cmt, check: "", values });
  }
  pkCols.forEach(pk => {
    const f = fields.find(x => x.name === pk);
    if (f) f.primary = true;
  });
  return { id, name,
    x: 20 + (id % 5) * 240, y: 20 + Math.floor(id / 5) * 220,
    fields, indices, comment: "", color: "#175e7a" };
}
function splitTopLevel(body) {
  const out = []; let depth = 0; let buf = ""; let q = false;
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
function unqLit(s) {
  s = String(s).trim();
  if (s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
  return s;
}
