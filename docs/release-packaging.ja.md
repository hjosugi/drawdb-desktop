<!-- i18n: language-switcher -->
[English](release-packaging.md) | [日本語](release-packaging.ja.md)

# リリースパッケージングポリシー

このプロジェクトは、`.github/workflows/release.yml`からGitHubリリースアーティファクトを公開します。
このワークフローは、条件付きのWindows Authenticode署名、macOSのDeveloper ID署名/ノータライゼーション、およびメンテナが必要なGitHub Actionsシークレットを設定している場合のTauriアップデータアーティファクト署名をサポートします。Microsoft Store、Flathub、Snapストア、AURへの公開には別途認証情報が必要であり、CIによる管理外です。現在のCIカバレッジと手動リリース検証の分割については[`validation-matrix.md`](validation-matrix.md)を参照してください。

タグ付けされたリリースは、このリポジトリ内の統合ソースツリーをビルドします。インポートされたdrawDBのリビジョンとマージ手順は`UPSTREAM.md`に記録されており、リリース時のベースチェックアウトやオーバーレイ適用のステップはありません。

## OSコード署名

Windowsバンドルは`bundle.windows.signCommand`を使用し、Tauriバンドル中に`src-tauri/scripts/sign-windows.ps1`を呼び出します。このスクリプトは認証情報で保護されています。

- Azureアーティファクト署名パス：`AZURE_CLIENT_ID`、`AZURE_TENANT_ID`、`AZURE_CLIENT_SECRET`、`AZURE_ARTIFACT_SIGNING_ENDPOINT`、`AZURE_ARTIFACT_SIGNING_ACCOUNT`、`AZURE_ARTIFACT_SIGNING_CERT_PROFILE`を設定します。リリースワークフローはTauriのドキュメント化された`artifact-signing-cli`をインストールし、設定されたアカウントと証明書プロファイルを通じて署名し、`signtool verify /pa`で検証します。
- ローカル/エンタープライズ証明書パス：ランナーの証明書ストアに証明書を提供し、`WINDOWS_CERTIFICATE_THUMBPRINT`を設定します。
- いずれの設定もない場合、スクリプトはWindows署名がスキップされることをログに記録し、バンドルを未署名のままにしておき、非リリースのCIの利用を可能にします。

macOSバンドルは`bundle.macOS.hardenedRuntime: true`を設定し、`entitlements.plist`を使用してJavaScriptCore JITエンタイトルメントを付与します（Apple Silicon用）。Tauriは通常のApple環境変数が存在する場合、macOSランナー上で署名とノータライゼーションを行います。

- 証明書：`APPLE_CERTIFICATE`、`APPLE_CERTIFICATE_PASSWORD`、`APPLE_SIGNING_IDENTITY`。
- Apple IDによるノータライゼーション：`APPLE_ID`、`APPLE_PASSWORD`、`APPLE_TEAM_ID`。
- App Store Connect APIによるノータライゼーション：`APPLE_API_ISSUER`、`APPLE_API_KEY`、`APPLE_API_PRIVATE_KEY`。ワークフローは秘密鍵を保護されたランナー一時ファイルに書き込み、`APPLE_API_KEY_PATH`をビルド時にのみエクスポートします。

メンテナは引き続き外部アカウントの設定が必要です：Windows用にはAzureアーティファクト署名またはOV/EV認証済みのAuthenticode証明書、macOS用にはDeveloper IDアプリケーション証明書を持つApple Developer Programアクセス。公開前に`signtool verify /pa`（Windows）と`xcrun stapler validate`（macOS）で検証してください。

## 自動アップデータアーティファクト

`src-tauri/tauri.conf.json`で`bundle.createUpdaterArtifacts`を有効にし、アップデータを次のURLに設定します。

```text
https://github.com/hjosugi/drawdb-desktop/releases/latest/download/latest.json
```

