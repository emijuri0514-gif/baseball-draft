// なんでもドラフトの計算のテスト。実行：npm run test:anything-draft（node だけで動く。ブラウザ不要）
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PRESETS, validateState, SAVE_VERSION, groupSubmissions, setupLottery, takeEnvelope, nextDrawer, openLottery, LIMITS, optionKey, addOptions, maxRounds, snakeOrder, shuffle, resolveSimultaneous, tallyVotes, matchesQuery, remainingOptions } from '../../js/anything-draft-core.mjs';

// 決まった順に値を返す乱数（テスト用）
const seq = (...vals) => { let i = 0; return () => vals[i++ % vals.length]; };

test('重複の判定は全角・半角と空白の違いだけを同じとみなす（記号・大小・ひらがなとカタカナは別）', () => {
  assert.equal(optionKey('ﾏｸﾞﾛ'), optionKey('マグロ'));
  assert.equal(optionKey('ＡＢＣ　１'), optionKey('ABC1'));
  assert.equal(optionKey('大 トロ'), optionKey('大トロ'));
  assert.notEqual(optionKey('A-1'), optionKey('A1'));
  assert.notEqual(optionKey('大トロ!'), optionKey('大トロ'));
  assert.notEqual(optionKey('まぐろ'), optionKey('マグロ'));
  assert.notEqual(optionKey('ABC'), optionKey('abc'));
});

test('選択肢を足す：重複・空・上限を数える', () => {
  let r = addOptions([], ['まぐろ', 'まぐろ ', '  ', 'いくら']);
  assert.deepEqual(r.options.map(o => o.label), ['まぐろ', 'いくら']);
  assert.equal(r.dupes, 1); assert.equal(r.empty, 1);
  assert.deepEqual(r.options.map(o => o.id), [1, 2]);
  const many = Array.from({ length: 260 }, (_, i) => `選択肢${i}`);
  r = addOptions([], many);
  assert.equal(r.options.length, LIMITS.optionsMax);
  assert.equal(r.overLimit, 10);
  r = addOptions([{ id: 5, label: 'a' }], ['b'], { team: '巨人' });
  assert.deepEqual(r.options[1], { id: 6, label: 'b', team: '巨人' });
});

test('巡の数の上限は「選択肢の数÷人数」（切り捨て）、上限15', () => {
  assert.equal(maxRounds(30, 5), 6);
  assert.equal(maxRounds(4, 5), 0);
  assert.equal(maxRounds(250, 2), LIMITS.roundsMax);
  assert.equal(maxRounds(10, 1), 0);
});

test('ウェーバーは偶数巡で折り返す', () => {
  assert.deepEqual(snakeOrder([2, 0, 1], 1), [2, 0, 1]);
  assert.deepEqual(snakeOrder([2, 0, 1], 2), [1, 0, 2]);
  assert.deepEqual(snakeOrder([2, 0, 1], 3), [2, 0, 1]);
});

test('並べ替えは全員を1回ずつ含む', () => {
  const s = shuffle([0, 1, 2, 3, 4], seq(0.9, 0.1, 0.5, 0.3));
  assert.deepEqual(s.slice().sort(), [0, 1, 2, 3, 4]);
});

test('同時指名：重ならなければ全員確定', () => {
  const r = resolveSimultaneous({ 0: 10, 1: 11, 2: 12 }, seq(0));
  assert.equal(r.confirmed.length, 3); assert.equal(r.losers.length, 0); assert.equal(r.lotteries.length, 0);
});

test('同時指名：3人が重なったら1人確定・2人が選び直し', () => {
  const r = resolveSimultaneous({ 0: 10, 1: 10, 2: 10, 3: 11 }, seq(0.5));
  const lot = r.lotteries[0];
  assert.deepEqual(lot.players, [0, 1, 2]);
  assert.equal(lot.winner, 1); // 0.5 × 3人 → 1番目
  assert.deepEqual(r.losers, [0, 2]);
  assert.deepEqual(r.confirmed.map(c => [c.player, c.optionId, c.via]).sort(), [[1, 10, 'lottery'], [3, 11, 'single']]);
});

test('同時指名の選び直しは必ず終わる（重なりごとに1人確定）', () => {
  // 8人が毎回全員同じものを選んでも、7回の選び直しで全員そろう
  let pending = [0, 1, 2, 3, 4, 5, 6, 7], loops = 0;
  while (pending.length) {
    const sub = {}; pending.forEach(p => { sub[p] = 99; });
    pending = resolveSimultaneous(sub, Math.random).losers;
    loops++;
    assert.ok(loops <= 8);
  }
});

