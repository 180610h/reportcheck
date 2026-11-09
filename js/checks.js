/* ローカル（端末内）で動くチェック。AI を使わずに即時に結果を出す部分 */
(function () {
'use strict';

const SAMPLE_TASK = 'SNSが大学生の情報収集に与える影響について、具体的な資料に基づいて論じなさい。（2000字程度）';

const SAMPLE = `SNSが大学生の情報収集に与える影響

現代社会において、SNSは私たちの生活に欠かせない存在となっている。特に大学生にとって、SNSは様々な情報を得るための重要なツールです。

なので、本レポートではSNSが大学生の情報収集にどのような影響を与えているのかについて多角的に考察し、そのメリットとデメリットを整理したうえで、今後の大学生に求められる情報リテラシーのあり方について検討していきたいと思う。

まず、SNSのメリットとしては、情報がすぐに手に入ることが挙げられる。友達とかサークルの連絡もSNSで回ってくるので、すごく便利だ。また、ニュースもSNSで見ることが多い。

一方で、SNSには誤った情報が拡散されやすいという問題もある。実際、大学生の多くがSNS上の情報を確認せずにシェアした経験があるという調査もある。また、自分と似た意見ばかりが表示されるため、考えが偏ってしまうかもしれない。

総じて、SNSは便利な反面、注意して使うことが重要であると言えるでしょう。情報の真偽を確かめる姿勢が今後ますます求められる！`;

const RULES = [
  // 話し言葉
  {cat:'話し言葉',sev:'warn',re:/(?<=(?:^|[。！？\n])[\s　]*)(なので|だから|でも|けど|だけど|あと|じゃあ)[、,]?/g,label:'文頭の話し言葉',tip:'文頭は「そのため」「したがって」「しかし」「また」などに。'},
  {cat:'話し言葉',sev:'warn',re:/とか/g,label:'「とか」',tip:'「や」「など」に置き換えます。'},
  {cat:'話し言葉',sev:'warn',re:/すごく|すごい|めっちゃ|めちゃくちゃ|超[^過越音特]|ヤバ|やば/g,label:'くだけた強調',tip:'「非常に」「大きく」、または数値や具体例で程度を示します。'},
  {cat:'話し言葉',sev:'warn',re:/やっぱり|やっぱ|ちゃんと|いろんな|いっぱい|全然|ぶっちゃけ|みたいな|ちょっと/g,label:'口語の語彙',tip:'「やはり」「きちんと」「様々な」「多くの」「まったく」「少し」など書き言葉に。'},
  {cat:'話し言葉',sev:'warn',re:/じゃない|っていう|(?<![にとおいよ])って(?=思|言)|んです|んだ(?=[。、])/g,label:'話し言葉の語尾',tip:'「ではない」「という」「のである」などに直します。'},
  {cat:'話し言葉',sev:'info',re:/友達|親友|ネット(?!ワーク)|スマホ|バイト/g,label:'くだけた名詞',tip:'「友人」「インターネット」「スマートフォン」「アルバイト」などが無難です。'},
  // AIっぽさ（決まり文句）
  {cat:'AIっぽさ',sev:'info',re:/様々な|さまざまな|多様な/g,label:'「様々な」',tip:'何が「様々」なのか、具体的に2〜3個挙げると説得力が出ます。'},
  {cat:'AIっぽさ',sev:'info',re:/(?:欠かせない|不可欠な?|重要な(?:役割|ツール|存在)|重要である|重要です|鍵(?:となる|を握る)|カギ(?:となる|を握る))/g,label:'「重要」系の決まり文句',tip:'なぜ重要なのか、根拠（データ・事例）を一文添えるか、具体的な主張に言い換えます。'},
  {cat:'AIっぽさ',sev:'info',re:/多角的|多面的|包括的|総合的/g,label:'中身のない「多角的」',tip:'実際にどの観点から見たのかを書けば、この言葉は不要になります。'},
  {cat:'AIっぽさ',sev:'info',re:/と言えるでしょう|と言えるだろう|と言えよう|ではないでしょうか|ではないだろうか/g,label:'ぼかした締め',tip:'自分の主張として「〜と考える」「〜である」と言い切れるか検討します。'},
  {cat:'AIっぽさ',sev:'info',re:/総じて|まとめると|結論として|以上のことから|このように/g,label:'定型のまとめ句',tip:'使ってよいですが、直後に新しい自分の結論が来ているか確認します。'},
  {cat:'AIっぽさ',sev:'info',re:/(?:ますます|今後(?:さらに|一層))?求められ(?:る|ている)/g,label:'「求められる」',tip:'誰に、何が、なぜ求められるのかを具体的に。'},
  {cat:'AIっぽさ',sev:'info',re:/現代社会において|現代社会では|近年、|昨今/g,label:'お決まりの書き出し',tip:'「近年」なら何年頃からか、統計や出来事で示すと具体的になります。'},
  {cat:'AIっぽさ',sev:'info',re:/(?:メリット|利点)と(?:デメリット|欠点|課題)|光と影|諸刃の剣|便利な反面/g,label:'両論併記の型',tip:'両方並べるだけで終わらず、どちらを重く見るのか自分の立場を示します。'},
  // 曖昧さ
  {cat:'曖昧さ',sev:'info',re:/と思う|と思います|と思った|と思われる|と感じる|と感じた/g,label:'「思う」「感じる」',tip:'レポートでは「〜と考える」「〜と考えられる」が基本。根拠があれば言い切ります。'},
  {cat:'曖昧さ',sev:'info',re:/かもしれない|かもしれません|気がする|ような気|のではないか/g,label:'推量のぼかし',tip:'根拠があるなら言い切り、ないなら根拠を足します。'},
  {cat:'曖昧さ',sev:'warn',re:/(?:という|との)(?:調査|研究|データ|報告|指摘)(?:も|が)ある|(?:多く|大半|ほとんど)の(?:人|学生|大学生)が|と言われている|と言われる/g,label:'出典のない根拠',tip:'誰の調査か（著者・年・機関）を本文中に示し、参考文献に載せます。'},
  // 表記
  {cat:'表記',sev:'warn',re:/[！？!?]/g,label:'感嘆符・疑問符',tip:'レポートでは原則使いません。問いかけは「〜だろうか。」で。'},
  {cat:'表記',sev:'info',re:/[Ａ-Ｚａ-ｚ０-９]+/g,label:'全角英数字',tip:'英数字は半角に統一するのが一般的です。'},
  {cat:'表記',sev:'warn',re:/[、。，．]{2,}/g,label:'句読点の重複',tip:'句読点が続いています。'},
  {cat:'表記',sev:'info',re:/(?:…|・・・|\.\.\.|〜〜|ｗ|（笑）|\(笑\))/g,label:'くだけた記号',tip:'レポートには不向きな記号です。'},
];

const DESU = /(です|ます|ました|でした|ません|でしょう|ましょう|ください)[」』）)]*[。！？!?]$/;
const len = s => s.replace(/\s/g, '').length;
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const count = (re, t) => (t.match(re) || []).length;

function segment(text) {
  const out = []; let start = 0, depth = 0;
  const push = (s, e) => {
    while (s < e && /\s/.test(text[s])) s++;
    while (e > s && /\s/.test(text[e - 1])) e--;
    if (e > s) { const t = text.slice(s, e); out.push({ s, e, t, ended: /[。！？!?]$/.test(t) }); }
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if ('「『（(【'.includes(c)) depth++;
    else if ('」』）)】'.includes(c)) depth = Math.max(0, depth - 1);
    if (c === '\n') { push(start, i); start = i + 1; depth = 0; }
    else if (depth === 0 && '。！？!?'.includes(c)) { push(start, i + 1); start = i + 1; }
  }
  push(start, text.length);
  return out;
}

function analyze(text, styleSetting) {
  const out = [];
  const sents = segment(text);
  const body = sents.filter(s => s.ended);
  for (const r of RULES) {
    r.re.lastIndex = 0;
    for (const m of text.matchAll(r.re)) {
      if (!m[0]) continue;
      out.push({ s: m.index, e: m.index + m[0].length, cat: r.cat, sev: r.sev, label: r.label, tip: r.tip });
    }
  }
  // 文体
  const desu = body.filter(s => DESU.test(s.t)), dearu = body.filter(s => !DESU.test(s.t));
  let mode = styleSetting;
  if (mode === 'auto') mode = desu.length > dearu.length ? 'desu' : 'dearu';
  const wrong = mode === 'desu' ? dearu : desu;
  if ((desu.length && dearu.length) || styleSetting !== 'auto') {
    for (const s of wrong) {
      const m = s.t.match(/[^、。]{0,8}[。！？!?]$/);
      out.push({ s: s.e - (m ? m[0].length : 1), e: s.e, cat: '文体', sev: 'error',
        label: mode === 'desu' ? 'です・ます調に混ざった常体' : 'だ・である調に混ざった敬体',
        tip: mode === 'desu' ? '文末を「です・ます」にそろえます。' : '文末を「だ・である」にそろえます（例：重要です→重要である）。' });
    }
  }
  // 文の長さ・読点
  for (const s of body) {
    const L = len(s.t), commas = count(/[、，]/g, s.t);
    if (L > 100) out.push({ s: s.s, e: s.e, cat: '読みやすさ', sev: 'warn', label: `長すぎる文（${L}字）`, tip: '1文はおおむね60〜80字以内に。「〜し、〜して、〜ので」の途中で文を切ります。', whole: true });
    else if (L > 80) out.push({ s: s.s, e: s.e, cat: '読みやすさ', sev: 'info', label: `やや長い文（${L}字）`, tip: '2文に分けられないか検討します。', whole: true });
    if (L > 55 && commas === 0) out.push({ s: s.s, e: s.e, cat: '読みやすさ', sev: 'info', label: '読点がない長い文', tip: '意味の切れ目に「、」を入れます。', whole: true });
  }
  // 文末の単調さ・接続詞の連続
  const tail = x => x.t.replace(/[」』）)]*[。！？!?]$/, '').slice(-2);
  for (let i = 2; i < body.length; i++) {
    if (tail(body[i]) === tail(body[i - 1]) && tail(body[i]) === tail(body[i - 2]))
      out.push({ s: body[i].e - 3, e: body[i].e, cat: '読みやすさ', sev: 'info', label: `同じ文末が3回連続（〜${tail(body[i])}。）`, tip: '文末に変化をつけると単調さが消えます。' });
  }
  const CONJ = /^(また|さらに|そして|しかし|一方で|つまり|まず|次に)/;
  for (let i = 1; i < body.length; i++) {
    const a = body[i - 1].t.match(CONJ), b = body[i].t.match(CONJ);
    if (a && b && a[1] === b[1]) out.push({ s: body[i].s, e: body[i].s + b[1].length, cat: '読みやすさ', sev: 'info', label: `接続詞「${b[1]}」の連続`, tip: '同じ接続詞が続いています。' });
  }
  out.sort((a, b) => a.s - b.s || b.e - a.e);
  return { issues: out, sents, body, mode, desu: desu.length, dearu: dearu.length };
}

