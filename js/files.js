/* 添付ファイルを AI に渡せる形にする。
   PDF と画像はそのまま送る（AI が直接読む）。Word / ODT は画面に出さずに中身だけ取り出して送る。 */
(function () {
'use strict';

class ReadError extends Error {}
const MB = 1024 * 1024;

const loaded = {};
function loadScript(src) {
  if (!loaded[src]) loaded[src] = new Promise((ok, ng) => {
    const s = document.createElement('script');
    s.src = src; s.onload = ok; s.onerror = () => ng(new ReadError('読み取り用の部品を読み込めませんでした。'));
    document.head.appendChild(s);
  });
  return loaded[src];
}
const toBase64 = buf => {
  const bytes = new Uint8Array(buf); let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

/* ---------- Word ---------- */
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
        if (ln === 'del' || ln === 'rt' || ln === 'instrText' || ln === 'delText') continue;
        if (ln === 't') t += c.textContent;
        else if (ln === 'tab') t += '　';
        else if (ln === 'br' || ln === 'cr') t += '\n';
        else if (ln === 'footnoteReference' || ln === 'endnoteReference') t += `［注${c.getAttributeNS(W, 'id')}］`;
        else if (ln !== 'p') walk(c);
      }
    };
    walk(p); out.push(t);
  }
  return out;
}
async function docxText(buf) {
  await loadScript('vendor/jszip/jszip.min.js');
  let zip;
  try { zip = await window.JSZip.loadAsync(buf); } catch (_) { throw new ReadError('Wordファイルを開けませんでした。ファイルが壊れていないか確認してください。'); }
  const main = zip.file('word/document.xml');
  if (!main) throw new ReadError('Wordファイルの本文が見つかりませんでした。');
  let text = docxParagraphs(await main.async('string')).join('\n');
  for (const [f, tag, label] of [['word/footnotes.xml', 'footnote', '脚注'], ['word/endnotes.xml', 'endnote', '文末脚注']]) {
    const z = zip.file(f); if (!z) continue;
    const doc = new DOMParser().parseFromString(await z.async('string'), 'application/xml');
    const notes = [];
    for (const n of doc.getElementsByTagNameNS(W, tag)) {
      const id = n.getAttributeNS(W, 'id'); if (+id <= 0) continue;
      const body = docxParagraphs(new XMLSerializer().serializeToString(n)).join(' ').trim();
      if (body) notes.push(`［注${id}］${body}`);
    }
    if (notes.length) text += `\n\n【${label}】\n` + notes.join('\n');
  }
  return text;
}

/* ---------- OpenDocument ---------- */
const TX = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0';
async function odtText(buf) {
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
          notes.push(`［注${id}］` + [...c.getElementsByTagNameNS(TX, 'p')].map(inline).join(' ').trim());
          t += `［注${id}］`;
        } else t += inline(c);
      } else if (c.nodeType === 1) t += inline(c);
    }
    return t;
  };
  const walk = n => { for (const c of n.childNodes) if (c.nodeType === 1) { if (c.namespaceURI === TX && (c.localName === 'p' || c.localName === 'h')) paras.push(inline(c)); else walk(c); } };
  walk(doc.getElementsByTagNameNS('urn:oasis:names:tc:opendocument:xmlns:office:1.0', 'text')[0] || doc.documentElement);
  let text = paras.join('\n');
  if (notes.length) text += '\n\n【脚注】\n' + notes.join('\n');
  return text;
}

/* ---------- 画像（大きい写真は縮小してから送る） ---------- */
function loadImage(file) {
  return new Promise((ok, ng) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { ok(img); setTimeout(() => URL.revokeObjectURL(url), 1000); };
    img.onerror = () => { URL.revokeObjectURL(url); ng(new ReadError('この画像を開けませんでした。JPEG・PNG・WebP で保存し直してください。')); };
    img.src = url;
  });
}
async function imageData(file) {
  const img = await loadImage(file);
  const max = 2000;
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
  const url = c.toDataURL('image/jpeg', 0.88);
  const t = document.createElement('canvas'); const ts = 160 / Math.max(c.width, c.height);
  t.width = Math.round(c.width * ts); t.height = Math.round(c.height * ts); t.getContext('2d').drawImage(c, 0, 0, t.width, t.height);
  return { data: url.split(',')[1], mediaType: 'image/jpeg', thumb: t.toDataURL('image/jpeg', 0.8) };
}

/* ---------- 入口：添付1件を AI 用に用意する ---------- */
async function prepare(file) {
  const name = file.name || '貼り付けた画像';
  const ext = (name.toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || '';
  const base = { name, size: file.size };
  if (file.type.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif'].includes(ext)) {
    if (file.size > 40 * MB) throw new ReadError(`「${name}」は大きすぎます（40MBまで）。`);
    return { ...base, kind: 'image', ...(await imageData(file)) };
  }
  if (ext === 'pdf' || file.type === 'application/pdf') {
    if (file.size > 24 * MB) throw new ReadError(`「${name}」は大きすぎます（PDFは24MBまで）。ページを分けるか、画質を下げて保存し直してください。`);
    return { ...base, kind: 'pdf', mediaType: 'application/pdf', data: toBase64(await file.arrayBuffer()) };
  }
  if (['docx', 'docm', 'dotx'].includes(ext)) return { ...base, kind: 'text', label: 'Word', text: await docxText(await file.arrayBuffer()) };
  if (ext === 'odt') return { ...base, kind: 'text', label: 'ODT', text: await odtText(await file.arrayBuffer()) };
  if (['txt', 'md', 'text'].includes(ext) || file.type.startsWith('text/')) return { ...base, kind: 'text', label: 'テキスト', text: await file.text() };
  if (ext === 'doc') throw new ReadError('古いWord形式（.doc）は読めません。Wordで「名前を付けて保存」→「Word文書（.docx）」か PDF にしてください。');
  if (ext === 'pages') throw new ReadError('Pages形式は読めません。「書き出す」から Word（.docx）か PDF にしてください。');
  throw new ReadError(`「${name}」は対応していない形式です。PDF・Word（.docx）・画像（写真）・テキストに対応しています。`);
}

window.RCFiles = { prepare, ReadError, ACCEPT: '.pdf,.docx,.docm,.odt,.txt,.md,image/*' };
})();
