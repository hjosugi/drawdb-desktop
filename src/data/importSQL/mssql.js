// @ts-check
// SQL Server (T-SQL) DDL parser (subset) → drawDB diagram.
// Accepts the DDL written by exportSQL/mssql.js and SSMS "Script Table as"
// output: [bracket] or "double-quote" identifiers, dbo. prefixes, GO batch
// separators, IDENTITY, computed columns, CLUSTERED keys with WITH (...) ON
// [PRIMARY] options, CHECK (... IN (...)) enums, and MS_Description
// extended properties as comments.
import {
  addRelationship,
  applyIndexStatements,
  eachMatch,
  extractGeneratedColumn,
  identifierPattern,
  makeImportedTable,
  markPrimaryKeys,
  parseStringList,
  referentialActions,
  splitColumnList,
  splitTopLevel,
  stripSqlComments,
  unquoteIdentifier,
} from "./common.js";

const IDENTIFIERS = identifierPattern(["[", '"']);
const { ident: IDENT, qualified: QUAL } = IDENTIFIERS;
const ACTIONS = String.raw`(?:\s+ON\s+(?:DELETE|UPDATE)\s+(?:CASCADE|SET\s+NULL|SET\s+DEFAULT|NO\s+ACTION))*`;
const RE_CREATE_TABLE = new RegExp(
  `CREATE\\s+TABLE\\s+(${QUAL})\\s*\\(([\\s\\S]*?)\\)\\s*(?:ON\\s+${IDENT}\\s*)?(?:TEXTIMAGE_ON\\s+${IDENT}\\s*)?(?:;|\\bGO\\b|$)`,
  "gi",
);
const RE_ALTER_FK = new RegExp(
  `ALTER\\s+TABLE\\s+(${QUAL})\\s+(?:WITH\\s+(?:NO)?CHECK\\s+)?ADD\\s+(?:CONSTRAINT\\s+(${IDENT})\\s+)?FOREIGN\\s+KEY\\s*\\(([^)]+)\\)\\s*REFERENCES\\s+(${QUAL})\\s*\\(([^)]+)\\)(${ACTIONS})`,
  "gi",
);
const RE_ALTER_CHECK = new RegExp(
  `ALTER\\s+TABLE\\s+(${QUAL})\\s+(?:WITH\\s+(?:NO)?CHECK\\s+)?ADD\\s+(?:CONSTRAINT\\s+(${IDENT})\\s+)?CHECK\\s*\\(`,
  "gi",
);
const RE_ALTER_DEFAULT = new RegExp(
  `ALTER\\s+TABLE\\s+(${QUAL})\\s+ADD\\s+(?:CONSTRAINT\\s+${IDENT}\\s+)?DEFAULT\\s+`,
  "gi",
);
const RE_TABLE_FK = new RegExp(
  `^(?:CONSTRAINT\\s+(${IDENT})\\s+)?FOREIGN\\s+KEY\\s*\\(([^)]+)\\)\\s*REFERENCES\\s+(${QUAL})\\s*\\(([^)]+)\\)`,
  "i",
);
const RE_INLINE_FK = new RegExp(`\\bREFERENCES\\s+(${QUAL})\\s*\\(([^)]+)\\)`, "i");
const RE_EXTENDED_PROPERTY = /EXEC(?:UTE)?\s+(?:sys\s*\.\s*)?sp_addextendedproperty\b([\s\S]*?)(?:;|\bGO\b|(?=\bEXEC(?:UTE)?\b)|$)/gi;

const unquote = (s) => unquoteIdentifier(s);
const splitCols = (cols) =>
  splitColumnList(cols, (column) => unquote(column.replace(/\s+(ASC|DESC)\s*$/i, "")));

/**
 * @param {string} sql DDL script
 * @returns {import("../../types/drawdb").ImportedSchema}
 */
