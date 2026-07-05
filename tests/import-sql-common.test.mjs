import { describe, expect, it } from "vitest";
import { normalizeConstraintAction, stripSqlComments } from "../overlay/src/data/importSQL/common.js";

describe("SQL import parser helpers", () => {
  it("strips line and block comments without touching quoted literals or identifiers", () => {
    const stripped = stripSqlComments(`
      -- remove this line
      CREATE TABLE "keep--identifier" (
        note VARCHAR(255) DEFAULT '-- keep literal',
        code VARCHAR(255) DEFAULT '/* keep literal */',
        /* remove this block */
        \`tick--identifier\` INT
      );
    `);

    expect(stripped).not.toContain("remove this line");
    expect(stripped).not.toContain("remove this block");
    expect(stripped).toContain('"keep--identifier"');
    expect(stripped).toContain("'-- keep literal'");
    expect(stripped).toContain("'/* keep literal */'");
    expect(stripped).toContain("`tick--identifier`");
  });

  it("normalizes optional referential actions", () => {
    expect(normalizeConstraintAction(" set   null ")).toBe("SET NULL");
    expect(normalizeConstraintAction()).toBe("NO ACTION");
  });
});
