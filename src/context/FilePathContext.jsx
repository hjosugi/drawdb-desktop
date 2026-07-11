import { createContext, useState, useCallback, useMemo } from "react";

export const FilePathContext = createContext({
  path: null, kind: null, diagramId: null, dirty: false,
  setFile: () => {}, setDirty: () => {}, clear: () => {},
});

export default function FilePathProvider({ children }) {
  const [state, setState] = useState({ path: null, kind: null, diagramId: null, dirty: false });

  const setFile = useCallback((path, diagramId = null) => {
    if (!path) { setState({ path: null, kind: null, diagramId: null, dirty: false }); return; }
    const lower = path.toLowerCase();
    let kind = "ddb";
    if (lower.endsWith(".ddbpack")) kind = "pack";
    else if (lower.endsWith(".xlsx")) kind = "xlsx";
    setState({ path, kind, diagramId, dirty: false });
  }, []);

  const setDirty = useCallback((dirty = true) => {
    setState(s => ({ ...s, dirty }));
  }, []);

  const clear = useCallback(() => setState({ path: null, kind: null, diagramId: null, dirty: false }), []);

  const value = useMemo(() => ({ ...state, setFile, setDirty, clear }),
    [state, setFile, setDirty, clear]);

  return <FilePathContext.Provider value={value}>{children}</FilePathContext.Provider>;
}