function docChecks(text, res, target) {
  const chars = len(text);
  const paras = text.split(/\n/).filter(l => /[。！？]/.test(l)).length;
  const refHead = text.search(/(?:^|\n)\s*(?:参考文献|引用文献|参考資料|References|Bibliography)/i);
  const hasRefs = refHead >= 0;
  const refCount = hasRefs ? text.slice(refHead).split('\n').slice(1).filter(l => l.trim().length > 8).length : 0;
  const inTextCount = count(/[（(][^（()）\n]{1,40}[,，、]\s*(?:19|20)\d{2}[a-z]?[^）)]{0,12}[）)]|[（(](?:19|20)\d{2}[）)]|\[\d+\]/g, text);
  const own = /(?:私|筆者|自分)は[^。]{0,60}(?:考え|主張|見解|立場)|と考える|べきである|と主張する/.test(text);
  const concl = /(?:^|\n)\s*(?:おわりに|結論|まとめ|結び)|以上(?:の|から)|本(?:レポート|稿)では[^。]*(?:明らかに|示した|述べた)/.test(text);
  const out = [];
  let lenState = 'pass', lenNote = `${chars}字`;
  if (target) {
    const r = chars / target;
    if (r < 0.8) { lenState = 'fail'; lenNote = `${chars}字 / 目標${target}字（あと${target - chars}字）`; }
    else if (r < 0.9 || r > 1.1) { lenState = 'part'; lenNote = `${chars}字 / 目標${target}字（目安の±10%から外れています）`; }
    else lenNote = `${chars}字 / 目標${target}字`;
  }
  out.push({ state: lenState, label: '文字数', note: lenNote });
  out.push({ state: res.desu && res.dearu ? 'fail' : 'pass', label: '文体の統一', note: res.desu && res.dearu ? `だ・である調${res.dearu}文、です・ます調${res.desu}文が混在` : (res.mode === 'desu' ? 'です・ます調でそろっています' : 'だ・である調でそろっています') });
  out.push({ state: hasRefs && inTextCount ? 'pass' : hasRefs || inTextCount ? 'part' : 'fail', label: '出典・参考文献',
    note: hasRefs && inTextCount ? `本文中の引用 ${inTextCount}箇所・参考文献 ${refCount}件` : hasRefs ? '参考文献リストはありますが、本文中の引用表示（著者, 年）が見当たりません' : inTextCount ? '本文中の引用はありますが、末尾に参考文献リストがありません' : '出典が見当たりません。調査やデータに触れるなら必須です' });
  out.push({ state: own ? 'pass' : 'fail', label: '自分の考え', note: own ? '自分の主張・考察が書かれています' : '「私は〜と考える」のような自分の主張が見当たりません' });
  out.push({ state: paras >= 4 && concl ? 'pass' : paras >= 3 ? 'part' : 'fail', label: '構成（序論・本論・結論）', note: `段落 ${paras}つ` + (concl ? '・結論部あり' : '・明確な結論の見出しや締めの一文がありません') });
  return { list: out, chars, paras, target, refCount, inTextCount };
}

