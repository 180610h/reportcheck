/* 画面の組み立てと操作 */
(function () {
'use strict';
const { analyze, docChecks, depth, aiLocal, len } = window.RC;
const AI = window.RCAI;
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} },
  del(k) { try { localStorage.removeItem(k); } catch (_) {} },
};
const hash = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = (h * 33 ^ s.charCodeAt(i)) >>> 0; return h.toString(36); };

const ta = $('text'), pv = $('preview');
const state = {
  usingSample: true, filter: null, issues: [], lastLocalAi: null,
  evalResult: store.get('rc-eval', null),
  chatHistory: [], chatView: [], chatCostTotal: 0,
  settings: Object.assign({ mode: 'direct', apiKey: '', proxyUrl: '', accessCode: '', model: 'claude-opus-5-5' }, store.get('rc-settings', {})),
  sessionKey: '',
  busy: null,
};

/* ---------- 保存・読み込み ---------- */
function loadDraft() {
  const d = store.get('rc-draft', null);
  if (d && typeof d.text === 'string' && d.text.trim()) {
    ta.value = d.text; state.usingSample = false;
    ['task', 'field', 'level', 'target', 'style'].forEach(k => { if (d[k] != null) $(k).value = d[k]; });
  } else { ta.value = RC.SAMPLE; $('task').value = RC.SAMPLE_TASK; }
}
function saveDraft() {
  if (state.usingSample) return store.del('rc-draft');
  store.set('rc-draft', { text: ta.value, task: $('task').value, field: $('field').value, level: $('level').value, target: $('target').value, style: $('style').value });
}
const ctx = () => ({ text: ta.value, task: $('task').value.trim(), field: $('field').value, level: $('level').value, target: +$('target').value || 0 });
const settings = () => Object.assign({}, state.settings, state.settings.apiKey ? {} : { apiKey: state.sessionKey });
const aiReady = () => { const s = settings(); return s.mode === 'proxy' ? !!s.proxyUrl : !!s.apiKey; };
const evalCurrent = () => state.evalResult && state.evalResult.hash === hash(ta.value);

/* ---------- AI の指摘を本文上の位置に対応づける ---------- */
function locate(text, q) {
  if (!q) return -1;
  const tries = [q, q.trim(), q.replace(/[。、]$/, ''), q.slice(0, 20)];
  for (const t of tries) { if (t && t.length >= 4) { const i = text.indexOf(t); if (i >= 0) return [i, i + t.length]; } }
  return -1;
}
function aiIssues(text) {
  if (!evalCurrent()) return [];
  const d = state.evalResult.data, out = [];
  (d.priorities || []).forEach(p => {
    const loc = locate(text, p.quote);
    out.push({ s: loc === -1 ? -1 : loc[0], e: loc === -1 ? -1 : loc[1], cat: 'AI評価', sev: 'ai', label: p.title, tip: p.suggestion });
  });
  return out;
}