test('投票：自分への票は数えない・同数は同率優勝・0票なら優勝なし', () => {
  assert.deepEqual(tallyVotes({ 0: 1, 1: 0, 2: 1 }, 3), { counts: [1, 2, 0], winners: [1] });
  assert.deepEqual(tallyVotes({ 0: 1, 1: 2, 2: 0 }, 3).winners, [0, 1, 2]);
  assert.deepEqual(tallyVotes({ 0: 0 }, 3), { counts: [0, 0, 0], winners: [] });
});

test('検索は全角半角・カタカナひらがな・空白の違いを無視', () => {
  assert.ok(matchesQuery('マグロの赤身', 'まぐろ'));
  assert.ok(matchesQuery('大トロ', 'ｵｵﾄﾛ') === false); // 読み仮名は持たない（漢字は漢字で探す）
  assert.ok(matchesQuery('大 トロ', '大トロ'));
  assert.ok(matchesQuery('なんでも', ''));
});

test('残りの選択肢は確定した指名を除く', () => {
  const opts = [{ id: 1, label: 'a' }, { id: 2, label: 'b' }, { id: 3, label: 'c' }];
  assert.deepEqual(remainingOptions(opts, [{ optionId: 2 }]).map(o => o.id), [1, 3]);
});

test('テンプレートの選手名（ゲームの選手データ）は、使えない言葉のチェックに当たらない', async () => {
  await import('../../js/pick-card-safety.js');
  const safety = globalThis.PickCardSafety;
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const start = html.indexOf('const initialDatabase');
  const end = html.indexOf('];', start);
  const players = new Function(html.slice(start, end + 2) + '; return initialDatabase;')();
  const hit = players.map(p => p.name).filter(n => safety.check(n, null));
  assert.deepEqual(hit, []);
  assert.equal(safety.check('好きな寿司ネタ', null), null);
});

test('同時指名：重なった指名は抽選に回し、当たりはここでは決めない', () => {
  const g = groupSubmissions({ 0: 5, 1: 5, 2: 7, 3: 5 });
  assert.deepEqual(g.singles, [{ player: 2, optionId: 7 }]);
  assert.deepEqual(g.conflicts, [{ optionId: 5, players: [0, 1, 3] }]);
});

test('封筒の抽選：順番に1つずつ取り、全員が取ったら一斉に開ける。当たりの封筒を取った人が獲得', () => {
  let seed = 0.3; const rng = () => { seed = (seed * 9301 + 0.49297) % 1; return seed; };
  for (let k = 0; k < 20; k++) {
    const lot = setupLottery({ optionId: 5, players: [0, 1, 3] }, rng);
    assert.deepEqual([...lot.drawOrder].sort(), [0, 1, 3]);
    assert.equal(openLottery(lot), null, '全員が取る前は開けない');
    const first = nextDrawer(lot);
    assert.ok(takeEnvelope(lot, 2));
    assert.equal(lot.taken[2], first);
    assert.ok(!takeEnvelope(lot, 2), '取られた封筒は取れない');
    assert.ok(takeEnvelope(lot, 0));
    assert.ok(takeEnvelope(lot, 1));
    assert.ok(!takeEnvelope(lot, 1));
    assert.equal(nextDrawer(lot), null);
    const res = openLottery(lot);
    assert.equal(res.winner, lot.taken[lot.winEnv]);
    assert.deepEqual(res.losers.sort(), [0, 1, 3].filter(p => p !== res.winner).sort());
    assert.equal(openLottery(lot), null, '2回は開けない');
  }
});

test('選択肢を足す：追加できなかった入力（上限超え・記号だけ）を返す（入力欄に残すため）', () => {
  const many = Array.from({ length: 249 }, (_, i) => `x${i}`);
  const r = addOptions(addOptions([], many).options, ['🍣', 'い', '!!', ' ']);
  assert.equal(r.added, 1, '記号・絵文字だけの候補も、ほかと重ならなければ入る');
  assert.equal(r.overLimit, 2);
  assert.equal(r.empty, 1);
  assert.deepEqual(r.leftover, ['い', '!!']);
});

// ---------- 途中保存のデータの確かめ ----------
const base = () => ({ version: 2, phase: 'setup', title: '寿司', template: 'free', teams: [], players: ['あ', 'い', 'う'], options: [1, 2, 3, 4, 5, 6].map(i => ({ id: i, label: `候補${i}` })), mode: 'lottery', rounds: 2,
  order: [], round: 1, picks: [], turn: 0, sub: {}, queue: [], redo: [], rv: null, votes: {}, voteIdx: 0, msg: '' });

