/* チャット画面：添付または入力 → 採点 → 一覧表とコメント → 質問 */
(function () {
'use strict';
const AI = window.RCAI, Files = window.RCFiles;
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (_) { return false; } },
};
const len = s => s.replace(/\s/g, '').length;
const kb = n => n > 1048576 ? (n / 1048576).toFixed(1) + 'MB' : Math.max(1, Math.round(n / 1024)) + 'KB';
const fmtDate = iso => new Date(iso).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

const SAMPLE_TASK = 'SNSが大学生の情報収集に与える影響について、具体的な資料に基づいて論じなさい。（2000字程度）';
const SAMPLE = `SNSが大学生の情報収集に与える影響

現代社会において、SNSは私たちの生活に欠かせない存在となっている。特に大学生にとって、SNSは様々な情報を得るための重要なツールです。

なので、本レポートではSNSが大学生の情報収集にどのような影響を与えているのかについて多角的に考察し、そのメリットとデメリットを整理したうえで、今後の大学生に求められる情報リテラシーのあり方について検討していきたいと思う。

まず、SNSのメリットとしては、情報がすぐに手に入ることが挙げられる。友達とかサークルの連絡もSNSで回ってくるので、すごく便利だ。また、ニュースもSNSで見ることが多い。

一方で、SNSには誤った情報が拡散されやすいという問題もある。実際、大学生の多くがSNS上の情報を確認せずにシェアした経験があるという調査もある。また、自分と似た意見ばかりが表示されるため、考えが偏ってしまうかもしれない。

総じて、SNSは便利な反面、注意して使うことが重要であると言えるでしょう。情報の真偽を確かめる姿勢が今後ますます求められる！`;

const state = {
  attachments: [], pending: 0,
  history: null,            // 直近に採点したレポートの会話（質問用）
  busy: false,
  settings: Object.assign({ mode: 'direct', apiKey: '', proxyUrl: '', accessCode: '', model: 'claude-opus-5-5' }, store.get('rc-settings', {})),
  sessionKey: '',
};
const settings = () => Object.assign({}, state.settings, state.settings.apiKey ? {} : { apiKey: state.sessionKey });
const aiReady = () => { const s = settings(); return s.mode === 'proxy' ? !!s.proxyUrl : !!s.apiKey; };
const ctx = () => ({ task: $('task').value.trim(), level: $('level').value, field: $('field').value, target: +$('target').value || 0 });

/* ---------- 記録 ---------- */
const records = () => store.get('rc-records', []);
function addRecord(r) {
  const arr = records(); arr.unshift(r);
  while (arr.length > 100) arr.pop();
  if (!store.set('rc-records', arr)) toast('保存容量がいっぱいのため、記録を保存できませんでした。古い記録を削除してください。', 'err');
  updateRecCount();
}
const updateRecCount = () => { $('recCount').textContent = records().length; };

/* ---------- スレッド描画 ---------- */
const thread = $('thread');
const WHO = '<span class="who"><img src="icon.svg" alt="">添削ペン</span>';
function add(role, html) {
  const el = document.createElement('div');
  el.className = `msg ${role}`;
  el.innerHTML = (role === 'bot' ? WHO : '') + html;
  thread.appendChild(el);
  scrollDown();
  return el;
}
function scrollDown() { requestAnimationFrame(() => window.scrollTo({ top: document.body.scrollHeight, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })); }
const fileCard = a => {
  const ic = a.kind === 'image' ? `<img class="ic" src="${a.thumb}" alt="">` : `<span class="ic ${a.kind === 'pdf' ? 'pdf' : a.label === 'テキスト' ? 'txt' : 'doc'}">${a.kind === 'pdf' ? 'PDF' : a.label === 'テキスト' ? 'TXT' : 'DOC'}</span>`;
  return `${ic}<span class="nm">${esc(a.name)}<small>${kb(a.size)}</small></span>`;
};

