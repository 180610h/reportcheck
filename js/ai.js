/* レポートチェック専用AI（Claude）との通信。
   ビルド不要の静的サイトなので、SDK ではなく fetch で Messages API を直接呼ぶ。 */
(function () {
'use strict';

const API_URL = 'https://api.anthropic.com/v1/messages';

const MODELS = {
  'claude-opus-5-5':   { label: 'Claude Opus 5.5（最も丁寧・標準）', short: 'Opus 5.5', in: 4, out: 20, fallback: true },
  'claude-sonnet-5-5': { label: 'Claude Sonnet 5.5（速い・費用は約半分）', short: 'Sonnet 5.5', in: 2, out: 10, fallback: true },
  'claude-haiku-5-5':  { label: 'Claude Haiku 5.5（最速・低価格）', short: 'Haiku 5.5', in: 0.1, out: 0.5, fallback: false },
};

const CRITERIA = {
  question: '問いの明確さ', argument: '論証と根拠', analysis: '分析の深さ', discussion: '考察の深さ',
  specificity: '具体性', sources: '出典の扱い', structure: '構成', expression: '文章表現',
};

const SYSTEM = `あなたは日本の大学・大学院でレポート・論文指導を担当する経験豊富な教員で、レポート採点と添削の専門AIとして働いています。学生が提出前に自分で改善できるよう、具体的で根拠のある評価と、温かく率直なコメントを返します。

# 入力
レポートは、添付されたPDF・画像（印刷物や手書きの写真、スキャン）・文書、または直接入力された文章として渡されます。画像やPDFは紙面をそのまま読み取ってください。複数の画像はページ順に並んでいるものとして扱います。読み取れない箇所があれば format_checks に書きます。

# 採点の観点（各1〜5点）
- question 問いの明確さ：何を論じるのか（問い・目的・範囲）が序論で明確か。課題文の要求に答えているか。
- argument 論証と根拠：主張に対して理由・データ・文献が示され、飛躍なくつながっているか。
- analysis 分析の深さ：現象の列挙にとどまらず、原因・比較・仕組み・条件に踏み込んでいるか。
- discussion 考察の深さ：分析から何が言えるか、自分の解釈・含意・限界・反論への応答まで述べているか。
- specificity 具体性：数値・固有名詞・事例・引用で主張が具体化されているか。抽象語に頼っていないか。
- sources 出典の扱い：出典が本文中と文献リストで適切に示され、信頼できる資料か。出典のない断定がないか。
- structure 構成：序論・本論・結論の役割が果たされ、段落ごとに一つの論点になっているか。
- expression 文章表現：文体の統一、話し言葉の有無、一文の長さ、誤字脱字など。

点数の目安：5=学部上級〜大学院水準で優れている／4=良い・小さな改善点のみ／3=合格水準だが明確な弱点がある／2=大きな改善が必要／1=ほぼ満たしていない。指定された水準（学年）に合わせて採点します。
総合点（0〜100）は観点の評価を踏まえた総合判断です。評定はS(90〜)・A(80〜)・B(70〜)・C(60〜)・D(〜59)。

# 形式チェック（format_checks）
次の項目を必ずこの順で判定します：文字数（目標に対して）、文体の統一（だ・である／です・ます）、話し言葉、一文の長さ、誤字脱字・表記、出典の示し方、段落構成、タイトル・見出し。status は「良好」「注意」「要修正」のいずれか。

# 書き方のルール
- 本文の引用（evidence_quote, quote）は本文から一字一句そのままの短い連続した文字列（10〜40字）にします。欠けていることへの指摘なら空文字にします。
- 改善は「何を・どう足す／削るか」が分かる具体的な指示にし、書き換え例（example）は1〜2文まで。レポート全体の代筆はしません。
- 実在しない文献・統計・数値を作りません。データが必要な箇所は、学生が調べるべきものとして示します。
- teacher_comment は、教員が答案の最後に書く講評のように、良い点を認めつつ次に取り組むべきことを2〜4文で書きます。

# AI生成らしさ（ai_likelihood）
文章がAIで生成された可能性を0〜100%で推定します。手がかり：定型句の多さ、具体性や個人的視点の欠如、均一な文のリズム、どの課題にも当てはまる一般論、整いすぎた両論併記など。個人の経験・独自のデータ・自然な揺らぎ（手書きの修正跡など）は人間らしさの手がかりです。この推定は確実ではないため、根拠と反証を両方挙げ、confidence を正直に付けます。

# 採点後の相談
採点のあとに学生から質問が来たら、レポートの該当箇所を引用しながら日本語で簡潔に答えます。代筆はせず、構成の案・書くべき要素・短い例にとどめ、学生自身が書けるよう導きます。見出しや箇条書きは必要なときだけ使います。`;

const S = (props, req) => ({ type: 'object', additionalProperties: false, required: req || Object.keys(props), properties: props });
const str = d => (d ? { type: 'string', description: d } : { type: 'string' });
const SCHEMA = S({
  title: str('レポートの題名（なければ内容から短く要約）'),
  estimated_chars: { type: 'integer', description: '本文の文字数（空白・参考文献を除く概数）' },
  overall: S({ score: { type: 'integer', description: '0〜100' }, grade: { type: 'string', enum: ['S', 'A', 'B', 'C', 'D'] }, summary: str('3〜4文の総評') }),
  criteria: { type: 'array', description: '8観点すべてを定義順に', items: S({ key: { type: 'string', enum: Object.keys(CRITERIA) }, score: { type: 'integer', description: '1〜5' }, comment: str('評価の理由（1〜2文）'), evidence_quote: str(), improvement: str('改善のポイント（1文）') }) },
  format_checks: { type: 'array', items: S({ item: str(), status: { type: 'string', enum: ['良好', '注意', '要修正'] }, comment: str() }) },
  priorities: { type: 'array', description: '優先度の高い順に3〜5件', items: S({ title: str(), quote: str(), problem: str(), suggestion: str(), example: str() }) },
  strengths: { type: 'array', items: str() },
  deepening_questions: { type: 'array', items: str() },
  ai_likelihood: S({ percent: { type: 'integer' }, confidence: { type: 'string', enum: ['低', '中', '高'] }, signals: { type: 'array', items: str() }, counter_signals: { type: 'array', items: str() }, note: str() }),
  teacher_comment: str(),
});

class AIError extends Error { constructor(msg, kind) { super(msg); this.kind = kind; } }

function errorMessage(status, body) {
  const m = body && body.error && body.error.message ? body.error.message : '';
  if (status === 401) return 'APIキーが正しくありません。「AI設定」でキーを確認してください。';
  if (status === 403) return 'このキー（またはアクセスコード）ではこの操作が許可されていません。' + (m ? `（${m}）` : '');
  if (status === 404) return '指定したモデルが見つかりません。「AI設定」でモデルを選び直してください。';
  if (status === 413) return 'ファイルが大きすぎます。ページ数を減らすか、画像の枚数を減らしてください。';
  if (status === 429) return '利用上限に達したか、混み合っています。少し待ってから再実行してください。';
  if (status === 529 || status >= 500) return 'AIサーバーが混み合っています。少し待ってから再実行してください。';
  if (status === 400 && /pdf|page/i.test(m)) return 'このPDFは読み込めませんでした（ページ数が多すぎる・保護されている等）。' + m;
  return `AIの呼び出しに失敗しました（${status}）。${m}`;
}

/* ストリーミングで呼び出し、content ブロックを元の形のまま組み立てて返す */
async function call(settings, { messages, maxTokens, effort, format, onText, signal }) {
  const model = settings.model in MODELS ? settings.model : 'claude-opus-5-5';
  const viaProxy = settings.mode === 'proxy';
  const url = viaProxy ? settings.proxyUrl : API_URL;
  if (!url) throw new AIError('中継サーバーのURLが設定されていません。', 'config');
  if (!viaProxy && !settings.apiKey) throw new AIError('APIキーが設定されていません。右上の「AI設定」から入力してください。', 'config');

  const headers = { 'content-type': 'application/json', 'anthropic-version': '2026-10-21' };
  if (viaProxy) { if (settings.accessCode) headers['x-access-code'] = settings.accessCode; }
  else { headers['x-api-key'] = settings.apiKey; headers['anthropic-dangerous-direct-browser-access'] = 'true'; }

  const body = { model, max_tokens: maxTokens, stream: true, system: SYSTEM, messages, output_config: { effort } };
  if (format) body.output_config.format = format;
  if (MODELS[model].fallback) { body.fallbacks = 'default'; headers['anthropic-beta'] = 'server-side-fallback-2026-07-01'; }

  let res;
  try { res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal }); }
  catch (e) {
    if (e.name === 'AbortError') throw new AIError('中止しました。', 'abort');
    throw new AIError('AIサーバーに接続できません。ネット接続と「AI設定」の接続先を確認してください。', 'network');
  }
  if (!res.ok) { let j = null; try { j = await res.json(); } catch (_) {} throw new AIError(errorMessage(res.status, j), 'http'); }

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
  } catch (e) { if (e.name === 'AbortError') throw new AIError('中止しました。', 'abort'); throw e; }
  const content = blocks.filter(Boolean);
  const text = content.filter(b => b.type === 'text').map(b => b.text || '').join('');
  const p = MODELS[servedModel] || MODELS[model];
  const cost = ((usage.input_tokens || 0) * p.in + (usage.cache_creation_input_tokens || 0) * p.in * 1.25 + (usage.cache_read_input_tokens || 0) * p.in * 0.1 + (usage.output_tokens || 0) * p.out) / 1e6;
  if (stopReason === 'refusal') throw new AIError('AIがこの内容への回答を控えました。内容や質問の表現を見直してください。', 'refusal');
  return { content, text, stopReason, cost, model: servedModel };
}

