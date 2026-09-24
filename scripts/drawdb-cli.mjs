#!/usr/bin/env node
import ExcelJS from "exceljs";
import { readFile, writeFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { pathToFileURL } from "node:url";
import { buildWorkbook } from "../src/utils/excel/build.js";
import { workbookToDiagram } from "../src/utils/excel/parse.js";
import { assertValidDdbDiagram, parseDdb, serializeDdb, validateDdbDiagram } from "../src/utils/ddb.js";
import { toMSSQL } from "../src/data/exportSQL/mssql.js";
import { toMySQL } from "../src/data/exportSQL/mysqlEnhanced.js";
import { toOracle } from "../src/data/exportSQL/oracle.js";
import { toPostgres } from "../src/data/exportSQL/postgres.js";
import { fromMSSQL } from "../src/data/importSQL/mssql.js";
import { fromMySQL } from "../src/data/importSQL/mysqlEnhanced.js";
import { fromOracle } from "../src/data/importSQL/oracle.js";
import { fromPostgres } from "../src/data/importSQL/postgres.js";

const DIALECTS = {
  mysql: { export: toMySQL, import: fromMySQL },
  oracle: { export: toOracle, import: fromOracle },
  postgres: { export: toPostgres, import: fromPostgres },
  mssql: { export: toMSSQL, import: fromMSSQL },
};

const FORMATS = new Set(["sql", "xlsx"]);

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  });
}

export async function main(argv) {
  const { command, flags, positional } = parseArgs(argv);
  if (flags.help || command === "help" || command === "--help" || command === "-h" || !command) {
    printHelp();
    return;
  }

  if (command === "export") {
    await exportCommand(flags, positional);
    return;
  }
  if (command === "import") {
    await importCommand(flags, positional);
    return;
  }
  if (command === "validate") {
    await validateCommand(positional);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const flags = {};
  const positional = [];
  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index];
    if (arg === "--help" || arg === "-h") {
      flags.help = true;
    } else if (arg === "--to" || arg === "--from" || arg === "--dialect" || arg === "--output" || arg === "-o") {
      const key = arg === "-o" ? "output" : arg.slice(2);
      const value = rest[++index];
      if (!value || value.startsWith("-")) throw new Error(`${arg} requires a value`);
      flags[key] = value;
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  return { command, flags, positional };
}

async function exportCommand(flags, positional) {
  const format = requiredFormat(flags.to, "--to");
  const input = requiredInput(positional);
  const output = requiredOutput(flags.output);
  const diagram = parseDdb(await readFile(input, "utf8"));
  assertValidDdbDiagram(diagram);

  if (format === "sql") {
    const dialect = resolveDialect(flags.dialect || diagram.database || "mysql");
    await writeFile(output, DIALECTS[dialect].export(diagram), "utf8");
    console.log(`exported ${dialect} SQL: ${output}`);
    return;
  }

  const workbook = buildWorkbook(diagram);
  await workbook.xlsx.writeFile(output);
  console.log(`exported Excel workbook: ${output}`);
}

async function importCommand(flags, positional) {
  const format = requiredFormat(flags.from, "--from");
  const input = requiredInput(positional);
  const output = requiredOutput(flags.output);
  let diagram;

  if (format === "sql") {
    const dialect = resolveDialect(flags.dialect);
    diagram = DIALECTS[dialect].import(await readFile(input, "utf8"));
    diagram = withDdbDefaults(diagram, { name: baseNameWithoutExt(input), database: dialect });
  } else {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(input);
    const database = flags.dialect ? resolveDialect(flags.dialect) : "mysql";
    diagram = workbookToDiagram(workbook, { database, name: baseNameWithoutExt(input) });
  }

  assertValidDdbDiagram(diagram);
  await writeFile(output, serializeDdb(diagram), "utf8");
  console.log(`imported ${format} as .ddb: ${output}`);
}

async function validateCommand(positional) {
  const input = requiredInput(positional);
  const diagram = parseDdb(await readFile(input, "utf8"));
  const result = validateDdbDiagram(diagram);
  if (!result.valid) {
    throw new Error(`Invalid .ddb diagram:\n${result.errors.map((error) => `- ${error}`).join("\n")}`);
  }
  console.log(`valid .ddb: ${input}`);
}

function requiredFormat(value, flagName) {
  if (!value) throw new Error(`${flagName} is required`);
  const format = value.toLowerCase();
  if (!FORMATS.has(format)) throw new Error(`${flagName} must be one of: ${Array.from(FORMATS).join(", ")}`);
  return format;
}

function resolveDialect(value) {
  if (!value) throw new Error("--dialect is required for SQL import/export");
  const raw = value.toLowerCase();
  const dialect = ({
    postgresql: "postgres",
    oraclesql: "oracle",
    sqlserver: "mssql",
    transactsql: "mssql",
    tsql: "mssql",
  })[raw] ?? raw;
  if (!DIALECTS[dialect]) throw new Error(`--dialect must be one of: ${Object.keys(DIALECTS).join(", ")}`);
  return dialect;
}

function requiredInput(positional) {
  if (positional.length !== 1) throw new Error("exactly one input path is required");
  return positional[0];
}

function requiredOutput(output) {
  if (!output) throw new Error("-o, --output is required");
  return output;
}

function withDdbDefaults(diagram, { name, database }) {
  return {
    name,
    database,
    tables: diagram.tables || [],
    relationships: diagram.relationships || [],
    notes: diagram.notes || [],
    areas: diagram.areas || [],
    types: diagram.types || [],
    enums: diagram.enums || [],
    transform: diagram.transform || { zoom: 1, pan: { x: 0, y: 0 } },
  };
}

function baseNameWithoutExt(path) {
  const file = basename(path);
  return file.slice(0, file.length - extname(file).length) || file;
}

function printHelp() {
  console.log(`Usage:
  drawdb export --to sql --dialect postgres input.ddb -o schema.sql
  drawdb export --to xlsx input.ddb -o tables.xlsx
  drawdb import --from sql --dialect mysql schema.sql -o out.ddb
  drawdb import --from xlsx tables.xlsx -o out.ddb
  drawdb validate input.ddb

Formats:
  sql, xlsx

Dialects:
  mysql, oracle, postgres, mssql (aliases: sqlserver, tsql)`);
}
