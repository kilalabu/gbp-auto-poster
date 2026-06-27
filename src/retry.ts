/**
 * retry.ts — 一過性ネットワークエラーに対する指数バックオフ・リトライ
 *
 * 背景:
 *   Google Calendar API / OAuth トークン取得は gaxios(HTTP層)経由で行うが、
 *   一過性の接続断（"Premature close" / ECONNRESET / fetch failed など）が
 *   発生しうる（2026-06-26〜の連続失敗の主因）。
 *   これらは再試行で回復することが多いため、指数バックオフでリトライする。
 *
 *   一方、invalid_grant（リフレッシュトークン失効）のような回復不能エラーは
 *   何度リトライしても無駄なので、isRetryable で区別して fail-fast させる。
 */

/** withRetry の挙動を制御するオプション */
export interface RetryOptions {
  /** 最大試行回数（初回を含む）。デフォルト 3 */
  maxAttempts?: number;
  /** 初回リトライ前の待機(ms)。以降は 2倍ずつ増える。デフォルト 2000 */
  baseDelayMs?: number;
  /** リトライ対象かどうかを判定する関数。デフォルトは「常にリトライ」 */
  isRetryable?: (err: unknown) => boolean;
  /** リトライ直前に呼ばれるフック（ログ出力用） */
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
}

/** ms 待機するユーティリティ */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * fn を実行し、失敗かつ isRetryable が true の間は指数バックオフでリトライする。
 * 全試行が失敗した場合は最後のエラーを再 throw する。
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 2000;
  const isRetryable = options.isRetryable ?? (() => true);

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      // 最終試行 or リトライ不可能なエラーなら即座に脱出して throw
      if (attempt >= maxAttempts || !isRetryable(err)) break;
      // 2秒 → 4秒 → 8秒 … と待機時間を倍増させる
      const delayMs = baseDelayMs * 2 ** (attempt - 1);
      options.onRetry?.(err, attempt, delayMs);
      await sleep(delayMs);
    }
  }
  throw lastErr;
}

/**
 * 一過性のネットワークエラー（再試行で回復しうる）かどうかを判定する。
 *
 * この関数は「再試行する価値があるエラー」と「即座に諦めるべきエラー」を
 * 分ける、本リトライ機構の中核となる判断ロジック。
 */
export function isRetryableError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);

  // 一過性の接続エラー（再試行で回復しうる）
  // "Premature close" は node-fetch / undici が接続途中切断時に出すメッセージ
  const transient =
    /Premature close|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|network|fetch failed|terminated/i;
  if (transient.test(message)) return true;

  // gaxios はHTTPエラー時に status / code を持つ。5xx と 429(レート制限)は一過性とみなす。
  const status =
    (err as { status?: number; code?: number; response?: { status?: number } })?.status ??
    (err as { response?: { status?: number } })?.response?.status ??
    (err as { code?: number })?.code;
  if (typeof status === 'number') {
    return status === 429 || (status >= 500 && status < 600);
  }

  // invalid_grant 等の認証エラー・4xx・不明なエラーはリトライしない（fail-fast）
  return false;
}
