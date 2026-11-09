/* レポートチェック専用AI（Claude）との通信。
   ビルド不要の静的サイトなので、SDK ではなく fetch で Messages API を直接呼ぶ。 */
(function () {
'use strict';

const API_URL = 'https://api.anthropic.com/v1/messages';

const MODELS = {
  'claude-opus-5-5':   { label: 'Claude Opus 5.5（最も丁寧・標準）', in: 4,   out: 20,  fallback: true },
  'claude-sonnet-5-5': { label: 'Claude Sonnet 5.5（速い・費用は約半分）', in: 2, out: 10, fallback: true },
  'claude-haiku-5-5':  { label: 'Claude Haiku 5.5（最速・低価格）', in: 0.1, out: 0.5, fallback: false },
};

const CRITERIA = {
  question:    '問いの明確さ',
  argument:    '論証と根拠',
  analysis:    '分析の深さ',
  discussion:  '考察の深さ',
  specificity: '具体性',
  sources:     '出典の扱い',
  structure:   '構成',
  expression:  '文章表現',
};

const EVAL_SYSTEM = `あなたは日本の大学・大学院でレポート・論文指導を担当する経験豊富な教員です。学生が提出前に自分で改善できるよう、具体的で根拠のある評価を返します。

# 評価の観点（各1〜5点）
- question 問いの明確さ：何を論じるのか（問い・目的・範囲）が序論で明確か。課題文の要求に答えているか。
- argument 論証と根拠：主張に対して理由・データ・文献が示され、飛躍なくつながっているか。
- analysis 分析の深さ：現象の列挙にとどまらず、原因・比較・仕組み・条件に踏み込んでいるか。
- discussion 考察の深さ：分析結果から何が言えるか、自分の解釈・含意・限界・反論への応答まで述べているか。
- specificity 具体性：数値・固有名詞・事例・引用で主張が具体化されているか。抽象語（様々な・重要・影響など）に頼っていないか。
- sources 出典の扱い：出典が本文中と文献リストで適切に示され、信頼できる資料か。出典のない断定がないか。
- structure 構成：序論・本論・結論の役割が果たされ、段落ごとに一つの論点になっているか。
- expression 文章表現：レポートにふさわしい文体・語彙で、読みやすいか。

点数の目安：5=学部上級〜大学院水準で優れている／4=良い・小さな改善点のみ／3=合格水準だが明確な弱点がある／2=大きな改善が必要／1=ほぼ満たしていない。学年・分野の指定があればその水準に合わせて採点します。

# 書き方のルール
- 指摘には必ず本文からの引用（evidence_quote, quote）を付けます。引用は本文から一字一句そのままコピーした連続する文字列（10〜40字程度）にしてください。該当箇所がない（欠けている）ことへの指摘なら空文字にします。
- 改善案は「何を・どう足す／削るか」が分かる具体的な指示にします。書き換え例（example）は1〜2文までにし、レポート全体を代筆しません。
- 書き換え例で、実在しない文献・統計・数値を作らないでください。データが必要な箇所は「〇〇（出典）のデータを入れる」のように、学生が調べるべきものとして示します。
- 良い点も具体的に挙げます。
- deepening_questions には、考察を深めるために学生が自問すべき問いを3〜5個書きます。

# AI生成らしさの推定（ai_likelihood）
文章がAI（大規模言語モデル）で生成された可能性を0〜100%で推定します。手がかり：定型句の多さ、具体性や個人的視点の欠如、均一な文のリズム、どの課題にも当てはまる一般論、整いすぎた両論併記など。逆に、個人の経験・独自のデータ・自然な揺らぎは人間らしさの手がかりです。
この推定は確実ではなく、定型的に書く人の文章も高く出ることがあります。根拠（signals）と反証（counter_signals）を両方挙げ、confidence を正直に付けてください。断定的な表現は避けます。`;

const EVAL_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['overall', 'criteria', 'strengths', 'priorities', 'deepening_questions', 'ai_likelihood'],
  properties: {
    overall: {
      type: 'object', additionalProperties: false, required: ['score', 'grade', 'summary'],
      properties: {
        score: { type: 'integer', description: '0〜100の総合点' },
        grade: { type: 'string', enum: ['S', 'A', 'B', 'C', 'D'] },
        summary: { type: 'string', description: '3〜4文の総評' },
      },
    },
    criteria: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['key', 'score', 'comment', 'evidence_quote', 'improvement'],
        properties: {
          key: { type: 'string', enum: Object.keys(CRITERIA) },
          score: { type: 'integer', description: '1〜5' },
          comment: { type: 'string' },
          evidence_quote: { type: 'string' },
          improvement: { type: 'string' },
        },
      },
    },
    strengths: { type: 'array', items: { type: 'string' } },
    priorities: {
      type: 'array', description: '優先度の高い順に3〜6件',
      items: {
        type: 'object', additionalProperties: false,
        required: ['title', 'quote', 'problem', 'suggestion', 'example'],
        properties: {
          title: { type: 'string' }, quote: { type: 'string' }, problem: { type: 'string' },
          suggestion: { type: 'string' }, example: { type: 'string' },
        },
      },
    },
    deepening_questions: { type: 'array', items: { type: 'string' } },
    ai_likelihood: {
      type: 'object', additionalProperties: false,
      required: ['percent', 'confidence', 'signals', 'counter_signals', 'note'],
      properties: {
        percent: { type: 'integer' },
        confidence: { type: 'string', enum: ['低', '中', '高'] },
        signals: { type: 'array', items: { type: 'string' } },
        counter_signals: { type: 'array', items: { type: 'string' } },
        note: { type: 'string' },
      },
    },
  },
};

