# Make.com シナリオ設定手順

## 概要

このシステムでは Make.com を「踏み台」として使い、GitHub Actions から受け取った投稿データを Google Business Profile に転送します。
Make.com はすでに Google の審査を通過済みなので、個人の Google アカウントで連携するだけで GBP 投稿が可能です。

## 前提条件

- [Make.com](https://www.make.com/) の無料アカウントを作成済みであること
- Google Business Profile に店舗が登録・確認済みであること

---

## Step 1: 新規シナリオの作成

1. Make.com にログイン
2. 左メニューの **「Scenarios」** をクリック
3. 右上の **「Create a new scenario」** をクリック

---

## Step 2: モジュール 1 — Custom Webhook（トリガー）

1. 検索ボックスに **「Webhooks」** と入力して選択
2. **「Custom webhook」** を選択
3. **「Add」** をクリックして新しい Webhook を作成
4. 名前を入力（例: `GBP Auto Poster`）して **「Save」**
5. 表示された **Webhook URL をコピーして保存**（後で GitHub Secrets に登録します）
6. **「OK」** をクリック

> **ヒント:** URLは `https://hook.eu2.make.com/xxxxxxxxxx` のような形式です。

### Webhook のデータ構造を認識させる

1. Webhook モジュールの下に表示される **「Run once」** をクリック（待機状態になる）
2. 別のターミナルで以下のコマンドを実行してテストデータを送信する:

```bash
curl -X POST "（コピーした Webhook URL）" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "テスト投稿",
    "text": "テスト投稿です",
    "bookingUrl": "https://example.com"
  }'
```

3. Make.com 画面が自動的に更新され、データ構造が認識される

---

## Step 3: モジュール 2 — Google Business Profile（アクション）

1. Webhook モジュールの右の **「+」** をクリック
2. 検索ボックスに **「Google Business Profile」** と入力して選択
3. **「Create a Post」** を選択

### Google アカウントの連携

1. **「Add」** をクリック
2. Advanced settings は **OFF のまま**にして **「Sign in with Google」** をクリック
3. ブラウザが開くので、GBP が登録されている Google アカウントでログイン
4. 権限を許可して Make.com に戻る

### フィールドのマッピング

| Make.com のフィールド | 設定値 | 説明 |
|---|---|---|
| **Enter a Location Name** | `Select from the list` | ドロップダウンから選択 |
| **Account name** | 対象アカウントを選択 | ログインした Google アカウントに紐づく GBP アカウント |
| **Location** | 対象店舗を選択 | 投稿先の店舗 |
| **Post type** | `Call to action` | 通常投稿＋ CTA ボタン付き |
| **Title** | `{{1.title}}` | Webhook から受け取る（投稿文の【...】部分） |
| **Summary** | `{{1.text}}` | Webhook から受け取る（投稿本文全体） |
| **Call to Action Type** | `Book` | 予約ボタン |
| **Call to Action URL** | `{{1.bookingUrl}}` | Webhook から受け取る（予約サイト URL） |

> **注意:** Post type の選択肢は Event / Call to action / Offer / Alert (COVID-19) の4種類。

---

## Step 4: シナリオの保存と有効化

1. 右下の **「Save」** をクリック
2. 左上のトグルスイッチを **ON** にする（シナリオが有効になる）

---

## Step 5: GitHub Secrets への登録

1. GitHub リポジトリの **「Settings」** → **「Secrets and variables」** → **「Actions」** を開く
2. **「New repository secret」** をクリック
3. 以下のシークレットを追加:

| Name | Value |
|---|---|
| `MAKE_WEBHOOK_URL` | Step 2 でコピーした Webhook URL |

---

## Step 6: 動作確認

1. GitHub リポジトリの **「Actions」** タブを開く
2. **「GBP Auto Post」** ワークフローを選択
3. **「Run workflow」** → **「Run workflow」** で手動実行
4. ワークフローが成功（緑チェック）になることを確認
5. Make.com の **「History」** タブでシナリオが正常に実行されたか確認
6. Google Business Profile の管理画面で投稿が作成されているか確認

---

## トラブルシューティング

### Make.com でエラーが出る場合

- **「Insufficient permissions」**: Google アカウントの連携をやり直す
- **「Location not found」**: Account name・Location のドロップダウンで正しい店舗を選択し直す
- **「Invalid post type」**: Post type が `Call to action` になっているか確認

### GitHub Actions で `HTTP 4xx` エラーが出る場合

- Webhook URL が正しくコピーされているか確認
- Make.com シナリオが ON になっているか確認
- Make.com の無料枠（月 1,000 オペレーション）が上限に達していないか確認

---

## 運用コスト試算

| 項目 | 消費量 |
|---|---|
| 1回の実行 | 1 オペレーション |
| 1日1回の場合 | 約 30 オペレーション/月 |
| 無料枠 | 1,000 オペレーション/月 |
| **余裕** | **約 970 オペレーション（3年以上分の余裕）** |
