/**
 * analyze-history.ts
 *
 * Googleカレンダーの過去の予約データを取得し、
 * 平日・土日別の時間帯ごとの予約コマ数を集計してターミナルに出力するスクリプト。
 *
 * 使用方法:
 *   pnpm analyze
 *
 * - 過去365日分を1リクエストで取得（最大2500件）
 * - 各予約が占有するすべての時間帯をカウント（例: 10:00〜12:00 → 10時・11時をそれぞれ+1）
 * - 「見学」「予約不可」を含むタイトルのイベントは集計から除外
 * - 「過去365日」と「事業引き継ぎ後（2025-11-01〜）」の2パターンを表示
 * - ローカル実行専用。CIからは使用しない
 */

import 'dotenv/config';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { parse } from 'yaml';
import { google } from 'googleapis';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);
dayjs.extend(timezone);

/** 集計から除外するイベントタイトルのキーワード */
const EXCLUDED_TITLE_KEYWORDS = ['見学', '予約不可'];

/** 事業引き継ぎ日（この日以降のデータを「引き継ぎ後」として別集計する） */
const TAKEOVER_DATE = '2025-11-01';

interface StudioConfig {
  id: string;
  name: string;
  calendarId: string;
  timezone: string;
}

interface StudiosYaml {
  studios: StudioConfig[];
}

/** 0〜23 インデックスで時間帯ごとの予約コマ数を保持する配列 */
type HourCounts = number[];

interface AnalysisResult {
  studioName: string;
  totalEvents: number;
  fromDate: string;
  toDate: string;
  weekday: HourCounts;
  weekend: HourCounts;
}

/**
 * イベント一覧を受け取り、平日・土日別に時間帯ごとのコマ数をカウントする。
 *
 * 予約が複数時間にまたがる場合（例: 10:00〜12:00）は、
 * 各時間帯（10時・11時）をそれぞれ1コマとしてカウントする。
 * 終了時刻がちょうど整時の場合（例: 12:00終了）はその時間は含まない。
 */
function countByHour(
  events: Array<{ start: string; end: string }>,
  tz: string,
): { weekday: HourCounts; weekend: HourCounts } {
  const weekday: HourCounts = Array(24).fill(0);
  const weekend: HourCounts = Array(24).fill(0);

  for (const { start, end } of events) {
    const s = dayjs(start).tz(tz);
    const e = dayjs(end).tz(tz);
    const counts = s.day() === 0 || s.day() === 6 ? weekend : weekday;

    const startHour = s.hour();
    const endHour = e.hour();
    const endMin = e.minute();
    // 12:00 ちょうど終了なら 12時は含まない（endHour = 12, exclusive = 12）
    // 12:30 終了なら 12時も含む（endHour = 12, exclusive = 13）
    const endHourExclusive = endMin > 0 ? endHour + 1 : endHour;

    for (let h = startHour; h < endHourExclusive && h < 24; h++) {
      counts[h]++;
    }
  }

  return { weekday, weekend };
}

/**
 * 分析結果をASCIIバーチャート形式の文字列として組み立てて返す。
 * 平日・土日いずれも0件の時間帯は表示しない。
 */
function formatAnalysis(result: AnalysisResult): string {
  const { studioName, totalEvents, fromDate, toDate, weekday, weekend } = result;
  const maxCount = Math.max(...weekday, ...weekend, 1);
  const BAR_MAX = 20; // バーの最大文字数
  const lines: string[] = [];

  lines.push(`\n${'═'.repeat(64)}`);
  lines.push(`  ${studioName} — 予約時間帯分析`);
  lines.push(`  期間: ${fromDate} 〜 ${toDate}`);
  lines.push(`  取得件数: ${totalEvents} 件`);
  lines.push(`${'═'.repeat(64)}`);
  lines.push(`時間帯   ${'平日'.padEnd(28)}${'土日'}`);
  lines.push(`${'─'.repeat(64)}`);

  let printed = 0;
  for (let h = 0; h < 24; h++) {
    const wd = weekday[h];
    const we = weekend[h];
    if (wd === 0 && we === 0) continue;

    const wdBar = '█'.repeat(Math.round((wd / maxCount) * BAR_MAX));
    const weBar = '█'.repeat(Math.round((we / maxCount) * BAR_MAX));
    const label = `${String(h).padStart(2, '0')}:00`;

    lines.push(
      `${label}   ${wdBar.padEnd(BAR_MAX)} ${String(wd).padStart(3)}件  ` +
      `${weBar.padEnd(BAR_MAX)} ${String(we).padStart(3)}件`,
    );
    printed++;
  }

  if (printed === 0) {
    lines.push('  （予約データなし）');
  }

  lines.push(`${'─'.repeat(64)}\n`);

  return lines.join('\n');
}

