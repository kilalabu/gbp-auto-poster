/**
 * slack.ts
 *
 * 投稿結果を Slack Incoming Webhook で通知するモジュール。
 * 成功・失敗いずれの場合も呼び出され、実行サマリーを投稿する。
 *
 * SLACK_WEBHOOK_URL が未設定の場合は通知をスキップする（ローカルテスト用途）。
 */

import type { AvailabilityCase } from './calendar';

/** notify の引数 */
interface NotifyParams {
  webhookUrl: string;         // SLACK_WEBHOOK_URL 環境変数の値
  studioName: string;         // 店舗名（通知メッセージに含める）
  success: boolean;           // 投稿成功かどうか
  avCase: AvailabilityCase;   // 空き状況ケース（成功時の表示用）
  postTextLength: number;     // 生成した投稿文の文字数（成功時の表示用）
  retried: boolean;           // リトライを実施したかどうか
  error?: string;             // 失敗時のエラー内容
}

/** Slack 通知に表示するケース名（日本語） */
const CASE_LABELS: Record<AvailabilityCase, string> = {
  A: 'CASE A（ピーク時間帯に空きあり）',
  B: 'CASE B（丸1日空き）',
  C: 'CASE C（その他空き）',
};

/**
 * Slack Webhook へ実行結果を通知する。
 *
 * 成功時の通知例:
 *   ✅ [Studio Beat 24h] GBP 投稿完了
 *   日付: 2026-02-25
 *   ケース: CASE A（ピーク時間帯に空きあり）
 *   投稿文字数: 152文字
 *
 * 失敗時の通知例:
 *   ❌ [Studio Beat 24h] GBP 投稿失敗
 *   日付: 2026-02-25
 *   エラー: HTTP 403: ...
 *   リトライ: 実施済み（失敗）
 */
export async function notify(params: NotifyParams): Promise<void> {
  const { webhookUrl, studioName, success, avCase, postTextLength, retried, error } = params;

  // Webhook URL が未設定の場合はスキップ（ローカル開発時など）
  if (!webhookUrl) {
    console.log('[Slack] SLACK_WEBHOOK_URL が未設定のため通知をスキップします');
    return;
  }

  // 日付を YYYY-MM-DD 形式で取得（タイムゾーンは実行環境の TZ 設定に依存）
  const today = new Date().toISOString().slice(0, 10);

  let text: string;
  if (success) {
    // 成功メッセージ: 空配列フィルタで retried が false の場合の空行を除去
    text = [
      `✅ [${studioName}] GBP 投稿完了`,
      `日付: ${today}`,
      `ケース: ${CASE_LABELS[avCase]}`,
      `投稿文字数: ${postTextLength}文字`,
      retried ? '※ 1回リトライ後に成功' : '',
    ]
      .filter(Boolean) // 空文字列を除外
      .join('\n');
  } else {
    // 失敗メッセージ
    text = [
      `❌ [${studioName}] GBP 投稿失敗`,
      `日付: ${today}`,
      `エラー: ${error ?? '不明なエラー'}`,
      retried ? 'リトライ: 実施済み（失敗）' : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  // Slack Incoming Webhook へ POST（Node.js 組み込み fetch を使用）
  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
}
