// @ts-check
import { TABLE_COLOR } from "./constants.js";

export function mkTable(id, name, fields, indices, comment) {
  return {
    id,
    name: sanitizeTableName(name),
    x: 20 + (id % 5) * 240,
    y: 20 + Math.floor(id / 5) * 220,
    fields,
    indices,
    comment,
    color: TABLE_COLOR,
  };
}

export const sanitizeColName = (value) =>
  String(value).trim().replace(/[^A-Za-z0-9_]/g, "_").replace(/^(\d)/, "_$1").slice(0, 64) || "col";

export const sanitizeTableName = (value) =>
  String(value).trim().replace(/[^A-Za-z0-9_]/g, "_").replace(/^(\d)/, "_$1").slice(0, 64) || "tbl";

export const stripExt = (name) => name.replace(/\.[^.]+$/, "");
export const basename = (path) => path.split(/[\\/]/).pop();
export const bool = (value) => (value ? "YES" : "NO");
export const parseBool = (value) =>
  value === true || value === 1 || value === "YES" || value === "TRUE" || value === "true" || value === "Y";

export function nextPow2(value) {
  let result = 8;
  while (result < value) result *= 2;
  return result;
}

export function uniqueSheetName(name, used) {
  const base = String(name).replace(/[[\]:*?/\\]/g, "_").slice(0, 31) || "Sheet";
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = (base.slice(0, 28) + "_" + suffix++).slice(0, 31);
  }
  used.add(candidate);
  return candidate;
}

export function toArrayBuffer(u8) {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
}

