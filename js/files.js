/* ファイルから本文を取り出す（Word / OpenDocument / PDF / テキスト）。すべて端末内で処理する */
(function () {
'use strict';

const loaded = {};
function loadScript(src) {
  if (!loaded[src]) loaded[src] = new Promise((ok, ng) => {
    const s = document.createElement('script');
    s.src = src; s.onload = ok; s.onerror = () => ng(new Error('読み取り用の部品を読み込めませんでした。ネット接続を確認してください。'));
    document.head.appendChild(s);
  });
  return loaded[src];
}

class ReadError extends Error {}

/* ---------- Word（.docx） ---------- */
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
function docxParagraphs(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const out = [];
  for (const p of doc.getElementsByTagNameNS(W, 'p')) {
    let t = '';
    const walk = n => {
      for (const c of n.childNodes) {
        if (c.nodeType !== 1) continue;
        const ln = c.localName;
        if (ln === 'del' || ln === 'rt' || ln === 'instrText' || ln === 'delText') continue; // 削除履歴・ルビ・フィールド命令は除く
        if (ln === 't') t += c.textContent;
        else if (ln === 'tab') t += '　';
        else if (ln === 'br' || ln === 'cr') t += '\n';
        else if (ln === 'footnoteReference' || ln === 'endnoteReference') t += `［注${c.getAttributeNS(W, 'id')}］`;
        else if (ln !== 'p') walk(c);
      }
    };
    walk(p);
    out.push(t);
  }
  return out;
}
async function readDocx(buf) {
  await loadScript('vendor/jszip/jszip.min.js');
  let zip;
  try { zip = await window.JSZip.loadAsync(buf); } catch (_) { throw new ReadError('Wordファイルを開けませんでした。ファイルが壊れていないか確認してください。'); }
  const main = zip.file('word/document.xml');
  if (!main) throw new ReadError('Wordファイルの本文が見つかりませんでした。');
  let text = docxParagraphs(await main.async('string')).join('\n');
  // 脚注・文末脚注（出典が書かれていることが多いので末尾に付ける）
  for (const [f, label] of [['word/footnotes.xml', '脚注'], ['word/endnotes.xml', '文末脚注']]) {
    const z = zip.file(f); if (!z) continue;
    const doc = new DOMParser().parseFromString(await z.async('string'), 'application/xml');
    const notes = [];
    for (const n of doc.getElementsByTagNameNS(W, f.includes('foot') ? 'footnote' : 'endnote')) {
      const id = n.getAttributeNS(W, 'id'); if (+id <= 0) continue;
      const body = docxParagraphs(new XMLSerializer().serializeToString(n)).join(' ').trim();
      if (body) notes.push(`［注${id}］${body}`);
    }
    if (notes.length) text += `\n\n【${label}】\n` + notes.join('\n');
  }
  return text;
}

/* ---------- OpenDocument（.odt） ---------- */
const TX = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0';
async function readOdt(buf) {
  await loadScript('vendor/jszip/jszip.min.js');
  let zip;
  try { zip = await window.JSZip.loadAsync(buf); } catch (_) { throw new ReadError('ODTファイルを開けませんでした。'); }
  const f = zip.file('content.xml'); if (!f) throw new ReadError('ODTファイルの本文が見つかりませんでした。');
  const doc = new DOMParser().parseFromString(await f.async('string'), 'application/xml');
  const paras = [], notes = [];
  const inline = n => {
    let t = '';
    for (const c of n.childNodes) {
      if (c.nodeType === 3) t += c.nodeValue;
      else if (c.nodeType === 1 && c.namespaceURI === TX) {
        if (c.localName === 's') t += ' '.repeat(+c.getAttributeNS(TX, 'c') || 1);
        else if (c.localName === 'tab') t += '　';
        else if (c.localName === 'line-break') t += '\n';
        else if (c.localName === 'note') {
          const cit = c.getElementsByTagNameNS(TX, 'note-citation')[0];
          const id = cit ? cit.textContent : String(notes.length + 1);
          const body = [...c.getElementsByTagNameNS(TX, 'p')].map(inline).join(' ').trim();
          notes.push(`［注${id}］${body}`); t += `［注${id}］`;
        } else t += inline(c);
      } else if (c.nodeType === 1) t += inline(c);
    }
    return t;
  };
  const walk = n => {
    for (const c of n.childNodes) {
      if (c.nodeType !== 1) continue;
      if (c.namespaceURI === TX && (c.localName === 'p' || c.localName === 'h')) paras.push(inline(c));
      else walk(c);
    }
  };
  const body = doc.getElementsByTagNameNS('urn:oasis:names:tc:opendocument:xmlns:office:1.0', 'text')[0] || doc.documentElement;
  walk(body);
  let text = paras.join('\n');
  if (notes.length) text += '\n\n【脚注】\n' + notes.join('\n');
  return text;
}

/* ---------- PDF ---------- */
const CJK = '　-ヿ㐀-鿿＀-￯';
async function readPdf(buf) {
  await loadScript('vendor/pdfjs/pdf.min.js');
  const lib = window.pdfjsLib;
  lib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.js';
  let pdf;
  try { pdf = await lib.getDocument({ data: new Uint8Array(buf), cMapUrl: 'vendor/pdfjs/cmaps/', cMapPacked: true }).promise; }
  catch (e) {
    if (e && e.name === 'PasswordException') throw new ReadError('パスワード付きのPDFは読み取れません。');
    throw new ReadError('PDFを開けませんでした。ファイルが壊れていないか確認してください。');
  }
  const lines = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    let cur = '', lastY = null;
    for (const it of tc.items) {
      if (!('str' in it)) continue;
      const y = it.transform ? Math.round(it.transform[5]) : null;
      if (lastY !== null && y !== null && Math.abs(y - lastY) > 2 && cur) { lines.push(cur); cur = ''; }
      cur += it.str; lastY = y;
      if (it.hasEOL) { lines.push(cur); cur = ''; lastY = null; }
    }
    if (cur) lines.push(cur);
    lines.push('\f'); // ページ区切り
  }
  // 行を段落に組み直す
  const tidy = l => l.replace(new RegExp(`([${CJK}])\\s+(?=[${CJK}A-Za-z0-9])`, 'g'), '$1')
    .replace(new RegExp(`([A-Za-z0-9])\\s+(?=[${CJK}])`, 'g'), '$1').trim();
  const clean = lines.map(l => l === '\f' ? l : tidy(l))
    .filter(l => l === '\f' || (l && !/^[-–—]?\s*\d{1,3}\s*[-–—]?$/.test(l) && !/^\d{1,3}\s*\/\s*\d{1,3}$/.test(l)));
  const lens = clean.filter(l => l !== '\f').map(l => l.length).sort((a, b) => a - b);
  const full = lens.length ? lens[Math.floor(lens.length * 0.75)] : 40;
  let out = '', prev = '';
  for (const l of clean) {
    if (l === '\f') continue;
    if (!out) out = l;
    else {
      const prevEnds = /[。．！？!?」』）):：]$/.test(prev) || prev.length < full * 0.7;
      const startsNew = /^(?:[　\s]|[0-9０-９]+[.．、)）]|第[一二三四五六七八九十0-9]+|[①-⑳]|・|【|参考文献|引用文献)/.test(l);
      out += (prevEnds || startsNew) ? '\n' + l : (/[A-Za-z0-9,.]$/.test(prev) && /^[A-Za-z0-9]/.test(l) ? ' ' : '') + l;
    }
    prev = l;
  }
  if (!out.replace(/\s/g, '')) throw new ReadError('このPDFには文字情報がありません（スキャン画像のPDFは読み取れません）。元のWordファイルを使うか、文字を選択できるPDFにしてください。');
  return out;
}

