/**
 * calendar.test.ts
 *
 * calcFreeSlots のユニットテスト。
 * 予約済み区間の「隙間」から空き枠を正しく算出できるかを検証する。
 */

import { describe, it, expect } from 'vitest';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { calcFreeSlots } from '../src/calendar';

dayjs.extend(utc);
dayjs.extend(timezone);

const TZ = 'Asia/Tokyo';
const DATE = '2026-03-01';

/** JST 時刻の ms タイムスタンプを返す */
function ms(hour: number): number {
  return dayjs.tz(`${DATE}T${String(hour).padStart(2, '0')}:00:00`, TZ).valueOf();
}

/** calcFreeSlots の戻り値スロットの開始・終了時刻を JST の時 (hour) で返す */
function slotHours(slot: { start: string; end: string }): [number, number] {
  return [
    dayjs(slot.start).tz(TZ).hour(),
    dayjs(slot.end).tz(TZ).hour(),
  ];
}

const DAY_START = ms(0);
const DAY_END = dayjs.tz(`${DATE}`, TZ).endOf('day').valueOf();

describe('calcFreeSlots', () => {
  it('予約なし → 1日全体が1つの空き枠', () => {
    const result = calcFreeSlots(DAY_START, DAY_END, [], TZ);
    expect(result).toHaveLength(1);
    expect(dayjs(result[0].start).valueOf()).toBe(DAY_START);
    expect(dayjs(result[0].end).valueOf()).toBe(DAY_END);
  });

  it('中間に1件の予約 → 前後2枠が空き', () => {
    const result = calcFreeSlots(DAY_START, DAY_END, [[ms(10), ms(12)]], TZ);
    expect(result).toHaveLength(2);
    expect(slotHours(result[0])).toEqual([0, 10]);
    expect(slotHours(result[1])).toEqual([12, 23]); // 12時〜23:59:59（endOf('day').hour() = 23）
  });

  it('終日予約 → 空き枠なし', () => {
    const result = calcFreeSlots(DAY_START, DAY_END, [[DAY_START, DAY_END]], TZ);
    expect(result).toHaveLength(0);
  });

  it('隣接する2件の予約 → 間に隙間なし、前後のみ空き', () => {
    const result = calcFreeSlots(
      DAY_START,
      DAY_END,
      [[ms(10), ms(14)], [ms(14), ms(18)]],
      TZ,
    );
    // 0〜10 と 18〜24 が空き
    expect(result).toHaveLength(2);
    expect(slotHours(result[0])).toEqual([0, 10]);
    expect(slotHours(result[1])).toEqual([18, 23]);
  });

  it('重複する2件の予約 → 結合されて1つの埋まり区間として扱われる', () => {
    const result = calcFreeSlots(
      DAY_START,
      DAY_END,
      [[ms(10), ms(15)], [ms(12), ms(18)]], // 10-15 と 12-18 が重複
      TZ,
    );
    // 0〜10 と 18〜24 が空き
    expect(result).toHaveLength(2);
    expect(slotHours(result[0])).toEqual([0, 10]);
    expect(slotHours(result[1])).toEqual([18, 23]);
  });

  it('逆順で渡された予約区間でも正しくソートされる', () => {
    const result = calcFreeSlots(
      DAY_START,
      DAY_END,
      [[ms(18), ms(20)], [ms(10), ms(12)]], // 逆順
      TZ,
    );
    // 0〜10、12〜18、20〜24 が空き
    expect(result).toHaveLength(3);
    expect(slotHours(result[0])).toEqual([0, 10]);
    expect(slotHours(result[1])).toEqual([12, 18]);
    expect(slotHours(result[2])).toEqual([20, 23]);
  });

  it('一方が他方を包含する区間 → 正しく結合される', () => {
    const result = calcFreeSlots(
      DAY_START,
      DAY_END,
      [[ms(10), ms(20)], [ms(12), ms(16)]], // 12-16 は 10-20 に内包
      TZ,
    );
    // 0〜10 と 20〜24 が空き
    expect(result).toHaveLength(2);
    expect(slotHours(result[0])).toEqual([0, 10]);
    expect(slotHours(result[1])).toEqual([20, 23]);
  });

  it('複数の非連続予約 → それぞれの隙間が空き枠になる', () => {
    const result = calcFreeSlots(
      DAY_START,
      DAY_END,
      [[ms(9), ms(11)], [ms(14), ms(16)], [ms(19), ms(21)]],
      TZ,
    );
    // 0〜9、11〜14、16〜19、21〜24 が空き
    expect(result).toHaveLength(4);
    expect(slotHours(result[0])).toEqual([0, 9]);
    expect(slotHours(result[1])).toEqual([11, 14]);
    expect(slotHours(result[2])).toEqual([16, 19]);
    expect(slotHours(result[3])).toEqual([21, 23]);
  });
});
