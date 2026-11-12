/**
 * 恋愛の家庭教師｜Instagram分析シート
 *
 * Instagram API（Instagramログイン）から投稿・アカウントの数字を取得し、
 * Googleスプレッドシートに自動で記録します。
 *
 * - 青い見出しの列 … スクリプトが自動で書き込む列
 * - 黄色い見出しの列 … 手で入力する列（スクリプトは上書きしません）
 *
 * 使い方は README.md を見てください。
 */

// ===== 設定 =====
const API_VERSION = 'v23.0';
const API_BASE = 'https://graph.instagram.com/' + API_VERSION;
const TZ = 'Asia/Tokyo';
const DAY_MS = 24 * 60 * 60 * 1000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

const PROP_TOKEN = 'IG_TOKEN';
const PROP_TOKEN_REFRESHED = 'IG_TOKEN_REFRESHED';
const PROP_FORM_ID = 'FORM_ID';

const SHEET = {
  POSTS: '投稿データ',
  DAILY: 'アカウント日次',
  FUNNEL: '導線（週次）',
  CONSULT: '相談記録',
  COMMENTS: 'コメント',
  AUDIENCE: 'フォロワー属性',
  OPTIONS: '選択肢',
  LOG: 'ログ',
};

const COLOR_AUTO = '#cfe2f3';
const COLOR_MANUAL = '#fff2cc';
const COLOR_FORMULA = '#d9ead3';

// 列の定義 … type: auto=自動 / manual=手入力 / formula=数式
const COLS = {};
COLS[SHEET.POSTS] = [
  { label: '投稿ID', type: 'auto', format: '@' },
  { label: '投稿日', type: 'auto', format: 'yyyy/mm/dd hh:mm' },
  { label: '種類', type: 'auto' },
  { label: 'URL', type: 'auto' },
  { label: 'キャプション1行目', type: 'auto' },
  { label: '冒頭テロップ', type: 'manual', note: 'リールの最初に出る文字をそのまま入力' },
  { label: 'カバー文字', type: 'manual', note: 'カバー画像（サムネイル）の文字。テロップと同じなら空欄でOK' },
  { label: 'テロップ文字数', type: 'auto', format: '0' },
  { label: '型', type: 'manual', options: '型' },
  { label: '悩みテーマ', type: 'manual', options: '悩みテーマ' },
  { label: '自分ごと感', type: 'manual', options: '自分ごと感', note: '1=一般論 / 2=場面がある / 3=具体的な場面＋「〜な人へ」などの呼びかけ' },
  { label: '感情', type: 'manual', options: '感情' },
  { label: 'ブランドNG表現', type: 'manual', checkbox: true, note: '「脈あり確定」「落とす」「絶対モテる」など、断定・攻略寄りの言葉があればチェック。伸びていても勝ちパターンに入れない' },
  { label: '再生数', type: 'auto', format: '#,##0' },
  { label: 'リーチ', type: 'auto', format: '#,##0' },
  { label: 'いいね', type: 'auto', format: '#,##0' },
  { label: 'コメント', type: 'auto', format: '#,##0' },
  { label: '保存', type: 'auto', format: '#,##0' },
  { label: 'シェア', type: 'auto', format: '#,##0' },
  { label: '保存率', type: 'auto', format: '0.0%', note: '保存 ÷ リーチ' },
  { label: 'シェア率', type: 'auto', format: '0.0%', note: 'シェア ÷ リーチ' },
  { label: '平均視聴秒数', type: 'auto', format: '0.0' },
  { label: '3秒維持率', type: 'manual', format: '0%', note: 'アプリのインサイトで確認して入力（例: 45%）' },
  { label: 'スキップ率(取れれば)', type: 'auto', note: 'APIで取得できた場合のみ入ります' },
  { label: 'プロフアクセス(取れれば)', type: 'auto', format: '#,##0', note: '投稿の種類によってはAPIで取れません。取れない場合はアプリで確認して「メモ」へ' },
  { label: 'フォロー(取れれば)', type: 'auto', format: '#,##0' },
  { label: '相談につながった数', type: 'auto', format: '0', note: '「相談記録」シートの「見た動画」にこの投稿のURLが入っている件数' },
  { label: 'メモ', type: 'manual' },
  { label: '最終更新', type: 'auto', format: 'yyyy/mm/dd hh:mm' },
];

COLS[SHEET.DAILY] = [
  { label: '日付', type: 'auto', format: 'yyyy/mm/dd' },
  { label: 'フォロワー数', type: 'auto', format: '#,##0', note: '毎朝の取得時点の人数' },
  { label: 'フォロワー増減', type: 'auto', format: '+#,##0;-#,##0;0' },
  { label: 'リーチ', type: 'auto', format: '#,##0' },
  { label: '再生数', type: 'auto', format: '#,##0' },
  { label: '反応したアカウント数', type: 'auto', format: '#,##0' },
  { label: '合計反応数', type: 'auto', format: '#,##0' },
  { label: 'プロフィール閲覧(取れれば)', type: 'auto', format: '#,##0' },
  { label: 'リンク等タップ(参考)', type: 'auto', format: '#,##0', note: 'APIの profile_links_taps。プロフィールのURLリンクのタップが含まれない場合があるため参考値。LPの閲覧数のほうを正とします' },
];

