// @ts-check
import JSZip from "jszip";
import { db } from "../data/db";
import { readBinaryFile, writeBinaryFile, serializeDdb, parseDdb } from "./desktopIO";
import { upsertDdbDiagram } from "../desktop/diagram.js";
import { DesktopError, ErrorCode, errorText } from "../desktop/errors.js";
import { t } from "../i18n/index.js";

const MANIFEST = "manifest.json";
const PACK_FORMAT = "drawdb-pack";
const sanitize = (s) => (s || "untitled").replace(/[\\/:*?"<>|]/g, "_").slice(0, 80);

export async function exportAllToPack(path) {
  const zip = new JSZip();
  const manifest = { $format: PACK_FORMAT, $version: 1, exportedAt: new Date().toISOString(), diagrams: [], templates: [] };
  const dDir = zip.folder("diagrams");
  const tDir = zip.folder("templates");
  const diagrams = await db.diagrams.toArray();
  for (const d of diagrams) {
    const file = `${sanitize(d.name)}__${d.diagramId || d.id}.ddb`;
    dDir.file(file, serializeDdb(d));
    manifest.diagrams.push({ file, diagramId: d.diagramId, name: d.name });
  }
  const tpls = await db.templates.where("custom").equals(1).toArray();
  for (const t of tpls) {
    const file = `${sanitize(t.title)}__${t.id}.json`;
    tDir.file(file, JSON.stringify(t, null, 2));
    manifest.templates.push({ file, title: t.title });
  }
  zip.file(MANIFEST, JSON.stringify(manifest, null, 2));
  const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
  await writeBinaryFile(path, bytes);
  return { path, count: manifest.diagrams.length };
}

/**
 * @typedef {{
 *   diagrams: Array<{ file: string, data: import("../types/drawdb").DdbPayload }>,
 *   templates: Array<{ file: string, data: Record<string, unknown> }>,
 *   failed: Array<{ file: string, reason: string }>,
 *   recovered: boolean,
 * }} PackContents
 */

async function readManifest(zip) {
  const raw = await zip.file(MANIFEST)?.async("string");
  if (!raw) return { manifest: null, problem: `${MANIFEST} is missing` };
  try {
    const manifest = JSON.parse(raw);
    if (manifest?.$format !== PACK_FORMAT) {
      return { manifest: null, problem: `${MANIFEST} has format ${JSON.stringify(manifest?.$format)}` };
    }
    return { manifest, problem: "" };
  } catch (error) {
    return { manifest: null, problem: `${MANIFEST} is not valid JSON: ${errorText(error)}` };
  }
}

function archiveEntries(zip, folder, extension) {
  return Object.values(zip.files)
    .filter((entry) => !entry.dir && entry.name.startsWith(`${folder}/`) && entry.name.toLowerCase().endsWith(extension))
    .map((entry) => entry.name.slice(folder.length + 1))
    .sort();
}

/**
 * Reads a .ddbpack archive without touching storage. Unreadable diagrams are
 * reported in `failed` instead of aborting the import. When the manifest is
 * missing or damaged, every .ddb/.json entry in the archive is recovered and
 * `recovered` is set.
 * @param {Uint8Array | ArrayBuffer} bytes
 * @returns {Promise<PackContents>}
 */
export async function readPackEntries(bytes) {
  let zip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch (cause) {
    throw new DesktopError(ErrorCode.ZIP_CORRUPT, { cause });
  }

  const { manifest, problem } = await readManifest(zip);
  const recovered = !manifest;
  const diagramFiles = manifest
    ? (manifest.diagrams ?? []).map((entry) => entry?.file).filter(Boolean)
    : archiveEntries(zip, "diagrams", ".ddb");
  const templateFiles = manifest
    ? (manifest.templates ?? []).map((entry) => entry?.file).filter(Boolean)
    : archiveEntries(zip, "templates", ".json");

  if (recovered && diagramFiles.length === 0 && templateFiles.length === 0) {
    throw new DesktopError(ErrorCode.PACK_INVALID, { detail: problem });
  }

  /** @type {PackContents} */
  const contents = { diagrams: [], templates: [], failed: [], recovered };
  if (recovered) contents.failed.push({ file: MANIFEST, reason: problem });

  for (const file of diagramFiles) {
    try {
      const text = await zip.file(`diagrams/${file}`)?.async("string");
      if (text == null) throw new Error("entry listed in the manifest is missing from the archive");
      contents.diagrams.push({ file, data: parseDdb(text) });
    } catch (error) {
      contents.failed.push({ file: `diagrams/${file}`, reason: errorText(error) });
    }
  }
  for (const file of templateFiles) {
    try {
      const text = await zip.file(`templates/${file}`)?.async("string");
      if (text == null) throw new Error("entry listed in the manifest is missing from the archive");
      const data = JSON.parse(text);
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("template must be a JSON object");
      contents.templates.push({ file, data });
    } catch (error) {
      contents.failed.push({ file: `templates/${file}`, reason: errorText(error) });
    }
  }

  if (contents.diagrams.length === 0 && contents.templates.length === 0 && contents.failed.length > 0) {
    throw new DesktopError(ErrorCode.PACK_INVALID, {
      detail: contents.failed.map((entry) => `${entry.file}: ${entry.reason}`).join("\n"),
    });
  }
  return contents;
}

export async function importFromPack(path, { merge = true } = {}) {
  const contents = await readPackEntries(await readBinaryFile(path));
  if (!merge) await db.diagrams.clear();
  const diagramIds = [];
  for (const { data } of contents.diagrams) {
    const result = await upsertDdbDiagram(db.diagrams, data);
    diagramIds.push(result.diagramId);
  }
  for (const { data } of contents.templates) {
    await db.templates.add({ ...data, custom: 1 });
  }
  return {
    count: diagramIds.length,
    diagramIds,
    failed: contents.failed,
    recovered: contents.recovered,
  };
}

/**
 * Message listing the entries of a .ddbpack that could not be imported.
 * @param {{ count: number, failed: Array<{ file: string, reason: string }>, recovered: boolean }} result
 */
export function packWarning({ count, failed, recovered }) {
  const lines = [t("pack.partialMessage", { count })];
  if (recovered) lines.push(t("pack.recoveredManifest"));
  lines.push("", ...failed.map((entry) => `- ${entry.file}: ${entry.reason}`));
  return lines.join("\n");
}
