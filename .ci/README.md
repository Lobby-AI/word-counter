# .ci

`architecture-guards` の実装と設定を管理するディレクトリです。

## ファイル構成

- `architecture-guards.mjs`: アーキテクチャガードのエントリポイント（実行フロー）
- `architecture-guards/project-runtime.mjs`: 対象プロジェクト検出・TS解決・import解決・コード収集
- `architecture-guards/guards.mjs`: guard エンジン（モジュール組み立て）
- `architecture-guards/guards/*.mjs`: guardごとの判定ロジックと共通pathヘルパ
- `architecture-guards/config-loader.mjs`: `architecture-guards.config.json` の検証/正規化
- `architecture-guards/reporting.mjs`: annotation・違反表示・JSONレポート生成
- `architecture-guards/import-entries.mjs`: import/export/require の抽出ロジック
- `architecture-guards/semantic-normalizer.mjs`: `duplicateSemantic` 用の正規化ロジック
- `architecture-guards/lexer-utils.mjs`: 字句解析系の共通ユーティリティ
- `tests/*.test.mjs`: 回帰テスト（Node.js built-in test runner）
- `architecture-guards.config.json`: ガード設定
- `../workflow-templates/architecture-guards.yml`: 配布用PR/Pushガードワークフロー
- `../workflow-templates/architecture-guard-full-scan.yml`: 配布用フルスキャンワークフロー

## 何をチェックするか

検出された source root 配下のコード（`.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.mts`）を走査し、以下の5ガードを実行します。

- `duplicateBinary`: 完全一致ファイルの重複
- `duplicateSemantic`: コメントや関数名揺れを吸収した意味的重複
- `overCommonization`: shared配置の過剰共通化
- `relativeCrossSection`: セクション跨ぎの相対import/require違反
- `aliasImportForbidden`: 内部エイリアスimport禁止 + 非リテラル `import/require` 禁止
  - source root 配下へ解決される非相対specifierをエイリアスとして扱います

## 実行条件と終了コード

- 次を満たさない場合は `SKIP`（終了コード0）
  - リポジトリ内に `package.json` がある
  - その package 配下に `app` または `src/app` がある（App Router）
- `must` 違反が1件でもあれば終了コード1
- `warn` のみなら終了コード0
- 予期しない例外（設定不正など）は終了コード1

検出候補が複数ある場合は、次の優先度で1件を選択します。
- リポジトリルート直下の package
- ディレクトリ名が `web` の package
- ルートから浅い package

## 使い方

```bash
node .ci/architecture-guards.mjs
```

JSONレポートを出力する場合:

```bash
node .ci/architecture-guards.mjs --report-json architecture-guard-report.json
# または
node .ci/architecture-guards.mjs --report-json=architecture-guard-report.json
```

実行時には、対象として選ばれた package/source/app のパスをログ出力します。

## テスト

```bash
node --test .ci/tests/*.test.mjs
```

## 設定ファイル仕様

設定ファイルは `architecture-guards.config.json` です。

> JSON 形式のため、`architecture-guards.config.json` 自体にはコメントを書けません。  
> キーの意味や運用ルールはこの README を参照してください。

### 主要キー早見表

- `sharedDirectoryKinds`: shared と見なすディレクトリ名一覧
- `guardSeverity`: 各 guard の強制レベル（`must` / `warn` / `pass`）
- `guardThresholds`: 重複判定や over-commonization 判定のしきい値
- `allowedFailedIds`: 既知許容として抑制する violation ID 一覧
- `allowedAliasImports`: 例外的に許可する内部エイリアス import
- `aliasResolutionOverrides`: 特定 specifier の解決先を手動上書き

### `sharedDirectoryKinds`（必須）

- 型: `string[]`
- 役割:
  - `relativeCrossSection` で「相対importが許される shared ディレクトリ名」を定義
  - `overCommonization` で shared モジュール判定に利用
- 例: `["_lib", "_components", "_hooks", "_types", "_utils"]`

### `guardSeverity`（必須）