COLS[SHEET.FUNNEL] = [
  { label: '週（月曜はじまり）', type: 'auto', format: 'yyyy/mm/dd' },
  { label: 'リーチ合計', type: 'auto', format: '#,##0', note: '日別リーチの合計（同じ人が重複して数えられます）' },
  { label: '再生数合計', type: 'auto', format: '#,##0' },
  { label: 'プロフィール閲覧合計', type: 'auto', format: '#,##0' },
  { label: 'フォロワー増減', type: 'auto', format: '+#,##0;-#,##0;0' },
  { label: 'LP閲覧数', type: 'manual', format: '#,##0', note: 'Googleアナリティクスなどで確認して入力' },
  { label: '診断回答数', type: 'auto', format: '#,##0', note: '診断フォームを連携すると自動で入ります' },
  { label: 'LINE追加（LP経由）', type: 'manual', format: '#,##0', note: 'LINE公式アカウントの「流入経路分析」で確認' },
  { label: 'LINE追加（診断経由）', type: 'manual', format: '#,##0' },
  { label: 'LINE追加（その他）', type: 'manual', format: '#,##0' },
  { label: 'LINE追加合計', type: 'formula', format: '#,##0' },
  { label: '相談開始数', type: 'auto', format: '#,##0', note: '「相談記録」シートの件数（目標: 月10人）' },
  { label: 'LP到達率', type: 'formula', format: '0.0%', note: 'LP閲覧 ÷ プロフィール閲覧（取れない場合は ÷ リーチ）' },
  { label: 'LINE追加率', type: 'formula', format: '0.0%', note: 'LINE追加合計 ÷ (LP閲覧＋診断回答)' },
  { label: '相談率', type: 'formula', format: '0.0%', note: '相談開始 ÷ LINE追加合計' },
  { label: 'メモ', type: 'manual' },
];

COLS[SHEET.CONSULT] = [
  { label: '相談日', type: 'manual', format: 'yyyy/mm/dd', note: '名前やLINEの表示名は書かないでください' },
  { label: '経路', type: 'manual', options: '相談の経路' },
  { label: '見た動画', type: 'manual', note: '「どの動画を見て来ましたか？」と聞いて、投稿のURLを貼る（分からなければ空欄）' },
  { label: '悩みテーマ', type: 'manual', options: '悩みテーマ' },
  { label: '相談者の言葉（そのまま）', type: 'manual', note: 'タイトル作りの材料になります。個人が特定できる部分は省いてください' },
  { label: '状況・アドバイスした一歩', type: 'manual' },
  { label: '継続して相談したいか', type: 'manual', options: '継続意向' },
  { label: '学び・メモ', type: 'manual', note: 'どこまで相談すると役に立てたか、伝わった言葉など' },
];

COLS[SHEET.COMMENTS] = [
  { label: 'コメントID', type: 'auto', format: '@' },
  { label: '投稿ID', type: 'auto', format: '@' },
  { label: '投稿のタイトル', type: 'auto' },
  { label: '日時', type: 'auto', format: 'yyyy/mm/dd hh:mm' },
  { label: '本文', type: 'auto' },
  { label: '悩みテーマ', type: 'manual', options: '悩みテーマ' },
  { label: 'タイトルに使えそうな言葉', type: 'manual' },
];

COLS[SHEET.AUDIENCE] = [
  { label: '取得日', type: 'auto', format: 'yyyy/mm/dd' },
  { label: '区分', type: 'auto' },
  { label: '項目', type: 'auto' },
  { label: '人数', type: 'auto', format: '#,##0' },
  { label: '割合', type: 'auto', format: '0.0%' },
];

COLS[SHEET.LOG] = [
  { label: '日時', type: 'auto', format: 'yyyy/mm/dd hh:mm:ss' },
  { label: '種別', type: 'auto' },
  { label: '内容', type: 'auto' },
];

const OPTIONS = {
  '型': ['質問型（このLINEどう返す？）', '場面型（バイト先の子を誘いたい 等）', 'あるある型', 'NG→OK型', 'はるの体験型', '相談回答型（この相談なら僕はこう考えます）', '診断・タイプ型', '数字型（3つの〜）', 'その他'],
  '悩みテーマ': ['LINEの送り方・返し方', '返信待ち・脈なし不安', 'デートの誘い方', '2人きりの会話・沈黙', 'デート当日', 'デート後の振り返り', '友達止まり', '距離の縮め方', '自信のなさ・考えすぎ', 'その他'],
  '自分ごと感': ['1', '2', '3'],
  '感情': ['寄り添い（共感）', '解決（すぐ使える）', '両方'],
  '相談の経路': ['Instagram→LP', 'Instagram→診断', 'InstagramのDM', 'その他'],
  '継続意向': ['はい', 'たぶん', 'いいえ', '未確認'],
};

// 投稿のインサイト指標。core はまとめて取得、optional は1つずつ試す
const MEDIA_METRICS = {
  REELS: {
    core: ['views', 'reach', 'likes', 'comments', 'saved', 'shares', 'ig_reels_avg_watch_time'],
    optional: ['reels_skip_rate', 'profile_visits', 'follows'],
  },
  FEED: {
    core: ['views', 'reach', 'likes', 'comments', 'saved', 'shares'],
    optional: ['profile_visits', 'follows'],
  },
};
const ACCOUNT_DAY_METRICS = ['reach', 'views', 'accounts_engaged', 'total_interactions', 'profile_views', 'profile_links_taps'];

