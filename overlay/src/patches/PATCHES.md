# 手動マージ必要な既存ファイル一覧

## 1. src/main.jsx
```jsx
import FilePathProvider from "./context/FilePathContext";
ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <FilePathProvider><App /></FilePathProvider>
  </React.StrictMode>
);
```

## 2. src/components/Workspace.jsx
save() の DB 更新後と useEffect を追加。詳細は PATCHES_FULL.md 参照。

## 3. src/components/EditorHeader/ControlPanel.jsx
File メニュー拡張。詳細は PATCHES_FULL.md 参照。
