/**
 * slack.ts
 *
 * 投稿結果を Slack Incoming Webhook で通知するモジュール。
 * 失敗時のみ通知する。
 *
 * SLACK_WEBHOOK_URL が未設定の場合は通知をスキップする（ローカルテスト用途）。
 */

/** notify の引数 */
interface NotifyParams {
  webhookUrl: string;   // SLACK_WEBHOOK_URL 環境変数の値
  studioName: string;   // 店舗名（通知メッセージに含める）
  success: boolean;     // 投稿成功かどうか（true の場合は通知しない）
  avCase: unknown;      // 未使用（呼び出し側の互換性のために残す）
  postTextLength: number; // 未使用（呼び出し側の互換性のために残す）
  retried: boolean;     // リトライを実施したかどうか
  error?: string;       // 失敗時のエラー内容
}

/**
 * Slack Webhook へ失敗時のみ通知する。
 *
 * 失敗時の通知例:
 *   ❌ [Studio Beat 24h] GBP 投稿失敗
 *   日付: 2026-02-25
 *   エラー: HTTP 403: ...
 *   リトライ: 実施済み（失敗）
 */
export async function notify(params: NotifyParams): Promise<void> {
  const { webhookUrl, studioName, success, retried, error } = params;

  // 成功時は通知しない
  if (success) return;

  // Webhook URL が未設定の場合はスキップ（ローカル開発時など）
  if (!webhookUrl) {
    console.log('[Slack] SLACK_WEBHOOK_URL が未設定のため通知をスキップします');
    return;
  }

  // 日付を YYYY-MM-DD 形式で取得（タイムゾーンは実行環境の TZ 設定に依存）
  const today = new Date().toISOString().slice(0, 10);

  const text = [
    `❌ [${studioName}] GBP 投稿失敗`,
    `日付: ${today}`,
    `エラー: ${error ?? '不明なエラー'}`,
    retried ? 'リトライ: 実施済み（失敗）' : '',
  ]
    .filter(Boolean)
    .join('\n');

  // Slack Incoming Webhook へ POST（Node.js 組み込み fetch を使用）
  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
}