// ===== メニュー =====
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Instagram分析')
    .addItem('① 初期設定（シートを作る）', 'setupSheets')
    .addItem('② アクセストークンを登録', 'promptToken')
    .addItem('③ 今すぐデータを取得', 'fetchAllManual')
    .addItem('④ 過去28日分の日次データを取り込む', 'backfillDailyManual')
    .addItem('⑤ 毎日の自動取得をオンにする', 'installTriggers')
    .addSeparator()
    .addItem('診断フォーム（Googleフォーム）を連携', 'promptFormUrl')
    .addItem('自動取得をオフにする', 'removeTriggers')
    .addToUi();
}

// ===== 初期設定 =====
function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetTimeZone(TZ);

  setupOptionsSheet_(ss);
  [SHEET.POSTS, SHEET.DAILY, SHEET.FUNNEL, SHEET.CONSULT, SHEET.COMMENTS, SHEET.AUDIENCE, SHEET.LOG].forEach(function (name) {
    ensureSheet_(ss, name);
  });

  // 最初からある「シート1」が空なら削除
  ['シート1', 'Sheet1'].forEach(function (n) {
    const s = ss.getSheetByName(n);
    if (s && s.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s);
  });

  ss.setActiveSheet(ss.getSheetByName(SHEET.POSTS));
  alert_('シートを作成しました。\n\n青い見出し＝自動で入る列\n黄色い見出し＝手で入力する列\n緑の見出し＝自動で計算される列\n\n次は「② アクセストークンを登録」に進んでください。');
}

function setupOptionsSheet_(ss) {
  let sheet = ss.getSheetByName(SHEET.OPTIONS);
  if (sheet) return; // 既にあればユーザーの編集を尊重して触らない
  sheet = ss.insertSheet(SHEET.OPTIONS);
  const keys = Object.keys(OPTIONS);
  const maxLen = Math.max.apply(null, keys.map(function (k) { return OPTIONS[k].length; }));
  const values = [keys];
  for (let i = 0; i < maxLen; i++) {
    values.push(keys.map(function (k) { return OPTIONS[k][i] || ''; }));
  }
  sheet.getRange(1, 1, values.length, keys.length).setValues(values);
  sheet.getRange(1, 1, 1, keys.length).setFontWeight('bold').setBackground(COLOR_MANUAL);
  sheet.setFrozenRows(1);
  sheet.getRange(1, keys.length + 2).setValue('※ 選択肢は自由に追加・変更できます（各列の下に追記）');
}

function ensureSheet_(ss, name) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  const defs = COLS[name];
  const existing = sheet.getLastColumn() > 0 ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String) : [];
  let nextCol = existing.filter(function (v) { return v !== ''; }).length === 0 ? 1 : sheet.getLastColumn() + 1;

  defs.forEach(function (def) {
    let col = existing.indexOf(def.label) + 1;
    if (col === 0) {
      col = nextCol++;
      ensureCols_(sheet, col);
      sheet.getRange(1, col).setValue(def.label);
    }
    const head = sheet.getRange(1, col);
    head.setFontWeight('bold').setBackground(def.type === 'auto' ? COLOR_AUTO : def.type === 'formula' ? COLOR_FORMULA : COLOR_MANUAL);
    if (def.note) head.setNote(def.note);
    const body = sheet.getRange(2, col, sheet.getMaxRows() - 1, 1);
    if (def.format) body.setNumberFormat(def.format);
    if (def.options) {
      const optRange = optionRange_(ss, def.options);
      if (optRange) {
        body.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInRange(optRange, true).setAllowInvalid(true).build());
      }
    }
    // 値を入れずにチェックボックスの入力規則だけ付ける（空行が「データあり」扱いにならないように）
    if (def.checkbox) body.setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
  });
  sheet.setFrozenRows(1);
  return sheet;
}

function optionRange_(ss, key) {
  const sheet = ss.getSheetByName(SHEET.OPTIONS);
  if (!sheet) return null;
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const col = headers.indexOf(key) + 1;
  if (col === 0) return null;
  return sheet.getRange(2, col, 200, 1);
}

// ===== トークン =====
function promptToken() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt('アクセストークンを登録', 'Metaの開発者画面で発行したInstagramのアクセストークンを貼り付けてください。\n（このスプレッドシートのスクリプト設定にだけ保存されます）', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const token = res.getResponseText().trim();
  if (!token) return;
  PropertiesService.getScriptProperties().setProperty(PROP_TOKEN, token);
  PropertiesService.getScriptProperties().setProperty(PROP_TOKEN_REFRESHED, new Date().toISOString());
  try {
    const me = getMe_();
    alert_('接続できました！\nアカウント: @' + me.username + '\nフォロワー: ' + me.followers_count + '人\n投稿数: ' + me.media_count + '件\n\n次は「③ 今すぐデータを取得」を押してください。');
  } catch (e) {
    alert_('トークンは保存しましたが、接続に失敗しました。\n\n' + e.message + '\n\nトークンが正しいか、権限（instagram_business_basic / instagram_business_manage_insights / instagram_business_manage_comments）が付いているか確認してください。');
  }
}

function getToken_() {
  const t = PropertiesService.getScriptProperties().getProperty(PROP_TOKEN);
  if (!t) throw new Error('アクセストークンが未登録です。メニューの「② アクセストークンを登録」から登録してください。');
  return t;
}

