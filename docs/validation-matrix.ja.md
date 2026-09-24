<!-- i18n: language-switcher -->
[English](validation-matrix.md) | [日本語](validation-matrix.ja.md)

# リリース検証マトリックス

このマトリックスは、自動的に証明されるリリースワークフローの内容と、公開前に手動で確認する必要がある項目を記録しています。CIまたはVMのチェックは、表にその旨が記載されている場合にのみ代替として認められます。それ以外の場合は、ホステッドランナーによるビルドを物理デバイスの検証とみなさないでください。

## 現在のカバレッジ

| 対象 | リリースパッケージ | CIカバレッジ | 手動リリース状況 | 備考 |
| --- | --- | --- | --- | --- |
| Windows 10 x64 | NSIS `.exe`、MSI `.msi`（WebView2 `offlineInstaller`） | `windows-latest`からのビルド成果物のみ; 設定テストは `bundle.windows.webviewInstallMode` を強制 | WebView2未搭載のクリーンVMでのインストール、起動、機能、アンインストールの確認待ち | GitHubホストのWindowsはWindows 10デスクトップの検証代替ではありません。 |
| Windows 11 x64 | NSIS `.exe`、MSI `.msi`（WebView2 `offlineInstaller`） | `windows-latest`からのビルド成果物のみ; 設定テストは `bundle.windows.webviewInstallMode` を強制 | 物理またはVMでのインストール、起動、機能、アンインストールの確認待ち | x64 Windowsの成果物を使用します。 |
| Windows 11 ARM64 | NSIS `.exe`（WebView2 `offlineInstaller`） | `windows-11-arm`からのビルド成果物; 設定テストは `bundle.windows.webviewInstallMode` を強制 | ARMデバイスまたはVMでのインストール、起動、機能、アンインストールの確認待ち | MSI ARM64はデバイス検証まで保留中です。 |
| macOS Intel | `.dmg`、`.app` | `macos-latest`からのビルド成果物、`x86_64-apple-darwin` | Intel Macでのインストール、起動、機能、アンインストールの確認待ち | ホステッドmacOSビルドはFinderの関連付けやユーザ起動動作を証明しません。 |
| macOS Apple Silicon | `.dmg`、`.app` | `macos-latest`からのビルド成果物、`aarch64-apple-darwin` | Apple Silicon Macでのインストール、起動、機能、アンインストールの確認待ち | リリース承認には物理ハードウェアが望ましいです。 |
| Ubuntu 22.04 x64 | `.deb`、`.rpm`、`.AppImage` | `ubuntu-22.04`からのビルド成果物 | VMまたは物理インストール、起動、機能、関連付け、アンインストールの確認待ち | Ubuntu 22.04はLinuxのglibc基準です。`.deb`/`.rpm`は`application/x-drawdb`と`application/x-drawdbpack`のメタデータをインストールし、AppImageの関連付けには外部デスクトップ統合が必要です。 |
| Ubuntu 22.04 ARM64 | `.deb`、`.rpm`、`.AppImage` | `ubuntu-22.04-arm`からのビルド成果物 | ARM VMまたは物理インストール、起動、機能、関連付け、アンインストールの確認待ち | ホステッドのインストールスモークテストは行われていません。`.deb`/`.rpm`の関連付けは手動で検証してください。 |
| Ubuntu 24.04 x64 | `.deb`、`.AppImage`（Ubuntu 22.04 x64ビルドから） | 個別のビルドはなし; 22.04の基準からの互換性を期待 | VMまたは物理インストール、起動、機能、関連付け、アンインストールの確認待ち | リリース前に依存関係のギャップを記録してください。AppImageの関連付けはGear Lever、appimaged、または同等の統合なしでは自動ではありません。 |
| Fedora 最新 x64 | `.rpm`（Ubuntu 22.04 x64ビルドから） | FedoraコンテナRPMの検査、`dnf install`、パッケージとバイナリの存在確認、Xvfbヘッドレス起動スモーク、`dnf remove` | VMまたは物理Fedoraインストールでの完全なデスクトップ機能と関連付けの確認待ち | CIのスモークテストはパッケージのインストール性と起動をカバーしますが、完全なGUIやKDEのファイル関連付け動作まではカバーしません。 |

