// @ts-check
export function stripSqlComments(sql) {
  const text = String(sql ?? "");
  let out = "";
  let quote = "";

  for (let i = 0; i < text.length;) {
    const ch = text[i];
    const next = text[i + 1];

    if (quote) {
      out += ch;
      if (ch === quote) {
        if ((quote === "'" || quote === '"' || quote === "`") && next === quote) {
          out += next;
          i += 2;
          continue;
        }
        quote = "";
      }
      i++;
      continue;
    }

    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      out += ch;
      i++;
      continue;
    }

    if (ch === "-" && next === "-") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
      continue;
    }

    if (ch === "/" && next === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += i < text.length ? 2 : 0;
      out += " ";
      continue;
    }

    out += ch;
    i++;
  }

  return out;
}

export function normalizeConstraintAction(action) {
  return action ? action.trim().toUpperCase().replace(/\s+/g, " ") : "NO ACTION";
}

// ---------------------------------------------------------------------------
// Shared building blocks for the dialect DDL parsers. Dialect modules supply
// identifier syntax and type normalization; everything else lives here.
// ---------------------------------------------------------------------------

const QUOTE_PAIRS = { "'": "'", '"': '"', "`": "`", "[": "]" };

/**
 * Identifier regex sources for a quoting style. `quotes` lists the opening
 * characters accepted by the dialect (e.g. ['"'] or ['`'] or ['[', '"']).
 */
export function identifierPattern(quotes) {
  const quoted = quotes.map((open) => {
    const close = QUOTE_PAIRS[open];
    const o = open.replace(/[[\]]/g, "\\$&");
    const c = close.replace(/[[\]]/g, "\\$&");
    return `${o}(?:[^${c}]|${c}${c})+${c}`;
  });
  const ident = `(?:${[...quoted, "[\\w$#]+"].join("|")})`;
  return { ident, qualified: `(?:${ident}\\.){0,2}${ident}` };
}

/** Removes identifier quotes (and any schema/database qualifier). */
export function unquoteIdentifier(value, { qualified = true } = {}) {
  const text = String(value ?? "").trim();
  const parts = qualified ? splitQualified(text) : [text];
  const last = (parts[parts.length - 1] || "").trim();
  const open = last[0];
  const close = QUOTE_PAIRS[open];
  if (close && open !== "'" && last.endsWith(close) && last.length >= 2) {
    return last.slice(1, -1).split(close + close).join(close);
  }
  return last;
}

function splitQualified(text) {
  const parts = [];
  let buffer = "";
  let closing = "";
  for (const ch of text) {
    if (closing) {
      buffer += ch;
      if (ch === closing) closing = "";
      continue;
    }
    if (QUOTE_PAIRS[ch] && ch !== "'") {
      closing = QUOTE_PAIRS[ch];
      buffer += ch;
      continue;
    }
    if (ch === ".") {
      parts.push(buffer);
      buffer = "";
      continue;
    }
    buffer += ch;
  }
  parts.push(buffer);
  return parts;
}

/**
 * Splits a CREATE TABLE body on top-level commas, ignoring commas nested in
 * parentheses, string literals, and quoted identifiers.
 */
export function splitTopLevel(body) {
  const out = [];
  let depth = 0;
  let buffer = "";
  let closing = "";
  for (const ch of String(body)) {
    if (closing) {
      buffer += ch;
      if (ch === closing) closing = "";
      continue;
    }
    if (QUOTE_PAIRS[ch]) {
      closing = QUOTE_PAIRS[ch];
      buffer += ch;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(buffer);
      buffer = "";
      continue;
    }
    buffer += ch;
  }
  if (buffer.trim()) out.push(buffer);
  return out;
}

/** Splits a column list such as `"a", "b"` into unquoted names. */
export function splitColumnList(list, unquote = unquoteIdentifier) {
  return splitTopLevel(list).map((column) => unquote(column.trim()));
}

/** Decodes a single-quoted SQL string literal; other values are trimmed. */
export function stripStringLiteral(value) {
  const text = String(value ?? "").trim();
  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) {
    return text.slice(1, -1).replace(/''/g, "'");
  }
  return text;
}

/** Parses the value list of ENUM(...) / CHECK (x IN (...)). */
export function parseStringList(list) {
  return splitTopLevel(list)
    .map((value) => stripStringLiteral(value))
    .filter((value) => value.length > 0);
}

const ACTION = "(CASCADE|SET\\s+NULL|RESTRICT|NO\\s+ACTION|SET\\s+DEFAULT)";

/**
 * Extracts ON DELETE / ON UPDATE actions from a constraint clause.
 * `allowedDelete` restricts which delete actions are recognised (Oracle).
 */