/* ---------- 描画 ---------- */
function render() {
  const text = ta.value;
  const res = analyze(text, $('style').value);
  const doc = docChecks(text, res, +$('target').value || 0);
  const dep = depth(text);
  const local = aiLocal(text, res, res.issues, dep);
  state.lastLocalAi = local;
  state.issues = res.issues.concat(aiIssues(text)).sort((a, b) => (a.s < 0) - (b.s < 0) || a.s - b.s);
  const issues = state.issues;

  // 添削ビュー（重なる指摘は先に来たもの・文単位でないものを優先）
  const ranked = issues.map((x, i) => ({ ...x, i })).filter(x => x.s >= 0)
    .sort((a, b) => (b.sev === 'ai') - (a.sev === 'ai') || (a.whole ? 1 : 0) - (b.whole ? 1 : 0) || a.s - b.s);
  const taken = [];
  for (const x of ranked) { if (taken.some(t => x.s < t.e && t.s < x.e)) continue; taken.push(x); }
  taken.sort((a, b) => a.s - b.s);
  let html = '', p = 0;
  for (const m of taken) { html += esc(text.slice(p, m.s)) + `<mark class="s-${m.sev}" data-i="${m.i}" data-cat="${esc(m.cat)}" title="${esc(m.label)}">${esc(text.slice(m.s, m.e))}</mark>`; p = m.e; }
  html += esc(text.slice(p));
  pv.innerHTML = html || '<span style="color:var(--muted)">本文がありません。「本文を書く・貼る」タブから貼り付けてください。</span>';

  // 数値
  $('stChars').textContent = doc.chars.toLocaleString();
  $('stSent').textContent = res.body.length;
  $('stAvg').textContent = res.body.length ? Math.round(res.body.reduce((a, s) => a + len(s.t), 0) / res.body.length) : 0;
  $('stPara').textContent = doc.paras;
  const r = doc.target ? Math.min(1, doc.chars / doc.target) : 0;
  $('meter').style.width = (r * 100) + '%';
  $('meter').style.background = { pass: 'var(--ok)', part: 'var(--warn)', fail: 'var(--pen)' }[doc.list[0].state];
  $('meterL').textContent = doc.target ? `目標まで ${Math.round(r * 100)}%` : '目標文字数なし';
  $('meterR').textContent = doc.target ? `${doc.chars.toLocaleString()} / ${doc.target.toLocaleString()}字` : '';

  // 形式スコア
  const w = { error: 4, warn: 2.5, info: 0.8, ai: 0 };
  let pen = Math.min(60, res.issues.reduce((a, x) => a + w[x.sev], 0));
  pen += doc.list.reduce((a, c) => a + (c.state === 'fail' ? 8 : c.state === 'part' ? 3 : 0), 0);
  const has = !!text.trim();
  const score = has ? Math.max(0, Math.round(100 - pen)) : 0;
  const v = score >= 85 ? ['提出できる状態です', 'var(--ok)'] : score >= 65 ? ['もう一息', 'var(--warn)'] : ['要修正', 'var(--pen)'];
  $('score').innerHTML = `${has ? score : '–'}<small>/100</small>`;
  $('score').style.color = has ? v[1] : '';
  $('verdict').textContent = has ? v[0] : '–'; $('verdict').style.color = has ? v[1] : '';

  $('checks').innerHTML = doc.list.map(c => `<div class="ck ${c.state}"><span class="mk">${c.state === 'pass' ? '✓' : c.state === 'part' ? '△' : '✕'}</span><div>${esc(c.label)}<small>${esc(c.note)}</small></div></div>`).join('');

  renderAiGauge(local);
  renderDepth(dep);
  renderPen(text);
  renderEval();
  $('sampleNote').hidden = !state.usingSample;
  $('aiDot').classList.toggle('on', aiReady());
}

function renderAiGauge(local) {
  const cur = evalCurrent() ? state.evalResult.data.ai_likelihood : null;
  const row = (label, pct, sub) => `<div class="gauge-row"><span>${label}</span><div class="bar scale">${pct == null ? '' : `<i style="width:${pct}%"></i>`}</div><span class="pct">${pct == null ? '–' : pct + '%'}</span></div>${sub ? `<div class="sub" style="margin-left:9.2em">${sub}</div>` : ''}`;
  $('gauge').innerHTML =
    row('文体統計', local.percent, local.percent == null ? local.reason : '') +
    row('AI（Claude）判定', cur ? cur.percent : null, cur ? `確からしさ：${esc(cur.confidence)}` : '「AI評価」タブで実行すると表示されます');
  const big = cur ? cur.percent : local.percent;
  $('aiPct').innerHTML = `${big == null ? '–' : big}<small>%</small>`;
  $('aiPct').style.color = big == null ? '' : big >= 70 ? 'var(--pen)' : big >= 40 ? 'var(--warn)' : 'var(--ok)';
  $('aiPctSrc').textContent = cur ? `Claude の判定（文体統計 ${local.percent ?? '–'}%）` : local.percent == null ? local.reason : '文体統計による推定';
  $('featBox').hidden = !local.features;
  if (local.features) $('feats').innerHTML = local.features.map(f => `<div class="feat"><span>${esc(f.label)}</span><span class="v">${esc(f.v)}</span><small>${esc(f.note)}・寄与 ${Math.round(f.s * f.w * 90)}pt</small></div>`).join('');
}

function renderDepth(dep) {
  $('depthList').innerHTML = dep.map(d => {
    const lv = d.score >= 60 ? ['hi', '十分'] : d.score >= 30 ? ['mid', 'やや不足'] : ['lo', '不足'];
    return `<div class="dp"><span class="lbl">${esc(d.label)}<span class="lv ${lv[0]}">${lv[1]}</span></span><div class="bar"><i style="width:${d.score}%"></i></div><span class="sc">${d.score}</span><small>${esc(d.tip)}（1000字あたり ${d.per}）</small></div>`;
  }).join('');
}