公開アップデータの公開鍵はTauriの設定にコミットされています。対応する秘密鍵はリポジトリ外に保管し、その内容を`TAURI_SIGNING_PRIVATE_KEY`のGitHub Actionsシークレットに保存してください。秘密鍵がパスワード保護されている場合は、`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`も設定します。

`release.yml`は`tauri-apps/tauri-action@v1`を`uploadUpdaterJson: true`と`updaterJsonPreferNsis: true`とともに使用し、ドラフトのGitHubリリースにプラットフォームバンドル、`.sig`ファイル、`latest.json`を送信します。リリース前に、古いインストール済みビルドがWindows、macOS、Linux AppImage上で新しいバージョンを検出、ダウンロード、検証、インストール、再起動できることを確認してください。

## リリースアーティファクト

| プラットフォーム | アーキテクチャ | フォーマット | CIソース |
| --- | --- | --- | --- |
| Windows | x64 | NSIS `.exe`、MSI `.msi` | `windows-latest` |
| Windows | ARM64 | NSIS `.exe` | `windows-11-arm` |
| macOS | インテル | `.dmg`、`.app` | `macos-latest` + `x86_64-apple-darwin` |
| macOS | Apple Silicon | `.dmg`、`.app` | `macos-latest` + `aarch64-apple-darwin` |
| Linux | x64 | `.deb`、`.rpm`、`.AppImage` | `ubuntu-22.04` |
| Linux | ARM64 | `.deb`、`.rpm`、`.AppImage` | `ubuntu-22.04-arm` |

## Windows WebView2ランタイムポリシー

Windowsインストーラーは明示的に`bundle.windows.webviewInstallMode`を`{ "type": "offlineInstaller" }`に設定します。これはNSISとMSIの両方の出力に適用されます。

このポリシーは、より小さなダウンロードよりもクリーンなWindows 10のインストール性を優先します。

- Microsoft Edge WebView2 RuntimeがないWindows 10マシンは、インストーラーからdrawDBをインストール・起動でき、インストール中にWebView2ランタイムの別ダウンロードは不要です。
- TauriはエバーグリーンWebView2 Runtimeのオフラインインストーラーを埋め込むため、アーティファクトは大きくなることが予想されます。
- インストール後もシステムのエバーグリーンWebView2 Runtimeを使用し続けるため、ランタイムのセキュリティアップデートはMicrosoftによって管理されます。プロジェクトは固定バージョンのWebView2ランタイムをピン留めしません。

## デスクトップセキュリティポリシー

Tauriデスクトップシェルは`src-tauri/tauri.conf.json`に明示的なCSPを設定しており、`null`に設定してはいけません。ポリシーは意図的にローカル優先であり、スクリプトはアプリ内に限定され、スタイルはインラインCSSを許可し、画像はローカル/データ/Blob/アセットURLを許可し、IPCはTauri IPCエンドポイントに限定され、`object-src`、`base-uri`、`frame-ancestors`は無効化されています。

デフォルトの機能ファイルはダイアログの開閉、ローカルファイルシステム操作（ユーザー選択のダイアグラムや履歴用）、オープナーのリビール、SQLiteプラグインに限定されます。ファイルシステムの範囲は、ユーザのドキュメント、デスクトップ、ダウンロード、`~/drawDB`、およびアプリの設定/データ場所に留めておくべきです。リリースの問題でより広範なパスが必要とされる場合を除きます。

Linuxビルドは互換性のためにUbuntu 22.04のglibcを基準とします。RPMバンドルは`src-tauri/tauri.conf.json`の`bundle.linux.rpm`メタデータを使用し、WebKitGTK、GTK、AppIndicator、librsvgのランタイム依存関係を含みます。x64 RPMはファーストパーティのアーティファクトであり、ビルドマトリックス後に`ubuntu-22.04`のx64アーティファクトをダウンロードし、`.rpm`を検査、`dnf`でFedoraコンテナ内にインストールし、インストールされたパッケージとバイナリを検証し、Xvfbを用いたスモークテストを実行し、削除します。

## Linuxのファイル関連付け

