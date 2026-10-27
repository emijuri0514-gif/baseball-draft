// ★ なんでもドラフト（1台で遊ぶ版）の計算だけを集めたもの。画面・保存・通信には触れない（node でテストできる）。
//   設計：非公開リポジトリ docs/ANYTHING_DRAFT_SOLO_DESIGN.md（2026-10-22）
//   入力した文字のチェック（見えない文字の除去・文字数・禁止語）は js/pick-card-safety.js を画面側で使う。

export const LIMITS = Object.freeze({
  minPlayers: 2,
  maxPlayers: 8,
  nameMax: 12,       // 参加者の名前（見た目の1文字ずつ数える）
  titleMax: 30,      // お題
  optionMax: 30,     // 選択肢1つ
  optionsMax: 250,   // 選択肢の数
  roundsMax: 15,     // 巡の数の上限（結果の画像に載せきれる数に合わせる）
});

// 重複を見分けるための形（2026-10-27 オーナー決定）：全角・半角と空白の違いだけを同じとみなす。
// 英字の大小・ひらがなとカタカナ・記号の違いは、別の候補として扱う（例：「A-1」と「A1」、「まぐろ」と「マグロ」は別）
export function optionKey(s) {
  return String(s || '')
    .replace(/[\uFF01-\uFF5E]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)) // 全角の英数字・記号 → 半角
    .replace(/[\uFF61-\uFF9F]+/g, m => m.normalize('NFKC'))                          // 半角カナ → 全角カナ（濁点もまとめる）
    .replace(/\s+/g, '');                                                               // 空白（全角の空白も）を除く
}
// 探すときの形：探しやすさのため、全角半角・英字の大小・カタカナとひらがな・空白や記号の違いを無視する（重複の判定とは別）
export function searchKey(s) {
  return String(s || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[^\p{L}\p{N}]/gu, '');
}

// 選択肢を足す。existing（[{id,label,team?}]）に labels（整えた後の文字）を足し、重複と上限を数えて返す
export function addOptions(existing, labels, { team = '', nextId } = {}) {
  const out = existing.slice();
  const keys = new Set(out.map(o => optionKey(o.label)));
  let dupes = 0, overLimit = 0, empty = 0, added = 0;
  // leftover：追加できなかった入力（上限を超えた分・空白だけの行）。入力欄に残して、黙って消さない
  const leftover = [];
  let idSeq = nextId || (out.reduce((m, o) => Math.max(m, o.id), 0) + 1);
  for (const label of labels) {
    const key = optionKey(label);
    if (!key) { empty++; if (String(label || '').trim()) leftover.push(label); continue; }
    if (keys.has(key)) { dupes++; continue; }
    if (out.length >= LIMITS.optionsMax) { overLimit++; leftover.push(label); continue; }
    keys.add(key);
    out.push(team ? { id: idSeq++, label, team } : { id: idSeq++, label });
    added++;
  }
  return { options: out, added, dupes, overLimit, empty, leftover };
}

// 巡の数の上限：選択肢の数 ÷ 人数（切り捨て）。全員の指名数が必ずそろう。人数より少なければ0（始められない）
export function maxRounds(nOptions, nPlayers) {
  if (nPlayers < LIMITS.minPlayers) return 0;
  return Math.min(LIMITS.roundsMax, Math.floor(nOptions / nPlayers));
}

// ウェーバーの順番：奇数巡は最初の順番、偶数巡は逆（スネーク）。round は1から
export function snakeOrder(base, round) {
  return round % 2 === 1 ? base.slice() : base.slice().reverse();
}

// 0〜n-1 の整数の乱数（rng は 0以上1未満を返す関数。テストでは固定の関数を渡す）
export function randInt(n, rng) {
  return Math.min(n - 1, Math.floor(rng() * n));
}

export function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(i + 1, rng);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 同時指名の発表：submitted は { 参加者の番号: 選択肢のid }。
// 重ならなければそのまま確定、重なったら抽選で1人を確定し、残りは選び直し（losers）にする
export function resolveSimultaneous(submitted, rng) {
  const byOption = new Map();
  Object.keys(submitted).map(Number).sort((a, b) => a - b).forEach(p => {
    const id = submitted[p];
    if (!byOption.has(id)) byOption.set(id, []);
    byOption.get(id).push(p);
  });
  const confirmed = [], losers = [], lotteries = [];
  for (const [optionId, players] of byOption) {
    if (players.length === 1) {
      confirmed.push({ player: players[0], optionId, via: 'single' });
    } else {
      const winner = players[randInt(players.length, rng)];
      confirmed.push({ player: winner, optionId, via: 'lottery' });
      lotteries.push({ optionId, players, winner });
      players.filter(p => p !== winner).forEach(p => losers.push(p));
    }
  }
  losers.sort((a, b) => a - b);
  return { confirmed, losers, lotteries };
}