/* レポート（添付ファイル・入力文）を最初のユーザーメッセージにまとめる */
function reportMessage(report, ctx) {
  const content = [];
  for (const a of report.attachments) {
    if (a.kind === 'pdf') content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: a.data }, title: a.name });
    else if (a.kind === 'image') content.push({ type: 'image', source: { type: 'base64', media_type: a.mediaType, data: a.data } });
    else content.push({ type: 'document', source: { type: 'text', media_type: 'text/plain', data: a.text }, title: a.name });
  }
  if (report.text) content.push({ type: 'document', source: { type: 'text', media_type: 'text/plain', data: report.text }, title: '直接入力したレポート' });
  if (content.length) content[content.length - 1].cache_control = { type: 'ephemeral' };
  const lines = [];
  if (ctx.task) lines.push(`【課題文】${ctx.task}`);
  lines.push(`【水準】${ctx.level}　【分野】${ctx.field}　【目標文字数】${ctx.target ? ctx.target + '字' : '指定なし'}`);
  if (report.exactChars) lines.push(`【本文の文字数（空白除く・機械計測）】${report.exactChars}字`);
  const imgs = report.attachments.filter(a => a.kind === 'image').length;
  if (imgs > 1) lines.push(`画像${imgs}枚はレポートのページ順です。`);
  lines.push('このレポートを採点してください。');
  content.push({ type: 'text', text: lines.join('\n') });
  return { role: 'user', content };
}