Linuxの`.deb`および`.rpm`パッケージは、`.ddb`、`.ddbpack`、`.xlsx`ファイルのハンドラーとしてdrawDBを登録することが期待されます。

- `bundle.fileAssociations`はdrawDB所有のMIMEタイプ`application/x-drawdb`と`application/x-drawdbpack`を使用し、標準の`.xlsx` MIMEタイプもサポートします。
- `src-tauri/linux/app.drawdb.desktop.xml`は`*.ddb`と`*.ddbpack`の共有MIMEデータベースグロブを定義します。
- Tauri Linuxパッケージの`files`は、そのMIME XML、AppStreamメタデータ、hicolorアイコンを`.deb`、`.rpm`、`.AppImage`レイアウトにインストールします。
- `.deb`と`.rpm`のポストインストール/ポスト削除フックは、ホストディストリビューションがこれらのキャッシュツールを提供している場合、共有MIME、デスクトップ、hicolorアイコンキャッシュを更新します。
- `src-tauri/linux/drawdb.desktop.hbs`は`MimeType=`をTauriのファイル関連付けに合わせて調整し、`Exec={{exec}} %F`を設定して、ファイルマネージャが選択したローカルファイルを引数として渡せるようにします。

インストール済みの`.deb`と`.rpm`パッケージの手動リリース検証には以下を含める必要があります。

```sh
xdg-mime query filetype sample.ddb
xdg-mime query filetype sample.ddbpack
xdg-mime query filetype sample.xlsx
xdg-mime query default application/x-drawdb
xdg-mime query default application/x-drawdbpack
gio mime application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
grep '^Exec=' /usr/share/applications/drawDB.desktop
```

期待されるカスタムMIMEタイプは`application/x-drawdb`と`application/x-drawdbpack`であり、`drawDB.desktop`はこれらのタイプと`.xlsx`ハンドラーとして登録されている必要があります。既存の`.xlsx`のデフォルト設定は強制的に置き換えないこと。`Exec=`行には`%F`を保持し、Ubuntu GNOMEやFedora KDE上でアプリを閉じた状態と既存のdrawDBインスタンスが動作中の状態の両方でダブルクリックテストを行います。

AppImageはポータブルアーティファクトのままであり、自動的にシステムのファイル関連付けをインストールまたは主張しません。インテグレーションツール（Gear Lever、appimaged、または同等のツール）とともに使用する必要があります。`xdg-mime default drawDB.desktop application/x-drawdb application/x-drawdbpack`の設定は永続しません。手動のAppImageデスクトップエントリは`Exec=`に`%F`を保持してください。

## Linuxディストリビューションポリシー

| チャネル | ポリシー |
| --- | --- |
| RPM | GitHubリリースのファーストパーティアーティファクトとしてサポート。CIは`dnf`を用いたFedoraインストールとヘッドレス起動スモークテストを実施。メンテナは手動のFedoraリリース検証中に完全なデスクトップ機能マトリックスを完了すべき。 |
| Flatpak | 保留中。Flathubへの提出は、統合デスクトップアプリがランタイムサンドボックスレビューを完了するまで待つ必要があります。 |
| AUR | 保留中。リリース後にPKGBUILDがGitHubリリースアーティファクトをラップ可能。 |
| Snap | 保留中。Snap公開にはストアの認証情報と制約レビューが必要。ユーザ需要が出るまではAppImage/RPM/DEBを使用。 |

## 手動リリース検証

非ドラフトリリースを公開する前に、ワークフローアーティファクトをダウンロードし、issue #14に実デバイスのマトリックスを記録してください。最低限、インストール、起動、ファイルの保存/開き、`.ddbpack`、ファイル関連付け、Excelのラウンドトリップ、SQLエクスポート、英語/日本語切り替え、自動保存の復元、HiDPI表示、アンインストールを各サポートOSで検証します。Windows 10については、WebView2 Runtime未インストールのクリーンVMを用意し、NSISとMSIの両方からインストーラーだけで最初の起動に到達できることを確認してください。