/** 長期トークン（60日）を延長する。トリガーで週1回実行 */
function refreshToken() {
  try {
    const url = 'https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=' + encodeURIComponent(getToken_());
    const body = fetchJson_(url);
    if (!body.access_token) throw new Error('新しいトークンが返ってきませんでした');
    const props = PropertiesService.getScriptProperties();
    props.setProperty(PROP_TOKEN, body.access_token);
    props.setProperty(PROP_TOKEN_REFRESHED, new Date().toISOString());
    log_('INFO', 'アクセストークンを延長しました（有効期限: 約' + Math.round((body.expires_in || 0) / 86400) + '日）');
  } catch (e) {
    log_('ERROR', 'アクセストークンの延長に失敗: ' + e.message + ' → 期限切れの場合はMetaの開発者画面で再発行し、「② アクセストークンを登録」してください');
    throw e;
  }
}

// ===== API =====
function buildUrl_(path, params) {
  const q = Object.assign({}, params || {}, { access_token: getToken_() });
  const qs = Object.keys(q).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(q[k]); }).join('&');
  return API_BASE + path + '?' + qs;
}

function fetchJson_(url) {
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  const code = res.getResponseCode();
  let body = {};
  try { body = JSON.parse(res.getContentText() || '{}'); } catch (e) { body = {}; }
  if (code >= 400 || body.error) {
    // URLにはトークンが含まれるので、エラーメッセージにURLは入れない
    const msg = body.error ? (body.error.message || JSON.stringify(body.error)) : 'HTTP ' + code;
    const err = new Error(msg);
    err.apiError = body.error;
    throw err;
  }
  return body;
}

function getMe_() {
  return fetchJson_(buildUrl_('/me', { fields: 'user_id,username,followers_count,media_count' }));
}

function fetchAllMedia_() {
  let url = buildUrl_('/me/media', {
    fields: 'id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count',
    limit: 50,
  });
  const out = [];
  while (url && out.length < 2000) {
    const body = fetchJson_(url);
    Array.prototype.push.apply(out, body.data || []);
    url = body.paging && body.paging.next;
  }
  return out;
}

function parseInsights_(body) {
  const r = {};
  (body.data || []).forEach(function (d) {
    let v = null;
    if (d.total_value && d.total_value.value !== undefined) v = d.total_value.value;
    else if (d.values && d.values.length) v = d.values[d.values.length - 1].value;
    r[d.name] = v;
  });
  return r;
}

/**
 * 指標をまとめて取得し、失敗したら1つずつ取り直す。
 * 3回連続で失敗した指標は、その実行中はもう試さない（取得できない指標とみなす）。
 */
function fetchMetrics_(path, baseParams, coreMetrics, optionalMetrics, stats, statKeyPrefix) {
  const result = {};
  const usable = function (m) {
    const s = stats[statKeyPrefix + m];
    return !(s && !s.ok && s.fail >= 3);
  };
  const mark = function (m, ok, msg) {
    const k = statKeyPrefix + m;
    stats[k] = stats[k] || { ok: false, fail: 0, msg: '' };
    if (ok) stats[k].ok = true; else { stats[k].fail++; stats[k].msg = msg; }
  };
  const tryOne = function (m) {
    if (!usable(m)) return;
    try {
      const got = parseInsights_(fetchJson_(buildUrl_(path, Object.assign({}, baseParams, { metric: m }))));
      Object.assign(result, got);
      mark(m, true);
    } catch (e) {
      mark(m, false, e.message);
    }
  };

  const core = coreMetrics.filter(usable);
  if (core.length) {
    try {
      const got = parseInsights_(fetchJson_(buildUrl_(path, Object.assign({}, baseParams, { metric: core.join(',') }))));
      Object.assign(result, got);
      core.forEach(function (m) { mark(m, true); });
    } catch (e) {
      core.forEach(tryOne);
    }
  }
  (optionalMetrics || []).forEach(tryOne);
  return result;
}

// ===== メイン処理 =====
function fetchAllManual() {
  const summary = fetchAll();
  alert_('取得が完了しました。\n\n' + summary);
}

function fetchAll() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('別の取得処理が実行中です。少し待ってからもう一度試してください。');
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const me = getMe_();
    const stats = {};
    const lines = [];

    const postResult = updatePosts_(ss, stats);
    lines.push('投稿: ' + postResult.count + '件を更新（新規 ' + postResult.added + '件）');

    const newComments = updateComments_(ss, postResult.media, postResult.prevCommentCounts, me.username);
    lines.push('コメント: 新しく ' + newComments + '件を記録');

    updateDaily_(ss, [1], me.followers_count, stats);
    lines.push('アカウント日次: 昨日の分を記録（フォロワー ' + me.followers_count + '人）');

    if (shouldUpdateAudience_(ss)) {
      const ok = updateAudience_(ss);
      lines.push(ok ? 'フォロワー属性: 更新' : 'フォロワー属性: 取得できませんでした（フォロワー100人未満の場合は取れません）');
    }

    updateFunnel_(ss);
    lines.push('導線（週次）: 更新');

    const missing = Object.keys(stats).filter(function (k) { return !stats[k].ok; });
    if (missing.length) {
      log_('INFO', 'APIで取得できなかった指標: ' + missing.join(', ') + '（' + stats[missing[0]].msg + '）');
      lines.push('※取得できなかった指標: ' + missing.join(', ') + '（詳細は「ログ」シート）');
    }
    const summary = lines.join('\n');
    log_('INFO', summary.replace(/\n/g, ' / '));
    return summary;
  } catch (e) {
    log_('ERROR', e.message);
    throw e;
  } finally {
    lock.releaseLock();
  }
}

