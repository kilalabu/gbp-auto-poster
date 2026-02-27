/**
 * calendar.ts
 *
 * Google Calendar API を使って当日の予約イベントを取得し、
 * 「空き枠」と「ピーク時間帯の空き」を算出して返すモジュール。
 *
 * 空き状況の判定結果は以下の3ケース:
 *   CASE A: ピーク時間帯（平日 17-21時 / 土日 13-17時）に空きあり
 *   CASE B: その日の予約が0件（丸1日空き）
 *   CASE C: 予約はあるがピーク時間帯は埋まっている（その他の空き）
 */

import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { google, Auth } from 'googleapis';

// dayjs にタイムゾーン処理プラグインを登録
// GitHub Actions は UTC 環境のため、JST 基準の計算にはこれらが必須
dayjs.extend(utc);
dayjs.extend(timezone);

/** 空き状況を表す3パターン */
export type AvailabilityCase = 'A' | 'B' | 'C';

/** 空き時間枠（開始・終了を ISO 文字列で保持） */
export interface TimeSlot {
  start: string; // ISO string
  end: string;   // ISO string
}

/** getAvailability の戻り値 */
export interface AvailabilityResult {
  case: AvailabilityCase;
  freeSlots: TimeSlot[];      // 当日の全空き枠
  peakFreeSlots: TimeSlot[];  // ピーク時間帯内の空き枠（CASE A のみ値あり）
  isWeekend: boolean;         // 土日かどうか（ピーク時間帯の切り替えに使用）
  todayLabel: string;         // 投稿文用の日付表示（例: "2月25日(火)"）
}

/** studios.yaml から渡されるピーク時間帯設定 */
interface PeakHours {
  weekday: { start: number; end: number }; // 平日ピーク（例: 17〜21）
  weekend: { start: number; end: number }; // 土日ピーク（例: 13〜17）
}

/**
 * 当日の空き状況を取得して返す。
 *
 * @param auth       googleapis の OAuth2Client（アクセストークン自動更新あり）
 * @param calendarId GoogleカレンダーのID（studios.yaml で設定）
 * @param peakHours  ピーク時間帯設定
 * @param tz         タイムゾーン文字列（デフォルト: 'Asia/Tokyo'）
 */
export async function getAvailability(
  auth: Auth.OAuth2Client,
  calendarId: string,
  peakHours: PeakHours,
  tz: string = 'Asia/Tokyo',
): Promise<AvailabilityResult> {
  // JST 基準で「今日の 00:00〜23:59」を算出
  // TZ 環境変数が設定されていれば dayjs().tz(tz) で確実に JST になる
  const now = dayjs().tz(tz);
  const todayStart = now.startOf('day');
  const todayEnd = now.endOf('day');
  const isWeekend = now.day() === 0 || now.day() === 6; // 0=日、6=土

  // Google Calendar API クライアントを初期化
  const calendar = google.calendar({ version: 'v3', auth });

  // 当日の全イベント（予約）を開始時刻順で取得
  const response = await calendar.events.list({
    calendarId,
    timeMin: todayStart.toISOString(),
    timeMax: todayEnd.toISOString(),
    singleEvents: true, // 繰り返しイベントを個別に展開
    orderBy: 'startTime',
  });

  const events = response.data.items ?? [];

  // CASE B: イベントが0件 = 丸1日空き
  // 最も単純なケースを先に処理して早期リターン
  if (events.length === 0) {
    return {
      case: 'B',
      freeSlots: [{ start: todayStart.toISOString(), end: todayEnd.toISOString() }],
      peakFreeSlots: [], // 丸1日空きなのでピーク枠は別途計算不要（generator 側で処理）
      isWeekend,
      todayLabel: formatTodayLabel(now),
    };
  }

  // イベントを「開始 ms〜終了 ms」のペア配列に変換
  // dateTime（時刻指定予約）と date（終日予約）の両方に対応
  const busyIntervals: Array<[number, number]> = events
    .filter(e => e.start && e.end)
    .map(e => {
      const start = dayjs(e.start?.dateTime ?? e.start?.date ?? undefined).tz(tz);
      const end = dayjs(e.end?.dateTime ?? e.end?.date ?? undefined).tz(tz);
      return [start.valueOf(), end.valueOf()] as [number, number];
    });

  // 予約区間の隙間から「空き枠」を算出
  const freeSlots = calcFreeSlots(todayStart.valueOf(), todayEnd.valueOf(), busyIntervals, tz);

  // ピーク時間帯の境界値（ms）を算出
  const peak = isWeekend ? peakHours.weekend : peakHours.weekday;
  const peakStart = todayStart.hour(peak.start).valueOf();
  const peakEnd = todayStart.hour(peak.end).valueOf();

  // 全空き枠からピーク時間帯と重なる部分だけを抽出・クランプ
  const peakFreeSlots = freeSlots
    .filter(slot => {
      const s = dayjs(slot.start).valueOf();
      const e = dayjs(slot.end).valueOf();
      // 空き枠とピーク窓が重なるかどうか（部分一致でOK）
      return s < peakEnd && e > peakStart;
    })
    .map(slot => {
      // ピーク窓の範囲内に切り詰める
      const s = Math.max(dayjs(slot.start).valueOf(), peakStart);
      const e = Math.min(dayjs(slot.end).valueOf(), peakEnd);
      return {
        start: dayjs(s).tz(tz).toISOString(),
        end: dayjs(e).tz(tz).toISOString(),
      };
    })
    // クランプ後に長さが0になったものを除外
    .filter(slot => dayjs(slot.end).valueOf() > dayjs(slot.start).valueOf());

  // ピーク枠に空きがあれば CASE A、なければ CASE C
  const avCase: AvailabilityCase = peakFreeSlots.length > 0 ? 'A' : 'C';

  return {
    case: avCase,
    freeSlots,
    peakFreeSlots,
    isWeekend,
    todayLabel: formatTodayLabel(now),
  };
}

