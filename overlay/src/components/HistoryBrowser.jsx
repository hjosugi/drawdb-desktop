import { useEffect, useMemo, useState } from "react";
import {
  createTauriHistoryStorage,
  listHistorySnapshots,
  readHistorySnapshot,
  restoreHistorySnapshot,
  summarizeDiagramDiff,
} from "../utils/history.js";
import { t } from "../i18n/index.js";

export default function HistoryBrowser({ currentDiagram, sourcePath, onRestore, onClose }) {
  const storage = useMemo(() => createTauriHistoryStorage(), []);
  const [snapshots, setSnapshots] = useState([]);
  const [selected, setSelected] = useState(null);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");

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