// ===== 投稿 =====
function updatePosts_(ss, stats) {
  const sheet = mustSheet_(ss, SHEET.POSTS);
  const media = fetchAllMedia_();
  const before = readTable_(sheet);
  const prevCommentCounts = {};
  before.rows.forEach(function (r) { prevCommentCounts[normKey_(r['投稿ID'])] = r['コメント']; });

  const now = new Date();
  const records = media.map(function (m) {
    const kind = m.media_product_type === 'REELS' ? 'REELS' : 'FEED';
    const def = MEDIA_METRICS[kind];
    const ins = fetchMetrics_('/' + m.id + '/insights', {}, def.core, def.optional, stats, kind + ':');
    const reach = num_(ins.reach);
    const saved = num_(ins.saved);
    const shares = num_(ins.shares);
    return {
      '投稿ID': String(m.id),
      '投稿日': parseIgDate_(m.timestamp),
      '種類': kind === 'REELS' ? 'リール' : (m.media_type === 'CAROUSEL_ALBUM' ? 'カルーセル' : m.media_type === 'VIDEO' ? '動画' : '画像'),
      'URL': m.permalink || '',
      'キャプション1行目': firstLine_(m.caption),
      '再生数': blank_(ins.views),
      'リーチ': blank_(ins.reach),
      'いいね': blank_(ins.likes !== undefined ? ins.likes : m.like_count),
      'コメント': blank_(ins.comments !== undefined ? ins.comments : m.comments_count),
      '保存': blank_(ins.saved),
      'シェア': blank_(ins.shares),
      '保存率': reach > 0 && saved !== null ? saved / reach : '',
      'シェア率': reach > 0 && shares !== null ? shares / reach : '',
      '平均視聴秒数': ins.ig_reels_avg_watch_time != null ? Math.round(ins.ig_reels_avg_watch_time / 100) / 10 : '',
      'スキップ率(取れれば)': blank_(ins.reels_skip_rate),
      'プロフアクセス(取れれば)': blank_(ins.profile_visits),
      'フォロー(取れれば)': blank_(ins.follows),
      '最終更新': now,
    };
  });

  const autoLabels = Object.keys(records[0] || {});
  const added = upsert_(sheet, '投稿ID', records, autoLabels);
  refreshPostDerived_(ss, sheet);
  sortSheet_(sheet, '投稿日', false);
  return { count: records.length, added: added, media: media, prevCommentCounts: prevCommentCounts };
}

/** テロップ文字数・相談につながった数を計算 */
function refreshPostDerived_(ss, sheet) {
  const table = readTable_(sheet);
  if (!table.rows.length) return;
  const consultSheet = ss.getSheetByName(SHEET.CONSULT);
  const watched = consultSheet ? readTable_(consultSheet).rows.map(function (r) { return String(r['見た動画'] || ''); }).filter(String) : [];

  const lens = [];
  const consults = [];
  table.rows.forEach(function (r) {
    const telop = String(r['冒頭テロップ'] || '').replace(/\s/g, '');
    lens.push([telop ? telop.length : '']);
    const code = shortcode_(r['URL']);
    const id = String(r['投稿ID'] || '');
    const n = watched.filter(function (w) { return (code && w.indexOf(code) !== -1) || (id && w.indexOf(id) !== -1); }).length;
    consults.push([n]);
  });
  writeColumn_(sheet, table.idx['テロップ文字数'], lens);
  writeColumn_(sheet, table.idx['相談につながった数'], consults);
}

// ===== コメント =====
function updateComments_(ss, media, prevCounts, ownUsername) {
  const sheet = mustSheet_(ss, SHEET.COMMENTS);
  const existing = {};
  readTable_(sheet).rows.forEach(function (r) { existing[normKey_(r['コメントID'])] = true; });

  const records = [];
  media.forEach(function (m) {
    const count = m.comments_count || 0;
    if (!count) return;
    const prev = prevCounts[String(m.id)];
    if (prev !== undefined && prev !== '' && Number(prev) === count) return; // 変化なしならスキップ
    let url;
    try {
      url = buildUrl_('/' + m.id + '/comments', { fields: 'id,text,timestamp,username', limit: 50 });
      let guard = 0;
      while (url && guard++ < 20) {
        const body = fetchJson_(url);
        (body.data || []).forEach(function (c) {
          if (existing[String(c.id)]) return;
          if (ownUsername && c.username === ownUsername) return; // 自分の返信は除く
          existing[String(c.id)] = true;
          records.push({
            'コメントID': String(c.id),
            '投稿ID': String(m.id),
            '投稿のタイトル': firstLine_(m.caption),
            '日時': c.timestamp ? parseIgDate_(c.timestamp) : '',
            '本文': c.text || '',
          });
        });
        url = body.paging && body.paging.next;
      }
    } catch (e) {
      log_('WARN', 'コメントの取得に失敗（投稿ID ' + m.id + '）: ' + e.message);
    }
  });
  if (records.length) upsert_(sheet, 'コメントID', records, Object.keys(records[0]));
  if (records.length) sortSheet_(sheet, '日時', false);
  return records.length;
}