async function main(): Promise<void> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'Missing required environment variables: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN',
    );
  }

  const yamlContent = readFileSync('config/studios.yaml', 'utf-8');
  const { studios } = parse(yamlContent) as StudiosYaml;

  // calendarId の "${VAR_NAME}" 形式を環境変数で展開
  for (const studio of studios) {
    const match = studio.calendarId.match(/^\$\{(.+)\}$/);
    if (match) {
      const val = process.env[match[1]];
      if (!val) throw new Error(`Missing environment variable: ${match[1]}`);
      studio.calendarId = val;
    }
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  const toDate = dayjs();
  const fromDate = toDate.subtract(365, 'day');

  const outputLines: string[] = [];

  for (const studio of studios) {
    console.log(`[${studio.name}] データ取得中...`);

    const response = await calendar.events.list({
      calendarId: studio.calendarId,
      timeMin: fromDate.toISOString(),
      timeMax: toDate.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 2500,
    });

    // 時刻指定イベントのみ対象・除外キーワードを含むタイトルは除外
    const bookingEvents = (response.data.items ?? [])
      .filter(e => {
        if (!e.start?.dateTime || !e.end?.dateTime) return false;
        const title = e.summary ?? '';
        return !EXCLUDED_TITLE_KEYWORDS.some(kw => title.includes(kw));
      })
      .map(e => ({
        start: e.start!.dateTime!,
        end: e.end!.dateTime!,
      }));

    // ── 分析1: 過去365日 ──
    const fullYearCounts = countByHour(bookingEvents, studio.timezone);
    const fullYearOutput = formatAnalysis({
      studioName: studio.name,
      totalEvents: bookingEvents.length,
      fromDate: fromDate.tz(studio.timezone).format('YYYY-MM-DD'),
      toDate: toDate.tz(studio.timezone).format('YYYY-MM-DD'),
      weekday: fullYearCounts.weekday,
      weekend: fullYearCounts.weekend,
    });
    console.log(fullYearOutput);
    outputLines.push(fullYearOutput);

    // ── 分析2: 事業引き継ぎ後（2025-11-01〜）──
    const takeoverStartMs = dayjs.tz(TAKEOVER_DATE, studio.timezone).valueOf();
    const takeoverEvents = bookingEvents.filter(
      e => dayjs(e.start).valueOf() >= takeoverStartMs,
    );
    const takeoverCounts = countByHour(takeoverEvents, studio.timezone);
    const takeoverOutput = formatAnalysis({
      studioName: `${studio.name}（引き継ぎ後）`,
      totalEvents: takeoverEvents.length,
      fromDate: TAKEOVER_DATE,
      toDate: toDate.tz(studio.timezone).format('YYYY-MM-DD'),
      weekday: takeoverCounts.weekday,
      weekend: takeoverCounts.weekend,
    });
    console.log(takeoverOutput);
    outputLines.push(takeoverOutput);
  }

  // ── ファイル出力 ──
  const timestamp = toDate.tz('Asia/Tokyo').format('YYYY-MM-DD_HHmm');
  const outputDir = 'output';
  const outputPath = `${outputDir}/analysis-${timestamp}.txt`;

  mkdirSync(outputDir, { recursive: true });
  writeFileSync(outputPath, outputLines.join('\n'), 'utf-8');
  console.log(`\n分析結果を保存しました: ${outputPath}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