// 同時指名の発表（抽選の前）：重ならなかった指名と、重なった指名（抽選が要るもの）に分ける。
// 抽選は画面で参加者が封筒を選んで行うので、ここでは当たりを決めない
export function groupSubmissions(submitted) {
  const byOption = new Map();
  Object.keys(submitted).map(Number).sort((a, b) => a - b).forEach(p => {
    const id = submitted[p];
    if (!byOption.has(id)) byOption.set(id, []);
    byOption.get(id).push(p);
  });
  const singles = [], conflicts = [];
  for (const [optionId, players] of byOption) {
    if (players.length === 1) singles.push({ player: players[0], optionId });
    else conflicts.push({ optionId, players });
  }
  return { singles, conflicts };
}

// 封筒の抽選を用意する：封筒を選ぶ順番（毎回まぜる）と、当たりの封筒の番号を決める（画面には出さない）
export function setupLottery({ optionId, players }, rng) {
  return { optionId, players, drawOrder: shuffle(players, rng), winEnv: randInt(players.length, rng), taken: {}, opened: false, winner: null };
}
// 封筒を取る：次に選ぶ人が envIdx の封筒を取る。取れたら true
export function takeEnvelope(lot, envIdx) {
  const n = lot.players.length, count = Object.keys(lot.taken).length;
  if (lot.opened || count >= n || envIdx < 0 || envIdx >= n || lot.taken[envIdx] != null) return false;
  lot.taken[envIdx] = lot.drawOrder[count];
  return true;
}
export const nextDrawer = lot => lot.drawOrder[Object.keys(lot.taken).length] ?? null;
// 全員が取ったら一斉に開ける：当たりの封筒を取った人が獲得。外れた人の一覧を返す
export function openLottery(lot) {
  if (lot.opened || Object.keys(lot.taken).length < lot.players.length) return null;
  lot.opened = true;
  lot.winner = lot.taken[lot.winEnv];
  return { winner: lot.winner, losers: lot.players.filter(p => p !== lot.winner) };
}

// 投票の集計：votes は { 投票した人: 投票先 }。自分への票は数えない。最多の人が複数なら全員が同率優勝
export function tallyVotes(votes, nPlayers) {
  const counts = new Array(nPlayers).fill(0);
  for (const [voter, target] of Object.entries(votes)) {
    const v = Number(voter), t = Number(target);
    if (v === t || t < 0 || t >= nPlayers) continue;
    counts[t]++;
  }
  const top = Math.max(...counts);
  const winners = top > 0 ? counts.map((c, i) => (c === top ? i : -1)).filter(i => i >= 0) : [];
  return { counts, winners };
}

// 選ぶ画面の検索：全角半角・カタカナとひらがな・空白の違いを無視した部分一致
export function matchesQuery(label, query) {
  const q = searchKey(query);
  if (!q) return true;
  return searchKey(label).includes(q);
}

// まだ取られていない選択肢（確定した指名を除く）
export function remainingOptions(options, picks) {
  const taken = new Set(picks.map(p => p.optionId));
  return options.filter(o => !taken.has(o.id));
}

