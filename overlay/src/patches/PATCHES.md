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
save() の DB 更新後、ローカル履歴スナップショット、破損 .ddb 復旧、ファイル関連付け open-file の useEffect、dirty 状態のウィンドウクローズ確認を追加。詳細は PATCHES_FULL.md 参照。

## 3. src/components/EditorHeader/ControlPanel.jsx
File メニュー拡張、ローカル履歴ブラウザ、履歴設定、履歴から復元、i18n(EN/JA)対応。更新確認メニューと起動時更新チェックは `scripts/setup.mjs` が自動統合します。詳細は PATCHES_FULL.md 参照。

## i18n
`src/i18n/index.js` と `src/i18n/desktop/*` は overlay でコピーされます。既定はブラウザ言語、未対応言語は英語です。
