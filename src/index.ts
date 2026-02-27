/**
 * index.ts — メインエントリポイント
 *
 * 処理フロー（店舗ごとにループ）:
 *   1. 環境変数と studios.yaml を読み込む
 *   2. Google Calendar から当日の空き状況を取得（calendar.ts）
 *   3. 空き状況に応じた投稿テキストを生成（generator.ts）
 *   4. Make.com Webhook 経由で GBP に投稿（gbp.ts）
 *   5. 結果を Slack に通知（slack.ts）
 *
 * 1店舗でも失敗した場合は process.exit(1) で終了し、
 * GitHub Actions の Run を失敗ステータスにする。
 */

import 'dotenv/config'; // .env ファイルを環境変数に読み込む（ローカル開発用）
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { google } from 'googleapis';
import { getAvailability } from './calendar';
import { generatePost } from './generator';
import { createLocalPost } from './gbp';
import { notify } from './slack';

/** studios.yaml のピーク時間帯設定 */
interface PeakHours {
  weekday: { start: number; end: number };
  weekend: { start: number; end: number };
}

/** studios.yaml の1店舗分の設定 */
interface StudioConfig {
  id: string;          // 識別子（ログ・デバッグ用）
  name: string;        // 店舗名（Slack 通知・投稿文に使用）
  calendarId: string;  // Google Calendar の calendarId
  accountId: string;   // GBP アカウントID（"accounts/数字" 形式）
  locationId: string;  // GBP ロケーションID（"locations/数字" 形式）
  bookingUrl: string;  // 予約URL（CTA ボタンのリンク先）
  timezone: string;    // タイムゾーン（例: "Asia/Tokyo"）
  peakHours: PeakHours;
  keywords: string[];  // SEO キーワード（現在は generator.ts のテンプレートに直書き）
}

/** studios.yaml のルート構造 */
interface StudiosYaml {
  studios: StudioConfig[];
}

async function main(): Promise<void> {
  // ── 1. 環境変数の検証 ──
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  const makeWebhookUrl = process.env.MAKE_WEBHOOK_URL;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'Missing required environment variables: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN',
    );
  }
  if (!makeWebhookUrl) {
    throw new Error('Missing required environment variable: MAKE_WEBHOOK_URL');
  }

  // ── 2. 店舗設定の読み込み ──
  // カレントディレクトリから読むので、pnpm start はプロジェクトルートで実行すること
  const yamlContent = readFileSync('config/studios.yaml', 'utf-8');
  const { studios } = parse(yamlContent) as StudiosYaml;

  // ── 3. OAuth2 クライアントの初期化 ──
  // Google Calendar API の認証に使用する（GBP 投稿は Make.com 経由のため不要）
  // リフレッシュトークンをセットしておくことで、自動でアクセストークンを取得・更新する
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  let hasError = false; // いずれかの店舗で失敗した場合に true になる

  // ── 4. 店舗ごとにループ処理 ──
  for (const studio of studios) {
    console.log(`\n[${studio.name}] 処理開始...`);

    try {
      // カレンダーから空き状況を取得（CASE A/B/C を判定）
      const availability = await getAvailability(
        oauth2Client,
        studio.calendarId,
        studio.peakHours,
        studio.timezone,
      );

      console.log(`[${studio.name}] Availability case: CASE ${availability.case}`);

      // 空き状況に応じた投稿テキストを生成（ランダムバリエーション選択）
      const postText = generatePost(availability, {
        timezone: studio.timezone,
        peakHours: studio.peakHours,
      });

      console.log(`[${studio.name}] 投稿文 (${postText.length}文字):\n${postText}`);

      // Make.com Webhook 経由で GBP に投稿（エラー時は内部で1回リトライ）
      const result = await createLocalPost({
        accountId: studio.accountId,
        locationId: studio.locationId,
        postText,
        bookingUrl: studio.bookingUrl,
        webhookUrl: makeWebhookUrl,
      });

      // 投稿結果を Slack に通知（成功・失敗いずれも送信）
      await notify({
        webhookUrl: process.env.SLACK_WEBHOOK_URL ?? '',
        studioName: studio.name,
        success: result.success,
        avCase: availability.case,
        postTextLength: postText.length,
        retried: result.retried,
        error: result.error,
      });

      if (!result.success) {
        hasError = true;
        console.error(`[${studio.name}] 投稿失敗: ${result.error}`);
      } else {
        console.log(`[${studio.name}] 投稿成功${result.retried ? '（リトライ後）' : ''}`);
      }

    } catch (err) {
      // 予期しない例外（ネットワークエラー・YAML パースエラーなど）
      hasError = true;
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[${studio.name}] 予期しないエラー: ${errMsg}`);

      // Slack 通知自体が失敗してもプロセスを止めない（.catch で無視）
      await notify({
        webhookUrl: process.env.SLACK_WEBHOOK_URL ?? '',
        studioName: studio.name,
        success: false,
        avCase: 'C',       // エラー時はダミー値
        postTextLength: 0,
        retried: false,
        error: errMsg,
      }).catch(() => {});
    }
  }

  // 1店舗でも失敗していれば非ゼロ終了コードで終了
  // → GitHub Actions の Run が失敗ステータスになり、失敗通知メールが届く
  if (hasError) {
    process.exit(1);
  }
}

// トップレベルの例外をキャッチして終了コード 1 で終わらせる
main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
