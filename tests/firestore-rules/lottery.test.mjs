// 野球くじ Firestore ルールのテスト（エミュレータ）。正常な操作が成功し、不正な操作が拒否されることを確認する。
// usage: cd tests/firestore-rules && npm install && npm test（Java 11以上が必要。本番には一切接続しない）
import fs from 'fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs, runTransaction, increment, arrayUnion, serverTimestamp } from 'firebase/firestore';

const env = await initializeTestEnvironment({ projectId: 'demo-lottery', firestore: { rules: fs.readFileSync(new URL('../../lottery-firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8080 } });
const results = [];
async function t(name, expectOk, fn) {
  try { await (expectOk ? assertSucceeds(fn()) : assertFails(fn())); results.push(['OK ', name]); }
  catch (e) { results.push(['NG ', name + ' — ' + String(e.message || e).slice(0, 160)]); }
}
async function seed() {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'games/g1'), { status: 'scheduled', home_team_id: 'A', away_team_id: 'B', market: { homeOdds: 1.8, awayOdds: 2.1, totalLine: 7.5, overOdds: 1.9, underOdds: 1.9 } });
    await setDoc(doc(db, 'games/g2'), { status: 'finished', home_team_id: 'A', away_team_id: 'B', market: { homeOdds: 1.8, awayOdds: 2.1, totalLine: 7.5, overOdds: 1.9, underOdds: 1.9 } });
    await setDoc(doc(db, 'draws/d1'), { status: 'open', unit_price: 100, ticket_count: 0, participant_uids: [] });
    await setDoc(doc(db, 'draws/d2'), { status: 'closed', unit_price: 100, ticket_count: 5, participant_uids: ['bob'] });
    await setDoc(doc(db, 'shop_items/s1'), { cost: 300 });
    await setDoc(doc(db, 'users/bob'), { display_name: 'b', total_points: 1000, prediction_history: [], point_history: [], unlocks: [] });
    await setDoc(doc(db, 'bets/bob_g1'), { user_id: 'bob', game_id: 'g1', bet_type: 'winner', bet_value: 'A', odds: 1.8, points_wagered: 100, result: 'pending' });
    await setDoc(doc(db, 'tickets/tb'), { user_id: 'bob', draw_id: 'd1', unit_price: 100, result: 'pending' });
  });
}
const newUser = { display_name: 'ゲスト', total_points: 1000, prediction_history: [], point_history: [{ at: 'x', total_points: 1000, note: '初期付与' }], unlocks: [] };
const bet = (uid, game, odds = 1.8) => ({ user_id: uid, game_id: game, bet_type: 'winner', bet_value: 'A', odds, points_wagered: 100, result: 'pending' });

await seed();
const alice = env.authenticatedContext('alice').firestore();
const admin = env.authenticatedContext('root', { admin: true }).firestore();
const anon = env.unauthenticatedContext().firestore();

// --- users ---
await t('users: 初期1000ptで自分のドキュメントを作れる', true, () => setDoc(doc(alice, 'users/alice'), newUser));
await seed();
await t('users: 初期ポイントを999999にして作れない', false, () => setDoc(doc(alice, 'users/alice'), { ...newUser, total_points: 999999 }));
await t('users: 解放アイテム入りで作れない', false, () => setDoc(doc(alice, 'users/alice'), { ...newUser, unlocks: ['s1'] }));
await t('users: 余計な項目(is_admin)付きで作れない', false, () => setDoc(doc(alice, 'users/alice'), { ...newUser, is_admin: true }));
await t('users: 他人のドキュメントは作れない', false, () => setDoc(doc(alice, 'users/carol'), newUser));
await t('users: 他人のポイントを読めない', false, () => getDoc(doc(alice, 'users/bob')));
await setDoc(doc(alice, 'users/alice'), newUser);
await t('users: 自分のポイントを増やせない', false, () => updateDoc(doc(alice, 'users/alice'), { total_points: 5000 }));
await t('users: 自分のポイントを予想で減らせる', true, () => updateDoc(doc(alice, 'users/alice'), { total_points: 900, prediction_history: ['x'] }));
await t('users: 他人のポイントを変えられない', false, () => updateDoc(doc(alice, 'users/bob'), { total_points: 1 }));
await t('users: ショップで正しい価格ぶん減らして解放できる', true, () => updateDoc(doc(alice, 'users/alice'), { total_points: 600, unlocks: ['s1'] }));
await t('users: admin はポイントを増やせる(払い戻し)', true, () => updateDoc(doc(admin, 'users/alice'), { total_points: 2000 }));

// --- bets ---
await t('bets: 受付中の試合に正しいオッズで予想できる', true, () => setDoc(doc(alice, 'bets/alice_g1'), bet('alice', 'g1')));
await t('bets: 結果確定済みの試合には予想できない', false, () => setDoc(doc(alice, 'bets/alice_g2'), bet('alice', 'g2')));
await t('bets: オッズを偽装できない', false, () => setDoc(doc(alice, 'bets/alice_g1x'), bet('alice', 'g1', 50)));
await t('bets: 他人名義で作れない', false, () => setDoc(doc(alice, 'bets/bob_g1b'), bet('bob', 'g1')));
await t('bets: 自分の予想を読める', true, () => getDocs(query(collection(alice, 'bets'), where('user_id', '==', 'alice'))));
await t('bets: 他人の予想を読めない', false, () => getDoc(doc(alice, 'bets/bob_g1')));
await t('bets: 自分で的中に書き換えられない', false, () => updateDoc(doc(alice, 'bets/alice_g1'), { result: 'won' }));
await t('bets: admin は精算用に全件読める', true, () => getDocs(query(collection(admin, 'bets'), where('game_id', '==', 'g1'), where('result', '==', 'pending'))));
await t('bets: 未ログインでは作れない', false, () => setDoc(doc(anon, 'bets/x_g1'), bet('x', 'g1')));

// --- tickets / draws（実際のクライアントと同じトランザクション）---
await t('tickets: 受付中のくじ回を購入できる(トランザクション)', true, () => runTransaction(alice, async tx => {
  const u = await tx.get(doc(alice, 'users/alice'));
  tx.set(doc(alice, 'tickets/ta1'), { ticket_id: 'ta1', user_id: 'alice', draw_id: 'd1', picks: [], unit_price: 100, result: 'pending', matched_count: null, payout: null, purchased_at: serverTimestamp() });
  tx.update(doc(alice, 'users/alice'), { total_points: u.data().total_points - 100, prediction_history: arrayUnion('ta1') });
  tx.update(doc(alice, 'draws/d1'), { ticket_count: increment(1), participant_uids: arrayUnion('alice') });
}));
await t('tickets: 締切済みのくじ回は購入できない', false, () => setDoc(doc(alice, 'tickets/ta2'), { user_id: 'alice', draw_id: 'd2', unit_price: 100, result: 'pending' }));
await t('tickets: 単価を偽装できない', false, () => setDoc(doc(alice, 'tickets/ta3'), { user_id: 'alice', draw_id: 'd1', unit_price: 1, result: 'pending' }));
await t('tickets: 他人のチケットを読めない', false, () => getDoc(doc(alice, 'tickets/tb')));
await t('tickets: 当選に書き換えられない', false, () => updateDoc(doc(alice, 'tickets/ta1'), { result: 'won', payout: 99999 }));
await t('draws: 他人を参加者に追加できない', false, () => updateDoc(doc(alice, 'draws/d1'), { ticket_count: increment(1), participant_uids: arrayUnion('mallory') }));
await t('draws: 参加者を消せない', false, () => updateDoc(doc(alice, 'draws/d1'), { ticket_count: increment(1), participant_uids: [] }));
await t('draws: 販売口数を一度に11以上増やせない', false, () => updateDoc(doc(alice, 'draws/d1'), { ticket_count: increment(11) }));
await t('draws: 締切済みの回は更新できない', false, () => updateDoc(doc(alice, 'draws/d2'), { ticket_count: increment(1), participant_uids: arrayUnion('alice') }));
await t('draws: 一般ユーザーはくじ回を作れない', false, () => setDoc(doc(alice, 'draws/d9'), { status: 'open', unit_price: 1, ticket_count: 0, participant_uids: [] }));
await t('draws: 一般ユーザーは精算(status変更)できない', false, () => updateDoc(doc(alice, 'draws/d1'), { status: 'settled' }));
await t('draws: admin はくじ回を作れる', true, () => setDoc(doc(admin, 'draws/d9'), { status: 'open', unit_price: 100, ticket_count: 0, participant_uids: [] }));
await t('draws: admin は精算できる', true, () => updateDoc(doc(admin, 'draws/d1'), { status: 'settled' }));
await t('games: 一般ユーザーは試合結果を書き換えられない', false, () => updateDoc(doc(alice, 'games/g1'), { status: 'finished' }));
await t('games: admin は試合結果を確定できる', true, () => updateDoc(doc(admin, 'games/g1'), { status: 'finished' }));
await t('shop_items: 一般ユーザーは価格を変えられない', false, () => updateDoc(doc(alice, 'shop_items/s1'), { cost: 1 }));

await env.cleanup();
results.forEach(r => console.log(r[0] + r[1]));
const ng = results.filter(r => r[0].startsWith('NG'));
console.log(`\n${results.length}件中 ${results.length - ng.length}件OK / ${ng.length}件NG`);
process.exit(ng.length ? 1 : 0);
