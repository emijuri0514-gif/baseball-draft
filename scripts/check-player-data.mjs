// 選手データ（index.htmlのinitialDatabase）の整合性チェック。
// 選手名鑑・ランキングも同じデータをfetchして表示するため、ここが通れば3画面とも同じ前提で動く。
// usage: npm run check:player-data
import fs from 'fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = html.indexOf('const initialDatabase');
const end = start === -1 ? -1 : html.indexOf('];', start);
if (end === -1) { console.error('index.html から initialDatabase を見つけられませんでした'); process.exit(1); }
const players = new Function(html.slice(start, end + 2) + '; return initialDatabase;')();

const TEAMS = ['巨人', '阪神', 'DeNA', '中日', 'ヤクルト', '広島', 'オリックス', 'ロッテ', 'ソフトバンク', '楽天', '日本ハム', '西武'];
const FIELD_POS = ['捕', '一', '二', '三', '遊', '左', '中', '右'];
const PITCH_POS = ['先発', '中継', '抑え'];
const POS_OF_EVAL = { '先発': '投手', '中継ぎ': '投手', '抑え': '投手', '捕手': '捕手', '内野手': '内野手', '外野手': '外野手' };
const KEYS = ['id', 'name', 'team', 'pos', 'bestPos', 'eval', 'fStats', 'pStats'];

const errors = [];
const err = (p, msg) => errors.push(`${p && p.name ? p.name : '(名前なし)'}（id:${p && p.id}）: ${msg}`);
const statOk = v => Number.isInteger(v) && v >= 1 && v <= 100;
const seenId = new Map(), seenName = new Map();

for (const p of players) {
  for (const k of Object.keys(p)) if (!KEYS.includes(k)) err(p, `想定外の項目 ${k}`);
  // ★ idは週刊ベースボールONLINEの選手ページIDをそのまま使う（8桁）。仮の連番だと詳細リンクが壊れる。
  if (!Number.isInteger(p.id) || String(p.id).length !== 8) err(p, 'idが8桁の整数ではない');
  if (seenId.has(p.id)) err(p, `idが ${seenId.get(p.id)} と重複`); else seenId.set(p.id, p.name);
  if (typeof p.name !== 'string' || !p.name.trim()) err(p, '名前が空');
  else if (seenName.has(p.name)) err(p, '名前が重複'); else seenName.set(p.name, p.id);
  if (!TEAMS.includes(p.team)) err(p, `球団名が不正: ${p.team}`);
  if (POS_OF_EVAL[p.eval] !== p.pos) err(p, `posとevalが食い違う: ${p.pos}/${p.eval}`);
  if (!Array.isArray(p.bestPos) || p.bestPos.length === 0) { err(p, 'bestPosが空'); continue; }
  if (new Set(p.bestPos).size !== p.bestPos.length) err(p, 'bestPosに重複');

  const isPitcher = p.pos === '投手';
  const stats = isPitcher ? p.pStats : p.fStats;
  if (!!p.fStats === !!p.pStats) err(p, 'fStatsとpStatsのどちらか一方だけを持つ必要がある');
  const statKeys = isPitcher ? ['pow', 'con', 'sta'] : ['meet', 'pow', 'run', 'def'];
  if (!stats) err(p, isPitcher ? 'pStatsがない' : 'fStatsがない');
  else {
    if (Object.keys(stats).sort().join() !== [...statKeys].sort().join()) err(p, `能力値の項目が不正: ${Object.keys(stats).join(',')}`);
    for (const k of statKeys) if (!statOk(stats[k])) err(p, `${k}が1〜100の整数ではない: ${stats[k]}`);
  }
  const allowed = isPitcher ? PITCH_POS : FIELD_POS;
  for (const pos of p.bestPos) if (!allowed.includes(pos)) err(p, `bestPosに不正な守備位置: ${pos}`);
  // ※ pos（NPBの登録区分）とbestPosの先頭（実際の本職）は一致しないことがある（周東佑京＝登録は内野手・本職は中堅など）。
  //   意図どおりのデータなので、ここでは照合しない。
}

const count = (f) => players.filter(f).length;
console.log(`選手 ${players.length}人（野手${count(p => p.fStats)}・投手${count(p => p.pStats)}）/ 球団ごと: ` +
  TEAMS.map(t => `${t}${count(p => p.team === t)}`).join(' '));
if (errors.length) {
  console.error(`\n${errors.length}件の問題が見つかりました:`);
  errors.forEach(e => console.error('  - ' + e));
  process.exit(1);
}
console.log('OK: id・名前の重複なし、項目・能力値・守備位置の形式に問題なし');
