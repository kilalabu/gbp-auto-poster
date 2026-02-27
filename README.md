# GBP Auto Poster

Googleカレンダーの予約状況をもとに、Googleビジネスプロフィール（旧マイビジネス）へ毎日自動投稿するバッチ処理システム。

## 概要

Studio Beat（天満橋の24時間営業レンタルスタジオ）の空き状況を毎朝 **08:00 JST** に自動取得し、状況に応じた投稿文を生成して GBP へ投稿する。GitHub Actions でスケジュール実行するため、サーバー不要で運用できる。

### 投稿の3パターン

| ケース | 条件 | 訴求内容 |
|---|---|---|
| **CASE A** | ピーク時間帯（平日 17〜21時 / 土日 13〜17時）に空きあり | 「今すぐ使える人気枠」として緊急感を出す |
| **CASE B** | 当日の予約が0件（丸1日空き） | 「穴場日・のびのび使える」としてポジティブに発信 |
| **CASE C** | 予約はあるがピーク時間帯は埋まっている | 空き時間帯を案内して認知を高める |

スパム判定回避のため、各ケースに **4パターンのテンプレート**を用意してランダム選択する。全テンプレートに SEO/MEO キーワード（天満橋・24時間営業・年中無休・レンタルスタジオ）を自然な形で挿入済み。

---

## 技術スタック

| 項目 | 内容 |
|---|---|
| Runtime | Node.js 24 LTS |
| 言語 | TypeScript (CommonJS) |
| パッケージ管理 | pnpm |
| TS 実行 | tsx |
| Google API | googleapis（Calendar + OAuth2） |
| GBP 投稿 | Make.com Custom Webhook 経由（Make.com が GBP API を呼び出す） |
| ワークフロー自動化 | Make.com（無料枠: 1,000 オペレーション/月） |
| 日付処理 | dayjs + timezone/utc プラグイン |
| 実行環境 | GitHub Actions（ubuntu-latest） |

---

## ディレクトリ構成

```
.
├── .github/workflows/auto-post.yml  # GitHub Actions（毎日 08:00 JST 自動実行）
├── config/
│   └── studios.yaml                 # 店舗設定（calendarId は環境変数参照、git 管理対象）
├── src/
│   ├── index.ts                     # メインエントリ（店舗ごとにループ処理）
│   ├── calendar.ts                  # Googleカレンダー取得・空き枠算出
│   ├── generator.ts                 # 投稿テキスト生成（CASE A/B/C・4バリエーション）
│   ├── gbp.ts                       # GBP API 投稿（リトライロジック含む）
│   └── slack.ts                     # Slack Webhook 通知
├── scripts/
│   └── auth.ts                      # OAuth2 リフレッシュトークン取得（初回のみ実行）
├── docs/plan/                       # 設計ドキュメント
├── .env.example                     # 環境変数テンプレート
└── package.json
```

---

## セットアップ手順

### 前提条件

| ツール | バージョン |
|---|---|
| Node.js | 24 LTS |
| pnpm | 10 以上 |

```bash
# mise を使う場合
mise use --global node@24
mise use --global pnpm@10
```

---

### ステップ 1: GCP プロジェクトの設定

#### 1-1. GCP プロジェクトを作成（または選択）

[Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作成する（例: `gbp-auto-poster`）。

#### 1-2. 必要な API を有効化

「API とサービス」→「ライブラリ」から以下を有効化する。

| API | 用途 |
|---|---|
| Google Calendar API | カレンダーのイベント取得 |

> **GBP 投稿について**
>
> GBP への投稿は Make.com が代行するため、GBP 関連の API を GCP で有効化する必要はない。

#### 1-3. OAuth2 クライアント ID を作成

「API とサービス」→「認証情報」→「認証情報を作成」→「OAuth クライアント ID」

- アプリケーションの種類: **デスクトップ アプリ**
- 作成後に表示される `クライアント ID` と `クライアントシークレット` を控える

#### 1-4. OAuth 同意画面を「公開（In Production）」に設定

「OAuth 同意画面」でスコープを設定後、公開ステータスを **「アプリを公開」** に変更する。

> **⚠️ 必須の設定**
>
> 「テスト」モードのままでは **リフレッシュトークンが 7 日で失効**し、毎週手動再発行が必要になる。
> 「アプリを公開」に変更することでトークンが無期限利用可能になる。
> Google の審査は不要（個人・内部ツール用途）。「未確認のアプリ」警告はクリックスルーすれば使用可能。
>
> 設定するスコープ:
> - `https://www.googleapis.com/auth/calendar.readonly`

---

### ステップ 2: ローカル環境のセットアップ

```bash
# リポジトリをクローン
git clone https://github.com/<your-org>/gbp-auto-poster.git
cd gbp-auto-poster

# 依存パッケージをインストール
pnpm install

# 環境変数ファイルを作成
cp .env.example .env
```

`.env` にステップ 1-3 で取得した値を記入する：

```env
GOOGLE_CLIENT_ID=1234567890-abcdefghij.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxxxxxxxxxxxxxxx
GOOGLE_REFRESH_TOKEN=      # ← ステップ3で設定
STUDIO_BEAT_CALENDAR_ID=   # ← Googleカレンダー設定 > カレンダーの統合 > カレンダー ID
MAKE_WEBHOOK_URL=          # ← ステップ4（Make.com 設定）で取得
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/xxx/yyy/zzz
```

> `.env` は `.gitignore` に登録されているため Git にはコミットされない。

---

### ステップ 3: OAuth2 リフレッシュトークンを取得

```bash
pnpm run auth
```

実行すると認可 URL がコンソールに表示される。ブラウザで開いて Google アカウントで認可すると、ブラウザが `localhost:3000` にリダイレクトされ、自動的にトークンが取得される。

```
=== 取得したトークン ===
refresh_token: 1//0xxxxxxxxxx...
```

表示された `refresh_token` を `.env` の `GOOGLE_REFRESH_TOKEN` に設定する。

---

### ステップ 4: Make.com シナリオを設定

Make.com が GBP への投稿を代行するため、Make.com 側でシナリオを1回だけ手動設定する必要がある。

詳細な設定手順は [`docs/manual/Make.com設定手順.md`](docs/manual/Make.com設定手順.md) を参照。

設定が完了すると **Webhook URL**（例: `https://hook.eu2.make.com/xxxxxxxxxx`）が発行される。この URL を `.env` の `MAKE_WEBHOOK_URL` に設定する。

---

### ステップ 5: studios.yaml を設定

`config/studios.yaml` に実際の店舗情報を記入する。

```yaml
studios:
  - id: studio-beat
    name: Studio Beat
    calendarId: "${STUDIO_BEAT_CALENDAR_ID}"  # 環境変数で展開（実際の値は .env に記載）
    bookingUrl: "https://yoyakuru.jp/studio-beat"
    timezone: "Asia/Tokyo"
    peakHours:
      weekday: { start: 17, end: 21 }
      weekend: { start: 13, end: 17 }
```

**カレンダー ID の確認方法:**
[Googleカレンダー設定](https://calendar.google.com/calendar/r/settings) →「マイカレンダー」→ 対象カレンダー →「カレンダーの統合」→「カレンダー ID」

取得した値を `.env` の `STUDIO_BEAT_CALENDAR_ID` に設定する。`studios.yaml` への直接記載は不要。

> **GBP の投稿先店舗について**
>
> 投稿先アカウント・店舗は Make.com シナリオ内で固定選択する（ステップ 4 参照）。`studios.yaml` への GBP ID の記載は不要。

---

### ステップ 6: ローカルで動作確認

```bash
pnpm start
```

GBP への投稿と Slack 通知が実行されれば成功。

---

### ステップ 7: GitHub Secrets を設定

GitHub リポジトリの「Settings」→「Secrets and variables」→「Actions」から以下を登録する。

| Secret 名 | 値 |
|---|---|
| `GOOGLE_CLIENT_ID` | GCP OAuth2 クライアント ID |
| `GOOGLE_CLIENT_SECRET` | GCP OAuth2 クライアントシークレット |
| `GOOGLE_REFRESH_TOKEN` | ステップ 3 で取得したリフレッシュトークン |
| `STUDIO_BEAT_CALENDAR_ID` | Google カレンダー ID（ステップ 5 参照） |
| `MAKE_WEBHOOK_URL` | ステップ 4（Make.com 設定）で取得した Webhook URL |
| `SLACK_WEBHOOK_URL` | Slack Incoming Webhook URL |

GitHub Actions の「Actions」タブ →「GBP Auto Post」→「Run workflow」で手動実行して動作確認する。

---

## 使い方

### 日常運用

セットアップ完了後は **何もしなくてよい**。毎朝 08:00 JST に GitHub Actions が自動実行して GBP へ投稿する。

### コマンド一覧

| コマンド | 内容 |
|---|---|
| `pnpm start` | 手動で今日の投稿を実行する |
| `pnpm run auth` | OAuth2 リフレッシュトークンを再取得する（トークン失効時） |
| `pnpm typecheck` | TypeScript の型チェックを実行する |

### 店舗を追加する

`config/studios.yaml` の `studios` 配列に店舗を追加するだけでコード変更不要。

ただし、`calendarId` は環境変数参照（`"${VAR_NAME}"` 形式）で記載するため、**店舗ごとに新しい環境変数の追加が必要**。

**追加手順:**

1. `config/studios.yaml` に新しい店舗エントリを追加（例: `calendarId: "${NEW_STUDIO_CALENDAR_ID}"`）
2. `.env`（ローカル）に `NEW_STUDIO_CALENDAR_ID=xxxx@group.calendar.google.com` を追記
3. GitHub Secrets に `NEW_STUDIO_CALENDAR_ID` を登録
4. `.github/workflows/auto-post.yml` の `env:` ブロックに `NEW_STUDIO_CALENDAR_ID: ${{ secrets.NEW_STUDIO_CALENDAR_ID }}` を追記

---

## トラブルシューティング

### Make.com でエラーが出る場合

`docs/manual/Make.com設定手順.md` のトラブルシューティングセクションを参照。

### GitHub Actions で `HTTP 4xx` エラーが出る場合

- `MAKE_WEBHOOK_URL` が GitHub Secrets に正しく登録されているか確認する
- Make.com シナリオが ON になっているか確認する
- Make.com の無料枠（月 1,000 オペレーション）が上限に達していないか確認する

### `invalid_grant` (OAuth2)

リフレッシュトークンが失効している。主な原因と対処:

- **OAuth 同意画面が「テスト」モードのまま**: [ステップ 1-4](#1-4-oauth-同意画面を公開in-productionに設定) を参照して「アプリを公開」に変更し、`pnpm run auth` を再実行する
- **6ヶ月以上未使用**: `pnpm run auth` でトークンを再取得し、`.env` と GitHub Secrets の `GOOGLE_REFRESH_TOKEN` を更新する

### `calendar not found` / `Missing environment variable: STUDIO_BEAT_CALENDAR_ID`

`.env`（ローカル）または GitHub Secrets（Actions）の `STUDIO_BEAT_CALENDAR_ID` が未設定か誤っている。Googleカレンダーの設定から正しいカレンダー ID を確認して設定する。

### ローカルで `pnpm start` を実行しても投稿されない

1. `.env` の値がすべて設定されているか確認する（`STUDIO_BEAT_CALENDAR_ID`・`MAKE_WEBHOOK_URL` を含む）
2. `node --version` で Node.js 24 以上が使われているか確認する
3. `pnpm install` が完了しているか確認する
4. Make.com シナリオが ON になっているか確認する
