/**
 * gbp.ts
 *
 * Make.com の Custom Webhook 経由で Google Business Profile に投稿するモジュール。
 *
 * 【アーキテクチャ変更の背景】
 *   GBP API (mybusiness v4) を直接叩くには Google のパートナー審査が必要で、
 *   個人では Organization アカウントの取得が困難なため、
 *   すでに Google の審査を通過済みの Make.com を踏み台として利用する。
 *
 *   このモジュールは生成した投稿テキストを Make.com の Webhook URL に POST するだけで、
 *   実際の GBP API 呼び出しは Make.com 側のシナリオが担う。
 *
 * エラーハンドリング:
 *   Webhook エラー時は 10 秒待機して 1 回だけリトライする。
 *   リトライでも失敗した場合は success: false を返す（例外は投げない）。
 */

/** createLocalPost の引数 */
export interface LocalPostParams {
  accountId: string;  // "accounts/123456789012" 形式（studios.yaml の値をそのまま渡す）
  locationId: string; // "locations/987654321098" 形式（同上）
  postText: string;   // generator.ts が生成した投稿テキスト
  bookingUrl: string; // CTA ボタンのリンク先（予約サイト URL）
  webhookUrl: string; // Make.com Custom Webhook URL（環境変数 MAKE_WEBHOOK_URL から渡す）
}

/** createLocalPost の戻り値 */
export interface PostResult {
  success: boolean; // 投稿成功かどうか
  retried: boolean; // リトライを実施したかどうか
  error?: string;   // 失敗時のエラー内容（成功時は undefined）
}

/** ms 待機するユーティリティ */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Make.com Webhook 経由で GBP に投稿する。
 * エラー時は 10 秒後に 1 回だけリトライする。
 */
export async function createLocalPost(params: LocalPostParams): Promise<PostResult> {
  const { accountId, locationId, postText, bookingUrl, webhookUrl } = params;

  // 投稿タイトル: 投稿文の先頭にある【...】を抽出してタイトルとして使う
  // 例: "【本日穴場です】本日2月25日..." → "本日穴場です"
  // Make.com の "Call to action" Post type で Title フィールドが必須のため送信する
  const titleMatch = postText.match(/^【(.+?)】/);
  const title = titleMatch ? titleMatch[1] : postText.slice(0, 40);

  // Make.com シナリオに渡すペイロード
  // Make.com 側でこの JSON を受け取り、GBP の Create a Post モジュールにマッピングする
  const body = JSON.stringify({
    accountId,   // Make.com の "Location Name" フィールド構築用: {{1.accountId}}/{{1.locationId}}
    locationId,  // 同上
    title,       // Make.com の "Title" フィールドにマッピング: {{1.title}}
    text: postText,      // Make.com の "Summary" フィールドにマッピング: {{1.text}}
    bookingUrl,  // Make.com の "Call to Action URL" フィールドにマッピング: {{1.bookingUrl}}
  });

  // 1回目の試行
  const result = await attempt(webhookUrl, body);

  if (result.ok) {
    return { success: true, retried: false };
  }

  // 失敗 → 10 秒待機してリトライ（一時的なネットワークエラーや Make.com の過負荷に対応）
  console.error(`Make.com Webhook error (${result.status}): ${result.errorText}. Retrying in 10s...`);
  await sleep(10_000);

  // 2回目（最終）の試行
  const retry = await attempt(webhookUrl, body);
  if (retry.ok) {
    return { success: true, retried: true };
  }

  // リトライも失敗 → エラー内容を返す（呼び出し元が Slack 通知を担う）
  return {
    success: false,
    retried: true,
    error: `HTTP ${retry.status}: ${retry.errorText}`,
  };
}

/**
 * fetch で1回 HTTP POST を試みる内部ヘルパー。
 * レスポンスの成否と内容を返す（例外は投げない）。
 */
async function attempt(
  url: string,
  body: string,
): Promise<{ ok: boolean; status: number; errorText: string }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body,
  });

  if (response.ok) {
    return { ok: true, status: response.status, errorText: '' };
  }

  // エラーレスポンスのボディを取得してデバッグ情報として返す
  const errorText = await response.text().catch(() => '(could not read response body)');
  return { ok: false, status: response.status, errorText };
}
