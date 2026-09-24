// Oracle DDL parser (subset) → drawDB diagram
import {
  addRelationship,
  applyCommentStatements,
  applyIndexStatements,
  eachMatch,
  identifierPattern,
  makeImportedTable,
  markPrimaryKeys,
  normalizeConstraintAction,
  referentialActions,
  splitColumnList,
  splitTopLevel,
  stripSqlComments,
  stripStringLiteral,
  unquoteIdentifier,
} from "./common.js";

const IDENTIFIERS = identifierPattern(['"']);
const { ident: ORACLE_IDENT, qualified: ORACLE_QUAL_IDENT } = IDENTIFIERS;
const RE_CREATE_TABLE = new RegExp(`CREATE\\s+TABLE\\s+(${ORACLE_QUAL_IDENT})\\s*\\(([\\s\\S]*?)\\)\\s*;`, "gi");
const RE_ALTER_FK = new RegExp(`ALTER\\s+TABLE\\s+(${ORACLE_QUAL_IDENT})\\s+ADD\\s+CONSTRAINT\\s+(${ORACLE_IDENT})\\s+FOREIGN\\s+KEY\\s*\\(([^)]+)\\)\\s+REFERENCES\\s+(${ORACLE_QUAL_IDENT})\\s*\\(([^)]+)\\)(?:\\s+ON\\s+DELETE\\s+(CASCADE|SET\\s+NULL))?\\s*;`, "gi");
const RE_TABLE_FK = new RegExp(`^(?:CONSTRAINT\\s+(${ORACLE_IDENT})\\s+)?FOREIGN\\s+KEY\\s*\\(([^)]+)\\)\\s+REFERENCES\\s+(${ORACLE_QUAL_IDENT})\\s*\\(([^)]+)\\)`, "i");
const RE_INLINE_FK = new RegExp(`\\bREFERENCES\\s+(${ORACLE_QUAL_IDENT})\\s*\\(([^)]+)\\)`, "i");

const unquote = (s) => unquoteIdentifier(s);
const splitCols = (cols) => splitColumnList(cols, unquote);
// Oracle accepts ON DELETE CASCADE / SET NULL only and has no ON UPDATE.
const oracleActions = (text) => ({
  ...referentialActions(text, { allowedDelete: ["CASCADE", "SET NULL"], update: false }),
  updateConstraint: "NO ACTION",
});

export function fromOracle(sql) {
  const source = stripSqlComments(sql);
  const tables = [];
  const relationships = [];
  const pendingFks = [];
  const tableMap = new Map();
  eachMatch(RE_CREATE_TABLE, source, (m) => {
    const name = unquote(m[1]);
    const t = parseTableBody(name, m[2], tables.length, pendingFks);
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
      updateConstraint: "NO ACTION",
      deleteConstraint: normalizeConstraintAction(m[6]),
    });
  });
  return { tables, relationships };
}

function parseTableBody(name, body, id, pendingFks) {
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
        ...oracleActions(line),
      });
      continue;
    }
    if (/^CONSTRAINT\s+/i.test(line) || /^PRIMARY\s+KEY\s*\(/i.test(line)) {
      const pk = line.match(/PRIMARY\s+KEY\s*\(([^)]+)\)/i);
      if (pk) pkCols.push(...splitCols(pk[1]));
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
    const def = defM ? stripStringLiteral(defM[1]) : "";
    const { baseType, size } = splitType(type);
    const inlineFk = rest.match(RE_INLINE_FK);
    if (inlineFk) {
      pendingFks.push({
        name: `fk_${name}_${colName}`,
        sourceTable: name,
        sourceCols: [colName],
        targetTable: unquote(inlineFk[1]),
        targetCols: splitCols(inlineFk[2]),
        ...oracleActions(rest),
      });
    }
    fields.push({
      id: fields.length, name: colName, type: baseType.toUpperCase(),
      size, notNull, primary: isPK, unique, increment,
      default: def, comment: "", check: "",
    });
  }
  markPrimaryKeys(fields, pkCols);
  return makeImportedTable({ id, name, fields });
}

function splitType(t) {
  const m = t.match(/^([A-Z0-9_]+)\s*\(([^)]*)\)$/i);
  if (!m) return { baseType: t.trim(), size: "" };
  return { baseType: m[1].trim(), size: m[2].trim() };
}
