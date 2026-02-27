/**
 * generator.ts
 *
 * calendar.ts の空き状況判定結果（CASE A/B/C）をもとに、
 * GBP へ投稿するテキストを動的に生成するモジュール。
 *
 * スパム判定を避けるため、各 CASE にランダムで選択するテンプレートを用意する。
 * 全テンプレートに SEO/MEO キーワードを自然な形で挿入済み。
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

/** 配列からランダムに1要素を返すユーティリティ */
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * TimeSlot[] を「HH:mm - HH:mm」形式に変換する（改行区切り）。
 * CASE A・CASE C の投稿文フッターに埋め込む空き枠文字列の生成に使用する。
 */
export function slotsToString(slots: TimeSlot[], tz: string): string {
  return slots
    .map(s => {
      const start = dayjs(s.start).tz(tz).format('HH:mm');
      const end = dayjs(s.end).tz(tz).format('HH:mm');
      return `${start} - ${end}`;
    })
    .join('\n');
}

/**
 * 空き枠文字列を受け取り、共通フッター文字列を返す。
 * 設備案内・LINE 誘導・空き時間帯の一覧を含む。
 */
function makeFooter(slotStr: string): string {
  return `\n\n🕒 ピックアップ空き枠：\n${slotStr}\n\nスマホ用三脚や大型鏡、ヨガマットも無料で使えます。\n公式LINEにて不定期クーポン配布中！\n\n✅ ご予約は公式LINEから！`;
}

/**
 * 空き状況に応じた投稿テキストを生成して返す。
 *
 * @param availability calendar.ts の getAvailability() 戻り値
 * @param studio       タイムゾーン・ピーク時間帯設定
 * @returns            GBP に投稿するテキスト（フッター付き）
 */
export function generatePost(
  availability: AvailabilityResult,
  studio: StudioGeneratorConfig,
): string {
  const { case: avCase, peakFreeSlots, freeSlots } = availability;

  let body: string;
  let slotStr: string;

  if (avCase === 'B') {
    // ── CASE B: 丸1日空き ──
    // 「穴場」「ゆったり使える」という訴求でポジティブに発信する
    slotStr = slotsToString(freeSlots, studio.timezone);
    const templates = [
      `【本日穴場です】本日は終日予約にゆとりがあります。\n天満橋の24時間営業・年中無休のレンタルスタジオをたっぷり使いたい方に最適です。`,
      `【集中練習に最適】本日は1日を通じてご予約にゆとりがあります。\n天満橋の24時間年中無休スタジオで、広々としたスペースを活かした練習や撮影が可能です。`,
      `【本日は予約が取りやすい日】Studio Beatは本日、終日空き状態です。\n天満橋の便利な立地で、24時間いつでも思い立った時にすぐ予約してご利用いただけます。`,
      `【ゆったり使えるチャンス】終日ご予約が可能です。\n24時間営業・年中無休の天満橋スタジオで、集中してスキルアップや動画撮影にたっぷりご活用ください。`,
    ];
    body = pick(templates);

  } else if (avCase === 'A') {
    // ── CASE A: ピーク時間帯に空きあり ──
    // 「今すぐ使える人気枠」として緊急感を出す訴求
    slotStr = slotsToString(peakFreeSlots, studio.timezone);
    const templates = [
      `【本日ピーク帯に空きあり】天満橋の24時間営業・年中無休スタジオに、人気の時間帯の空きが出ました！\nお仕事帰りの個人練習や直前のダンス練習にすぐ対応可能です。`,
      `【ゴールデンタイム空き速報】本日、学校や仕事帰りに便利な時間帯にご予約いただけます。\n天満橋駅から好アクセスの24時間スタジオStudio Beatなら、即時予約でそのまま入室可能です。`,
    ];
    body = pick(templates);

  } else {
    // ── CASE C: その他の空き ──
    // ピーク枠は埋まっているが空き自体はある状態。最大3枠まで表示
    slotStr = slotsToString(freeSlots.slice(0, 3), studio.timezone);
    const templates = [
      `【本日の空き時間情報】天満橋の24時間営業・年中無休スタジオ、現在のご予約可能枠です。\nキーボックスでの非対面入室なので、急な予定でもスムーズにご利用いただけます。`,
      `【現在予約受付中】本日ご利用いただける時間帯のご案内です。\n練習・撮影・リハーサルなど、用途に合わせて天満橋のStudio Beatをぜひご活用ください。`,
    ];
    body = pick(templates);
  }

  // 本文 + 空き時間・設備案内フッターを結合して返す
  return `${body}${makeFooter(slotStr)}`;
}
