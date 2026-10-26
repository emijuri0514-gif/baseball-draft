// なんでもドラフトの計算のテスト。実行：npm run test:anything-draft（node だけで動く。ブラウザ不要）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LIMITS, optionKey, addOptions, maxRounds, snakeOrder, shuffle, resolveSimultaneous, tallyVotes, matchesQuery, remainingOptions } from '../../js/anything-draft-core.mjs';

// 決まった順に値を返す乱数（テスト用）
const seq = (...vals) => { let i = 0; return () => vals[i++ % vals.length]; };

test('重複の判定は全角半角・カタカナひらがな・空白・記号の違いを無視する', () => {
  assert.equal(optionKey('ﾏｸﾞﾛ'), optionKey('まぐろ'));
  assert.equal(optionKey('大 トロ!'), optionKey('大トロ'));
  assert.equal(optionKey('ＡＢＣ'), optionKey('abc'));
});

test('選択肢を足す：重複・空・上限を数える', () => {
  let r = addOptions([], ['まぐろ', 'マグロ', '  ', 'いくら']);
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