/* ---------- 入口 ---------- */
async function read(file) {
  const name = file.name.toLowerCase();
  const ext = name.slice(name.lastIndexOf('.') + 1);
  if (file.size > 30 * 1024 * 1024) throw new ReadError('ファイルが大きすぎます（30MBまで）。');
  if (ext === 'txt' || ext === 'md' || ext === 'text') return normalize(await file.text());
  if (ext === 'doc') throw new ReadError('古いWord形式（.doc）は読み取れません。Wordで「名前を付けて保存」→「Word文書（.docx）」にしてから開いてください。');
  if (ext === 'pages') throw new ReadError('Pages形式は読み取れません。Pagesの「書き出す」から Word（.docx）か PDF にしてください。');
  const buf = await file.arrayBuffer();
  if (ext === 'docx' || ext === 'docm' || ext === 'dotx') return normalize(await readDocx(buf));
  if (ext === 'odt') return normalize(await readOdt(buf));
  if (ext === 'pdf') return normalize(await readPdf(buf));
  throw new ReadError('対応していない形式です。Word（.docx）、PDF、OpenDocument（.odt）、テキスト（.txt）に対応しています。');
}
function normalize(t) {
  return t.replace(/\r\n?/g, '\n').replace(/ /g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

window.RCFiles = { read, ReadError, ACCEPT: '.docx,.docm,.odt,.pdf,.txt,.md' };
})();
