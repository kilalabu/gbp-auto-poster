/**
 * generator.test.ts
 *
 * slotsToString と generatePost のユニットテスト。
 * - slotsToString: TimeSlot[] → 「〇時〜〇時」形式の文字列変換
 * - generatePost: CASE A/B/C の分岐、slotStr の正確性、フッターの付与
 */

import { describe, it, expect } from 'vitest';
import { generatePost, slotsToString } from '../src/generator';
import type { AvailabilityResult, TimeSlot } from '../src/calendar';

const TZ = 'Asia/Tokyo';

/** JST 時刻の ISO 文字列を返す（例: makeIso(17) → "2026-02-27T17:00:00+09:00"） */
function makeIso(hour: number, date = '2026-02-27'): string {
  return `${date}T${String(hour).padStart(2, '0')}:00:00+09:00`;
}

/** 指定した JST 開始・終了時刻の TimeSlot を返す */
function makeSlot(startHour: number, endHour: number): TimeSlot {
  return { start: makeIso(startHour), end: makeIso(endHour) };
}

const STUDIO = {
  timezone: TZ,
  peakHours: {
    weekday: { start: 17, end: 21 },
    weekend: { start: 13, end: 17 },
  },
};

// ─────────────────────────────────────────────
// slotsToString
// ─────────────────────────────────────────────

describe('slotsToString', () => {
  it('空配列 → 空文字列', () => {
    expect(slotsToString([], TZ)).toBe('');
  });

  it('1件 → 「〇時〜〇時」形式', () => {
    expect(slotsToString([makeSlot(17, 21)], TZ)).toBe('17時〜21時');
  });

  it('複数件 → 読点区切りで連結', () => {
    expect(slotsToString([makeSlot(17, 18), makeSlot(19, 21)], TZ)).toBe('17時〜18時、19時〜21時');
  });

  it('深夜帯（0時〜3時）も正しく変換', () => {
    expect(slotsToString([makeSlot(0, 3)], TZ)).toBe('0時〜3時');
  });

  it('土日ピーク帯（13時〜17時）も正しく変換', () => {
    expect(slotsToString([makeSlot(13, 17)], TZ)).toBe('13時〜17時');
  });
});

// ─────────────────────────────────────────────
// generatePost — CASE B（丸1日空き）
// ─────────────────────────────────────────────

describe('generatePost CASE B', () => {
  const availability: AvailabilityResult = {
    case: 'B',
    freeSlots: [makeSlot(0, 23)],
    peakFreeSlots: [],
    isWeekend: false,
    todayLabel: '2月27日(金)',
  };

  it('「穴場」「終日」「ゆとり」のいずれかを含む', () => {
    const result = generatePost(availability, STUDIO);
    expect(result).toMatch(/穴場|終日|ゆとり/);
  });

  it('SEO キーワードを含む', () => {
    const result = generatePost(availability, STUDIO);
    expect(result).toContain('24時間営業');
    expect(result).toContain('年中無休');
    expect(result).toContain('天満橋');
  });

  it('共通フッターを含む', () => {
    const result = generatePost(availability, STUDIO);
    expect(result).toContain('24時間即時予約・キーボックスで非対面入室可能');
  });
});

// ─────────────────────────────────────────────
// generatePost — CASE A（ピーク時間帯に空きあり）
// ─────────────────────────────────────────────

describe('generatePost CASE A', () => {
  it('平日ピーク空き枠（17時〜19時）が投稿文に含まれる', () => {
    const availability: AvailabilityResult = {
      case: 'A',
      freeSlots: [makeSlot(17, 21)],
      peakFreeSlots: [makeSlot(17, 19)],
      isWeekend: false,
      todayLabel: '2月27日(金)',
    };
    expect(generatePost(availability, STUDIO)).toContain('17時〜19時');
  });

  it('複数のピーク空き枠が読点区切りで含まれる', () => {
    const availability: AvailabilityResult = {
      case: 'A',
      freeSlots: [makeSlot(17, 18), makeSlot(19, 21)],
      peakFreeSlots: [makeSlot(17, 18), makeSlot(19, 21)],
      isWeekend: false,
      todayLabel: '2月27日(金)',
    };
    const result = generatePost(availability, STUDIO);
    expect(result).toContain('17時〜18時');
    expect(result).toContain('19時〜21時');
    expect(result).toContain('、');
  });

  it('土日ピーク空き枠（13時〜17時）が投稿文に含まれる', () => {
    const availability: AvailabilityResult = {
      case: 'A',
      freeSlots: [makeSlot(13, 17)],
      peakFreeSlots: [makeSlot(13, 17)],
      isWeekend: true,
      todayLabel: '3月1日(日)',
    };
    expect(generatePost(availability, STUDIO)).toContain('13時〜17時');
  });

  it('共通フッターを含む', () => {
    const availability: AvailabilityResult = {
      case: 'A',
      freeSlots: [makeSlot(17, 21)],
      peakFreeSlots: [makeSlot(17, 21)],
      isWeekend: false,
      todayLabel: '2月27日(金)',
    };
    expect(generatePost(availability, STUDIO)).toContain('24時間即時予約・キーボックスで非対面入室可能');
  });
});

// ─────────────────────────────────────────────
// generatePost — CASE C（ピーク外の空きのみ）
// ─────────────────────────────────────────────

describe('generatePost CASE C', () => {
  it('空き枠の時刻が投稿文に含まれる', () => {
    const availability: AvailabilityResult = {
      case: 'C',
      freeSlots: [makeSlot(9, 12), makeSlot(14, 16)],
      peakFreeSlots: [],
      isWeekend: false,
      todayLabel: '2月27日(金)',
    };
    const result = generatePost(availability, STUDIO);
    expect(result).toContain('9時〜12時');
    expect(result).toContain('14時〜16時');
  });

  it('空き枠が4件以上あっても先頭3件のみ表示される', () => {
    const availability: AvailabilityResult = {
      case: 'C',
      freeSlots: [
        makeSlot(1, 3),
        makeSlot(5, 7),
        makeSlot(9, 11),
        makeSlot(13, 15), // 4件目: 除外されるべき
      ],
      peakFreeSlots: [],
      isWeekend: false,
      todayLabel: '2月27日(金)',
    };
    const result = generatePost(availability, STUDIO);
    expect(result).toContain('1時〜3時');
    expect(result).toContain('5時〜7時');
    expect(result).toContain('9時〜11時');
    expect(result).not.toContain('13時〜15時');
  });

  it('共通フッターを含む', () => {
    const availability: AvailabilityResult = {
      case: 'C',
      freeSlots: [makeSlot(9, 12)],
      peakFreeSlots: [],
      isWeekend: false,
      todayLabel: '2月27日(金)',
    };
    expect(generatePost(availability, STUDIO)).toContain('24時間即時予約・キーボックスで非対面入室可能');
  });
});
