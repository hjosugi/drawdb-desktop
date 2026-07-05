// Oracle DDL parser (subset) → drawDB diagram
import { normalizeConstraintAction, stripSqlComments } from "./common.js";

const ORACLE_IDENT = String.raw`(?:"(?:[^"]|"")+"|[\w]+)`;
const ORACLE_QUAL_IDENT = String.raw`(?:(?:"(?:[^"]|"")+"|[\w]+)\.)?(?:"(?:[^"]|"")+"|[\w]+)`;
const RE_CREATE_TABLE = new RegExp(`CREATE\\s+TABLE\\s+(${ORACLE_QUAL_IDENT})\\s*\\(([\\s\\S]*?)\\)\\s*;`, "gi");
const RE_COMMENT_TBL = new RegExp(`COMMENT\\s+ON\\s+TABLE\\s+(${ORACLE_QUAL_IDENT})\\s+IS\\s+'((?:[^']|'')*)'\\s*;`, "gi");
const RE_COMMENT_COL = new RegExp(`COMMENT\\s+ON\\s+COLUMN\\s+(${ORACLE_QUAL_IDENT})\\.(${ORACLE_IDENT})\\s+IS\\s+'((?:[^']|'')*)'\\s*;`, "gi");
const RE_ALTER_FK = new RegExp(`ALTER\\s+TABLE\\s+(${ORACLE_QUAL_IDENT})\\s+ADD\\s+CONSTRAINT\\s+(${ORACLE_IDENT})\\s+FOREIGN\\s+KEY\\s*\\(([^)]+)\\)\\s+REFERENCES\\s+(${ORACLE_QUAL_IDENT})\\s*\\(([^)]+)\\)(?:\\s+ON\\s+DELETE\\s+(CASCADE|SET\\s+NULL))?\\s*;`, "gi");
const RE_CREATE_INDEX = new RegExp(`CREATE\\s+(UNIQUE\\s+)?INDEX\\s+(${ORACLE_IDENT})\\s+ON\\s+(${ORACLE_QUAL_IDENT})\\s*\\(([^)]+)\\)\\s*;`, "gi");
const RE_TABLE_FK = new RegExp(`^(?:CONSTRAINT\\s+(${ORACLE_IDENT})\\s+)?FOREIGN\\s+KEY\\s*\\(([^)]+)\\)\\s+REFERENCES\\s+(${ORACLE_QUAL_IDENT})\\s*\\(([^)]+)\\)`, "i");
const RE_INLINE_FK = new RegExp(`\\bREFERENCES\\s+(${ORACLE_QUAL_IDENT})\\s*\\(([^)]+)\\)`, "i");

const unquote = (s) => {
  const last = String(s).trim().split(".").pop() || "";
  return last.replace(/^"|"$/g, "").replace(/""/g, '"');
};

export function fromOracle(sql) {
  const source = stripSqlComments(sql);
  const tables = [];
  const relationships = [];
  const pendingFks = [];
  const tableMap = new Map();
  let m, id = 0;
  while ((m = RE_CREATE_TABLE.exec(source)) !== null) {
    const name = unquote(m[1]);
    const t = parseTableBody(name, m[2], id++, pendingFks);
    tables.push(t);
    tableMap.set(name.toLowerCase(), t);
  }
  while ((m = RE_COMMENT_TBL.exec(source)) !== null) {
    const t = tableMap.get(unquote(m[1]).toLowerCase());
    if (t) t.comment = m[2].replace(/''/g, "'");
  }
  while ((m = RE_COMMENT_COL.exec(source)) !== null) {
    const t = tableMap.get(unquote(m[1]).toLowerCase());
    if (!t) continue;
    const colName = unquote(m[2]);
    const f = t.fields.find(x => x.name.toLowerCase() === colName.toLowerCase());
    if (f) f.comment = m[3].replace(/''/g, "'");
  }
  while ((m = RE_CREATE_INDEX.exec(source)) !== null) {
    const unique = !!m[1];
    const ixName = unquote(m[2]);
    const t = tableMap.get(unquote(m[3]).toLowerCase());
    if (!t) continue;
    const cols = m[4].split(",").map(s => unquote(s.trim()));
    t.indices = t.indices || [];
    t.indices.push({ id: t.indices.length, name: ixName, fields: cols, unique });
  }
  pendingFks.forEach((fk) => addRelationship(relationships, tableMap, fk));
  while ((m = RE_ALTER_FK.exec(source)) !== null) {
    addRelationship(relationships, tableMap, {
      name: unquote(m[2]),
      sourceTable: unquote(m[1]),
      sourceCols: splitCols(m[3]),
      targetTable: unquote(m[4]),
      targetCols: splitCols(m[5]),
      updateConstraint: "NO ACTION",
      deleteConstraint: normalizeConstraintAction(m[6]),
    });
  }
  return { tables, relationships };
}

function parseTableBody(name, body, id, pendingFks) {
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
        updateConstraint: "NO ACTION",
        ...constraintActions(line),
      });
      continue;
    }
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
    const colM = line.match(new RegExp(`^(${ORACLE_IDENT})\\s+(.+)$`));
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
    const inlineFk = rest.match(RE_INLINE_FK);
    if (inlineFk) {
      pendingFks.push({
        name: `fk_${name}_${colName}`,
        sourceTable: name,
        sourceCols: [colName],
        targetTable: unquote(inlineFk[1]),
        targetCols: splitCols(inlineFk[2]),
        updateConstraint: "NO ACTION",
        ...constraintActions(rest),
      });
    }
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

function addRelationship(relationships, tableMap, fk) {
  const sT = tableMap.get(fk.sourceTable.toLowerCase());
  const eT = tableMap.get(fk.targetTable.toLowerCase());
  if (!sT || !eT) return;
  const startFieldId = sT.fields.findIndex(f => f.name === fk.sourceCols[0]);
  const endFieldId = eT.fields.findIndex(f => f.name === fk.targetCols[0]);
  if (startFieldId < 0 || endFieldId < 0) return;
  relationships.push({
    id: relationships.length, name: fk.name,
    startTableId: sT.id, startFieldId,
    endTableId: eT.id, endFieldId,
    cardinality: "one_to_many", updateConstraint: fk.updateConstraint,
    deleteConstraint: fk.deleteConstraint,
  });
}

function splitCols(cols) {
  return cols.split(",").map(s => unquote(s.trim()));
}

function constraintActions(text) {
  const del = text.match(/\bON\s+DELETE\s+(CASCADE|SET\s+NULL)/i);
  return {
    deleteConstraint: normalizeConstraintAction(del?.[1]),
  };
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
