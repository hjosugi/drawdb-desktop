// @ts-check
// Desktop messages live in the "desktop" namespace of drawDB's i18next
// instance, so the language chosen in drawDB's own selector (or detected by
// i18next) drives desktop menus, dialogs, and errors too. Only English and
// Japanese have desktop translations; every other drawDB language falls back
// to English through i18next's fallbackLng.
//
// Outside the app (headless CLI, unit tests) i18next is not initialized and
// the same messages are resolved locally, so callers never depend on the
// React tree having booted.
import i18next from "i18next";
import en from "./desktop/en.js";
import ja from "./desktop/ja.js";

export const DESKTOP_NAMESPACE = "desktop";
export const messages = Object.freeze({ en, ja });
export const supportedLocales = Object.freeze(["en", "ja"]);

// drawDB registers Japanese under the non-standard code "jp"; i18next's
// language detector reports "ja" / "ja-JP". Register the bundle for both.
const BUNDLE_LANGUAGES = Object.freeze({ en: ["en"], ja: ["ja", "jp"] });

/**
 * @param {string | undefined | null} locale
 * @returns {"en" | "ja"}
 */
export function normalizeLocale(locale) {
  if (typeof locale !== "string" || !locale.trim()) return "en";
  const base = locale.toLowerCase().split(/[-_]/)[0];
  if (base === "jp" || base === "ja") return "ja";
  return "en";
}

/** @param {import("i18next").i18n} instance */
export function registerDesktopMessages(instance = i18next) {
  for (const [locale, languages] of Object.entries(BUNDLE_LANGUAGES)) {
    for (const language of languages) {
      if (!instance.hasResourceBundle(language, DESKTOP_NAMESPACE)) {
        instance.addResourceBundle(language, DESKTOP_NAMESPACE, messages[locale], true, false);
      }
    }
  }
}

function attach(instance) {
  if (instance.isInitialized) registerDesktopMessages(instance);
  // Re-register after (re)initialization, which replaces the resource store.
  instance.on("initialized", () => registerDesktopMessages(instance));
}

attach(i18next);

function browserLocale() {
  const nav = globalThis.navigator;
  const languages = Array.isArray(nav?.languages) && nav.languages.length
    ? nav.languages
    : [nav?.language];
  return languages.find(Boolean) || "en";
}

/** Desktop locale derived from drawDB's current i18next language. */
export function getLocale(instance = i18next) {
  if (instance.isInitialized) {
    return normalizeLocale(instance.resolvedLanguage || instance.language);
  }
  return normalizeLocale(browserLocale());
}

/**
 * Switches drawDB (and therefore desktop messages) to `locale`.
 * @param {string} locale
 */
export async function setLocale(locale, instance = i18next) {
  const normalized = normalizeLocale(locale);
  if (instance.isInitialized) {
    await instance.changeLanguage(normalized === "ja" ? "jp" : normalized);
  }
  return normalized;
}

/**
 * @param {string} template
 * @param {Record<string, unknown>} params
 */
function interpolate(template, params) {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (placeholder, name) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : placeholder);
}

/**
 * Looks up a desktop message.
 * @param {string} key flat key such as "menu.saveDdb"
 * @param {Record<string, unknown>} [params] interpolation values
 * @param {string} [locale] explicit locale; defaults to the drawDB language
 * @param {import("i18next").i18n} [instance]
 * @returns {string}
 */
export function t(key, params = {}, locale, instance = i18next) {
  if (instance.isInitialized) {
    const lng = locale ? (normalizeLocale(locale) === "ja" ? "jp" : "en") : undefined;
    return String(instance.t(key, {
      ...params,
      ns: DESKTOP_NAMESPACE,
      ...(lng ? { lng } : {}),
      keySeparator: false,
      nsSeparator: false,
      defaultValue: interpolate(messages.en[key] ?? key, params),
      interpolation: { escapeValue: false },
    }));
  }
  const normalized = normalizeLocale(locale ?? getLocale(instance));
  const template = messages[normalized]?.[key] ?? messages.en[key] ?? key;
  return interpolate(template, params);
}

export default {
  DESKTOP_NAMESPACE,
  getLocale,
  messages,
  normalizeLocale,
  registerDesktopMessages,
  setLocale,
  supportedLocales,
  t,
};
