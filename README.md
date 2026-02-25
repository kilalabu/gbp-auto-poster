# GBP Auto Poster

Googleカレンダーの予約状況をもとに、Googleビジネスプロフィール（旧マイビジネス）へ毎日自動投稿するバッチ処理システム。

## 概要

Studio Beat 24h（天満橋の24時間営業レンタルスタジオ）の空き状況を毎朝 **08:00 JST** に自動取得し、状況に応じた投稿文を生成して GBP へ投稿する。GitHub Actions でスケジュール実行するため、サーバー不要で運用できる。

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
| GBP 投稿 | Node.js 組み込み fetch（mybusiness v4 API 直接呼び出し） |
| 日付処理 | dayjs + timezone/utc プラグイン |
| 実行環境 | GitHub Actions（ubuntu-latest） |

---

## ディレクトリ構成

```
.
├── .github/workflows/auto-post.yml  # GitHub Actions（毎日 08:00 JST 自動実行）
├── config/
│   └── studios.yaml                 # 店舗設定（カレンダーID・GBP ID・予約URL等）
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
| My Business Business Information API | GBP 店舗情報取得 |
| Google My Business API (v4) | GBP への localPosts 投稿 |

> **⚠️ GBP API のクォータ申請**
>
> Google My Business API（v4）は申請が必要な場合があり、承認前は 403 エラーになる。
> [Google Business Profile API アクセスリクエスト](https://developers.google.com/my-business/content/prereqs) を確認して申請する。

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
> - `https://www.googleapis.com/auth/business.manage`

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
GOOGLE_REFRESH_TOKEN=   # ← ステップ3で設定
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

### ステップ 4: studios.yaml を設定

`config/studios.yaml` に実際の店舗情報を記入する。

```yaml
studios:
  - id: studio-beat-24h
    name: Studio Beat 24h
    calendarId: "xxxx@group.calendar.google.com"  # Googleカレンダーの設定から確認
    accountId: "accounts/123456789012"             # GBP のアカウントID
    locationId: "locations/987654321098"           # GBP のロケーションID
    bookingUrl: "https://yoyakuru.jp/studio-beat-24h"
    timezone: "Asia/Tokyo"
    peakHours:
      weekday: { start: 17, end: 21 }
      weekend: { start: 13, end: 17 }
    keywords:
      - "天満橋"
      - "24時間営業"
      - "年中無休"
      - "レンタルスタジオ"
```

**カレンダー ID の確認方法:**
[Googleカレンダー設定](https://calendar.google.com/calendar/r/settings) →「マイカレンダー」→ 対象カレンダー →「カレンダーの統合」→「カレンダー ID」

**GBP の accountId / locationId の確認方法（アクセストークン取得後）:**
```bash
# アカウント一覧
curl -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  https://mybusinessaccountmanagement.googleapis.com/v1/accounts

# ロケーション一覧
curl -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  "https://mybusinessbusinessinformation.googleapis.com/v1/accounts/YOUR_ACCOUNT_ID/locations"
```

---

### ステップ 5: ローカルで動作確認

```bash
pnpm start
```

GBP への投稿と Slack 通知が実行されれば成功。

---

### ステップ 6: GitHub Secrets を設定

GitHub リポジトリの「Settings」→「Secrets and variables」→「Actions」から以下を登録する。

| Secret 名 | 値 |
|---|---|
| `GOOGLE_CLIENT_ID` | GCP OAuth2 クライアント ID |
| `GOOGLE_CLIENT_SECRET` | GCP OAuth2 クライアントシークレット |
| `GOOGLE_REFRESH_TOKEN` | ステップ 3 で取得したリフレッシュトークン |
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

---

## トラブルシューティング

### `403 Forbidden` (GBP API)

GBP API のクォータ申請が完了していない。[ステップ 1-2](#1-2-必要な-api-を有効化) を参照して申請する。

### `invalid_grant` (OAuth2)

リフレッシュトークンが失効している。主な原因と対処:

- **OAuth 同意画面が「テスト」モードのまま**: [ステップ 1-4](#1-4-oauth-同意画面を公開in-productionに設定) を参照して「アプリを公開」に変更し、`pnpm run auth` を再実行する
- **6ヶ月以上未使用**: `pnpm run auth` でトークンを再取得し、`.env` と GitHub Secrets の `GOOGLE_REFRESH_TOKEN` を更新する

### `calendar not found`

`config/studios.yaml` の `calendarId` が誤っている。Googleカレンダーの設定から正しい ID を確認する。

### ローカルで `pnpm start` を実行しても投稿されない

1. `.env` の値がすべて設定されているか確認する
2. `node --version` で Node.js 24 以上が使われているか確認する
3. `pnpm install` が完了しているか確認する
