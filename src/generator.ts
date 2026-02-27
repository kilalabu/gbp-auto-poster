/**
 * generator.ts
 *
 * calendar.ts の空き状況判定結果（CASE A/B/C）をもとに、
 * GBP へ投稿するテキストを動的に生成するモジュール。
 *
 * スパム判定を避けるため、各 CASE に 4 パターンのテンプレートを用意し
 * ランダムで選択する。全テンプレートに SEO/MEO キーワードを自然な形で挿入済み。
 *
 * SEO/MEO キーワード（全 CASE 共通）:
 *   - 天満橋
 *   - 24時間営業
 *   - 年中無休
 *   - レンタルスタジオ
 */

import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import type { AvailabilityResult, TimeSlot } from './calendar';

dayjs.extend(utc);
dayjs.extend(timezone);

interface PeakHours {
  weekday: { start: number; end: number };
  weekend: { start: number; end: number };
}

/** generatePost に渡す店舗設定（studios.yaml から抜粋） */
export interface StudioGeneratorConfig {
  timezone: string;
  peakHours: PeakHours;
}

/** 全 CASE の末尾に共通で付与する CTA 文言 */
const FOOTER =
  '\n\n24時間即時予約・キーボックスで非対面入室可能。\n下記の予約ボタンから今すぐご予約いただけます。';

/** 配列からランダムに1要素を返すユーティリティ */
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** 数値の時刻を「〇時」形式に変換（例: 17 → "17時"） */
function formatHour(h: number): string {
  return `${h}時`;
}

/**
 * TimeSlot[] を「〇時〜〇時、〇時〜〇時」形式に変換する。
 * CASE A・CASE C の投稿文に埋め込む空き枠文字列の生成に使用する。
 */
export function slotsToString(slots: TimeSlot[], tz: string): string {
  return slots
    .map(s => {
      const st = dayjs(s.start).tz(tz).hour();
      const en = dayjs(s.end).tz(tz).hour();
      return `${st}時〜${en}時`;
    })
    .join('、');
}

/**
 * 空き状況に応じた投稿テキストを生成して返す。
 *
 * @param availability calendar.ts の getAvailability() 戻り値
 * @param studio       タイムゾーン・ピーク時間帯設定
 * @returns            GBP に投稿するテキスト（FOOTER 付き）
 */
export function generatePost(
  availability: AvailabilityResult,
  studio: StudioGeneratorConfig,
): string {
  const { case: avCase, peakFreeSlots, freeSlots, isWeekend, todayLabel } = availability;

  // 土日かどうかでピーク時間帯を切り替え
  const peak = isWeekend ? studio.peakHours.weekend : studio.peakHours.weekday;
  const peakStartStr = formatHour(peak.start);
  const peakEndStr = formatHour(peak.end);

  let body: string;

  if (avCase === 'B') {
    // ── CASE B: 丸1日空き ──
    // 「穴場」「のびのび使える」という訴求でポジティブに発信する
    const templates = [
      `【本日穴場です】本日${todayLabel}は終日予約にゆとりがあります。天満橋の24時間営業・年中無休のレンタルスタジオをたっぷり使いたい方に最適です。動画撮影、長時間のリハーサル、深夜の自主練など、周りを気にせず集中できる1日です。`,
      `【${todayLabel} 終日空きあり】天満橋で24時間営業・年中無休のレンタルスタジオをお探しの方へ。本日は1日を通じてご予約にゆとりがあります。長時間の撮影セッションや集中練習にぜひご活用ください。`,
      `【本日は穴場日です】${todayLabel}、Studio Beat 24hは終日空き状態です。天満橋の24時間営業・年中無休スタジオで、のびのびと練習・撮影ができる絶好のチャンスです。深夜・早朝のご利用も大歓迎。`,
      `【${todayLabel} 贅沢に使える1日】天満橋の24時間営業・年中無休レンタルスタジオ、本日は終日ゆとりあり。周りを気にせず長時間練習したい方や、グループでのリハーサルにも最適です。`,
    ];
    body = pick(templates);

  } else if (avCase === 'A') {
    // ── CASE A: ピーク時間帯に空きあり ──
    // 「今すぐ使える人気枠」として緊急感を出す訴求
    // peakFreeSlots を「〇時〜〇時」形式に整形して投稿文に埋め込む
    const slotStr = slotsToString(peakFreeSlots, studio.timezone);

    const templates = [
      `【本日${peakStartStr}〜${peakEndStr}に空きあり】${todayLabel}、天満橋の24時間営業・年中無休レンタルスタジオ Studio Beat 24h に空きが出ました！お仕事帰りの個人練習や直前のダンス練習にすぐ対応可能です。空き枠: ${slotStr}`,
      `【${todayLabel} ${peakStartStr}台に空き】天満橋の年中無休・24時間営業レンタルスタジオに本日ピーク時間帯の空きがあります（${slotStr}）。仕事・学校帰りにそのままスタジオへどうぞ。即時予約OK。`,
      `【今日の${peakStartStr}〜空き情報】${todayLabel}の人気時間帯（${slotStr}）に空きが出ました。天満橋から好アクセスの24時間営業・年中無休レンタルスタジオ。直前予約でもキーボックスですぐ入室できます。`,
      `【${peakStartStr}〜${peakEndStr} 空き速報】${todayLabel}、天満橋 Studio Beat 24h の人気時間帯に空きあり（${slotStr}）。24時間営業・年中無休なので急な予定にも対応。今すぐご予約ください。`,
    ];
    body = pick(templates);

  } else {
    // ── CASE C: その他の空き ──
    // ピーク枠は埋まっているが空き自体はある状態
    // 最大3枠まで表示して「今日も使えます」という情報発信
    const slotStr = slotsToString(freeSlots.slice(0, 3), studio.timezone); // 先頭3件に絞る

    const templates = [
      `【${todayLabel} 空き時間帯のご案内】天満橋の24時間営業・年中無休レンタルスタジオ Studio Beat 24h の本日空き情報です。現在ご利用いただける枠: ${slotStr}。キーボックスで非対面入室できます。`,
      `【本日の空き状況】${todayLabel}、天満橋の年中無休・24時間営業スタジオに空きがあります（${slotStr}）。練習・撮影・リハーサルなど用途に合わせてご利用ください。`,
      `【${todayLabel} スタジオ空き情報】天満橋 Studio Beat 24h の空き時間帯: ${slotStr}。24時間営業・年中無休なので急な予定でもご安心ください。即時予約可能です。`,
      `【本日ご利用いただける枠】${todayLabel}の空き: ${slotStr}。天満橋の24時間営業・年中無休レンタルスタジオで、個人練習からグループリハーサルまで対応しています。`,
    ];
    body = pick(templates);
  }

  // 本文 + 共通フッター（CTA 案内文）を結合して返す
  return `${body}${FOOTER}`;
}