function welcome() {
  add('bot', `<div class="bubble welcome">
    <h2>レポートを送ってください。採点して返します。</h2>
    <ol>
      <li>下の欄にレポートを<b>貼り付ける</b>か、<b>ファイル</b>（PDF・Word・写真）を添付します。手書きやスキャンでも読めます。</li>
      <li>課題の条件（水準・文字数・課題文）を合わせて、<b>「採点する」</b>を押します。</li>
      <li>8つの観点の点数とコメントを<b>一覧表</b>で返します。そのあと質問もできます。</li>
    </ol>
    <p class="sub">採点のたびに、ファイルや本文が Anthropic 社の AI に送信されます。結果はこの端末の「採点の記録」に残ります。</p>
    <div class="row">
      ${aiReady() ? '' : '<button class="btn primary" type="button" data-act="settings">まずAI設定をする</button>'}
      <button class="btn" type="button" data-act="sample">サンプルのレポートで試す</button>
    </div></div>`);
}

/* ---------- 採点結果カード ---------- */
const CRIT_KEYS = Object.keys(AI.CRITERIA);
const stCls = s => s === '良好' ? 'ok' : s === '注意' ? 'warn' : 'ng';
function delta(n, lowerBetter) {
  if (n == null) return '';
  if (n === 0) return '<span class="d">±0</span>';
  const good = lowerBetter ? n < 0 : n > 0;
  return `<span class="d ${good ? 'up' : 'down'}">${n > 0 ? '+' : ''}${n}</span>`;
}