- 型: オブジェクト
- キー: `duplicateBinary`, `duplicateSemantic`, `overCommonization`, `relativeCrossSection`, `aliasImportForbidden`
- 値: `must | warn | pass`

各値の意味:

- `must`: 違反があればCIを失敗させる
- `warn`: 違反を表示するがCIは失敗させない
- `pass`: そのガードを実行しない

### `guardThresholds`（必須）

- 型: オブジェクト
- `duplicateBinaryMinFiles`（整数, 2以上）:
  - 同一バイナリハッシュのファイル数がこの値以上で違反
- `duplicateSemanticMinFiles`（整数, 2以上）:
  - 同一正規化ハッシュのファイル数がこの値以上で違反候補
- `semanticDuplicateMinNormalizedChars`（整数, 1以上）:
  - 意味重複判定対象にする最小正規化文字数
- `overCommonizationMinCrossSectionRefs`（整数, 1以上）:
  - cross-section参照数がこの値未満だと over-commonization 理由に加算
- `overCommonizationMinSectionsToEnforce`（整数, 1以上）:
  - over-commonization 判定を開始する最小セクション数
- `maxAnnotationFilesPerViolation`（整数, 1以上）:
  - 1違反あたり GitHub annotation を出すファイル数上限

### `allowedFailedIds`（必須）

- 型: `string[]`
- 役割: 指定IDの違反を suppress（既知許容）する

### `allowedAliasImports`（任意）

- 型: オブジェクト
- `exact`: 完全一致で許可する内部エイリアスimport
- `prefixes`: 前方一致で許可する内部エイリアスimport

補足:

- `@/components/ui` は固定で許可されます
- まず `resolveImport` で source root へ解決される非相対specifierを違反判定します
- TypeScriptの `paths/baseUrl`（対象 package の `tsconfig.json` / `jsconfig.json`）も解決対象です
- 追加フォールバックとして、以下の接頭辞は違反判定対象です（allowlist指定が無い場合）
  - `@/`
  - `#`
  - `~/`
  - `/`

### `aliasResolutionOverrides`（任意）

- 型: `{ [specifier: string]: string }`
- 役割: import解決時に specifier を任意パスへマップする
- 解決先パスは source root 基準（`app` または `src`）で扱われる
- キーが `/` で終わる場合は prefix マッチとして扱う（最長一致優先）

例:

```json
{
  "aliasResolutionOverrides": {
    "@/protected/": "app/(protected)/"
  }
}
```

## 各ガードの違反ID形式

- `duplicateBinary`: `duplicate:binary:<sha256>`
- `duplicateSemantic`: `duplicate:semantic:<sha256>`
- `overCommonization`: `over-commonization:<path>`
- `relativeCrossSection`: `relative-cross-section:<importerPath>::<specifier>`
- `aliasImportForbidden`:
  - エイリアス利用時: `alias-import-forbidden:<importerPath>::<specifier>`
  - 非リテラル dynamic import: `alias-import-forbidden:<importerPath>::dynamic-import-non-literal:<line>`
  - 非リテラル require: `alias-import-forbidden:<importerPath>::require-non-literal:<line>`

`allowedFailedIds` はこのID文字列と一致するものが suppress 対象です。

## 出力仕様

- 標準出力/標準エラーに判定結果を出力
- GitHub Actions 上では annotation を出力
- `--report-json` 指定時はJSONレポートを生成
  - `summary.mustActiveCount`, `summary.warnActiveCount`, `summary.suppressedCount`
  - guardごとの `activeIds`, `suppressedIds`, `activeSamples`

## 保守ルール

- ガードを追加する場合:
  - `architecture-guards/guards.mjs` の `GUARD_KEYS` / `guardRunFactories` へ追加
  - `architecture-guards.config.json` の `guardSeverity` に項目追加
- 閾値を追加する場合:
  - `architecture-guards/config-loader.mjs` の `normalizeGuardThresholds` に項目追加
  - `architecture-guards.config.json` の `guardThresholds` に項目追加
