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

// 重複を見分けるための形：全角半角（NFKC）・英字の大小・カタカナとひらがな・空白や記号の違いを無視する
export function optionKey(s) {
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
  let dupes = 0, overLimit = 0, empty = 0;
  let idSeq = nextId || (out.reduce((m, o) => Math.max(m, o.id), 0) + 1);
  for (const label of labels) {
    const key = optionKey(label);
    if (!key) { empty++; continue; }
    if (keys.has(key)) { dupes++; continue; }
    if (out.length >= LIMITS.optionsMax) { overLimit++; continue; }
    keys.add(key);
    out.push(team ? { id: idSeq++, label, team } : { id: idSeq++, label });
  }
  return { options: out, dupes, overLimit, empty };
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
  const q = optionKey(query);
  if (!q) return true;
  return optionKey(label).includes(q);
}

// まだ取られていない選択肢（確定した指名を除く）
export function remainingOptions(options, picks) {
  const taken = new Set(picks.map(p => p.optionId));
  return options.filter(o => !taken.has(o.id));
}
