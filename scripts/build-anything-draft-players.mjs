// なんでもドラフトのテンプレート（12球団の推し選手・応援歌）用の選手一覧（名前と球団だけ）を、
// ゲーム本体の選手データ（index.html の initialDatabase）から作る。手で書き写さない。
// usage: npm run build:anything-players        … data/anything-draft-players.json を書き出す
//        npm run check:anything-players        … 書き出し済みのファイルが最新か確かめる（PRのチェックで使う）
// ★ なんでもドラフトのページは、このJSONだけを読む（index.html の中のプログラムを読み取って実行しない）。
//   本体の変数名や並びが変わっても、なんでもドラフトはこのファイルの最後の版で動き続け、ここ（ビルド）で気づける。
import fs from 'fs';

const OUT = new URL('../data/anything-draft-players.json', import.meta.url);
const TEAMS = ['巨人', '阪神', 'DeNA', 'ヤクルト', '中日', '広島', 'オリックス', 'ロッテ', 'ソフトバンク', '楽天', '日本ハム', '西武'];
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = html.indexOf('const initialDatabase');
const end = start === -1 ? -1 : html.indexOf('];', start);
if (end === -1) { console.error('index.html から initialDatabase を見つけられませんでした（本体の選手データの書き方が変わった？）'); process.exit(1); }
const db = new Function(html.slice(start, end + 2) + '; return initialDatabase;')();
const players = db.map(p => ({ name: p.name, team: p.team }));
const bad = players.filter(p => typeof p.name !== 'string' || !p.name.trim() || !TEAMS.includes(p.team));
if (bad.length || players.length < 100) { console.error(`選手一覧の形がおかしい（${players.length}人、不正${bad.length}件）`); process.exit(1); }
const json = JSON.stringify({ about: 'なんでもドラフトのテンプレート用。index.html の選手データから npm run build:anything-players で作る。手で直さない', players }, null, 0).replace(/},{/g, '},\n{') + '\n';

if (process.argv.includes('--check')) {
  const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (cur !== json) { console.error('data/anything-draft-players.json が最新ではありません。npm run build:anything-players を実行してコミットしてください'); process.exit(1); }
  console.log(`✓ data/anything-draft-players.json は最新です（${players.length}人）`);
} else {
  fs.writeFileSync(OUT, json);
  console.log(`data/anything-draft-players.json を書き出しました（${players.length}人）`);
}
