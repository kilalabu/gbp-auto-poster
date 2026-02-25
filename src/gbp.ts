/**
 * gbp.ts
 *
 * Google Business Profile (GBP) の localPosts エンドポイントへ投稿するモジュール。
 *
 * 【重要】使用する API エンドポイントについて:
 *   GBP への投稿（localPosts）は `mybusiness v4` API を使用する。
 *   googleapis npm パッケージに含まれる `mybusinessbusinessinformation` v1 は
 *   店舗情報（business information）専用であり、localPosts リソースを持たない。
 *   そのため、Node.js 組み込みの fetch で直接 HTTP リクエストを送信する。
 *
 * エラーハンドリング:
 *   API エラー時は 10 秒待機して 1 回だけリトライする。
 *   リトライでも失敗した場合は success: false を返す（例外は投げない）。
 */

/** createLocalPost の引数 */
export interface LocalPostParams {
  accountId: string;  // "accounts/123456789012" 形式（studios.yaml の値をそのまま渡す）
  locationId: string; // "locations/987654321098" 形式（同上）
  postText: string;   // generator.ts が生成した投稿テキスト
  bookingUrl: string; // CTA ボタンのリンク先（予約サイト URL）
  accessToken: string; // OAuth2 アクセストークン（index.ts で取得）
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
 * GBP localPosts エンドポイントへ投稿する。
 * エラー時は 10 秒後に 1 回だけリトライする。
 */
export async function createLocalPost(params: LocalPostParams): Promise<PostResult> {
  const { accountId, locationId, postText, bookingUrl, accessToken } = params;

  // accountId = "accounts/123456789012"、locationId = "locations/987654321098" をそのまま結合
  // → https://mybusiness.googleapis.com/v4/accounts/123456789012/locations/987654321098/localPosts
  const url = `https://mybusiness.googleapis.com/v4/${accountId}/${locationId}/localPosts`;

  // GBP localPost のリクエストボディ
  const body = JSON.stringify({
    languageCode: 'ja',
    summary: postText, // 投稿本文
    callToAction: {
      actionType: 'BOOK', // 予約ボタン
      url: bookingUrl,
    },
    topicType: 'STANDARD', // 通常の投稿（イベント・特典などではない）
  });

  // 1回目の試行
  const result = await attempt(url, body, accessToken);

  if (result.ok) {
    return { success: true, retried: false };
  }

  // 失敗 → 10 秒待機してリトライ（429 レート制限や 500 系の一時エラーに対応）
  console.error(`GBP API error (${result.status}): ${result.errorText}. Retrying in 10s...`);
  await sleep(10_000);

  // 2回目（最終）の試行
  const retry = await attempt(url, body, accessToken);
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
  accessToken: string,
): Promise<{ ok: boolean; status: number; errorText: string }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`, // OAuth2 Bearer トークン
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