function renderPen(text) {
  const issues = state.issues;
  $('penCount').textContent = issues.length;
  const cats = {}; issues.forEach(x => cats[x.cat] = (cats[x.cat] || 0) + 1);
  if (state.filter && !cats[state.filter]) state.filter = null;
  const f = state.filter;
  $('chips').innerHTML = `<button class="chip" data-c="" aria-pressed="${!f}">すべて <b>${issues.length}</b></button>` +
    Object.entries(cats).map(([c, n]) => `<button class="chip" data-c="${esc(c)}" aria-pressed="${f === c}">${esc(c)} <b>${n}</b></button>`).join('');
  const order = { error: 0, ai: 1, warn: 2, info: 3 };
  const shown = issues.map((x, i) => ({ ...x, i })).filter(x => !f || x.cat === f).sort((a, b) => order[a.sev] - order[b.sev] || a.s - b.s);
  $('list').innerHTML = shown.length ? shown.map(x => {
    let q = '';
    if (x.s >= 0) {
      const a = Math.max(0, x.s - (x.whole ? 0 : 10)), b = Math.min(text.length, x.whole ? Math.min(x.e, x.s + 46) : x.e + 10);
      const hitEnd = Math.min(x.e, b);
      q = `<q>${(a > 0 ? '…' : '') + esc(text.slice(a, x.s))}<em>${esc(text.slice(x.s, hitEnd))}</em>${esc(text.slice(hitEnd, b))}${b < text.length ? '…' : ''}</q>`.replace(/\n/g, ' ');
    }
    return `<button class="item s-${x.sev}" data-i="${x.i}" type="button"><span class="top"><span class="lbl">${esc(x.label)}</span><span class="cat">${esc(x.cat)}</span></span>${q}<span class="tip">${esc(x.tip)}</span></button>`;
  }).join('') : `<p class="empty">${text.trim() ? 'このカテゴリの指摘はありません。' : '本文を入れると指摘がここに並びます。'}</p>`;
  pv.querySelectorAll('mark').forEach(m => m.classList.toggle('dim', !!f && m.dataset.cat !== f));
}

/* ---------- AI評価 ---------- */
function renderEval(progressText) {
  const area = $('evalArea');
  if (state.busy === 'eval') {
    area.innerHTML = `<div class="progress"><span class="spin"></span>${esc(progressText || 'レポートを読んでいます…（1〜2分かかることがあります）')}</div>`;
    return;
  }
  const er = state.evalResult;
  if (!er) return;
  const d = er.data;
  const stale = er.hash !== hash(ta.value) ? '<p class="stale">本文が評価後に変更されています。もう一度評価すると最新の内容で採点します。</p>' : '';
  const crit = (d.criteria || []).map(c => `<div class="crit">
      <span class="name">${esc(AI.CRITERIA[c.key] || c.key)}</span>
      <span class="pips" aria-label="${c.score}点">${[1, 2, 3, 4, 5].map(n => `<i class="${n <= c.score ? 'on' : ''}"></i>`).join('')}</span>
      <span class="cost">${c.score} / 5</span>
      <div class="cm">${esc(c.comment)}</div>
      ${c.evidence_quote ? `<q class="quote" data-q="${esc(c.evidence_quote)}">${esc(c.evidence_quote)}</q>` : ''}
      <div class="im"><b>改善：</b>${esc(c.improvement)}</div></div>`).join('');
  const prio = (d.priorities || []).map((p, i) => `<div class="prio">
      <span class="t">${i + 1}. ${esc(p.title)}</span>
      ${p.quote ? `<q class="quote" data-q="${esc(p.quote)}">${esc(p.quote)}</q>` : ''}
      <span><span class="k">問題</span>${esc(p.problem)}</span>
      <span><span class="k">直し方</span>${esc(p.suggestion)}</span>
      ${p.example ? `<span class="ex"><span class="k">例</span>${esc(p.example)}</span>` : ''}</div>`).join('');
  const al = d.ai_likelihood || {};
  area.innerHTML = `${stale}
    <div class="ai-head"><span class="grade" style="color:var(--ai)">${esc(d.overall.grade)}</span>
      <div><div class="big" style="border:0;padding:0"><span class="lbl">総合点（${esc($('level').value)}水準）</span><span class="num" style="font-size:1.8rem">${d.overall.score}<small>/100</small></span></div></div></div>
    <p style="margin:0;font-size:.9rem">${esc(d.overall.summary)}</p>
    <div class="stack"><h2>観点別の評価</h2><div>${crit}</div></div>
    <div class="stack"><h2>優先して直す点</h2>${prio}</div>
    ${d.strengths && d.strengths.length ? `<div class="stack"><h2>良い点</h2><ul class="plain">${d.strengths.map(s => `<li>${esc(s)}</li>`).join('')}</ul></div>` : ''}
    ${d.deepening_questions && d.deepening_questions.length ? `<div class="stack"><h2>考察を深める問い</h2><ul class="plain">${d.deepening_questions.map(s => `<li>${esc(s)}</li>`).join('')}</ul></div>` : ''}
    <div class="stack"><h2>AI生成らしさ（Claudeの判定）</h2>
      <div class="gauge-row"><span>推定</span><div class="bar scale"><i style="width:${al.percent}%"></i></div><span class="pct">${al.percent}%</span></div>
      <span class="sub">確からしさ：${esc(al.confidence || '')}</span>
      ${al.signals && al.signals.length ? `<div><b style="font-size:.82rem">AIらしい手がかり</b><ul class="plain">${al.signals.map(s => `<li>${esc(s)}</li>`).join('')}</ul></div>` : ''}
      ${al.counter_signals && al.counter_signals.length ? `<div><b style="font-size:.82rem">人が書いたと考えられる手がかり</b><ul class="plain">${al.counter_signals.map(s => `<li>${esc(s)}</li>`).join('')}</ul></div>` : ''}
      ${al.note ? `<p class="caveat">${esc(al.note)}</p>` : ''}
    </div>`;
  $('evalCost').textContent = `${er.modelLabel || ''}・約 $${er.cost.toFixed(3)}`;
}