export function referentialActions(text, { allowedDelete = null, update = true } = {}) {
  const deleteMatch = String(text).match(new RegExp(`\\bON\\s+DELETE\\s+${ACTION}`, "i"));
  const updateMatch = update
    ? String(text).match(new RegExp(`\\bON\\s+UPDATE\\s+${ACTION}`, "i"))
    : null;
  let deleteConstraint = normalizeConstraintAction(deleteMatch?.[1]);
  if (allowedDelete && !allowedDelete.includes(deleteConstraint)) deleteConstraint = "NO ACTION";
  return {
    deleteConstraint,
    updateConstraint: normalizeConstraintAction(updateMatch?.[1]),
  };
}

/** Grid placement used for imported tables. */
export function gridPosition(index) {
  return { x: 20 + (index % 5) * 240, y: 20 + Math.floor(index / 5) * 220 };
}

/** Builds a drawDB table object for an imported definition. */
export function makeImportedTable({ id, name, fields, indices = [], comment = "" }) {
  return {
    id,
    name,
    ...gridPosition(id),
    fields,
    indices,
    comment,
    color: "#175e7a",
  };
}

/** Flags the named columns as primary keys. */
export function markPrimaryKeys(fields, columns) {
  columns.forEach((column) => {
    const field = fields.find((candidate) => candidate.name === column);
    if (field) field.primary = true;
  });
}

/** Resolves a parsed foreign key into a drawDB relationship, if possible. */
export function addRelationship(relationships, tableMap, fk) {
  const source = tableMap.get(fk.sourceTable.toLowerCase());
  const target = tableMap.get(fk.targetTable.toLowerCase());
  if (!source || !target) return;
  const startFieldId = source.fields.findIndex((field) => field.name === fk.sourceCols[0]);
  const endFieldId = target.fields.findIndex((field) => field.name === fk.targetCols[0]);
  if (startFieldId < 0 || endFieldId < 0) return;
  relationships.push({
    id: relationships.length,
    name: fk.name,
    startTableId: source.id,
    startFieldId,
    endTableId: target.id,
    endFieldId,
    cardinality: "one_to_many",
    updateConstraint: fk.updateConstraint ?? "NO ACTION",
    deleteConstraint: fk.deleteConstraint ?? "NO ACTION",
  });
}

/** Runs `callback` for every match of a global regex, from the start. */
export function eachMatch(regex, source, callback) {
  regex.lastIndex = 0;
  let match;
  while ((match = regex.exec(source)) !== null) callback(match);
  regex.lastIndex = 0;
}

/**
 * Assigns COMMENT ON TABLE / COLUMN statements (Oracle, PostgreSQL).
 */
export function applyCommentStatements(source, tableMap, { qualified, ident }, unquote) {
  const tableComment = new RegExp(`COMMENT\\s+ON\\s+TABLE\\s+(${qualified})\\s+IS\\s+'((?:[^']|'')*)'\\s*;`, "gi");
  const columnComment = new RegExp(`COMMENT\\s+ON\\s+COLUMN\\s+(${qualified})\\.(${ident})\\s+IS\\s+'((?:[^']|'')*)'\\s*;`, "gi");
  eachMatch(tableComment, source, (m) => {
    const table = tableMap.get(unquote(m[1]).toLowerCase());
    if (table) table.comment = m[2].replace(/''/g, "'");
  });
  eachMatch(columnComment, source, (m) => {
    const table = tableMap.get(unquote(m[1]).toLowerCase());
    if (!table) return;
    const column = unquote(m[2]).toLowerCase();
    const field = table.fields.find((candidate) => candidate.name.toLowerCase() === column);
    if (field) field.comment = m[3].replace(/''/g, "'");
  });
}

/** Adds CREATE [UNIQUE] INDEX statements to their tables. */
export function applyIndexStatements(source, tableMap, { qualified }, unquote) {
  const createIndex = new RegExp(
    `CREATE\\s+(UNIQUE\\s+)?(?:NONCLUSTERED\\s+|CLUSTERED\\s+)?INDEX\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(${qualified})\\s+ON\\s+(${qualified})\\s*(?:USING\\s+\\w+\\s*)?\\(([^)]+)\\)\\s*;`,
    "gi",
  );
  eachMatch(createIndex, source, (m) => {
    const table = tableMap.get(unquote(m[3]).toLowerCase());
    if (!table) return;
    table.indices = table.indices || [];
    table.indices.push({
      id: table.indices.length,
      name: unquote(m[2]),
      fields: splitTopLevel(m[4]).map((column) => unquote(column.trim().replace(/\s+(ASC|DESC)$/i, ""))),
      unique: !!m[1],
    });
  });
}
