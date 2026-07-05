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

export default function HistoryBrowser({ currentDiagram, sourcePath, onRestore, onClose }) {
  const storage = useMemo(() => createTauriHistoryStorage(), []);
  const [snapshots, setSnapshots] = useState([]);
  const [selected, setSelected] = useState(null);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");
  const [settings, setSettings] = useState(() => readHistorySettings());

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
        if (!cancelled) setError(err.message || String(err));
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
        if (!cancelled) setError(err.message || String(err));
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
      setError(err.message || String(err));
    }
  }

  return (
    <section className="history-browser" role="dialog" aria-label={t("history.title")}>
      <header>
        <h2>{t("history.title")}</h2>
        <button type="button" onClick={onClose}>{t("history.close")}</button>
      </header>
      {error ? <p role="alert">{error}</p> : null}
      <div className="history-browser__body">
        <ol>
          {snapshots.map((snapshot) => (
            <li key={snapshot.path}>
              <button type="button" onClick={() => setSelected(snapshot)}>
                {new Date(snapshot.createdAt).toLocaleString()} - {snapshot.reason}
              </button>
            </li>
          ))}
        </ol>
        <aside>
          <form className="history-browser__settings">
            <label>
              <input
                type="checkbox"
                checked={settings.enabled}
                onChange={(event) => updateSetting({ enabled: event.target.checked })}
              />
              {t("history.enabled")}
            </label>
            <label>
              {t("history.maxGenerations")}
              <input
                type="number"
                min="1"
                max="500"
                value={settings.maxGenerations}
                onChange={(event) => updateSetting({ maxGenerations: event.target.value })}
              />
            </label>
            <label>
              {t("history.maxMegabytes")}
              <input
                type="number"
                min="1"
                max="1024"
                value={Math.round(settings.maxBytes / 1024 / 1024)}
                onChange={(event) => updateSetting({ maxBytes: Number(event.target.value) * 1024 * 1024 })}
              />
            </label>
            <button type="button" onClick={openFolder}>{t("history.openFolder")}</button>
          </form>
          {preview ? (
            <>
              <h3>{preview.payload.name || selected?.name}</h3>
              <ul>
                {preview.diff.lines.map((line) => <li key={line}>{line}</li>)}
              </ul>
              <button type="button" onClick={restoreSelected}>{t("history.restore")}</button>
            </>
          ) : <p>{t("history.empty")}</p>}
        </aside>
      </div>
    </section>
  );
}