// ---------- 野球以外の候補の例（設定画面の「候補の例」。読み込んだ後に足したり外したりできる） ----------
export const PRESETS = Object.freeze([
  { key: 'sushi', title: '好きな寿司ネタ', items: ['まぐろ', '中トロ', '大トロ', 'サーモン', 'はまち', '真鯛', 'えび', '甘えび', 'いか', 'たこ', 'ほたて', 'いくら', 'うに', 'あじ', 'さば', 'いわし', '穴子', 'うなぎ', '玉子', 'ねぎとろ', '鉄火巻き', 'かっぱ巻き', '数の子', 'かんぱち'] },
  { key: 'nabe', title: '鍋に入れたい具', items: ['白菜', '長ねぎ', '春菊', '水菜', 'しいたけ', 'えのき', 'しめじ', '豆腐', '油揚げ', '鶏もも肉', '豚バラ肉', '牛肉', '鶏つくね', 'たら', '牡蠣', 'えび', '白滝', '餅', '大根', 'にんじん', 'ちくわ', '春雨', 'もやし', 'ごぼう'] },
  { key: 'island', title: '無人島に持っていくもの', items: ['ナイフ', 'ロープ', 'ライター', '鍋', '釣り竿', 'テント', '寝袋', '懐中電灯', 'ソーラー充電器', '浄水器', '救急セット', '地図と方位磁針', '塩', '米', 'スコップ', '双眼鏡', '笛', '日焼け止め', '虫よけ', '本', 'トランプ', 'ギター', 'ハンモック', 'タオル'] },
  { key: 'ramen', title: 'ラーメンのトッピング', items: ['チャーシュー', '味玉', 'メンマ', 'ねぎ', 'のり', 'もやし', 'コーン', 'バター', 'ほうれん草', 'なると', 'きくらげ', '紅しょうが', '白ごま', 'にんにく', '辛味噌', '背脂', '玉ねぎ', 'キャベツ', 'わかめ', '岩のり', '角煮', 'ゆず', '揚げねぎ', 'チーズ'] },
]);

// ---------- 途中保存のデータ ----------
// v2：10/26 版（封筒の抽選）。v3：設定の途中（お題・名前・未追加の入力）も保存し、投票なしを選べるようにした（10/27）
export const SAVE_VERSION = 3;
const PHASES = ['setup', 'draft', 'vote', 'result'];
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const isObj = v => v != null && typeof v === 'object' && !Array.isArray(v);
const isPerm = (arr, items) => Array.isArray(arr) && arr.length === items.length && [...arr].sort((a, b) => a - b).join(',') === [...items].sort((a, b) => a - b).join(',');

