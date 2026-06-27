import { describe, it, expect, vi } from 'vitest';
import { withRetry, isRetryableError } from '../src/retry';

describe('isRetryableError', () => {
  it('一過性の接続エラー(Premature close)はリトライ対象', () => {
    expect(
      isRetryableError(new Error('Invalid response body while trying to fetch ...: Premature close')),
    ).toBe(true);
  });

  it('ECONNRESET / fetch failed もリトライ対象', () => {
    expect(isRetryableError(new Error('read ECONNRESET'))).toBe(true);
    expect(isRetryableError(new Error('fetch failed'))).toBe(true);
  });

  it('5xx と 429 はリトライ対象', () => {
    expect(isRetryableError({ status: 503 })).toBe(true);
    expect(isRetryableError({ status: 429 })).toBe(true);
    expect(isRetryableError({ response: { status: 500 } })).toBe(true);
  });

  it('invalid_grant や 4xx はリトライ対象外（fail-fast）', () => {
    expect(isRetryableError(new Error('invalid_grant'))).toBe(false);
    expect(isRetryableError({ status: 401 })).toBe(false);
    expect(isRetryableError({ status: 400 })).toBe(false);
  });
});

describe('withRetry', () => {
  it('初回成功ならそのまま返す', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    await expect(withRetry(fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('一過性エラー後に成功すればリトライして返す', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('Premature close'))
      .mockResolvedValue('ok');
    await expect(
      withRetry(fn, { baseDelayMs: 0, isRetryable: isRetryableError }),
    ).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('リトライ不可能なエラーは即座に throw（再試行しない）', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('invalid_grant'));
    await expect(
      withRetry(fn, { baseDelayMs: 0, isRetryable: isRetryableError }),
    ).rejects.toThrow('invalid_grant');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('maxAttempts まで試して全て失敗したら最後のエラーを throw', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('Premature close'));
    await expect(
      withRetry(fn, { maxAttempts: 3, baseDelayMs: 0, isRetryable: isRetryableError }),
    ).rejects.toThrow('Premature close');
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
