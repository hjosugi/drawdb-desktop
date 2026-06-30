import {
  messages,
  normalizeLocale,
  supportedLocales,
  t,
} from "../overlay/src/i18n/index.js";

let fail = 0;
function check(label, cond) {
  if (cond) console.log(`  PASS  ${label}`);
  else { console.error(`  FAIL  ${label}`); fail++; }
}

check("locales are en + ja", JSON.stringify(supportedLocales) === JSON.stringify(["en", "ja"]));
check("ja-JP normalizes to ja", normalizeLocale("ja-JP") === "ja");
check("en-US normalizes to en", normalizeLocale("en-US") === "en");
check("unsupported locale falls back to en", normalizeLocale("fr-FR") === "en");

const enKeys = Object.keys(messages.en).sort();
const jaKeys = Object.keys(messages.ja).sort();
check("ja has same message keys as en", JSON.stringify(jaKeys) === JSON.stringify(enKeys));
check("English lookup works", t("menu.saveDdb", {}, "en") === "Save");
check("Japanese lookup works", t("menu.saveDdb", {}, "ja") === "保存");
check("fallback lookup works", t("menu.saveDdb", {}, "fr") === "Save");
check("parameter interpolation works", t("error.unknownDdbFormat", { format: "x" }, "en").includes("x"));

console.log(fail === 0 ? "I18N OK" : `${fail} i18n check(s) failed`);
process.exit(fail === 0 ? 0 : 1);