const CHAT_SYSTEM = `あなたは大学のライティングセンターで働く、レポート指導の専門チューターです。学生が自分の力でレポートを良くできるよう手助けします。

方針：
- 学生の質問に、レポート本文の該当箇所を引用しながら具体的に答えます。
- 原則として代筆はしません。段落や全文の書き換えを頼まれたら、構成の案・書くべき要素・1〜2文の例にとどめ、学生自身が書けるよう導きます。
- 実在しない文献・統計・URLを作りません。必要なら「どんな資料を探すとよいか」（資料の種類、検索語、公的統計の名称など）を案内します。
- 考察を深めるために、問い返しを効果的に使います。
- 回答は日本語で、簡潔に。見出しや箇条書きは必要なときだけ使います。`;

function contextBlock(ctx) {
  const lines = [];
  if (ctx.task) lines.push(`【課題文】\n${ctx.task}`);
  lines.push(`【分野】${ctx.field || '指定なし'}　【水準】${ctx.level || '学部'}　【目標文字数】${ctx.target ? ctx.target + '字' : '指定なし'}`);
  lines.push(`【レポート本文】\n<report>\n${ctx.text}\n</report>`);
  return lines.join('\n\n');
}

class AIError extends Error { constructor(msg, kind) { super(msg); this.kind = kind; } }

function errorMessage(status, body) {
  const m = body && body.error && body.error.message ? body.error.message : '';
  if (status === 401) return 'APIキーが正しくありません。設定画面でキーを確認してください。';
  if (status === 403) return 'このキーではこの操作が許可されていません。' + (m ? `（${m}）` : '');
  if (status === 404) return '指定したモデルが見つかりません。設定画面でモデルを選び直してください。';
  if (status === 413) return '本文が長すぎます。分けてチェックしてください。';
  if (status === 429) return '利用上限に達したか、混み合っています。少し待ってから再実行してください。';
  if (status === 529 || status >= 500) return 'AIサーバーが混み合っています。少し待ってから再実行してください。';
  return `AIの呼び出しに失敗しました（${status}）。${m}`;
}