/**
 * 予約済み区間の「隙間」を空き枠として返す。
 *
 * アルゴリズム: カーソルを dayStart から進めながら、
 * 予約区間の手前に隙間があれば空き枠として記録する。
 *
 * @param dayStart      当日 00:00 の ms タイムスタンプ
 * @param dayEnd        当日 23:59 の ms タイムスタンプ
 * @param busyIntervals 予約済み区間の配列（順不同でOK、内部でソートする）
 * @param tz            ISO 文字列変換用のタイムゾーン
 */
export function calcFreeSlots(
  dayStart: number,
  dayEnd: number,
  busyIntervals: Array<[number, number]>,
  tz: string,
): TimeSlot[] {
  // 開始時刻でソート（重なり・包含に対応するため）
  const sorted = [...busyIntervals].sort((a, b) => a[0] - b[0]);
  const freeSlots: TimeSlot[] = [];
  let cursor = dayStart; // 「ここまでは確認済み」を示すカーソル

  for (const [bStart, bEnd] of sorted) {
    if (bStart > cursor) {
      // カーソルと予約開始の間に隙間あり → 空き枠として追加
      freeSlots.push({
        start: dayjs(cursor).tz(tz).toISOString(),
        end: dayjs(bStart).tz(tz).toISOString(),
      });
    }
    // カーソルを予約終了まで（またはすでに先にいれば現在位置に）進める
    cursor = Math.max(cursor, bEnd);
  }

  // 最後の予約が終わった後〜dayEnd までが空きの場合
  if (cursor < dayEnd) {
    freeSlots.push({
      start: dayjs(cursor).tz(tz).toISOString(),
      end: dayjs(dayEnd).tz(tz).toISOString(),
    });
  }

  return freeSlots;
}

/**
 * dayjs オブジェクトから投稿文用の日付ラベルを生成する。
 * 例: dayjs('2026-02-25') → "2月25日(火)"
 */
function formatTodayLabel(d: dayjs.Dayjs): string {
  const DAYS = ['日', '月', '火', '水', '木', '金', '土'];
  const month = d.month() + 1; // dayjs の month() は 0始まりなので +1
  const date = d.date();
  const day = DAYS[d.day()];
  return `${month}月${date}日(${day})`;
}
