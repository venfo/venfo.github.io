# VENTURE INFO

就活生・投資初心者向けの企業発掘ツール。採掘型UIを通じて、未知企業との接触・保存・行動データを蓄積する静的Webアプリです。

公開URL: https://venfo.github.io/

## 構成

- `index.html`: デスクトップ向けメイン画面
- `mobile.html`: モバイル向けメイン画面
- `assets/quarry.css` / `assets/quarry.js`: 採掘場（`index.html`・`mobile.html`共通）のスタイルと処理
- `assets/company-profiles.js`: 大手100社の概要・出典データ（採掘場で使用）
- `assets/pictograms.js` / `assets/pictograms/`: 業界アイコン（採掘場・図鑑で共通）
- `company-data-client.js`: Supabaseから出典確認済みの企業情報を取得する共通処理
- `collection.html`: 発掘・保存した企業のコレクション
- `admin.html`: Supabase Edge Function経由の管理・分析画面
- `conveyor.html`: 企業閲覧画面
- `report.html`: レポート画面
- `SUPABASE_SETUP.sql`: 匿名行動ログ用テーブルとRLS
- `scripts/verify_repo.py`: Pull Requestの自動検査

## 開発フロー

`main`へ直接コミットせず、`codex/<変更内容>`ブランチからPull Requestを作成します。GitHub ActionsがPASSした後、同志ひびの明示的な承認を受けてからMergeします。

詳細は[開発運用ルール](docs/DEVELOPMENT.md)を参照してください。

## セキュリティ

Supabaseのpublishable / anon keyはブラウザ利用を前提としますが、RLSを必須とします。service-role key、OpenAI API key、管理者トークンはリポジトリへ保存せず、サーバー側のSecret管理を使用します。
