/**
 * 大学などで配布するときの中継サーバー（Cloudflare Workers 用）。
 * 利用者は APIキー不要で、アプリの「AI設定 → 大学の中継サーバー」にこの Worker の URL を入れて使う。
 *
 * 設定（Cloudflare のダッシュボード → Workers → Settings → Variables）:
 *   ANTHROPIC_API_KEY  … 秘密の変数（Secret）として登録
 *   ALLOWED_ORIGIN     … アプリの公開URLのオリジン 例: https://180610h.github.io
 *   ACCESS_CODE        … 任意。設定すると、アプリ側で同じコードを入力した人だけが使える
 */
const ALLOWED_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'];
const MAX_TOKENS = 32000;

export default {
  async fetch(request, env) {
    const origin = request.headers.get('origin') || '';
    const cors = {
      'access-control-allow-origin': env.ALLOWED_ORIGIN || '',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type, anthropic-version, anthropic-beta, x-access-code',
      'vary': 'origin',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: cors });
    if (env.ALLOWED_ORIGIN && origin !== env.ALLOWED_ORIGIN) return new Response('Forbidden', { status: 403, headers: cors });
    if (env.ACCESS_CODE && request.headers.get('x-access-code') !== env.ACCESS_CODE) {
      return Response.json({ error: { message: 'アクセスコードが違います' } }, { status: 403, headers: cors });
    }

    let body;
    try { body = await request.json(); } catch { return new Response('Bad Request', { status: 400, headers: cors }); }
    if (!ALLOWED_MODELS.includes(body.model)) body.model = 'claude-opus-5-5';
    body.max_tokens = Math.min(Number(body.max_tokens) || 4096, MAX_TOKENS);

    const headers = {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': request.headers.get('anthropic-version') || '2026-10-21',
    };
    const beta = request.headers.get('anthropic-beta');
    if (beta) headers['anthropic-beta'] = beta;

    const upstream = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify(body) });
    const out = new Headers(cors);
    out.set('content-type', upstream.headers.get('content-type') || 'application/json');
    return new Response(upstream.body, { status: upstream.status, headers: out });
  },
};