/* 深さの指標：1000字あたりの出現密度を 0〜100 に飽和させて表示する */
const DEPTH = [
  { key: 'specificity', label: '具体性', k: 10,
    f: t => count(/\d+(?:\.\d+)?\s*(?:%|％|割|人|件|年|円|倍|時間|分|歳|名|校|社|か国|ヶ国|万|億)|(?:19|20)\d{2}年/g, t) + count(/例えば|たとえば|具体的には|実際に|事例|ケース/g, t) + 0.5 * count(/「[^」]{2,40}」/g, t) + 0.25 * new Set(t.match(/[ァ-ヴ][ァ-ヴー]{3,}|[A-Z][A-Za-z]{1,}/g) || []).size,
    tip: '数値・年・固有名詞・具体例の量。抽象語だけでなく「何が」「どれくらい」を示す。' },
  { key: 'evidence', label: '根拠の提示', k: 6,
    f: t => count(/なぜなら|その理由は|理由として|ためである|からである|によると|によれば|調査|データ|統計|報告書|研究|文献|[（(][^）)]{1,30}\d{4}[^）)]{0,10}[）)]/g, t),
    tip: '主張に対して、理由・データ・文献が示されているか。' },
  { key: 'analysis', label: '分析（因果・比較）', k: 7,
    f: t => count(/要因|原因|背景|結果として|その結果|相関|比較|傾向|なぜ|メカニズム|構造|によって|に起因|差異|違い/g, t),
    tip: '現象を並べるだけでなく、原因・比較・仕組みに踏み込んでいるか。' },
  { key: 'perspective', label: '多角的な検討', k: 4,
    f: t => count(/確かに|もっとも|他方|反対に|ただし|しかしながら|反論|批判|限界|異なる立場|対照的|とはいえ|逆に/g, t),
    tip: '反対の立場・例外・限界に触れ、それに応答しているか。' },
  { key: 'discussion', label: '考察・解釈', k: 5,
    f: t => count(/と考える|と考えられる|示唆|意味する|つまり|すなわち|このことから|以上から|解釈|含意|と言える(?!でしょう)|と推察/g, t),
    tip: '事実から何が言えるのか、自分の解釈を述べているか。' },
  { key: 'originality', label: '自分の主張', k: 3,
    f: t => count(/(?:私|筆者|自分)(?:は|が|として)|本(?:レポート|稿)では|と主張する|べきである|提案する|筆者の考え/g, t),
    tip: '問いに対する自分の答え（立場）がはっきりしているか。' },
];