export function fromMSSQL(sql) {
  const source = stripSqlComments(sql);
  const tables = [];
  const relationships = [];
  const pendingFks = [];
  const tableMap = new Map();

  eachMatch(RE_CREATE_TABLE, source, (m) => {
    const name = unquote(m[1]);
    const table = parseTableBody(name, m[2], tables.length, pendingFks);
    tables.push(table);
    tableMap.set(name.toLowerCase(), table);
  });

  eachMatch(RE_ALTER_CHECK, source, (m) => {
    const table = tableMap.get(unquote(m[1]).toLowerCase());
    const body = balanced(source, m.index + m[0].length - 1);
    if (table && body !== null) applyCheck(table, body, m[2] ? unquote(m[2]) : "");
  });
  eachMatch(RE_ALTER_DEFAULT, source, (m) => {
    const table = tableMap.get(unquote(m[1]).toLowerCase());
    if (!table) return;
    const rest = source.slice(m.index + m[0].length);
    const value = readDefault(rest);
    const column = rest.slice(value.length).match(new RegExp(`^\\s*FOR\\s+(${IDENT})`, "i"));
    const field = column && findField(table, unquote(column[1]));
    if (field) field.default = cleanDefault(value);
  });
  applyIndexStatements(source, tableMap, IDENTIFIERS, unquote);
  applyExtendedProperties(source, tableMap);

  pendingFks.forEach((fk) => addRelationship(relationships, tableMap, fk));
  eachMatch(RE_ALTER_FK, source, (m) => {
    const sourceTable = unquote(m[1]);
    addRelationship(relationships, tableMap, {
      name: m[2] ? unquote(m[2]) : `FK_${sourceTable}_${relationships.length + 1}`,
      sourceTable,
      sourceCols: splitCols(m[3]),
      targetTable: unquote(m[4]),
      targetCols: splitCols(m[5]),
      ...referentialActions(m[6] || ""),
    });
  });

  return { tables, relationships };
}

function findField(table, name) {
  const lower = String(name).toLowerCase();
  return table.fields.find((field) => field.name.toLowerCase() === lower);
}

/** Returns the text inside the parenthesis opening at `open`, or null. */
function balanced(text, open) {
  let depth = 0;
  let quote = "";
  for (let index = open; index < text.length; index++) {
    const ch = text[index];
    if (quote) {
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === "'") quote = "'";
    else if (ch === "[") quote = "]";
    else if (ch === "(") depth++;
    else if (ch === ")" && --depth === 0) return text.slice(open + 1, index);
  }
  return null;
}

/** Reads a DEFAULT expression: a literal, a function call, or ((…)). */
function readDefault(rest) {
  const trimmed = rest.replace(/^\s+/, "");
  const lead = rest.length - trimmed.length;
  if (trimmed.startsWith("(")) {
    const inner = balanced(trimmed, 0);
    return inner === null ? trimmed : rest.slice(0, lead + inner.length + 2);
  }
  const literal = trimmed.match(/^N?'(?:[^']|'')*'/i);
  if (literal) return rest.slice(0, lead + literal[0].length);
  const call = trimmed.match(/^[\w.]+\s*(?=\()/);
  if (call) {
    const inner = balanced(trimmed, call[0].length);
    if (inner !== null) return rest.slice(0, lead + call[0].length + inner.length + 2);
  }
  const token = trimmed.match(/^[^\s,]+/);
  return rest.slice(0, lead + (token ? token[0].length : 0));
}

/** Normalizes a DEFAULT expression: strips (( )) and decodes N'…' literals. */
function cleanDefault(value) {
  let text = String(value).trim();
  while (text.startsWith("(") && balanced(text, 0) === text.slice(1, -1)) {
    text = text.slice(1, -1).trim();
  }
  const literal = text.match(/^N?'((?:[^']|'')*)'$/i);
  if (literal) return literal[1].replace(/''/g, "'");
  if (/^(getdate|sysdatetime|current_timestamp)(\(\))?$/i.test(text)) return "CURRENT_TIMESTAMP";
  return text;
}