// ===== アカウント日次 =====
function backfillDailyManual() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const days = [];
  for (let i = 1; i <= 28; i++) days.push(i);
  const stats = {};
  updateDaily_(ss, days, null, stats);
  updateFunnel_(ss);
  alert_('過去28日分の日次データを取り込みました。\n（フォロワー数は過去分を取得できないため、今日以降の記録から入ります）');
}

/**
 * @param {number[]} daysAgoList 何日前の分を取るか（1=昨日）
 * @param {number|null} followers 昨日の行に入れるフォロワー数（今の人数）
 */
function updateDaily_(ss, daysAgoList, followers, stats) {
  const sheet = mustSheet_(ss, SHEET.DAILY);
  const records = daysAgoList.map(function (daysAgo) {
    const start = jstDayStart_(daysAgo);
    const since = Math.floor(start / 1000);
    const ins = fetchMetrics_('/me/insights', { period: 'day', metric_type: 'total_value', since: since, until: since + 86400 }, ACCOUNT_DAY_METRICS, [], stats, 'account:');
    const rec = {
      '日付': new Date(start),
      'リーチ': blank_(ins.reach),
      '再生数': blank_(ins.views),
      '反応したアカウント数': blank_(ins.accounts_engaged),
      '合計反応数': blank_(ins.total_interactions),
      'プロフィール閲覧(取れれば)': blank_(ins.profile_views),
      'リンク等タップ(参考)': blank_(ins.profile_links_taps),
    };
    if (daysAgo === 1 && followers != null) rec['フォロワー数'] = followers;
    return rec;
  });
  const labels = ['日付', 'フォロワー数', 'リーチ', '再生数', '反応したアカウント数', '合計反応数', 'プロフィール閲覧(取れれば)', 'リンク等タップ(参考)'];
  upsert_(sheet, '日付', records, labels);
  sortSheet_(sheet, '日付', true);

  // フォロワー増減（前日の記録がある日だけ）
  const table = readTable_(sheet);
  let prev = null;
  const diffs = table.rows.map(function (r) {
    const f = r['フォロワー数'];
    const d = (f !== '' && prev !== null) ? Number(f) - prev : '';
    prev = f !== '' ? Number(f) : null;
    return [d];
  });
  writeColumn_(sheet, table.idx['フォロワー増減'], diffs);
}

// ===== フォロワー属性 =====
function shouldUpdateAudience_(ss) {
  const sheet = ss.getSheetByName(SHEET.AUDIENCE);
  if (!sheet || sheet.getLastRow() < 2) return true;
  const rows = readTable_(sheet).rows;
  const last = rows[rows.length - 1]['取得日'];
  return !(last instanceof Date) || Date.now() - last.getTime() >= 7 * DAY_MS;
}

function updateAudience_(ss) {
  const sheet = mustSheet_(ss, SHEET.AUDIENCE);
  const today = new Date(jstDayStart_(0));
  const genderLabel = { F: '女性', M: '男性', U: '不明' };
  const out = [];
  [['gender', '性別'], ['age', '年齢']].forEach(function (pair) {
    try {
      const body = fetchJson_(buildUrl_('/me/insights', {
        metric: 'follower_demographics', period: 'lifetime', timeframe: 'this_month', metric_type: 'total_value', breakdown: pair[0],
      }));
      const d = (body.data || [])[0];
      const results = (d && d.total_value && d.total_value.breakdowns && d.total_value.breakdowns[0] && d.total_value.breakdowns[0].results) || [];
      const total = results.reduce(function (s, r) { return s + (r.value || 0); }, 0);
      results
        .sort(function (a, b) { return String(a.dimension_values[0]).localeCompare(String(b.dimension_values[0])); })
        .forEach(function (r) {
          const key = r.dimension_values[0];
          out.push([today, pair[1], pair[0] === 'gender' ? (genderLabel[key] || key) : key, r.value, total ? r.value / total : '']);
        });
    } catch (e) {
      log_('WARN', 'フォロワー属性（' + pair[1] + '）を取得できませんでした: ' + e.message);
    }
  });
  if (!out.length) return false;
  ensureRows_(sheet, sheet.getLastRow() + out.length);
  sheet.getRange(sheet.getLastRow() + 1, 1, out.length, 5).setValues(out);
  return true;
}

