import JSZip from "jszip";
import { db } from "../data/db";
import { readBinaryFile, writeBinaryFile, serializeDdb, parseDdb } from "./desktopIO";

const MANIFEST = "manifest.json";
const sanitize = (s) => (s || "untitled").replace(/[\\/:*?"<>|]/g, "_").slice(0, 80);

export async function exportAllToPack(path) {
  const zip = new JSZip();
  const manifest = { $format: "drawdb-pack", $version: 1, exportedAt: new Date().toISOString(), diagrams: [], templates: [] };
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

export async function importFromPack(path, { merge = true } = {}) {
  const bytes = await readBinaryFile(path);
  const zip = await JSZip.loadAsync(bytes);
  const raw = await zip.file(MANIFEST)?.async("string");
  if (!raw) throw new Error("manifest.json not found in .ddbpack");
  const manifest = JSON.parse(raw);
  if (manifest.$format !== "drawdb-pack") throw new Error("Invalid .ddbpack format");
  if (!merge) await db.diagrams.clear();
  let imported = 0;
  for (const m of manifest.diagrams ?? []) {
    const text = await zip.file(`diagrams/${m.file}`)?.async("string");
    if (!text) continue;
    const data = parseDdb(text);
    const row = { ...data, lastModified: new Date() };
    delete row.$format; delete row.$version;
    const existing = data.diagramId
      ? await db.diagrams.where("diagramId").equals(data.diagramId).first() : null;
    if (existing) await db.diagrams.update(existing.id, row);
    else await db.diagrams.add(row);
    imported++;
  }
  for (const m of manifest.templates ?? []) {
    const text = await zip.file(`templates/${m.file}`)?.async("string");
    if (!text) continue;
    const t = JSON.parse(text);
    await db.templates.add({ ...t, custom: 1 });
  }
  return { count: imported };
}