function resultHTML(rec, prev) {
  const d = rec.data, al = d.ai_likelihood || {};
  const crit = CRIT_KEYS.map(k => (d.criteria || []).find(c => c.key === k)).filter(Boolean);
  const pc = k => prev && prev.data.criteria ? (prev.data.criteria.find(c => c.key === k) || {}).score : null;
  const chars = rec.exactChars || d.estimated_chars;
  const tgt = rec.ctx.target;
  const others = records().filter(r => r.id !== rec.id);
  const prevSel = others.length ? `<select data-prev="${rec.id}" aria-label="比較する記録"><option value="">前回と比較しない</option>${others.map(r => `<option value="${r.id}" ${prev && prev.id === r.id ? 'selected' : ''}>${esc(fmtDate(r.at))}・${esc((r.data.title || '無題').slice(0, 18))}（${r.data.overall.score}点）</option>`).join('')}</select>` : '';

  return `<div class="result" data-rec="${rec.id}">
    <div class="res-head"><span class="ttl">${esc(d.title || 'レポート')}</span>
      <span class="meta">${esc(rec.sources.join('・'))}｜${esc(rec.ctx.level)}${rec.ctx.field !== '指定なし' ? '・' + esc(rec.ctx.field) : ''}｜${esc(fmtDate(rec.at))}｜${esc((AI.MODELS[rec.model] || {}).short || rec.model)}・約$${rec.cost.toFixed(3)}</span></div>
    <div class="scoreband">
      <div class="grade-stamp" aria-label="評定 ${esc(d.overall.grade)}">${esc(d.overall.grade)}</div>
      <div class="kpi"><span class="l">総合点</span><span class="v">${d.overall.score}<small>/100</small></span>${prev ? delta(d.overall.score - prev.data.overall.score) : ''}</div>
      <div class="kpi"><span class="l">文字数${rec.exactChars ? '' : '（推定）'}</span><span class="v">${chars != null ? chars.toLocaleString() : '–'}<small>字</small></span>${tgt ? `<span class="d ${chars && chars >= tgt * 0.9 && chars <= tgt * 1.1 ? 'up' : 'down'}">目標 ${tgt.toLocaleString()}字</span>` : ''}</div>
      <div class="kpi"><span class="l">AI生成らしさ</span><span class="v">${al.percent ?? '–'}<small>%</small></span><div class="gbar"><i style="left:calc(${al.percent || 0}% - 1px)"></i></div></div>
    </div>
    <div class="res-sec"><h3>総評</h3><p class="summary">${esc(d.overall.summary)}</p></div>
    <div class="res-sec"><h3>観点別の評価 ${prevSel}</h3>
      <div class="tbl"><table class="grid stackable"><thead><tr><th>観点</th><th>評価</th>${prev ? '<th>前回比</th>' : ''}<th>コメント</th><th>改善のポイント</th></tr></thead><tbody>
      ${crit.map(c => `<tr class="${c.score <= 2 ? 'lowrow' : ''}"><th>${esc(AI.CRITERIA[c.key])}</th>
        <td class="sc"><span class="pips">${[1, 2, 3, 4, 5].map(n => `<i class="${n <= c.score ? 'on' : ''}"></i>`).join('')}</span>${c.score}/5</td>
        ${prev ? `<td class="sc">${pc(c.key) != null ? `${pc(c.key)}→${c.score} ${delta(c.score - pc(c.key))}` : '–'}</td>` : ''}
        <td class="wide" data-l="コメント">${esc(c.comment)}${c.evidence_quote ? `<q>${esc(c.evidence_quote)}</q>` : ''}</td>
        <td class="wide" data-l="改善のポイント">${esc(c.improvement)}</td></tr>`).join('')}
      </tbody></table></div></div>
    ${(d.format_checks || []).length ? `<div class="res-sec"><h3>形式チェック</h3>
      <div class="tbl"><table class="grid stackable"><thead><tr><th>項目</th><th>判定</th><th>コメント</th></tr></thead><tbody>
      ${d.format_checks.map(f => `<tr><th>${esc(f.item)}</th><td><span class="st ${stCls(f.status)}">${esc(f.status)}</span></td><td class="wide">${esc(f.comment)}</td></tr>`).join('')}
      </tbody></table></div></div>` : ''}
    ${(d.priorities || []).length ? `<div class="res-sec"><h3>優先して直す点</h3>${d.priorities.map((p, i) => `<div class="prio"><span class="n">${i + 1}</span><span class="t">${esc(p.title)}</span>
      <div class="b">${p.quote ? `<q class="quote">${esc(p.quote)}</q>` : ''}<span><span class="k">問題</span>${esc(p.problem)}</span><span><span class="k">直し方</span>${esc(p.suggestion)}</span>${p.example ? `<span class="ex"><span class="k">例</span>${esc(p.example)}</span>` : ''}</div></div>`).join('')}</div>` : ''}
    <div class="res-sec two">
      <div class="stack"><h3>良い点</h3><ul class="plain">${(d.strengths || []).map(s => `<li>${esc(s)}</li>`).join('')}</ul></div>
      <div class="stack"><h3>考察を深める問い</h3><ul class="plain">${(d.deepening_questions || []).map(s => `<li>${esc(s)}</li>`).join('')}</ul></div>
    </div>
    <div class="res-sec"><h3>AI生成らしさ ${al.percent ?? '–'}%（確からしさ：${esc(al.confidence || '–')}）</h3>
      <details class="ai-d"><summary>判定の手がかりを見る</summary>
        <div class="two" style="margin-top:8px">
          <div class="stack"><b style="font-size:.82rem">AIらしい手がかり</b><ul class="plain">${(al.signals || []).map(s => `<li>${esc(s)}</li>`).join('') || '<li>特になし</li>'}</ul></div>
          <div class="stack"><b style="font-size:.82rem">人が書いたと考えられる手がかり</b><ul class="plain">${(al.counter_signals || []).map(s => `<li>${esc(s)}</li>`).join('') || '<li>特になし</li>'}</ul></div>
        </div>${al.note ? `<p class="caveat" style="margin-top:8px">${esc(al.note)}</p>` : ''}</details>
      <p class="caveat">この数値は文章の特徴からの推定で、AIを使った証拠にはなりません。定型的に書く人の文章も高く出ることがあります。</p></div>
    ${d.teacher_comment ? `<div class="res-sec"><h3>先生からのコメント</h3><div class="teacher">${esc(d.teacher_comment)}<span class="sig">添削ペン</span></div></div>` : ''}
    <div class="res-act"><button class="btn sm" type="button" data-act="copy">結果をコピー</button><button class="btn sm" type="button" data-act="records">採点の記録を開く</button></div>
  </div>`;
}
function resultText(rec) {
  const d = rec.data, L = [];
  L.push(`【${d.title || 'レポート'}】 総合 ${d.overall.score}/100（評定 ${d.overall.grade}）・AI生成らしさ ${d.ai_likelihood ? d.ai_likelihood.percent : '–'}%`);
  L.push('', '■ 総評', d.overall.summary, '', '■ 観点別の評価');
  CRIT_KEYS.forEach(k => { const c = (d.criteria || []).find(x => x.key === k); if (c) L.push(`・${AI.CRITERIA[k]}：${c.score}/5　${c.comment}　→ ${c.improvement}`); });
  if (d.format_checks) { L.push('', '■ 形式チェック'); d.format_checks.forEach(f => L.push(`・${f.item}：${f.status}　${f.comment}`)); }
  if (d.priorities) { L.push('', '■ 優先して直す点'); d.priorities.forEach((p, i) => L.push(`${i + 1}. ${p.title}：${p.suggestion}`)); }
  if (d.teacher_comment) L.push('', '■ 先生からのコメント', d.teacher_comment);
  return L.join('\n');
}
function guessPrev(rec) {
  const others = records().filter(r => r.id !== rec.id);
  return others.find(r => r.sources.some(s => s !== '直接入力' && rec.sources.includes(s)))
    || others.find(r => r.data.title && r.data.title === rec.data.title) || null;
}

