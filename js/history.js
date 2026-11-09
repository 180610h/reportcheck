/* 保存した版の管理と、2つの版の前後比較 */
(function () {
'use strict';
const KEY = 'rc-versions';
const MAX = 60;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function list() { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (_) { return []; } }
function write(arr) {
  try { localStorage.setItem(KEY, JSON.stringify(arr)); return true; }
  catch (_) { return false; }
}
function add(v) {
  const arr = list();
  v.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  arr.unshift(v);
  while (arr.length > MAX) arr.pop();
  if (!write(arr)) throw new Error('保存容量がいっぱいです。古い版を削除するか、バックアップを書き出してから削除してください。');
  return v;
}
const get = id => list().find(v => v.id === id);
function remove(id) { write(list().filter(v => v.id !== id)); }
function rename(id, label) { const arr = list(); const v = arr.find(x => x.id === id); if (v) { v.label = label; write(arr); } }
function exportJSON() { return JSON.stringify({ app: 'tensaku-pen', version: 1, exportedAt: new Date().toISOString(), versions: list() }, null, 1); }
function importJSON(text) {
  let data; try { data = JSON.parse(text); } catch (_) { throw new Error('バックアップファイルを読み取れませんでした。'); }
  const incoming = Array.isArray(data) ? data : data && data.versions;
  if (!Array.isArray(incoming)) throw new Error('添削ペンのバックアップファイルではありません。');
  const arr = list(), ids = new Set(arr.map(v => v.id));
  let n = 0;
  for (const v of incoming) if (v && typeof v.text === 'string' && v.id && !ids.has(v.id)) { arr.push(v); n++; }
  arr.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  if (!write(arr.slice(0, MAX * 2))) throw new Error('保存容量が足りません。');
  return n;
}

/* ---------- 差分 ---------- */
function tokens(text) { return text.match(/[^\n。！？!?]+[。！？!?]*[」』）)]*|[。！？!?]+|\n/g) || []; }
function lcsOps(a, b, eq) {
  const n = a.length, m = b.length;
  // 先頭・末尾の一致部分は表を作らずに処理する
  let pre = 0; while (pre < n && pre < m && eq(a[pre], b[pre])) pre++;
  let suf = 0; while (suf < n - pre && suf < m - pre && eq(a[n - 1 - suf], b[m - 1 - suf])) suf++;
  const A = a.slice(pre, n - suf), B = b.slice(pre, m - suf);
  const N = A.length, M = B.length;
  const ops = [];
  for (let i = 0; i < pre; i++) ops.push(['=', a[i]]);
  if (N * M > 4e6) { A.forEach(x => ops.push(['-', x])); B.forEach(x => ops.push(['+', x])); }
  else {
    const T = new Uint16Array((N + 1) * (M + 1));
    for (let i = N - 1; i >= 0; i--) for (let j = M - 1; j >= 0; j--)
      T[i * (M + 1) + j] = eq(A[i], B[j]) ? T[(i + 1) * (M + 1) + j + 1] + 1 : Math.max(T[(i + 1) * (M + 1) + j], T[i * (M + 1) + j + 1]);
    let i = 0, j = 0;
    while (i < N && j < M) {
      if (eq(A[i], B[j])) { ops.push(['=', A[i]]); i++; j++; }
      else if (T[(i + 1) * (M + 1) + j] >= T[i * (M + 1) + j + 1]) ops.push(['-', A[i++]]);
      else ops.push(['+', B[j++]]);
    }
    while (i < N) ops.push(['-', A[i++]]);
    while (j < M) ops.push(['+', B[j++]]);
  }
  for (let i = n - suf; i < n; i++) ops.push(['=', a[i]]);
  return ops;
}
function charDiff(a, b) {
  const ops = lcsOps([...a], [...b], (x, y) => x === y);
  let h = '', run = null, buf = '';
  const flush = () => { if (!buf) return; h += run === '=' ? esc(buf) : run === '-' ? `<del>${esc(buf)}</del>` : `<ins>${esc(buf)}</ins>`; buf = ''; };
  for (const [o, c] of ops) { if (o !== run) { flush(); run = o; } buf += c; }
  flush();
  return { html: h, same: ops.filter(o => o[0] === '=').length };
}
function diff(aText, bText) {
  const ops = lcsOps(tokens(aText), tokens(bText), (x, y) => x === y);
  let html = '', added = 0, removed = 0, changed = 0;
  for (let k = 0; k < ops.length;) {
    if (ops[k][0] === '=') { html += esc(ops[k][1]); k++; continue; }
    const dels = [], ins = [];
    while (k < ops.length && ops[k][0] !== '=') { (ops[k][0] === '-' ? dels : ins).push(ops[k][1]); k++; }
    const D = dels.filter(t => t !== '\n'), I = ins.filter(t => t !== '\n');
    const pairs = Math.min(D.length, I.length);
    let used = 0;
    for (let p = 0; p < pairs; p++) {
      const cd = charDiff(D[p], I[p]);
      if (cd.same / Math.max(D[p].length, I[p].length) >= 0.35) { html += `<span class="chg">${cd.html}</span>`; changed++; used = p + 1; }
      else break;
    }
    for (const t of D.slice(used)) { html += `<del class="blk">${esc(t)}</del>`; removed++; }
    for (const t of I.slice(used)) { html += `<ins class="blk">${esc(t)}</ins>`; added++; }
    if (ins.includes('\n') || dels.includes('\n')) html += '\n';
  }
  return { html, added, removed, changed };
}

/* ---------- 比較表示 ---------- */
const CRIT = () => (window.RCAI && window.RCAI.CRITERIA) || {};
function row(label, a, b, better, fmt = x => x) {
  const has = a != null && b != null;
  const d = has ? b - a : null;
  let cls = '', arrow = '';
  if (has && d !== 0 && better) { const good = better === 'up' ? d > 0 : d < 0; cls = good ? 'good' : 'bad'; }
  if (has && d !== 0) arrow = (d > 0 ? '+' : '') + fmt(Math.round(d * 10) / 10);
  return `<tr><th>${esc(label)}</th><td>${a == null ? '–' : esc(fmt(a))}</td><td>${b == null ? '–' : esc(fmt(b))}</td><td class="${cls}">${has ? (d === 0 ? '±0' : esc(arrow)) : ''}</td></tr>`;
}
function compareHTML(a, b, depthLabels) {
  const dt = v => v.current ? '現在の本文' : `${esc(v.label || '無題')}<small>${new Date(v.at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</small>`;
  const ma = a.m, mb = b.m;
  let rows = '';
  rows += `<tr class="grp"><th colspan="4">形式</th></tr>`;
  rows += row('形式チェック', ma.score, mb.score, 'up');
  rows += row('文字数', ma.chars, mb.chars, null);
  rows += row('平均文長', ma.avgLen, mb.avgLen, null);
  rows += row('直すべき指摘', ma.issues.error, mb.issues.error, 'down');
  rows += row('直した方がよい指摘', ma.issues.warn, mb.issues.warn, 'down');
  rows += row('見直し候補', ma.issues.info, mb.issues.info, 'down');
  rows += `<tr class="grp"><th colspan="4">深さ分析</th></tr>`;
  for (const [k, label] of Object.entries(depthLabels)) rows += row(label, ma.depth[k], mb.depth[k], 'up');
  rows += `<tr class="grp"><th colspan="4">AI生成らしさ</th></tr>`;
  rows += row('文体統計（%）', ma.aiLocal, mb.aiLocal, 'down');
  rows += row('Claude判定（%）', a.ev && a.ev.ai, b.ev && b.ev.ai, 'down');
  if (a.ev || b.ev) {
    rows += `<tr class="grp"><th colspan="4">AI評価</th></tr>`;
    rows += row('総合点', a.ev && a.ev.score, b.ev && b.ev.score, 'up');
    for (const [k, label] of Object.entries(CRIT())) rows += row(label, a.ev && a.ev.crit[k], b.ev && b.ev.crit[k], 'up');
  }
  const d = diff(a.text, b.text);
  const evNote = (!a.ev || !b.ev) ? '<p class="sub">AI評価の比較は、両方の版でAI評価を実行してから保存すると表示されます。</p>' : '';
  return `<div class="cmp">
    <div class="cmp-head"><div><span class="k">比較元</span>${dt(a)}</div><span class="arrow">→</span><div><span class="k">比較先</span>${dt(b)}</div></div>
    <div class="tbl"><table><thead><tr><th></th><th>比較元</th><th>比較先</th><th>変化</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${evNote}
    <div class="cmp-sum"><span><ins>追加</ins> ${d.added}文</span><span><del>削除</del> ${d.removed}文</span><span><span class="chg">修正</span> ${d.changed}文</span></div>
    <div class="difftext">${d.html || '<span class="sub">本文の違いはありません。</span>'}</div>
  </div>`;
}

window.RCHistory = { list, add, get, remove, rename, exportJSON, importJSON, diff, compareHTML };
})();