/* ストリーミングで呼び出し、content ブロックを元の形のまま組み立てて返す */
async function call(settings, { system, messages, maxTokens, effort, format, onText, signal }) {
  const model = settings.model in MODELS ? settings.model : 'claude-opus-5-5';
  const viaProxy = settings.mode === 'proxy';
  const url = viaProxy ? settings.proxyUrl : API_URL;
  if (!url) throw new AIError('中継サーバーのURLが設定されていません。', 'config');
  if (!viaProxy && !settings.apiKey) throw new AIError('APIキーが設定されていません。右上の「AI設定」から入力してください。', 'config');

  const headers = { 'content-type': 'application/json', 'anthropic-version': '2026-10-21' };
  if (viaProxy) { if (settings.accessCode) headers['x-access-code'] = settings.accessCode; }
  else { headers['x-api-key'] = settings.apiKey; headers['anthropic-dangerous-direct-browser-access'] = 'true'; }

  const body = { model, max_tokens: maxTokens, stream: true, system, messages, output_config: { effort } };
  if (format) body.output_config.format = format;
  if (MODELS[model].fallback) { body.fallbacks = 'default'; headers['anthropic-beta'] = 'server-side-fallback-2026-07-01'; }

  let res;
  try { res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal }); }
  catch (e) {
    if (e.name === 'AbortError') throw new AIError('中止しました。', 'abort');
    throw new AIError('AIサーバーに接続できません。ネット接続と設定（接続先URL）を確認してください。', 'network');
  }
  if (!res.ok) {
    let j = null; try { j = await res.json(); } catch (_) {}
    throw new AIError(errorMessage(res.status, j), 'http');
  }

  const blocks = []; let stopReason = null, usage = {}, servedModel = model;
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
  const handle = ev => {
    switch (ev.type) {
      case 'message_start': servedModel = ev.message.model || model; usage = { ...ev.message.usage }; break;
      case 'content_block_start': blocks[ev.index] = JSON.parse(JSON.stringify(ev.content_block)); break;
      case 'content_block_delta': {
        const b = blocks[ev.index], d = ev.delta;
        if (d.type === 'text_delta') { b.text = (b.text || '') + d.text; onText && onText(d.text); }
        else if (d.type === 'thinking_delta') b.thinking = (b.thinking || '') + d.thinking;
        else if (d.type === 'signature_delta') b.signature = (b.signature || '') + d.signature;
        break;
      }
      case 'message_delta':
        if (ev.delta && ev.delta.stop_reason) stopReason = ev.delta.stop_reason;
        if (ev.usage) Object.assign(usage, ev.usage);
        break;
      case 'error': throw new AIError('AIの応答中にエラーが発生しました：' + ((ev.error && ev.error.message) || ''), 'stream');
    }
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
        const data = chunk.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('');
        if (data) handle(JSON.parse(data));
      }
    }
  } catch (e) {
    if (e.name === 'AbortError') throw new AIError('中止しました。', 'abort');
    throw e;
  }
  const content = blocks.filter(Boolean);
  const text = content.filter(b => b.type === 'text').map(b => b.text || '').join('');
  const p = MODELS[servedModel] || MODELS[model];
  const cost = ((usage.input_tokens || 0) * p.in + (usage.cache_creation_input_tokens || 0) * p.in * 1.25 + (usage.cache_read_input_tokens || 0) * p.in * 0.1 + (usage.output_tokens || 0) * p.out) / 1e6;
  if (stopReason === 'refusal') throw new AIError('AIがこの内容への回答を控えました。本文や質問の表現を見直してください。', 'refusal');
  return { content, text, stopReason, usage, cost, model: servedModel };
}

async function evaluate(settings, ctx, opts = {}) {
  const r = await call(settings, {
    system: EVAL_SYSTEM,
    messages: [{ role: 'user', content: contextBlock(ctx) + '\n\n上記のレポートを評価してください。' }],
    maxTokens: 32000, effort: 'high',
    format: { type: 'json_schema', schema: EVAL_SCHEMA },
    onText: opts.onText, signal: opts.signal,
  });
  if (r.stopReason === 'max_tokens') throw new AIError('評価が途中で切れました。もう一度実行してください。', 'truncated');
  let data;
  try { data = JSON.parse(r.text); } catch (_) { throw new AIError('評価結果を読み取れませんでした。もう一度実行してください。', 'parse'); }
  return { data, cost: r.cost, model: r.model, usage: r.usage };
}

/* 相談チャット。history には API へ送った user / assistant メッセージをそのまま保持する（思考ブロックも含めて改変しない） */
async function chat(settings, ctx, history, userText, opts = {}) {
  const first = { role: 'user', content: [
    { type: 'text', text: contextBlock(ctx), cache_control: { type: 'ephemeral' } },
    { type: 'text', text: userText },
  ] };
  const msgs = history.length ? [...history, { role: 'user', content: userText }] : [first];
  const r = await call(settings, {
    system: CHAT_SYSTEM, messages: msgs, maxTokens: 16000, effort: 'medium',
    onText: opts.onText, signal: opts.signal,
  });
  const newHistory = [...msgs, { role: 'assistant', content: r.content }];
  return { reply: r.text, history: newHistory, cost: r.cost, model: r.model, truncated: r.stopReason === 'max_tokens' };
}

window.RCAI = { MODELS, CRITERIA, evaluate, chat, AIError };
})();