function depth(text) {
  const chars = Math.max(1, len(text));
  return DEPTH.map(d => {
    const n = d.f(text);
    const per = n * 1000 / chars;
    const score = Math.round(100 * (1 - Math.exp(-per / d.k)));
    return { key: d.key, label: d.label, tip: d.tip, n: Math.round(n * 10) / 10, per: Math.round(per * 10) / 10, score };
  });
}

/* 文体統計による「AI生成らしさ」の推定（透明性のため特徴量ごとに表示する） */
function aiLocal(text, res, issues, depthList) {
  const chars = len(text), body = res.body;
  if (chars < 300 || body.length < 6) return { percent: null, reason: '300字・6文以上で推定できます' };
  const L = body.map(s => len(s.t));
  const mean = L.reduce((a, b) => a + b, 0) / L.length;
  const sd = Math.sqrt(L.reduce((a, b) => a + (b - mean) ** 2, 0) / L.length);
  const cv = sd / mean;
  const aiHits = issues.filter(x => x.cat === 'AIっぽさ').length;
  const dens = aiHits * 1000 / chars;
  const ends = {};
  body.forEach(s => { const k = s.t.replace(/[」』）)]*[。！？!?]$/, '').slice(-2); ends[k] = (ends[k] || 0) + 1; });
  const topEnd = Math.max(...Object.values(ends)) / body.length;
  const conjR = body.filter(s => /^(まず|また|さらに|加えて|一方で|そして|次に|最後に|このように|したがって|以上のことから|総じて|つまり)/.test(s.t)).length / body.length;
  const human = issues.filter(x => x.cat === '話し言葉' || (x.cat === '表記' && /重複|全角/.test(x.label))).length;
  const spec = (depthList.find(d => d.key === 'specificity') || { score: 50 }).score;
  const personal = /(?:私|筆者|自分)(?:自身)?(?:は|が|の)[^。]{0,40}(?:経験|体験|した|感じた|見た|聞いた|アルバイト|授業|ゼミ)|実際に私/.test(text);
  const F = [
    { label: '文の長さが均一', w: .24, s: clamp((0.6 - cv) / 0.35), v: `変動係数 ${cv.toFixed(2)}`, note: '人の文章は短い文と長い文が混ざりやすい' },
    { label: '決まり文句の密度', w: .24, s: clamp(dens / 5), v: `1000字あたり ${dens.toFixed(1)}`, note: '「様々な」「重要である」「総じて」など' },
    { label: '文末の単調さ', w: .14, s: clamp((topEnd - 0.25) / 0.4), v: `最多の文末が ${Math.round(topEnd * 100)}%`, note: '同じ語尾がくり返される' },
    { label: '接続詞で始まる文', w: .14, s: clamp((conjR - 0.15) / 0.3), v: `${Math.round(conjR * 100)}%`, note: '「まず」「また」「さらに」で整然と並べる' },
    { label: '具体性の低さ', w: .12, s: clamp(1 - spec / 100), v: `具体性 ${spec}`, note: '数値・固有名詞・事例が少ない' },
    { label: '個人の経験がない', w: .06, s: personal ? 0 : 1, v: personal ? 'あり' : 'なし', note: '自分の体験や観察への言及' },
    { label: '話し言葉・表記ゆれがない', w: .06, s: human ? 0 : 1, v: human ? `${human}箇所あり` : 'なし', note: '人の下書きには小さな崩れが残りやすい' },
  ];
  const p = F.reduce((a, f) => a + f.w * f.s, 0);
  return { percent: Math.round(5 + 90 * p), features: F };
}

window.RC = { SAMPLE, SAMPLE_TASK, analyze, docChecks, depth, aiLocal, segment, len, clamp };
})();
