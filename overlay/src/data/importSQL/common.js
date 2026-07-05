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
