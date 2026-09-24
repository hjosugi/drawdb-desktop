import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import {
  DesktopError,
  ErrorCode,
  describeError,
  notifyError,
  toDesktopError,
} from "../src/desktop/errors.js";
import { assertValidDdbDiagram, parseDdb, serializeDdb } from "../src/utils/ddb.js";
import { packWarning, readPackEntries } from "../src/utils/ddbpack.js";
import { t } from "../src/i18n/index.js";
import { messages } from "../src/i18n/index.js";

const en = (key, params) => t(key, params, "en");
const ja = (key, params) => t(key, params, "ja");

const diagram = {
  diagramId: "d-1",
  name: "Shop",
  database: "postgres",
  tables: [{ id: "t1", name: "users", fields: [{ id: "f1", name: "id", type: "INT" }] }],
  relationships: [],
};

async function pack(files) {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  return zip.generateAsync({ type: "uint8array" });
}

const manifest = (diagrams, templates = []) => JSON.stringify({
  $format: "drawdb-pack",
  $version: 1,
  diagrams: diagrams.map((file) => ({ file })),
  templates: templates.map((file) => ({ file })),
});

describe("desktop error classification", () => {
  it.each([
    ["failed to open file at path: /x.ddb with error: No such file or directory (os error 2)", ErrorCode.FILE_NOT_FOUND],
    ["The system cannot find the file specified. (os error 2)", ErrorCode.FILE_NOT_FOUND],
    ["forbidden path: /etc/shadow, maybe it is not allowed on the scope", ErrorCode.PERMISSION_DENIED],
    ["Permission denied (os error 13)", ErrorCode.PERMISSION_DENIED],
    ["Access is denied. (os error 5)", ErrorCode.PERMISSION_DENIED],
    ["End of data reached (data length = 4, asked index = 12). Corrupted zip ?", ErrorCode.ZIP_CORRUPT],
    ["Can't find end of central directory : is this a zip file ?", ErrorCode.ZIP_CORRUPT],
    ["something odd happened", ErrorCode.UNKNOWN],
  ])("maps %j to %s", (message, code) => {
    expect(toDesktopError(new Error(message)).code).toBe(code);
    expect(toDesktopError(message).code).toBe(code);
  });

  it("uses the file kind to name workbook failures", () => {
    expect(toDesktopError(new Error("Can't find end of central directory"), { kind: "xlsx" }).code)
      .toBe(ErrorCode.EXCEL_INVALID);
    expect(toDesktopError(new Error("Cannot read properties of undefined"), { kind: "xlsx" }).code)
      .toBe(ErrorCode.EXCEL_INVALID);
  });

  it("maps structured backend errors and JSON syntax errors", () => {
    expect(toDesktopError({ code: "RECENT_FILE_NOT_FOUND", message: "gone" }).code).toBe(ErrorCode.FILE_NOT_FOUND);
    expect(toDesktopError({ code: "RECENT_FILE_NOT_PERMITTED", message: "no" }).code).toBe(ErrorCode.PERMISSION_DENIED);
    let syntaxError;
    try {
      JSON.parse("{");
    } catch (error) {
      syntaxError = error;
    }
    expect(toDesktopError(syntaxError).code).toBe(ErrorCode.INVALID_JSON);
  });

  it("keeps DesktopError instances and their details", () => {
    const error = new DesktopError(ErrorCode.SQL_NO_TABLES);
    expect(toDesktopError(error)).toBe(error);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("SQL_NO_TABLES");
    expect(new DesktopError(ErrorCode.UNKNOWN, { cause: new Error("root") }).detail).toBe("root");
  });
});

describe("translated error messages", () => {
  it("has an English and Japanese message for every code", () => {
    for (const code of Object.values(ErrorCode)) {
      expect(messages.en[`errorCode.${code}`], code).toBeTruthy();
      expect(messages.ja[`errorCode.${code}`], code).toBeTruthy();
    }
  });

  it("combines the translated summary with the technical detail", () => {
    const error = new Error("No such file or directory (os error 2)");

    expect(describeError(error, { t: en })).toEqual({
      code: ErrorCode.FILE_NOT_FOUND,
      message: `${messages.en["errorCode.FILE_NOT_FOUND"]}\n\nDetails: No such file or directory (os error 2)`,
      detail: "No such file or directory (os error 2)",
    });
    expect(describeError(error, { t: ja }).message).toContain("ファイルが見つかりません");
    expect(describeError(new DesktopError(ErrorCode.SQL_NO_TABLES), { t: en }).message)
      .toBe(messages.en["errorCode.SQL_NO_TABLES"]);
  });

  it("interpolates error parameters", () => {
    const error = new DesktopError(ErrorCode.UNKNOWN_FORMAT, { params: { format: "other" } });
    expect(describeError(error, { t: en }).message).toContain("(other)");
  });

  it("shows the translated message through the injected presenter", async () => {
    const show = vi.fn();
    const result = await notifyError(new Error("Permission denied (os error 13)"), {
      title: "Could Not Save File",
      show,
    });

    expect(result.code).toBe(ErrorCode.PERMISSION_DENIED);
    expect(show).toHaveBeenCalledWith(result.message, "Could Not Save File");
  });
});