test('保存データ：v2 の設定中・途中のゲームを v3 にして受け入れる（元のデータは変えない）', () => {
  const raw = base();
  const r = validateState(raw);
  assert.ok(r.ok, r.reason);
  assert.equal(r.state.version, SAVE_VERSION);
  assert.equal(r.state.voteMode, 'vote');
  assert.equal(r.state.draftText, '');
  assert.equal(raw.version, 2);
  // 同時指名の途中（2人が選び終わった）
  const d = Object.assign(base(), { phase: 'draft', order: [2, 0, 1], queue: [2, 0, 1], turn: 2, sub: { 2: 1, 0: 3 } });
  assert.ok(validateState(d).ok, validateState(d).reason);
  // 抽選の途中（封筒を1人が取った）
  const lot = Object.assign(base(), { phase: 'draft', order: [0, 1, 2], queue: [0, 1, 2], picks: [{ round: 1, player: 2, optionId: 4, via: 'single' }], redo: [],
    rv: { sub: { 0: 1, 1: 1, 2: 4 }, lots: [{ optionId: 1, players: [0, 1], drawOrder: [1, 0], winEnv: 0, taken: { 1: 1 }, opened: false, winner: null }], idx: 0, stage: 'lottery', redo: false } });
  assert.ok(validateState(lot).ok, validateState(lot).reason);
  // 抽選が開いた後（外れた人が選び直す前）
  const opened = structuredClone(lot);
  Object.assign(opened.rv.lots[0], { taken: { 1: 1, 0: 0 }, opened: true, winner: 0 }); // 当たり＝0番の封筒＝0番の人
  opened.picks.push({ round: 1, player: 0, optionId: 1, via: 'lottery' }); opened.redo = [1]; opened.rv.stage = 'done';
  assert.ok(validateState(opened).ok, validateState(opened).reason);
  // 投票の途中
  const v = Object.assign(base(), { phase: 'vote', order: [0, 1, 2], voteIdx: 1, votes: { 0: 2 },
    picks: [0, 1, 2].flatMap(p => [1, 2].map(r => ({ round: r, player: p, optionId: p * 2 + r, via: 'waiver' }))) });
  assert.ok(validateState(v).ok, validateState(v).reason);
});

test('保存データ：壊れたもの・対応していない版は、理由つきで受け入れない（例外を出さない）', () => {
  const cases = [
    [null, '形'], [{ version: 9 }, '版'], [{ version: 2, phase: 'draft' }, ''],
    [Object.assign(base(), { phase: 'draft' }), '順番'],
    [Object.assign(base(), { players: ['あ'] }), '参加者'],
    [Object.assign(base(), { options: [{ id: 1, label: 'a' }, { id: 1, label: 'b' }] }), '選択肢'],
    [Object.assign(base(), { phase: 'draft', order: [0, 1, 2], queue: [0, 1, 2], picks: [{ round: 1, player: 0, optionId: 99 }] }), '指名'],
    [Object.assign(base(), { phase: 'draft', order: [0, 1, 2], queue: [0, 1, 2], picks: [{ round: 1, player: 0, optionId: 1 }, { round: 1, player: 1, optionId: 1 }] }), '指名'],
    [Object.assign(base(), { phase: 'draft', order: [0, 1, 2], queue: [0, 1, 2], turn: 1, sub: {} }), '同時指名'],
    [Object.assign(base(), { phase: 'draft', order: [0, 1, 2], queue: [0, 1, 2], rv: { sub: {}, lots: [{ optionId: 1, players: [0, 1], drawOrder: [0, 1], winEnv: 5, taken: {}, opened: false }], idx: 0, stage: 'lottery' } }), '抽選'],
    [Object.assign(base(), { phase: 'result', order: [0, 1, 2] }), 'そろって'],
    [Object.assign(base(), { phase: 'vote', order: [0, 1, 2], votes: { 0: 0 }, picks: [0, 1, 2].flatMap(p => [1, 2].map(r => ({ round: r, player: p, optionId: p * 2 + r }))) }), '投票'],
    [Object.assign(base(), { rounds: 0 }), '巡'],
  ];
  for (const [raw, word] of cases) {
    const r = validateState(raw);
    assert.equal(r.ok, false, JSON.stringify(raw).slice(0, 80));
    assert.ok(r.reason.includes(word), `${r.reason} / ${word}`);
  }
});

test('野球以外の候補の例：重複がなく、使えない言葉のチェックを通る', () => {
  const code = readFileSync(new URL('../../js/pick-card-safety.js', import.meta.url), 'utf8');
  const g = {}; new Function('globalThis', 'window', code)(g, g);
  const S = g.PickCardSafety || globalThis.PickCardSafety;
  for (const p of PRESETS) {
    const r = addOptions([], p.items);
    assert.equal(r.options.length, p.items.length, p.title);
    for (const it of [p.title, ...p.items]) assert.equal(S.check(it, null), null, `${p.title}：${it}`);
  }
});