## 手動チェックリスト

非ドラフトリリースを公開する前に、#14のイシューに結果を記録してください。

- インストーラーの実行とアンインストール。
- Windows 10で、WebView2 Runtimeが未インストールのクリーンVM上でNSISとMSIの両方の成果物からインストールし、最初の起動を確認。
- 起動と新しいダイアグラムの作成。
- `.ddb`の保存とダイアログを通じた開き。
- `.ddbpack`の保存と開き。
- Documents/Desktop/Downloads 以外にある `.ddb` を開き、アプリを再起動して
  File > 最近使ったファイルから1クリックで再オープンできること。記憶済みファイルを
  移動・削除すると「見つかりません」と表示され、選択時にエラートーストが出て履歴から
  削除されること。
- `.ddb`、`.ddbpack`、`.xlsx`を、アプリが閉じている状態と既に起動している状態の両方でダブルクリックし、関連付けを確認。
- IntelとApple SiliconのmacOSで、`.ddb`と`.xlsx`をアプリを起動せずに開き、別のファイルを開き、Dockアイコンにドロップして動作を確認。`CFBundleDocumentTypes`に`ddb`、`ddbpack`、`xlsx`の3つの拡張子がリストされていることを確認。
- 編集後にすぐに保存/破棄/キャンセルのクローズガードを操作。
- Linuxで、`xdg-mime query default application/x-drawdb`と`xdg-mime query default application/x-drawdbpack`が`drawDB.desktop`を返すことを確認し、`/usr/share/applications/drawDB.desktop`に`%F`が含まれていることを確認。
- Ubuntu GNOMEとFedora KDEで、WaylandとX11の両セッションで関連付けの動作をテスト。
- AppImageについて、Gear Lever、appimaged、または手動のデスクトップ統合を使用したかどうかを記録。これらの統合なしでは自動ファイル関連付けはサポートされません。
- macOS でネイティブメニューバーにアプリメニュー（drawDB について / 更新を確認 /
  サービス / 隠す / 終了）、ファイル（新規 / 開く / 最近使ったファイル / 保存 /
  名前を付けて保存 / 読み込み / 書き出し / ローカル履歴 / ウインドウを閉じる）、
  編集、表示、ウインドウ、ヘルプが並び、Cmd+N/O/S/Shift+S/W/Q が1回だけ動作し、
  テキスト欄とキャンバスで Cmd+C/V/Z が従来どおり動き、言語切替でラベルが変わること。
  Windows / Linux ではネイティブメニューバーが表示されず、Ctrl+N/O/S/Shift+S/W
  （Linux は Ctrl+Q も）が1回だけ動作すること。
- Excelのエクスポート/インポートのラウンドトリップ。
- Oracle、MySQL、PostgreSQL、SQL ServerへのSQLエクスポートと、各出力ファイルの「SQLを開く」での取り込み。
- スキーマ比較: 開いているダイアグラムと古い `.ddb`、2 つの `.ddb`、ローカル履歴の版を比較し、
  色分けされた変更一覧、破壊的変更の警告、ダイアレクト切替、マイグレーション `.sql` の保存を確認
  （PostgreSQL / MySQL へのマイグレーション適用は CI で自動検証）。
- EN/JAの切り替えと日本語IME入力。
- 自動保存の復元。
- 以前のリリースをインストールし、アップデータの検出、署名検証、ダウンロード進行状況、インストール、再起動前のファイルフラッシュ、再起動を確認。
- HiDPIまたは150%スケーリングのディスプレイ。

## 保留中のチャネル

Flatpak、AUR、Snapはまだ第一方のリリースチャネルではありません。リリース資産の命名規則が安定し、必要なストアやレジストリの認証情報が利用可能になり、関連するサンドボックスやパッケージングポリシーのレビューが完了するまで、保留とします。