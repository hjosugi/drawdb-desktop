import { useEffect, useMemo, useState } from "react";
import {
  createTauriHistoryStorage,
  listHistorySnapshots,
  openHistoryFolder,
  readHistorySnapshot,
  readHistorySettings,
  restoreHistorySnapshot,
  summarizeDiagramDiff,
  writeHistorySettings,
} from "../utils/history.js";
import { t } from "../i18n/index.js";
import { describeError } from "../desktop/errors.js";

export default function HistoryBrowser({ currentDiagram, sourcePath, onRestore, onClose }) {
  const storage = useMemo(() => createTauriHistoryStorage(), []);
  const [snapshots, setSnapshots] = useState([]);
  const [selected, setSelected] = useState(null);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");
  const [settings, setSettings] = useState(() => readHistorySettings());

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const found = await listHistorySnapshots({ diagram: currentDiagram, sourcePath, storage });
        if (!cancelled) {
          setSnapshots(found);
          setSelected(found[0] || null);
        }
      } catch (err) {
        if (!cancelled) setError(describeError(err).message);
      }
    })();
    return () => { cancelled = true; };
  }, [currentDiagram, sourcePath, storage]);

  useEffect(() => {
    let cancelled = false;
    setPreview(null);
    if (!selected) return () => {};
    (async () => {
      try {
        const snapshot = await readHistorySnapshot(selected, storage);
        if (!cancelled) {
          setPreview({
            payload: snapshot.payload,
            diff: summarizeDiagramDiff(currentDiagram, snapshot.payload),
          });
        }
      } catch (err) {
        if (!cancelled) setError(describeError(err).message);
      }
    })();
    return () => { cancelled = true; };
  }, [currentDiagram, selected, storage]);

  async function restoreSelected() {
    if (!selected) return;
    const payload = await restoreHistorySnapshot(selected, storage);
    await onRestore?.(payload);
  }

  function updateSetting(patch) {
    const next = writeHistorySettings({ ...settings, ...patch });
    setSettings(next);
  }

  async function openFolder() {
    try {
      await openHistoryFolder();
    } catch (err) {
      setError(describeError(err).message);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}
    >
      <section
        className="flex max-h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-zinc-300 bg-white text-zinc-900 shadow-2xl dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-browser-title"
      >
        <header className="flex items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-700">
          <h2 id="history-browser-title" className="text-xl font-semibold">{t("history.title")}</h2>
          <button className="rounded px-3 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800" type="button" onClick={onClose}>
            {t("history.close")}
          </button>
        </header>
        {error ? <p className="mx-5 mt-4 rounded bg-red-100 p-3 text-red-800" role="alert">{error}</p> : null}
        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(16rem,0.8fr)_minmax(20rem,1.2fr)]">
          <ol className="min-h-40 overflow-auto border-b border-zinc-200 p-3 md:border-b-0 md:border-r dark:border-zinc-700">
            {snapshots.length === 0 ? <li className="p-3 text-zinc-500">{t("history.empty")}</li> : null}
            {snapshots.map((snapshot) => (
              <li key={snapshot.path}>
                <button
                  className={`w-full rounded px-3 py-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800 ${selected?.path === snapshot.path ? "bg-blue-50 dark:bg-blue-950" : ""}`}
                  type="button"
                  onClick={() => setSelected(snapshot)}
                >
                  <span className="block">{new Date(snapshot.createdAt).toLocaleString()}</span>
                  <span className="text-xs text-zinc-500">{snapshot.reason}</span>
                </button>
              </li>
            ))}
          </ol>
          <aside className="overflow-auto p-5">
            <form className="mb-5 grid gap-3 rounded-lg bg-zinc-50 p-4 dark:bg-zinc-800">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={settings.enabled}
                  onChange={(event) => updateSetting({ enabled: event.target.checked })}
                />
                {t("history.enabled")}
              </label>
              <label className="grid grid-cols-[1fr_7rem] items-center gap-3">
                {t("history.maxGenerations")}
                <input
                  className="rounded border border-zinc-300 bg-white px-2 py-1 text-zinc-900"
                  type="number"
                  min="1"
                  max="500"
                  value={settings.maxGenerations}
                  onChange={(event) => updateSetting({ maxGenerations: event.target.value })}
                />
              </label>
              <label className="grid grid-cols-[1fr_7rem] items-center gap-3">
                {t("history.maxMegabytes")}
                <input
                  className="rounded border border-zinc-300 bg-white px-2 py-1 text-zinc-900"
                  type="number"
                  min="1"
                  max="1024"
                  value={Math.round(settings.maxBytes / 1024 / 1024)}
                  onChange={(event) => updateSetting({ maxBytes: Number(event.target.value) * 1024 * 1024 })}
                />
              </label>
              <button className="justify-self-start rounded border border-zinc-300 px-3 py-1.5 hover:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-700" type="button" onClick={openFolder}>
                {t("history.openFolder")}
              </button>
            </form>
            {preview ? (
              <>
                <h3 className="mb-3 text-lg font-semibold">{preview.payload.name || selected?.name}</h3>
                <ul className="mb-5 list-disc space-y-1 ps-5">
                  {preview.diff.lines.map((line) => <li key={line}>{line}</li>)}
                </ul>
                <button className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700" type="button" onClick={restoreSelected}>
                  {t("history.restore")}
                </button>
              </>
            ) : <p>{t("history.empty")}</p>}
          </aside>
        </div>
      </section>
    </div>
  );
}
