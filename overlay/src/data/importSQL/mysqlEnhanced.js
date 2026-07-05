// MySQL DDL parser (subset) → drawDB diagram
import { normalizeConstraintAction, stripSqlComments } from "./common.js";

const MYSQL_IDENT = "(?:`(?:[^`]|``)+`|[\\w$]+)";
const RE_CREATE_TABLE = new RegExp(
  `CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(${MYSQL_IDENT})\\s*\\(([\\s\\S]*?)\\)\\s*(ENGINE\\s*=[^;]*)?;`,
  "gi",
);
const RE_ALTER_FK = new RegExp(
  `ALTER\\s+TABLE\\s+(${MYSQL_IDENT})\\s+ADD\\s+CONSTRAINT\\s+(${MYSQL_IDENT})\\s+FOREIGN\\s+KEY\\s*\\(([^)]+)\\)\\s+REFERENCES\\s+(${MYSQL_IDENT})\\s*\\(([^)]+)\\)(?:\\s+ON\\s+DELETE\\s+([A-Z\\s]+?))?(?:\\s+ON\\s+UPDATE\\s+([A-Z\\s]+?))?\\s*;`,
  "gi",
);
const RE_TABLE_FK = new RegExp(
  `^(?:CONSTRAINT\\s+(${MYSQL_IDENT})\\s+)?FOREIGN\\s+KEY\\s*\\(([^)]+)\\)\\s+REFERENCES\\s+(${MYSQL_IDENT})\\s*\\(([^)]+)\\)`,
  "i",
);
const RE_INLINE_FK = new RegExp(
  `\\bREFERENCES\\s+(${MYSQL_IDENT})\\s*\\(([^)]+)\\)`,
  "i",
);
const unq = (s) => String(s).trim().replace(/^`|`$/g, "").replace(/``/g, "`");

export function fromMySQL(sql) {
  const source = stripSqlComments(sql);
  const tables = [];
  const relationships = [];
  const pendingFks = [];
  const tableMap = new Map();
  let id = 0, m;
  while ((m = RE_CREATE_TABLE.exec(source)) !== null) {
    const name = unq(m[1]);
    const t = parseTable(name, m[2], id++, pendingFks);
    tables.push(t);
    tableMap.set(name.toLowerCase(), t);
  }
  pendingFks.forEach((fk) => addRelationship(relationships, tableMap, fk));
  while ((m = RE_ALTER_FK.exec(source)) !== null) {
    addRelationship(relationships, tableMap, {
      name: unq(m[2]),
      sourceTable: unq(m[1]),
      sourceCols: splitCols(m[3]),
      targetTable: unq(m[4]),
      targetCols: splitCols(m[5]),
      deleteConstraint: normalizeConstraintAction(m[6]),
      updateConstraint: normalizeConstraintAction(m[7]),
    });
  }
  return { tables, relationships };
}

function parseTable(name, body, id, pendingFks) {
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
      const ix = line.match(new RegExp(`^(UNIQUE\\s+)?KEY\\s+(${MYSQL_IDENT})\\s*\\(([^)]+)\\)`, "i"));
      if (ix) indices.push({ id: indices.length, name: ix[2],
        fields: splitCols(ix[3]), unique: !!ix[1] });
      continue;
    }
    const fk = line.match(RE_TABLE_FK);
    if (fk) {
      pendingFks.push({
        name: fk[1] ? unq(fk[1]) : `fk_${name}_${pendingFks.length + 1}`,
        sourceTable: name,
        sourceCols: splitCols(fk[2]),
        targetTable: unq(fk[3]),
        targetCols: splitCols(fk[4]),
        ...constraintActions(line),
      });
      continue;
    }
    if (/^CONSTRAINT\s+/i.test(line)) continue;
    const colM = line.match(new RegExp(`^(${MYSQL_IDENT})\\s+(.+)$`));
    if (!colM) continue;
    const colName = unq(colM[1]);
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
    const inlineFk = rest.match(RE_INLINE_FK);
    if (inlineFk) {
      pendingFks.push({
        name: `fk_${name}_${colName}`,
        sourceTable: name,
        sourceCols: [colName],
        targetTable: unq(inlineFk[1]),
        targetCols: splitCols(inlineFk[2]),
        ...constraintActions(rest),
      });
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

function addRelationship(relationships, tableMap, fk) {
  const sT = tableMap.get(fk.sourceTable.toLowerCase());
  const eT = tableMap.get(fk.targetTable.toLowerCase());
  if (!sT || !eT) return;
  const startFieldId = sT.fields.findIndex(f => f.name === fk.sourceCols[0]);
  const endFieldId = eT.fields.findIndex(f => f.name === fk.targetCols[0]);
  if (startFieldId < 0 || endFieldId < 0) return;
  relationships.push({
    id: relationships.length,
    name: fk.name,
    startTableId: sT.id,
    startFieldId,
    endTableId: eT.id,
    endFieldId,
    cardinality: "one_to_many",
    deleteConstraint: fk.deleteConstraint,
    updateConstraint: fk.updateConstraint,
  });
}

function splitCols(cols) {
  return cols.split(",").map(s => unq(s.trim()));
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