/* ---------- 添付 ---------- */
function renderAtt() {
  const box = $('att');
  box.hidden = !state.attachments.length && !state.pending;
  box.innerHTML = state.attachments.map((a, i) => `<span class="fcard">${fileCard(a)}<button class="x" type="button" data-rm="${i}" aria-label="${esc(a.name)}を外す">×</button></span>`).join('')
    + (state.pending ? '<span class="fcard"><span class="spin"></span><span class="nm">読み込み中…</span></span>' : '');
  syncButtons();
}
async function addFiles(list) {
  for (const f of list) {
    if (/\.json$/i.test(f.name)) { importBackup(f); continue; }
    state.pending++; renderAtt();
    try {
      const a = await Files.prepare(f);
      if (a.kind === 'text' && !a.text.trim()) throw new Files.ReadError(`「${a.name}」に本文が見つかりませんでした。`);
      state.attachments.push(a);
    } catch (e) { toast(e.message || 'ファイルを読み込めませんでした。', 'err'); }
    state.pending--; renderAtt();
  }
}
function syncButtons() {
  const hasReport = state.attachments.length || len($('input').value) > 0;
  $('gradeBtn').disabled = state.busy || state.pending > 0 || !hasReport;
  $('askBtn').disabled = state.busy || !state.history || !$('input').value.trim() || state.attachments.length > 0;
  $('gradeBtn').textContent = state.busy ? '採点中…' : '採点する';
}

/* ---------- 採点 ---------- */
async function grade() {
  if (!aiReady()) { openSettings(); return; }
  const text = $('input').value.trim();
  const atts = state.attachments.slice();
  if (!text && !atts.length) return;
  const c = ctx();
  const userHtml = (atts.length ? `<div class="files">${atts.map(a => `<span class="fcard">${fileCard(a)}</span>`).join('')}</div>` : '')
    + (text ? `<div class="bubble excerpt">${esc(text.length > 160 ? text.slice(0, 160) + '…' : text)}${text.length > 160 ? `\n（全${len(text).toLocaleString()}字）` : ''}</div>` : '')
    + `<span class="who">${esc(c.level)}${c.target ? '・目標' + c.target + '字' : ''}${c.task ? '・課題文あり' : ''}</span>`;
  add('user', userHtml);
  $('input').value = ''; state.attachments = []; renderAtt(); autoGrow();

  const textOnly = atts.every(a => a.kind === 'text');
  const exactChars = textOnly ? len([text, ...atts.map(a => a.text)].join('')) : null;
  const sources = [...atts.map(a => a.name), ...(text ? ['直接入力'] : [])];
  const bot = add('bot', '<div class="bubble"><div class="progress"><span class="spin"></span><span class="pt">レポートを読み込んでいます…（1〜2分かかることがあります）</span></div></div>');
  state.busy = true; syncButtons();
  let n = 0;
  try {
    const r = await AI.grade(settings(), { attachments: atts, text, exactChars }, c, {
      onText: t => { n += t.length; const pt = bot.querySelector('.pt'); if (pt) pt.textContent = `採点しています…（${n.toLocaleString()}字）`; },
    });
    const rec = { id: Date.now().toString(36), at: new Date().toISOString(), sources, ctx: c, exactChars, data: r.data, cost: r.cost, model: r.model };
    const prev = guessPrev(rec);
    addRecord(rec);
    state.history = r.history;
    bot.innerHTML = WHO + resultHTML(rec, prev);
    add('bot', '<div class="bubble">採点しました。気になる点は、下の欄に書いて「質問する」を押してください（例：「考察を深めるにはどう書けばいい？」）。直したらもう一度送ると、前回との差も表に出ます。</div>');
    bot.scrollIntoView({ block: 'start', behavior: 'smooth' });
  } catch (e) {
    bot.innerHTML = WHO + `<div class="bubble err">${esc(e.message)}</div>`;
  }
  state.busy = false; syncButtons();
}