// 保存データを確かめて、使える形（v3）にして返す。だめなら理由（利用者に見せる文。入力した文字は含めない）を返す。
// 元のデータは書き換えない（コピーを返す）
export function validateState(raw) {
  const bad = reason => ({ ok: false, reason });
  if (!isObj(raw)) return bad('保存データの形が読み取れません');
  if (raw.version !== 2 && raw.version !== SAVE_VERSION) return bad(`対応していない保存データの版です（${Number.isFinite(raw.version) ? raw.version : '不明'}）`);
  let s;
  try { s = structuredClone(raw); } catch (e) { return bad('保存データの形が読み取れません'); }
  if (s.version === 2) { s.version = SAVE_VERSION; s.draftText = ''; s.voteMode = 'vote'; } // v2 からの移行（途中のゲームはそのまま）
  if (typeof s.draftText !== 'string' || s.draftText.length > 20000) s.draftText = '';
  if (!PHASES.includes(s.phase)) return bad('進行の段階が読み取れません');
  if (!['lottery', 'waiver'].includes(s.mode)) return bad('指名の方式が読み取れません');
  if (!['vote', 'none'].includes(s.voteMode)) return bad('投票の設定が読み取れません');
  if (typeof s.title !== 'string' || s.title.length > 200) return bad('お題が読み取れません');
  if (typeof s.template !== 'string') return bad('テンプレートの設定が読み取れません');
  if (!Array.isArray(s.teams) || !s.teams.every(t => typeof t === 'string')) return bad('テンプレートの設定が読み取れません');
  if (!Array.isArray(s.players) || s.players.length < LIMITS.minPlayers || s.players.length > LIMITS.maxPlayers || !s.players.every(n => typeof n === 'string' && n.length <= 100)) return bad('参加者の人数か名前が読み取れません');
  if (!Array.isArray(s.options) || s.options.length > LIMITS.optionsMax) return bad('選択肢が読み取れません');
  const ids = new Set();
  for (const o of s.options) {
    if (!isObj(o) || !isInt(o.id, 1, 1e9) || ids.has(o.id) || typeof o.label !== 'string' || !o.label || o.label.length > 200 || (o.team != null && typeof o.team !== 'string')) return bad('選択肢が読み取れません');
    ids.add(o.id);
  }
  if (!isInt(s.rounds, 1, LIMITS.roundsMax)) return bad('巡の数が読み取れません');
  if (s.phase === 'setup') return { ok: true, state: s };

  // ここから下はゲームが始まった後
  const n = s.players.length;
  const players = s.players.map((_, i) => i);
  const isP = v => isInt(v, 0, n - 1);
  if (s.players.some(x => !x.trim()) || new Set(s.players).size !== n) return bad('参加者の名前が読み取れません');
  if (s.rounds > maxRounds(s.options.length, n)) return bad('巡の数と選択肢の数が合いません');
  if (!isPerm(s.order, players)) return bad('指名の順番が読み取れません');
  if (!Array.isArray(s.picks)) return bad('指名の記録が読み取れません');
  const pickedIds = new Set(), slot = new Set(), perPlayer = new Array(n).fill(0);
  for (const p of s.picks) {
    if (!isObj(p) || !isInt(p.round, 1, s.rounds) || !isP(p.player) || !ids.has(p.optionId) || pickedIds.has(p.optionId) || slot.has(`${p.player}-${p.round}`)) return bad('指名の記録が読み取れません');
    pickedIds.add(p.optionId); slot.add(`${p.player}-${p.round}`); perPlayer[p.player]++;
  }
  if (s.phase === 'draft') {
    if (!isInt(s.round, 1, s.rounds)) return bad('いまの巡が読み取れません');
    if (s.picks.some(p => p.round > s.round)) return bad('指名の記録が読み取れません');
    if (!Array.isArray(s.queue) || s.queue.length !== n || !isPerm(s.queue, players)) return bad('いまの巡の順番が読み取れません');
    if (!Number.isInteger(s.turn) || s.turn < 0) return bad('いまの番が読み取れません');
    if (!Array.isArray(s.redo) || !s.redo.every(isP) || new Set(s.redo).size !== s.redo.length) return bad('選び直しの人が読み取れません');
    if (!isObj(s.sub)) return bad('同時指名の途中の記録が読み取れません');
    for (const [k, v] of Object.entries(s.sub)) if (!isP(Number(k)) || !ids.has(v) || pickedIds.has(v)) return bad('同時指名の途中の記録が読み取れません');
    if (s.mode === 'waiver') {
      if (s.turn >= n) return bad('いまの番が読み取れません');
    } else if (s.rv == null) {
      const list = s.redo.length ? s.redo : s.queue;
      if (s.turn > list.length) return bad('いまの番が読み取れません');
      if (Object.keys(s.sub).length !== s.turn) return bad('同時指名の途中の記録が読み取れません');
    } else {
      const rv = s.rv;
      if (!isObj(rv) || !isObj(rv.sub) || !Array.isArray(rv.lots) || !['list', 'lottery', 'done'].includes(rv.stage)) return bad('発表・抽選の途中の記録が読み取れません');
      if (rv.lots.length ? !isInt(rv.idx, 0, rv.lots.length - 1) : rv.idx !== 0) return bad('発表・抽選の途中の記録が読み取れません');
      for (const [k, v] of Object.entries(rv.sub)) if (!isP(Number(k)) || !ids.has(v)) return bad('発表・抽選の途中の記録が読み取れません');
      for (const l of rv.lots) {
        const m = Array.isArray(l && l.players) ? l.players.length : 0;
        if (!isObj(l) || !ids.has(l.optionId) || m < 2 || !l.players.every(isP) || new Set(l.players).size !== m || !isPerm(l.drawOrder, l.players) || !isInt(l.winEnv, 0, m - 1) || !isObj(l.taken) || typeof l.opened !== 'boolean') return bad('抽選の途中の記録が読み取れません');
        const takers = Object.entries(l.taken);
        if (takers.some(([e, p]) => !isInt(Number(e), 0, m - 1) || !l.players.includes(p)) || new Set(takers.map(t => t[1])).size !== takers.length) return bad('抽選の途中の記録が読み取れません');
        if (l.opened && (takers.length !== m || l.winner !== l.taken[l.winEnv] || !s.picks.some(p => p.optionId === l.optionId && p.player === l.winner))) return bad('抽選の結果の記録が読み取れません');
      }
    }
  } else {
    if (!perPlayer.every(c => c === s.rounds)) return bad('指名の記録が最後までそろっていません');
    if (!isObj(s.votes)) return bad('投票の記録が読み取れません');
    for (const [k, v] of Object.entries(s.votes)) if (!isP(Number(k)) || !isP(v) || Number(k) === v) return bad('投票の記録が読み取れません');
    if (s.phase === 'vote' && (!isInt(s.voteIdx, 0, n) || n < 3)) return bad('投票の途中の記録が読み取れません');
  }
  return { ok: true, state: s };
}