// ===== 導線（週次） =====
function updateFunnel_(ss) {
  const sheet = mustSheet_(ss, SHEET.FUNNEL);
  const daily = readTable_(mustSheet_(ss, SHEET.DAILY)).rows;
  const weeks = {};
  const touch = function (ms) {
    const k = weekStart_(ms);
    weeks[k] = weeks[k] || { reach: 0, views: 0, pv: 0, pvAny: false, fol: 0, folAny: false, form: 0, consult: 0 };
    return weeks[k];
  };

  daily.forEach(function (r) {
    if (!(r['日付'] instanceof Date)) return;
    const w = touch(r['日付'].getTime());
    w.reach += Number(r['リーチ']) || 0;
    w.views += Number(r['再生数']) || 0;
    if (r['プロフィール閲覧(取れれば)'] !== '') { w.pv += Number(r['プロフィール閲覧(取れれば)']) || 0; w.pvAny = true; }
    if (r['フォロワー増減'] !== '') { w.fol += Number(r['フォロワー増減']) || 0; w.folAny = true; }
  });

  const consultSheet = ss.getSheetByName(SHEET.CONSULT);
  if (consultSheet) {
    readTable_(consultSheet).rows.forEach(function (r) {
      if (r['相談日'] instanceof Date) touch(r['相談日'].getTime()).consult++;
    });
  }

  const formWeeks = countFormResponsesByWeek_();
  if (formWeeks) Object.keys(formWeeks).forEach(function (k) { touch(Number(k)).form = formWeeks[k]; });

  const records = Object.keys(weeks).map(Number).sort().map(function (k) {
    const w = weeks[k];
    const rec = {
      '週（月曜はじまり）': new Date(k),
      'リーチ合計': w.reach,
      '再生数合計': w.views,
      'プロフィール閲覧合計': w.pvAny ? w.pv : '',
      'フォロワー増減': w.folAny ? w.fol : '',
      '相談開始数': w.consult,
    };
    if (formWeeks) rec['診断回答数'] = w.form;
    return rec;
  });
  if (!records.length) return;
  upsert_(sheet, '週（月曜はじまり）', records, ['リーチ合計', '再生数合計', 'プロフィール閲覧合計', 'フォロワー増減', '相談開始数', '診断回答数']);
  sortSheet_(sheet, '週（月曜はじまり）', true);
  writeFunnelFormulas_(sheet);
}

function writeFunnelFormulas_(sheet) {
  const table = readTable_(sheet);
  const n = table.rows.length;
  if (!n) return;
  const L = function (label) { return colLetter_(table.idx[label] + 1); };
  const lineTotal = [], lpRate = [], lineRate = [], consultRate = [];
  for (let i = 0; i < n; i++) {
    const r = i + 2;
    lineTotal.push(['=IF(COUNT(' + L('LINE追加（LP経由）') + r + ',' + L('LINE追加（診断経由）') + r + ',' + L('LINE追加（その他）') + r + ')=0,"",SUM(' + L('LINE追加（LP経由）') + r + ',' + L('LINE追加（診断経由）') + r + ',' + L('LINE追加（その他）') + r + '))']);
    lpRate.push(['=IFERROR(IF(' + L('LP閲覧数') + r + '="","",' + L('LP閲覧数') + r + '/IF(N(' + L('プロフィール閲覧合計') + r + ')>0,' + L('プロフィール閲覧合計') + r + ',' + L('リーチ合計') + r + ')),"")']);
    lineRate.push(['=IFERROR(IF(' + L('LINE追加合計') + r + '="","",' + L('LINE追加合計') + r + '/(N(' + L('LP閲覧数') + r + ')+N(' + L('診断回答数') + r + '))),"")']);
    consultRate.push(['=IFERROR(IF(N(' + L('LINE追加合計') + r + ')=0,"",' + L('相談開始数') + r + '/' + L('LINE追加合計') + r + '),"")']);
  }
  writeColumn_(sheet, table.idx['LINE追加合計'], lineTotal, true);
  writeColumn_(sheet, table.idx['LP到達率'], lpRate, true);
  writeColumn_(sheet, table.idx['LINE追加率'], lineRate, true);
  writeColumn_(sheet, table.idx['相談率'], consultRate, true);
}

// ===== 診断フォーム =====
function promptFormUrl() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt('診断フォームを連携', '「恋愛つまずきタイプ診断」のGoogleフォームの編集画面のURLを貼り付けてください。\n（https://docs.google.com/forms/d/〜/edit）', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const m = res.getResponseText().match(/\/forms\/d\/([a-zA-Z0-9_-]+)/);
  if (!m) { alert_('URLの形式が違うようです。フォームの「編集画面」のURLを貼り付けてください。'); return; }
  try {
    const form = FormApp.openById(m[1]);
    PropertiesService.getScriptProperties().setProperty(PROP_FORM_ID, m[1]);
    updateFunnel_(SpreadsheetApp.getActiveSpreadsheet());
    alert_('連携しました：「' + form.getTitle() + '」\nこれまでの回答数: ' + form.getResponses().length + '件\n\n「導線（週次）」の「診断回答数」に毎週の回答数が入ります。');
  } catch (e) {
    alert_('フォームを開けませんでした。このGoogleアカウントで編集できるフォームか確認してください。\n\n' + e.message);
  }
}

function countFormResponsesByWeek_() {
  const id = PropertiesService.getScriptProperties().getProperty(PROP_FORM_ID);
  if (!id) return null;
  try {
    const counts = {};
    FormApp.openById(id).getResponses().forEach(function (r) {
      const k = weekStart_(r.getTimestamp().getTime());
      counts[k] = (counts[k] || 0) + 1;
    });
    return counts;
  } catch (e) {
    log_('WARN', '診断フォームの回答数を取得できませんでした: ' + e.message);
    return null;
  }
}

// ===== 自動実行 =====
function installTriggers() {
  removeTriggers(true);
  ScriptApp.newTrigger('fetchAll').timeBased().everyDays(1).atHour(6).inTimezone(TZ).create();
  ScriptApp.newTrigger('refreshToken').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(5).inTimezone(TZ).create();
  alert_('自動取得をオンにしました。\n\n・毎朝6時ごろ：データを取得\n・毎週月曜5時ごろ：アクセストークンを延長（60日の期限切れを防ぎます）\n\nエラーが出た場合は「ログ」シートに記録されます。');
}

function removeTriggers(silent) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['fetchAll', 'refreshToken'].indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t);
  });
  if (silent !== true) alert_('自動取得をオフにしました。');
}

