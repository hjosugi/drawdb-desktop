import { useEffect, useMemo, useState } from "react";
import { t } from "../i18n/index.js";
import {
  MIGRATION_DIALECTS,
  compareDiagrams,
  migrationScript,
} from "../desktop/schemaDiff.js";

const ACTION_STYLES = {
  added: "bg-green-50 text-green-900 dark:bg-green-950 dark:text-green-100",
  removed: "bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-100",
  modified: "bg-yellow-50 text-yellow-900 dark:bg-yellow-950 dark:text-yellow-100",
};

const formatValue = (value) => {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

export function describeChange(change) {
  const target = change.kind === "table" ? change.name : `${change.table}.${change.name}`;
  const label = `${t(`diff.kind.${change.kind}`)} ${target}`;
  if (!change.property) return `${t(`diff.action.${change.action}`)}: ${label}`;
  return `${t("diff.action.modified")}: ${label} — ${change.property}: ${formatValue(change.from)} → ${formatValue(change.to)}`;
}

/**
 * Side panel listing schema differences (added = green, removed = red,
 * modified = yellow) with the generated migration SQL.
 */
export default function SchemaDiffViewer({ comparison, onSave, onClose }) {
  const [dialect, setDialect] = useState(comparison.dialect);
  const [direction, setDirection] = useState("up");
  const result = useMemo(
    () => compareDiagrams(comparison.from, comparison.to, { database: dialect }),
    [comparison.from, comparison.to, dialect],
  );

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const script = () => migrationScript(result.sql, {
    dialect,
    fromLabel: comparison.fromLabel,
    toLabel: comparison.toLabel,
  });

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}
    >
      <section
        className="flex max-h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-zinc-300 bg-white text-zinc-900 shadow-2xl dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        role="dialog"
        aria-modal="true"
        aria-labelledby="schema-diff-title"
      >
        <header className="flex items-center justify-between gap-3 border-b border-zinc-200 px-5 py-4 dark:border-zinc-700">
          <div className="min-w-0">
            <h2 id="schema-diff-title" className="text-xl font-semibold">{t("diff.title")}</h2>
            <p className="truncate text-sm text-zinc-500">
              {comparison.fromLabel} → {comparison.toLabel}
            </p>
          </div>
          <button className="rounded px-3 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800" type="button" onClick={onClose}>
            {t("history.close")}
          </button>
        </header>
        {result.destructive.length ? (
          <div className="mx-5 mt-4 rounded bg-red-100 p-3 text-red-800" role="alert">
            <p className="font-semibold">{t("diff.destructiveTitle", { count: result.destructive.length })}</p>
            <ul className="list-disc ps-5 text-sm">
              {result.destructive.map((change, index) => <li key={index}>{describeChange(change)}</li>)}
            </ul>
          </div>
        ) : null}
        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(16rem,1fr)_minmax(20rem,1.2fr)]">
          <ol className="min-h-40 overflow-auto border-b border-zinc-200 p-3 md:border-b-0 md:border-r dark:border-zinc-700">
            {result.changes.length === 0 ? <li className="p-3 text-zinc-500">{t("diff.none")}</li> : null}
            {result.changes.map((change, index) => (
              <li key={index} className={`mb-1 rounded px-3 py-2 text-sm ${ACTION_STYLES[change.action]}`}>
                {describeChange(change)}
              </li>
            ))}
          </ol>
          <aside className="flex min-h-0 flex-col gap-3 overflow-auto p-5">
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm">
                {t("diff.dialect")}
                <select
                  className="rounded border border-zinc-300 bg-white px-2 py-1 text-zinc-900"
                  value={dialect}
                  onChange={(event) => setDialect(event.target.value)}
                >
                  {MIGRATION_DIALECTS.map((value) => (
                    <option key={value} value={value}>{t(`diff.dialectName.${value}`)}</option>
                  ))}
                </select>
              </label>
              <div className="flex overflow-hidden rounded border border-zinc-300 text-sm dark:border-zinc-600" role="tablist">
                {["up", "down"].map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={direction === value}
                    className={`px-3 py-1 ${direction === value ? "bg-blue-600 text-white" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
                    onClick={() => setDirection(value)}
                  >
                    {t(`diff.${value}`)}
                  </button>
                ))}
              </div>
            </div>
            <pre className="min-h-40 flex-1 overflow-auto rounded bg-zinc-50 p-3 text-xs dark:bg-zinc-800">
              {result.sql[direction] || t("diff.none")}
            </pre>
            <button
              className="justify-self-start self-start rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
              type="button"
              disabled={result.changes.length === 0}
              onClick={() => onSave?.(script(), dialect)}
            >
              {t("diff.save")}
            </button>
          </aside>
        </div>
      </section>
    </div>
  );
}