/* ---------- 質問 ---------- */
function mdLite(s) { return esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/^#{1,4}\s*(.+)$/gm, '<b>$1</b>'); }
async function ask() {
  const q = $('input').value.trim();
  if (!q || !state.history) return;
  if (!aiReady()) { openSettings(); return; }
  add('user', `<div class="bubble">${esc(q)}</div>`);
  $('input').value = ''; autoGrow();
  const bot = add('bot', '<div class="bubble"><div class="progress"><span class="spin"></span>考えています…</div></div>');
  const bub = bot.querySelector('.bubble');
  state.busy = true; syncButtons();
  let acc = '';
  try {
    const r = await AI.ask(settings(), state.history, q, { onText: t => { acc += t; bub.innerHTML = mdLite(acc); } });
    state.history = r.history;
    bub.innerHTML = mdLite(r.reply) + (r.truncated ? '\n<span class="sub">（回答が長いため途中で切れました）</span>' : '');
  } catch (e) { bub.classList.add('err'); bub.textContent = e.message; }
  state.busy = false; syncButtons(); scrollDown();
}

/* ---------- 記録ダイアログ ---------- */
function renderRecords() {
  const rs = records();
  $('recList').innerHTML = rs.length ? rs.map(r => `<div class="rec"><input type="checkbox" value="${r.id}" aria-label="比較に使う"><span class="t">${esc(r.data.title || '無題')}</span><span class="g">${esc(r.data.overall.grade)}</span>
    <span class="m">${esc(fmtDate(r.at))}・${r.data.overall.score}点・AIらしさ ${r.data.ai_likelihood ? r.data.ai_likelihood.percent : '–'}%・${esc(r.sources.join('、'))}<br>
    <button class="btn sm" type="button" data-show="${r.id}">結果を表示</button> <button class="btn sm" type="button" data-del="${r.id}">削除</button></span></div>`).join('')
    : '<p class="empty">まだ記録はありません。</p>';
  $('recCmp').innerHTML = ''; $('cmpRecords').disabled = true;
}
function compareRecords(a, b) {
  if (new Date(a.at) > new Date(b.at)) [a, b] = [b, a];
  const row = (label, x, y, lowerBetter) => `<tr><th>${esc(label)}</th><td class="sc">${x ?? '–'}</td><td class="sc">${y ?? '–'}</td><td class="sc">${x != null && y != null ? delta(y - x, lowerBetter) : ''}</td></tr>`;
  const cs = (r, k) => ((r.data.criteria || []).find(c => c.key === k) || {}).score;
  $('recCmp').innerHTML = `<div class="tbl"><table class="grid"><thead><tr><th></th><th>${esc(fmtDate(a.at))}</th><th>${esc(fmtDate(b.at))}</th><th>変化</th></tr></thead><tbody>
    ${row('総合点', a.data.overall.score, b.data.overall.score)}
    ${CRIT_KEYS.map(k => row(AI.CRITERIA[k], cs(a, k), cs(b, k))).join('')}
    ${row('AI生成らしさ（%）', a.data.ai_likelihood && a.data.ai_likelihood.percent, b.data.ai_likelihood && b.data.ai_likelihood.percent, true)}
  </tbody></table></div><p class="sub">緑は良くなった変化、赤は下がった変化です（AI生成らしさは下がる方が緑）。</p>`;
}
function showRecord(id) {
  const r = records().find(x => x.id === id); if (!r) return;
  $('records').close();
  const el = add('bot', resultHTML(r, null));
  el.scrollIntoView({ block: 'start' });
}

/* ---------- 設定 ---------- */
function openSettings() {
  const s = state.settings, f = $('settingsForm');
  f.mode.value = s.mode;
  $('apiKey').value = s.apiKey || state.sessionKey;
  $('remember').checked = !!s.apiKey || !state.sessionKey;
  $('proxyUrl').value = s.proxyUrl; $('accessCode').value = s.accessCode;
  $('model').innerHTML = Object.entries(AI.MODELS).map(([id, m]) => `<option value="${id}">${esc(m.label)}</option>`).join('');
  $('model').value = s.model;
  syncSettingsUI();
  $('settings').showModal();
}
function syncSettingsUI() {
  const proxy = $('settingsForm').mode.value === 'proxy';
  $('directBox').hidden = proxy; $('proxyBox').hidden = !proxy;
  const m = AI.MODELS[$('model').value];
  $('priceNote').textContent = `目安：レポート1本（2000字程度）の採点で約 $${(m.in * 4000 / 1e6 + m.out * 7000 / 1e6).toFixed(2)}。PDF・画像は文字だけより多めにかかります。費用はキーの持ち主に請求されます。`;
}
$('settingsForm').addEventListener('change', syncSettingsUI);
$('settings').addEventListener('close', () => {
  if ($('settings').returnValue !== 'save') return;
  const key = $('apiKey').value.trim(), remember = $('remember').checked;
  state.settings = { mode: $('settingsForm').mode.value, apiKey: remember ? key : '', proxyUrl: $('proxyUrl').value.trim(), accessCode: $('accessCode').value.trim(), model: $('model').value };
  state.sessionKey = remember ? '' : key;
  store.set('rc-settings', state.settings);
  $('aiDot').classList.toggle('on', aiReady());
  if (aiReady()) { document.querySelectorAll('[data-act="settings"]').forEach(b => b.remove()); toast('AI設定を保存しました。', 'ok'); }
});

/* ---------- その他 ---------- */
let toastTimer;
function toast(msg, kind) {
  const t = $('toast'); t.textContent = msg; t.className = 'toast ' + (kind || ''); t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, kind === 'err' ? 7000 : 3500);
}
function autoGrow() { const t = $('input'); t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, innerHeight * 0.35) + 'px'; syncButtons(); }
function condSummary() { const c = ctx(); $('condSummary').textContent = `${c.level}${c.target ? '・' + c.target + '字' : ''}${c.task ? '・課題文あり' : ''}`; }
function saveCond() { store.set('rc-cond', ctx()); condSummary(); }
async function importBackup(file) {
  try {
    const data = JSON.parse(await file.text());
    const inc = Array.isArray(data) ? data : data.records;
    if (!Array.isArray(inc)) throw 0;
    const arr = records(), ids = new Set(arr.map(r => r.id)); let n = 0;
    inc.forEach(r => { if (r && r.id && r.data && !ids.has(r.id)) { arr.push(r); n++; } });
    arr.sort((a, b) => b.at.localeCompare(a.at)); store.set('rc-records', arr); updateRecCount(); renderRecords();
    toast(`${n}件の記録を取り込みました。`, 'ok');
  } catch (_) { toast('添削ペンのバックアップファイルではありません。', 'err'); }
}