describe(".ddb parse failures", () => {
  it("reports broken JSON, non-object payloads, foreign formats, and invalid diagrams", () => {
    expect(() => parseDdb("{ broken")).toThrow(expect.objectContaining({ code: ErrorCode.INVALID_JSON }));
    expect(() => parseDdb("[]")).toThrow(expect.objectContaining({ code: ErrorCode.INVALID_DIAGRAM }));
    expect(() => parseDdb('{"$format":"other"}')).toThrow(expect.objectContaining({
      code: ErrorCode.UNKNOWN_FORMAT,
      params: { format: "other" },
    }));
    expect(() => assertValidDdbDiagram({ tables: [{ fields: [] }] }))
      .toThrow(expect.objectContaining({ code: ErrorCode.INVALID_DIAGRAM }));
  });
});

describe(".ddbpack reading and recovery", () => {
  it("reads every diagram and template listed in the manifest", async () => {
    const bytes = await pack({
      "manifest.json": manifest(["a.ddb"], ["t.json"]),
      "diagrams/a.ddb": serializeDdb(diagram),
      "templates/t.json": JSON.stringify({ title: "Template" }),
    });
    const contents = await readPackEntries(bytes);

    expect(contents.recovered).toBe(false);
    expect(contents.failed).toEqual([]);
    expect(contents.diagrams.map((entry) => entry.data.name)).toEqual(["Shop"]);
    expect(contents.templates.map((entry) => entry.data.title)).toEqual(["Template"]);
  });

  it("skips unreadable diagrams and keeps the readable ones", async () => {
    const bytes = await pack({
      "manifest.json": manifest(["good.ddb", "broken.ddb", "missing.ddb"]),
      "diagrams/good.ddb": serializeDdb(diagram),
      "diagrams/broken.ddb": "{ not json",
    });
    const contents = await readPackEntries(bytes);

    expect(contents.diagrams.map((entry) => entry.file)).toEqual(["good.ddb"]);
    expect(contents.failed.map((entry) => entry.file)).toEqual([
      "diagrams/broken.ddb",
      "diagrams/missing.ddb",
    ]);
  });

  it.each([
    ["missing", {}],
    ["damaged", { "manifest.json": "{ nope" }],
    ["foreign", { "manifest.json": JSON.stringify({ $format: "zip" }) }],
  ])("recovers diagrams from the archive when the manifest is %s", async (_label, extra) => {
    const bytes = await pack({
      ...extra,
      "diagrams/b.ddb": serializeDdb({ ...diagram, name: "B" }),
      "diagrams/a.ddb": serializeDdb({ ...diagram, name: "A" }),
      "templates/t.json": JSON.stringify({ title: "T" }),
    });
    const contents = await readPackEntries(bytes);

    expect(contents.recovered).toBe(true);
    expect(contents.diagrams.map((entry) => entry.data.name)).toEqual(["A", "B"]);
    expect(contents.templates).toHaveLength(1);
    expect(contents.failed[0].file).toBe("manifest.json");
  });

  it("rejects archives with nothing to import", async () => {
    await expect(readPackEntries(await pack({ "readme.txt": "hi" })))
      .rejects.toMatchObject({ code: ErrorCode.PACK_INVALID });
    await expect(readPackEntries(await pack({
      "manifest.json": manifest(["x.ddb"]),
      "diagrams/x.ddb": "[]",
    }))).rejects.toMatchObject({ code: ErrorCode.PACK_INVALID });
  });

  it("reports damaged ZIP data", async () => {
    await expect(readPackEntries(new Uint8Array([1, 2, 3, 4])))
      .rejects.toMatchObject({ code: ErrorCode.ZIP_CORRUPT });
  });

  it("lists skipped entries for the partial-import warning", () => {
    const text = packWarning({
      count: 1,
      recovered: true,
      failed: [{ file: "manifest.json", reason: "manifest.json is missing" }],
    });

    expect(text).toContain("1");
    expect(text).toContain("- manifest.json: manifest.json is missing");
  });
});