// ===== シート操作の共通処理 =====
function mustSheet_(ss, name) {
  return ss.getSheetByName(name) || ensureSheet_(ss, name);
}

function readTable_(sheet) {
  const lastCol = sheet.getLastColumn();
  const lastRow = sheet.getLastRow();
  if (lastCol === 0) return { headers: [], idx: {}, rows: [], values: [] };
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  const idx = {};
  headers.forEach(function (h, i) { if (h !== '' && idx[h] === undefined) idx[h] = i; });
  const values = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, lastCol).getValues() : [];
  const rows = values.map(function (v) {
    const o = {};
    headers.forEach(function (h, i) { if (h !== '') o[h] = v[i]; });
    return o;
  });
  return { headers: headers, idx: idx, rows: rows, values: values };
}

/**
 * キー列で行を探して、autoLabels の列だけ書き込む（手入力の列は触らない）。
 * @return {number} 新しく追加した行数
 */
function upsert_(sheet, keyLabel, records, autoLabels) {
  const table = readTable_(sheet);
  const idx = table.idx;
  if (idx[keyLabel] === undefined) throw new Error('「' + sheet.getName() + '」シートに「' + keyLabel + '」列がありません。「① 初期設定」を実行してください。');
  const numCols = table.headers.length;
  const data = table.values;
  const rowByKey = {};
  data.forEach(function (r, i) { rowByKey[normKey_(r[idx[keyLabel]])] = i; });

  let added = 0;
  records.forEach(function (rec) {
    const k = normKey_(rec[keyLabel]);
    let i = rowByKey[k];
    if (i === undefined) {
      data.push(new Array(numCols).fill(''));
      i = data.length - 1;
      rowByKey[k] = i;
      added++;
    }
    data[i][idx[keyLabel]] = rec[keyLabel];
    autoLabels.forEach(function (l) {
      if (Object.prototype.hasOwnProperty.call(rec, l) && idx[l] !== undefined) data[i][idx[l]] = rec[l];
    });
  });
  if (!data.length) return 0;
  ensureRows_(sheet, data.length + 1);

  const labels = [keyLabel].concat(autoLabels.filter(function (l) { return l !== keyLabel; }));
  labels.forEach(function (l) {
    const c = idx[l];
    if (c === undefined) return;
    writeColumn_(sheet, c, data.map(function (r) { return [r[c]]; }));
  });
  return added;
}

function writeColumn_(sheet, colIndex0, values, asFormulas) {
  if (colIndex0 === undefined || !values.length) return;
  ensureRows_(sheet, values.length + 1);
  const range = sheet.getRange(2, colIndex0 + 1, values.length, 1);
  if (asFormulas) range.setFormulas(values); else range.setValues(values);
}

function ensureRows_(sheet, lastRowNeeded) {
  const max = sheet.getMaxRows();
  if (lastRowNeeded > max) sheet.insertRowsAfter(max, lastRowNeeded - max);
}

function ensureCols_(sheet, colNeeded) {
  const max = sheet.getMaxColumns();
  if (colNeeded > max) sheet.insertColumnsAfter(max, colNeeded - max);
}

function sortSheet_(sheet, label, ascending) {
  const table = readTable_(sheet);
  if (table.rows.length < 2 || table.idx[label] === undefined) return;
  sheet.getRange(2, 1, table.rows.length, table.headers.length).sort({ column: table.idx[label] + 1, ascending: ascending });
}

function log_(level, message) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) { console.log(level + ': ' + message); return; }
    const sheet = mustSheet_(ss, SHEET.LOG);
    sheet.appendRow([new Date(), level, String(message).slice(0, 2000)]);
    const extra = sheet.getLastRow() - 501;
    if (extra > 0) sheet.deleteRows(2, extra);
  } catch (e) {
    console.log(level + ': ' + message);
  }
}

function alert_(msg) {
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { console.log(msg); }
}

// ===== 小さな関数 =====
function firstLine_(caption) {
  return String(caption || '').split('\n').map(function (s) { return s.trim(); }).filter(String)[0] || '';
}

function shortcode_(url) {
  const m = String(url || '').match(/\/(?:p|reel|reels|tv)\/([^/?#]+)/);
  return m ? m[1] : '';
}

/** Instagramの日時（例: 2025-01-01T12:00:00+0000）をDateに */
function parseIgDate_(s) {
  return new Date(String(s).replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
}

function num_(v) {
  return v === undefined || v === null || v === '' ? null : Number(v);
}

function blank_(v) {
  return v === undefined || v === null ? '' : v;
}

function normKey_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  return String(v);
}

/** 日本時間で「daysAgo日前の0時」のミリ秒 */
function jstDayStart_(daysAgo) {
  const dayNum = Math.floor((Date.now() + JST_OFFSET_MS) / DAY_MS);
  return (dayNum - daysAgo) * DAY_MS - JST_OFFSET_MS;
}

/** 日本時間で、その日を含む週の月曜0時のミリ秒 */
function weekStart_(ms) {
  const dayNum = Math.floor((ms + JST_OFFSET_MS) / DAY_MS);
  const dow = (dayNum + 4) % 7; // 0=日曜（1970/1/1は木曜）
  const offset = (dow + 6) % 7; // 月曜からの日数
  return (dayNum - offset) * DAY_MS - JST_OFFSET_MS;
}

function colLetter_(n) {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