$('composer').addEventListener('submit', e => { e.preventDefault(); (e.submitter && e.submitter.value === 'ask') ? ask() : grade(); });
$('input').addEventListener('input', autoGrow);
$('input').addEventListener('paste', e => { const fs = [...((e.clipboardData && e.clipboardData.files) || [])]; if (fs.length) { e.preventDefault(); addFiles(fs); } });
$('attach').onclick = () => $('fileInput').click();
$('fileInput').accept = Files.ACCEPT;
$('fileInput').addEventListener('change', e => { addFiles([...e.target.files]); e.target.value = ''; });
$('att').addEventListener('click', e => { const b = e.target.closest('[data-rm]'); if (b) { state.attachments.splice(+b.dataset.rm, 1); renderAtt(); } });
$('condToggle').onclick = () => { const c = $('cond'); c.hidden = !c.hidden; $('condToggle').setAttribute('aria-expanded', String(!c.hidden)); };
['task', 'level', 'field', 'target'].forEach(id => $(id).addEventListener('input', saveCond));
$('openSettings').onclick = openSettings;
$('openRecords').onclick = () => { renderRecords(); $('records').showModal(); };
$('closeRecords').onclick = () => $('records').close();
$('recList').addEventListener('change', () => { $('cmpRecords').disabled = $('recList').querySelectorAll('input:checked').length !== 2; });
$('recList').addEventListener('click', e => {
  const s = e.target.closest('[data-show]'), d = e.target.closest('[data-del]');
  if (s) showRecord(s.dataset.show);
  if (d) {
    if (!d.dataset.confirm) { d.dataset.confirm = '1'; d.textContent = '本当に削除'; return; }
    store.set('rc-records', records().filter(r => r.id !== d.dataset.del)); updateRecCount(); renderRecords();
  }
});
$('cmpRecords').onclick = () => {
  const ids = [...$('recList').querySelectorAll('input:checked')].map(i => i.value);
  const rs = records(); compareRecords(rs.find(r => r.id === ids[0]), rs.find(r => r.id === ids[1]));
};
$('exportBk').onclick = () => {
  const blob = new Blob([JSON.stringify({ app: 'tensaku-pen', version: 2, records: records() }, null, 1)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `tensaku-pen-records-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$('importBk').onclick = () => $('bkInput').click();
$('bkInput').addEventListener('change', e => { if (e.target.files[0]) importBackup(e.target.files[0]); e.target.value = ''; });

thread.addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const act = b.dataset.act;
  if (act === 'settings') openSettings();
  else if (act === 'sample') { $('input').value = SAMPLE; $('task').value = SAMPLE_TASK; saveCond(); autoGrow(); $('input').focus(); toast('サンプルを入力しました。「採点する」を押してください。'); }
  else if (act === 'records') { renderRecords(); $('records').showModal(); }
  else if (act === 'copy') {
    const r = records().find(x => x.id === b.closest('[data-rec]').dataset.rec); if (!r) return;
    navigator.clipboard.writeText(resultText(r)).then(() => toast('結果をコピーしました。', 'ok'), () => toast('コピーできませんでした。', 'err'));
  }
});
thread.addEventListener('change', e => {
  const s = e.target.closest('select[data-prev]'); if (!s) return;
  const rs = records(), rec = rs.find(r => r.id === s.dataset.prev), prev = rs.find(r => r.id === s.value) || null;
  if (rec) s.closest('.result').outerHTML = resultHTML(rec, prev);
});

let dragDepth = 0;
addEventListener('dragenter', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); dragDepth++; $('drop').hidden = false; } });
addEventListener('dragover', e => { if (!$('drop').hidden) e.preventDefault(); });
addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('drop').hidden = true; } });
addEventListener('drop', e => { if ($('drop').hidden) return; e.preventDefault(); dragDepth = 0; $('drop').hidden = true; addFiles([...e.dataTransfer.files]); });

// 起動
const cond = store.get('rc-cond', null);
if (cond) { $('task').value = cond.task || ''; $('level').value = cond.level || $('level').value; $('field').value = cond.field || $('field').value; $('target').value = cond.target || ''; }
condSummary(); updateRecCount(); $('aiDot').classList.toggle('on', aiReady());
welcome(); syncButtons();
})();