let evalCtl = null;
async function runEval() {
  if (!ta.value.trim()) return;
  if (!aiReady()) { openSettings(); return; }
  state.busy = 'eval'; evalCtl = new AbortController();
  $('runEval').disabled = true; $('stopEval').hidden = false;
  let chars = 0;
  renderEval();
  try {
    const r = await AI.evaluate(settings(), ctx(), {
      signal: evalCtl.signal,
      onText: t => { chars += t.length; if (chars % 40 < t.length) renderEval(`評価を書いています…（${chars}字）`); },
    });
    state.evalResult = { data: r.data, hash: hash(ta.value), cost: r.cost, model: r.model, modelLabel: (AI.MODELS[r.model] || {}).label?.split('（')[0] };
    store.set('rc-eval', state.evalResult);
    state.busy = null; render();
  } catch (e) {
    state.busy = null; render();
    $('evalArea').insertAdjacentHTML('afterbegin', `<p class="err">${esc(e.message)}</p>`);
  } finally { $('runEval').disabled = false; $('stopEval').hidden = true; }
}

/* ---------- 相談チャット ---------- */
function renderChat() {
  $('chat').innerHTML = state.chatView.map(m => `<div class="msg ${m.role}">${esc(m.text)}</div>`).join('');
  $('chat').scrollTop = $('chat').scrollHeight;
  $('suggest').hidden = state.chatView.length > 0;
  $('chatCost').textContent = state.chatCostTotal ? `この会話の費用 約 $${state.chatCostTotal.toFixed(3)}` : '';
}
async function sendChat(q) {
  q = q.trim(); if (!q || state.busy === 'chat') return;
  if (!ta.value.trim()) return;
  if (!aiReady()) { openSettings(); return; }
  state.busy = 'chat'; $('send').disabled = true; $('ask').value = '';
  state.chatView.push({ role: 'user', text: q }, { role: 'bot', text: '…' });
  renderChat();
  const bot = state.chatView[state.chatView.length - 1]; let acc = '';
  try {
    const r = await AI.chat(settings(), ctx(), state.chatHistory, q, { onText: t => { acc += t; bot.text = acc; renderChat(); } });
    state.chatHistory = r.history; bot.text = r.reply + (r.truncated ? '\n（回答が長いため途中で切れました）' : '');
    state.chatCostTotal += r.cost;
  } catch (e) { bot.text = '⚠ ' + e.message; }
  state.busy = null; $('send').disabled = false; renderChat();
}

/* ---------- 設定 ---------- */
function openSettings() {
  const s = state.settings;
  $('settingsForm').mode.value = s.mode;
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
  $('priceNote').textContent = `目安：2000字のレポート1回の評価で約 $${(m.in * 3500 / 1e6 + m.out * 6000 / 1e6).toFixed(2)}（入力 $${m.in} / 出力 $${m.out}・100万トークンあたり）。費用はキーの持ち主に請求されます。`;
}
$('settingsForm').addEventListener('change', syncSettingsUI);
$('settings').addEventListener('close', () => {
  if ($('settings').returnValue !== 'save') return;
  const key = $('apiKey').value.trim();
  const remember = $('remember').checked;
  state.settings = { mode: $('settingsForm').mode.value, apiKey: remember ? key : '', proxyUrl: $('proxyUrl').value.trim(), accessCode: $('accessCode').value.trim(), model: $('model').value };
  state.sessionKey = remember ? '' : key;
  store.set('rc-settings', state.settings);
  render();
});

