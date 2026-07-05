import { afterEach, describe, expect, it } from "vitest";
import {
  getLocale,
  messages,
  normalizeLocale,
  setLocale,
  supportedLocales,
  t,
} from "../overlay/src/i18n/index.js";

const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");

function restoreGlobal(name, descriptor) {
  if (descriptor) Object.defineProperty(globalThis, name, descriptor);
  else Reflect.deleteProperty(globalThis, name);
}

describe("desktop i18n", () => {
  afterEach(() => {
    restoreGlobal("localStorage", originalLocalStorage);
    restoreGlobal("navigator", originalNavigator);
  });

  it("supports English and Japanese locales", () => {
    expect(supportedLocales).toEqual(["en", "ja"]);
    expect(normalizeLocale("ja-JP")).toBe("ja");
    expect(normalizeLocale("en-US")).toBe("en");
    expect(normalizeLocale("fr-FR")).toBe("en");
    expect(normalizeLocale("")).toBe("en");
  });

  it("keeps Japanese and English message keys in sync", () => {
    expect(Object.keys(messages.ja).sort()).toEqual(Object.keys(messages.en).sort());
  });

  it("looks up messages with fallback and interpolation", () => {
    expect(t("menu.saveDdb", {}, "en")).toBe("Save");
    expect(t("menu.saveDdb", {}, "ja")).toBe("保存");
    expect(t("menu.saveDdb", {}, "fr")).toBe("Save");
    expect(t("error.unknownDdbFormat", { format: "x" }, "en")).toContain("x");
    expect(t("error.unknownDdbFormat", {}, "en")).toContain("{format}");
    expect(t("missing.key", {}, "ja")).toBe("missing.key");
  });

  it("stores normalized locale preferences when localStorage is available", () => {
    const store = new Map();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key) => store.get(key) || "",
        setItem: (key, value) => store.set(key, value),
      },
    });

    expect(setLocale("ja-JP")).toBe("ja");
    expect(getLocale()).toBe("ja");
  });

  it("falls back to browser locale when storage is unavailable", () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: () => {
          throw new Error("storage disabled");
        },
        setItem: () => {
          throw new Error("storage disabled");
        },
      },
    });
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { languages: ["ja-JP"], language: "en-US" },
    });

    expect(getLocale()).toBe("ja");
    expect(setLocale("fr-FR")).toBe("en");
  });
});