async function grade(settings, report, ctx, opts = {}) {
  const first = reportMessage(report, ctx);
  const r = await call(settings, {
    messages: [first], maxTokens: 32000, effort: 'high',
    format: { type: 'json_schema', schema: SCHEMA }, onText: opts.onText, signal: opts.signal,
  });
  if (r.stopReason === 'max_tokens') throw new AIError('採点が途中で切れました。もう一度実行してください。', 'truncated');
  let data;
  try { data = JSON.parse(r.text); } catch (_) { throw new AIError('採点結果を読み取れませんでした。もう一度実行してください。', 'parse'); }
  return { data, cost: r.cost, model: r.model, history: [first, { role: 'assistant', content: r.content }] };
}

/* 採点後の質問。history は API に送ったメッセージを改変せずに保持する（思考ブロックも含む） */
async function ask(settings, history, question, opts = {}) {
  const msgs = [...history, { role: 'user', content: question }];
  const r = await call(settings, { messages: msgs, maxTokens: 16000, effort: 'medium', onText: opts.onText, signal: opts.signal });
  return { reply: r.text, history: [...msgs, { role: 'assistant', content: r.content }], cost: r.cost, truncated: r.stopReason === 'max_tokens' };
}

window.RCAI = { MODELS, CRITERIA, grade, ask, AIError };
})();