/* ---------- タブ・操作 ---------- */
function setTab(view) {
  $('tab-edit').setAttribute('aria-selected', !view); $('tab-view').setAttribute('aria-selected', view);
  ta.hidden = view; pv.hidden = !view;
  if (!view) ta.focus();
}
function setPane(name) {
  document.querySelectorAll('.side .tab').forEach(t => t.setAttribute('aria-selected', t.dataset.pane === name));
  document.querySelectorAll('.side .body').forEach(b => b.hidden = b.dataset.pane !== name);
  try { sessionStorage.setItem('rc-pane', name); } catch (_) {}
}
function flash(m) {
  m.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  m.classList.add('flash'); setTimeout(() => m.classList.remove('flash'), 1400);
}
function jump(i) {
  setTab(true);
  const x = state.issues[i]; if (!x || x.s < 0) return;
  const marks = [...pv.querySelectorAll('mark')];
  const m = marks.find(el => +el.dataset.i === i) || marks.find(el => { const y = state.issues[+el.dataset.i]; return y.s <= x.s && y.e > x.s; });
  if (m) flash(m);
}
function jumpQuote(q) {
  const loc = locate(ta.value, q); if (loc === -1) return;
  const i = state.issues.findIndex(x => x.s <= loc[0] && x.e > loc[0]);
  if (i >= 0) return jump(i);
  // 指摘のない箇所：一時的に印を付けて示す
  setTab(true);
  const text = ta.value;
  pv.innerHTML = esc(text.slice(0, loc[0])) + `<mark class="s-ai flash" id="tmpMark">${esc(text.slice(loc[0], loc[1]))}</mark>` + esc(text.slice(loc[1]));
  flash($('tmpMark')); setTimeout(render, 2500);
}

let timer;
const onEdit = () => { state.usingSample = false; clearTimeout(timer); timer = setTimeout(() => { render(); saveDraft(); }, 250); };
ta.addEventListener('input', onEdit);
['task', 'field', 'level'].forEach(id => $(id).addEventListener('input', () => { state.usingSample = false; saveDraft(); }));
['target', 'style'].forEach(id => $(id).addEventListener('input', () => { render(); saveDraft(); }));
$('tab-edit').onclick = () => setTab(false);
$('tab-view').onclick = () => setTab(true);
document.querySelectorAll('.side .tab').forEach(t => t.addEventListener('click', () => setPane(t.dataset.pane)));
$('sample').onclick = () => { ta.value = RC.SAMPLE; $('task').value = RC.SAMPLE_TASK; state.usingSample = true; render(); saveDraft(); setTab(true); };
$('clear').onclick = () => { ta.value = ''; $('task').value = ''; state.usingSample = false; render(); saveDraft(); setTab(false); };
$('chips').addEventListener('click', e => { const b = e.target.closest('.chip'); if (!b) return; state.filter = b.dataset.c || null; renderPen(ta.value); });
$('list').addEventListener('click', e => { const b = e.target.closest('.item'); if (b) jump(+b.dataset.i); });
$('evalArea').addEventListener('click', e => { const q = e.target.closest('[data-q]'); if (q) jumpQuote(q.dataset.q); });
pv.addEventListener('click', e => {
  const m = e.target.closest('mark'); if (!m || m.dataset.i == null) return;
  setPane('pen');
  const it = $('list').querySelector(`.item[data-i="${m.dataset.i}"]`);
  if (it) { it.scrollIntoView({ block: 'nearest' }); it.focus(); }
});
pv.addEventListener('dblclick', () => setTab(false));
$('openSettings').onclick = openSettings;
$('runEval').onclick = runEval;
$('stopEval').onclick = () => evalCtl && evalCtl.abort();
$('composer').addEventListener('submit', e => { e.preventDefault(); sendChat($('ask').value); });
$('suggest').addEventListener('click', e => { const b = e.target.closest('.chip'); if (b) sendChat(b.textContent); });
$('resetChat').onclick = () => { state.chatHistory = []; state.chatView = []; state.chatCostTotal = 0; renderChat(); };

loadDraft();
render(); renderChat();
let pane = 'overview'; try { pane = sessionStorage.getItem('rc-pane') || pane; } catch (_) {}
setPane(pane);
})();
