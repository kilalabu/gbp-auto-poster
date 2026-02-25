/**
 * scripts/auth.ts — OAuth2 リフレッシュトークン取得スクリプト
 *
 * 【目的】
 *   GitHub Actions が毎日実行するために必要な「リフレッシュトークン」を
 *   ローカルマシンで一度だけ取得するためのヘルパースクリプト。
 *   取得したトークンは .env と GitHub Secrets に登録して運用する。
 *
 * 【実行方法】
 *   pnpm run auth
 *
 * 【処理フロー】
 *   1. OAuth2 認可 URL を生成してコンソールに表示
 *   2. ユーザーがブラウザで URL を開いて Google アカウントで認可
 *   3. Google がローカルサーバー（localhost:3000）にリダイレクト
 *   4. 認可コードを自動キャプチャしてトークンと交換
 *   5. refresh_token をコンソールに出力
 *
 * 【注意】
 *   - Desktop App タイプの OAuth2 クライアントは localhost リダイレクトが
 *     自動的に許可されるため、GCP コンソールへの追加設定は不要。
 *   - `prompt: 'consent'` を付けることで毎回 refresh_token が返される。
 *     付けないと2回目以降は access_token のみ返される場合がある。
 */

import 'dotenv/config';
import http from 'node:http';
import { URL } from 'node:url';
import { google } from 'googleapis';

const PORT = 3000;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;

/** 取得するスコープ（カレンダー読み取り + GBP 管理） */
const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/business.manage',
];

async function main(): Promise<void> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('.env に GOOGLE_CLIENT_ID と GOOGLE_CLIENT_SECRET を設定してください');
  }

  // OAuth2 クライアントを初期化（リダイレクト先は localhost の一時サーバー）
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);

  // 認可 URL を生成
  // access_type: 'offline' → refresh_token を取得するために必須
  // prompt: 'consent'     → 毎回同意画面を表示して refresh_token を確実に受け取る
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });

  console.log('\n=== GBP Auto Poster — OAuth2 リフレッシュトークン取得 ===\n');
  console.log('以下の URL をブラウザで開いてください:\n');
  console.log(authUrl);
  console.log('\nGoogleアカウントで認可後、自動的にトークンが取得されます...\n');

  // ── ローカル HTTP サーバーで Google からのコールバックを受け取る ──
  // ブラウザが認可後に http://localhost:3000/callback?code=XXX へリダイレクトするので
  // そのリクエストを一度だけ受け取って認可コードを取り出す
  const code = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (!req.url) return;

      const url = new URL(req.url, `http://localhost:${PORT}`);
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      if (error) {
        // ユーザーが認可を拒否した場合など
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<h1>エラー: ${error}</h1><p>このタブを閉じてください。</p>`);
        server.close();
        reject(new Error(`OAuth error: ${error}`));
        return;
      }

      if (code) {
        // 認可コードを取得できた → ブラウザに完了メッセージを表示してサーバーを閉じる
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h1>認証完了！</h1><p>このタブを閉じてターミナルを確認してください。</p>');
        server.close();
        resolve(code);
      }
    });

    server.listen(PORT, () => {
      console.log(`http://localhost:${PORT} でコールバックを待機中...`);
    });

    server.on('error', reject);
  });

  // 認可コード → アクセストークン + リフレッシュトークン に交換
  const { tokens } = await oauth2Client.getToken(code);

  console.log('\n=== 取得したトークン ===\n');
  console.log(`refresh_token: ${tokens.refresh_token}`);
  console.log('\n以下の設定を行ってください:');
  console.log('1. .env の GOOGLE_REFRESH_TOKEN にこの値を設定する');
  console.log('2. GitHub リポジトリの Secrets の GOOGLE_REFRESH_TOKEN にも同じ値を登録する');
}

main().catch(err => {
  console.error('エラー:', err.message);
  process.exit(1);
});
