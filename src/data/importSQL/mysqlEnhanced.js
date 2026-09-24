// MySQL DDL parser (subset) → drawDB diagram
import {
  addRelationship,
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

const { ident: MYSQL_IDENT } = identifierPattern(["`"]);
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
const unq = (s) => unquoteIdentifier(s, { qualified: false });
const splitCols = (cols) => splitColumnList(cols, unq);

export function fromMySQL(sql) {
  const source = stripSqlComments(sql);
  const tables = [];
  const relationships = [];
  const pendingFks = [];
  const tableMap = new Map();
  eachMatch(RE_CREATE_TABLE, source, (m) => {
    const name = unq(m[1]);
    const t = parseTable(name, m[2], tables.length, pendingFks);
    tables.push(t);
    tableMap.set(name.toLowerCase(), t);
  });
  pendingFks.forEach((fk) => addRelationship(relationships, tableMap, fk));
  eachMatch(RE_ALTER_FK, source, (m) => {
    addRelationship(relationships, tableMap, {
      name: unq(m[2]),
      sourceTable: unq(m[1]),
      sourceCols: splitCols(m[3]),
      targetTable: unq(m[4]),
      targetCols: splitCols(m[5]),
      deleteConstraint: normalizeConstraintAction(m[6]),
      updateConstraint: normalizeConstraintAction(m[7]),
    });
  });
  return { tables, relationships };
}

function parseTable(name, body, id, pendingFks) {
  const fields = [];
  const pkCols = [];
  const indices = [];
  for (const raw of splitTopLevel(body)) {
    const line = raw.trim();
    if (!line) continue;
    if (/^PRIMARY\s+KEY/i.test(line)) {
      const pk = line.match(/PRIMARY\s+KEY\s*\(([^)]+)\)/i);
      if (pk) pkCols.push(...splitCols(pk[1]));
      continue;
    }
    if (/^(UNIQUE\s+)?KEY\s+/i.test(line)) {
      const ix = line.match(new RegExp(`^(UNIQUE\\s+)?KEY\\s+(${MYSQL_IDENT})\\s*\\(([^)]+)\\)`, "i"));
      if (ix) indices.push({ id: indices.length, name: unq(ix[2]),
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
        ...referentialActions(line),
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
    const def  = defM ? stripStringLiteral(defM[1]) : "";
    const cmtM = rest.match(/COMMENT\s+'((?:[^']|'')*)'/i);
    const cmt  = cmtM ? cmtM[1].replace(/''/g, "'") : "";
    let values = undefined;
    if (type === "ENUM" || type === "SET") {
      values = parseStringList(size || "");
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
        ...referentialActions(rest),
      });
    }
    fields.push({ id: fields.length, name: colName, type, size,
      notNull, primary: isPK, unique, increment,
      default: def, comment: cmt, check: "", values });
  }
  markPrimaryKeys(fields, pkCols);
  return makeImportedTable({ id, name, fields, indices });
}
