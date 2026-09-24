import { afterEach, describe, expect, it } from "vitest";
import i18next from "i18next";
import {
  DESKTOP_NAMESPACE,
  getLocale,
  messages,
  normalizeLocale,
  registerDesktopMessages,
  setLocale,
  supportedLocales,
  t,
} from "../src/i18n/index.js";

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");

function restoreNavigator() {
  if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
  else Reflect.deleteProperty(globalThis, "navigator");
}

function setNavigator(value) {
  Object.defineProperty(globalThis, "navigator", { configurable: true, value });
}

// Mirrors src/i18n/i18n.js: drawDB registers its own "translation" resources
// (Japanese under "jp") with English as the fallback language.
async function drawdbInstance(lng) {
  const instance = i18next.createInstance();
  instance.on("initialized", () => registerDesktopMessages(instance));
  await instance.init({
    lng,
    fallbackLng: "en",
    interpolation: { escapeValue: false },
    resources: {
      en: { translation: { file: "File" } },
      jp: { translation: { file: "ファイル" } },
      fr: { translation: { file: "Fichier" } },
    },
  });
  return instance;
}

describe("desktop i18n on drawDB's i18next", () => {
  afterEach(() => {
    restoreNavigator();
  });

  it("maps drawDB language codes to the desktop locales", () => {
    expect(supportedLocales).toEqual(["en", "ja"]);
    expect(normalizeLocale("jp")).toBe("ja");
    expect(normalizeLocale("ja-JP")).toBe("ja");
    expect(normalizeLocale("en-US")).toBe("en");
    expect(normalizeLocale("fr-FR")).toBe("en");
    expect(normalizeLocale("")).toBe("en");
    expect(normalizeLocale(undefined)).toBe("en");
  });

  it("keeps Japanese and English message keys in sync", () => {
    expect(Object.keys(messages.ja).sort()).toEqual(Object.keys(messages.en).sort());
  });

  it("uses i18next interpolation placeholders only", () => {
    for (const [locale, table] of Object.entries(messages)) {
      for (const [key, value] of Object.entries(table)) {
        expect(value, `${locale}:${key}`).not.toMatch(/(^|[^{])\{[a-zA-Z0-9_]+\}(?!\})/);
      }
    }
  });

  it("registers the desktop namespace for en, ja, and drawDB's jp", async () => {
    const instance = await drawdbInstance("en");

    for (const language of ["en", "ja", "jp"]) {
      expect(instance.hasResourceBundle(language, DESKTOP_NAMESPACE)).toBe(true);
    }
    expect(instance.hasResourceBundle("fr", DESKTOP_NAMESPACE)).toBe(false);
  });

  it("follows the language selected in drawDB", async () => {
    const instance = await drawdbInstance("en");

    expect(t("menu.saveDdb", {}, undefined, instance)).toBe("Save");
    await instance.changeLanguage("jp");
    expect(getLocale(instance)).toBe("ja");
    expect(t("menu.saveDdb", {}, undefined, instance)).toBe("保存");
    expect(t("error.unknownDdbFormat", { format: "x" }, undefined, instance)).toBe("不明な.ddb形式です: x");
  });

  it("falls back to English for drawDB languages without desktop messages", async () => {
    const instance = await drawdbInstance("fr");

    expect(instance.t("file")).toBe("Fichier");
    expect(t("menu.saveDdb", {}, undefined, instance)).toBe("Save");
    expect(t("missing.key", {}, undefined, instance)).toBe("missing.key");
  });

  it("switches drawDB's language from the desktop language items", async () => {
    const instance = await drawdbInstance("en");

    await expect(setLocale("ja-JP", instance)).resolves.toBe("ja");
    expect(instance.language).toBe("jp");
    expect(instance.t("file")).toBe("ファイル");
    await setLocale("en", instance);
    expect(t("menu.recentFiles", {}, undefined, instance)).toBe("Recent Files");
  });

  it("honors an explicit locale argument", async () => {
    const instance = await drawdbInstance("en");

    expect(t("menu.recentFiles", {}, "ja", instance)).toBe("最近使ったファイル");
    expect(t("menu.recentFiles", {}, "en", instance)).toBe("Recent Files");
  });

  it("resolves messages without an initialized i18next (CLI and tests)", () => {
    const standalone = i18next.createInstance();
    setNavigator({ languages: ["ja-JP"], language: "en-US" });

    expect(getLocale(standalone)).toBe("ja");
    expect(t("menu.saveDdb", {}, undefined, standalone)).toBe("保存");
    expect(t("menu.saveDdb", {}, "fr", standalone)).toBe("Save");
    expect(t("error.unknownDdbFormat", { format: "x" }, "en", standalone)).toContain("x");
    expect(t("error.unknownDdbFormat", {}, "en", standalone)).toContain("{{format}}");
    expect(t("missing.key", {}, "ja", standalone)).toBe("missing.key");
  });
});
