import en from "./locales/en.js";
import ja from "./locales/ja.js";

const STORAGE_KEY = "drawdb-desktop.locale";

export const messages = Object.freeze({ en, ja });
export const supportedLocales = Object.freeze(["en", "ja"]);

export function normalizeLocale(locale) {
  if (typeof locale !== "string" || !locale.trim()) return "en";
  const base = locale.toLowerCase().split(/[-_]/)[0];
  return supportedLocales.includes(base) ? base : "en";
}

function storedLocale() {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function browserLocale() {
  const nav = globalThis.navigator;
  const languages = Array.isArray(nav?.languages) && nav.languages.length
    ? nav.languages
    : [nav?.language];
  return languages.find(Boolean) || "en";
}

export function getLocale() {
  return normalizeLocale(storedLocale() || browserLocale());
}

export function setLocale(locale) {
  const normalized = normalizeLocale(locale);
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, normalized);
  } catch {
    // Storage can be unavailable in private or embedded WebViews.
  }
  return normalized;
}

export function t(key, params = {}, locale = getLocale()) {
  const normalized = normalizeLocale(locale);
  const template = messages[normalized]?.[key] ?? messages.en[key] ?? key;
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, name) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : `{${name}}`);
}

export default {
  getLocale,
  messages,
  normalizeLocale,
  setLocale,
  supportedLocales,
  t,
};