/** Applies a CHECK constraint: `col IN (…)` becomes an enum, others a check. */
function applyCheck(table, expression, constraintName) {
  let text = expression.trim();
  while (text.startsWith("(") && balanced(text, 0) === text.slice(1, -1)) text = text.slice(1, -1).trim();
  const enumMatch = text.match(new RegExp(`^(${IDENT})\\s+IN\\s*\\(([\\s\\S]*)\\)$`, "i"));
  if (enumMatch) {
    const field = findField(table, unquote(enumMatch[1]));
    const values = parseStringList(enumMatch[2].replace(/(^|,)\s*N'/gi, "$1'"));
    if (field && values.length && /CHAR|TEXT/i.test(field.type)) {
      field.type = "ENUM";
      field.size = "";
      field.values = values;
      return;
    }
  }
  const prefix = `ck_${table.name}_`.toLowerCase();
  const column = constraintName.toLowerCase().startsWith(prefix)
    ? constraintName.slice(prefix.length)
    : "";
  const field = column && findField(table, column);
  if (field && !field.check) field.check = text;
}

function parseTableBody(name, body, id, pendingFks) {
  const fields = [];
  const pkCols = [];
  const checks = [];
  for (const raw of splitTopLevel(body)) {
    const line = raw.trim();
    if (!line) continue;
    const fk = line.match(RE_TABLE_FK);
    if (fk) {
      pendingFks.push({
        name: fk[1] ? unquote(fk[1]) : `FK_${name}_${pendingFks.length + 1}`,
        sourceTable: name,
        sourceCols: splitCols(fk[2]),
        targetTable: unquote(fk[3]),
        targetCols: splitCols(fk[4]),
        ...referentialActions(line),
      });
      continue;
    }
    const constraint = line.match(new RegExp(`^(?:CONSTRAINT\\s+(${IDENT})\\s+)?(PRIMARY\\s+KEY|UNIQUE|CHECK)\\b`, "i"));
    if (constraint) {
      const kind = constraint[2].toUpperCase();
      const open = line.indexOf("(", constraint[0].length);
      const inner = open >= 0 ? balanced(line, open) : null;
      if (inner === null) continue;
      if (kind.startsWith("PRIMARY")) pkCols.push(...splitCols(inner));
      else if (kind === "UNIQUE") {
        const columns = splitCols(inner);
        if (columns.length === 1) checks.push({ unique: columns[0] });
      } else checks.push({ check: inner, name: constraint[1] ? unquote(constraint[1]) : "" });
      continue;
    }
    const column = line.match(new RegExp(`^(${IDENT})\\s+([\\s\\S]+)$`));
    if (!column) continue;
    fields.push(parseColumn(name, unquote(column[1]), column[2], fields.length, pendingFks));
  }
  markPrimaryKeys(fields, pkCols);
  const table = makeImportedTable({ id, name, fields });
  checks.forEach((entry) => {
    if (entry.unique) {
      const field = findField(table, entry.unique);
      if (field && !field.primary) field.unique = true;
    } else applyCheck(table, entry.check, entry.name);
  });
  return table;
}

function parseColumn(tableName, name, rest, id, pendingFks) {
  const upper = rest.toUpperCase();
  const computed = /^AS\s*\(/i.test(rest) ? extractGeneratedColumn(rest) : null;
  const typeMatch = computed ? null : rest.match(new RegExp(`^(${IDENT}(?:\\s*\\.\\s*${IDENT})?)\\s*(?:\\(([^)]*)\\))?`));
  // Computed columns declare no type; VARCHAR keeps the diagram valid.
  const { type, size } = computed
    ? { type: "VARCHAR", size: "" }
    : normalizeType(unquote(typeMatch?.[1] || "NVARCHAR"), (typeMatch?.[2] || "").trim());

  const defaultAt = rest.search(/\bDEFAULT\b/i);
  const defaultValue = defaultAt >= 0 ? cleanDefault(readDefault(rest.slice(defaultAt + 7))) : "";
  const isPK = /\bPRIMARY\s+KEY\b/.test(upper);
  const inlineCheck = rest.match(/\bCHECK\s*\(/i);
  const field = {
    id,
    name,
    type,
    size,
    notNull: /\bNOT\s+NULL\b/.test(upper) || isPK,
    primary: isPK,
    unique: /\bUNIQUE\b/.test(upper) && !isPK,
    increment: /\bIDENTITY\b/.test(upper),
    default: defaultValue,
    comment: "",
    check: inlineCheck ? balanced(rest, (inlineCheck.index ?? 0) + inlineCheck[0].length - 1) ?? "" : "",
    ...(computed ? { generated: { expression: computed.expression, stored: /\bPERSISTED\b/.test(upper) } } : {}),
  };
  const inlineFk = rest.match(RE_INLINE_FK);
  if (inlineFk) {
    pendingFks.push({
      name: `FK_${tableName}_${name}`,
      sourceTable: tableName,
      sourceCols: [name],
      targetTable: unquote(inlineFk[1]),
      targetCols: splitCols(inlineFk[2]),
      ...referentialActions(rest),
    });
  }
  return field;
}

/** Maps T-SQL types back to drawDB's generic type names. */
function normalizeType(raw, size) {
  const base = String(raw).split(".").pop().toUpperCase();
  const max = size.toUpperCase() === "MAX";
  switch (base) {
    case "NVARCHAR": case "VARCHAR": return max ? { type: "TEXT", size: "" } : { type: "VARCHAR", size };
    case "NCHAR": case "CHAR": return { type: "CHAR", size };
    case "NTEXT": case "TEXT": return { type: "TEXT", size: "" };
    case "INT": return { type: "INT", size: "" };
    case "BIGINT": case "SMALLINT": case "TINYINT": return { type: base, size: "" };
    case "BIT": return { type: "BOOLEAN", size: "" };
    case "DECIMAL": case "NUMERIC": return { type: "DECIMAL", size };
    case "MONEY": return { type: "DECIMAL", size: "19,4" };
    case "SMALLMONEY": return { type: "DECIMAL", size: "10,4" };
    case "FLOAT": return { type: "DOUBLE", size: "" };
    case "REAL": return { type: "FLOAT", size: "" };
    case "DATETIME": case "DATETIME2": case "SMALLDATETIME": return { type: "DATETIME", size: "" };
    case "DATETIMEOFFSET": return { type: "TIMESTAMP", size: "" };
    case "DATE": case "TIME": return { type: base, size: "" };
    case "UNIQUEIDENTIFIER": return { type: "UUID", size: "" };
    case "VARBINARY": return max ? { type: "BLOB", size: "" } : { type: "VARBINARY", size };
    case "BINARY": return { type: "BINARY", size };
    case "IMAGE": return { type: "BLOB", size: "" };
    default: return { type: base, size };
  }
}

/** Reads MS_Description extended properties into table and column comments. */
function applyExtendedProperties(source, tableMap) {
  eachMatch(RE_EXTENDED_PROPERTY, source, (m) => {
    const args = m[1];
    const named = {};
    for (const arg of args.matchAll(/@(\w+)\s*=\s*N?'((?:[^']|'')*)'/gi)) {
      named[arg[1].toLowerCase()] = arg[2].replace(/''/g, "'");
    }
    let name = named.name;
    let value = named.value;
    let tableName = named.level1name;
    let column = named.level2type?.toUpperCase() === "COLUMN" ? named.level2name : undefined;
    if (name === undefined) {
      // Positional form: name, value, level0type, level0name, level1type, level1name, level2type, level2name.
      const positional = [...args.matchAll(/N?'((?:[^']|'')*)'/gi)].map((arg) => arg[1].replace(/''/g, "'"));
      [name, value, , , , tableName] = positional;
      column = positional[6]?.toUpperCase() === "COLUMN" ? positional[7] : undefined;
    }
    if (name !== "MS_Description" || value === undefined || !tableName) return;
    const table = tableMap.get(tableName.toLowerCase());
    if (!table) return;
    if (column === undefined) table.comment = value;
    else {
      const field = findField(table, column);
      if (field) field.comment = value;
    }
  });
}
