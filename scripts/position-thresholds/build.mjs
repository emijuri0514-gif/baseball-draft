// ポジション残数ボードの基準表（index.html の POSITION_BOARD_THRESHOLDS）を作り直す。
//
//   npm run build:position-thresholds            # 学習150回＋検証150回（3方式×12球団）→ 見逃し0件なら index.html に書き込む
//   npm run build:position-thresholds -- --runs 40 --dry-run   # お試し（書き込まない）
//
// 流れ：
//   1. index.html を実際にブラウザ（Chromium）で開き、ゲーム本体の getAIPick() / computeBoardN() / canPlayForBoard()
//      をそのまま使って、12球団のドラフトを3方式（NPB・全巡同時指名・完全ウェーバー）で繰り返す。
//      1球団は「ポジションを気にせず総合力順に取る人間役」にして、未確保のまま進む状況を作る。
//   2. 学習用の回から「N回の指名で各ポジションの人数が何人減ったか」を集め、99%点を表にする（N=1〜33）。
//   3. 学習とは別の乱数で回した検証用の回で、表どおりに危険・注意を出したときの見逃しを数える。
//      見逃し（次の番までに0人になったのに危険を出さなかった／その次の番までに0人になったのに危険・注意を出さなかった）
//      が1件でもあれば、書き込まずに終了コード1で終わる（--force で強制的に書き込める）。
//
// 作り直しが必要な場面と手順は、非公開リポジトリの docs/POSITION_BOARD_THRESHOLDS.md を参照。
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright-core';
import { computeSourceHash } from './source-hash.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const RUNS = +opt('runs', 150);
const SEED = +opt('seed', 20260930);
const TEAMS = +opt('teams', 12);
const DRY = args.includes('--dry-run');
const FORCE = args.includes('--force');
const QUANTILE = 0.99;
const NMAX = 33;
const MODES = ['npb', 'lottery', 'waiver'];
const POS = ['捕', '一', '二', '三', '遊', '左', '中', '右', '先発', '中継', '抑え'];

// ---- 静的サーバー（リポジトリ直下を配信） ----
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  const type = p.endsWith('.html') ? 'text/html; charset=utf-8' : p.endsWith('.css') ? 'text/css' : p.endsWith('.js') || p.endsWith('.mjs') ? 'application/javascript' : 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type }); res.end(fs.readFileSync(p));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const exe = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch(exe ? { executablePath: exe } : {});

// ---- ページ内で動かすシミュレーション（ゲーム本体の関数をそのまま使う） ----
function simulate({ RUNS, T, mode, collectTimelines }) {
  const POS = ['捕', '一', '二', '三', '遊', '左', '中', '右', '先発', '中継', '抑え'];
  const isW = r => mode === 'lottery' ? false : mode === 'waiver' ? true : r >= 2;
  // 「守れる」は選手ごとに固定なので先に計算しておく
  const can = new Map(initialDatabase.map(p => [p.id, POS.map(x => canPlayForBoard(p, x))]));
  const counts = () => POS.map((_, k) => availablePlayers.reduce((s, p) => s + (can.get(p.id)[k] ? 1 : 0), 0));
  const timelines = [], events = [];
  for (let run = 0; run < RUNS; run++) {
    availablePlayers = [...initialDatabase];
    const names = shuffleArray([...ALL_TEAMS]).slice(0, T);
    teams = names.map((n, i) => ({ id: i, name: n + '(AI)', baseName: n, isUser: false, color: TEAM_STYLE[n], roster: [], needsPick: true, scouting: TEAM_SCOUTING[n] || DEFAULT_SCOUTING }));
    const human = teams[Math.floor(Math.random() * T)];
    const base = shuffleArray(teams.map(t => t.id));
    const humanPick = () => { // ポジションを気にせず総合力順（人数の枠だけは守る）
      const miss = getMissingPositions(human.roster);
      let c = availablePlayers.filter(x => miss.includes(x.pos)); if (!c.length) c = availablePlayers;
      return c.reduce((a, x) => getBaseStat(x) > getBaseStat(a) ? x : a, c[0]);
    };
    const tl = [counts()], dec = [];
    const take = (t, pl) => { t.roster.push(pl); t.needsPick = false; availablePlayers = availablePlayers.filter(x => x.id !== pl.id); tl.push(counts()); };
    const decide = (round, st) => {
      const n = computeBoardN({ isWaiverRound: isW, round, totalRounds: TOTAL_ROUNDS, teams, userId: human.id, queue: st.queue, qpos: st.qpos, base, onClock: true });
      dec.push({ round, time: tl.length - 1, R: tl[tl.length - 1].slice(), n1: n.n1, n2: n.n2, secured: POS.map((_, k) => human.roster.some(p => can.get(p.id)[k])) });
    };
    for (let round = 1; round <= TOTAL_ROUNDS; round++) {
      teams.forEach(t => t.needsPick = true);
      if (isW(round)) {
        const queue = round % 2 === 0 ? [...base] : [...base].reverse();
        queue.forEach((id, qpos) => {
          const t = teams.find(x => x.id === id);
          if (t === human) { decide(round, { queue, qpos }); take(t, humanPick()); }
          else { const pk = getAIPick(t); if (pk) take(t, pk); else t.needsPick = false; }
        });
      } else {
        for (let guard = 0; teams.some(t => t.needsPick) && guard < 20; guard++) {
          if (human.needsPick) decide(round, { queue: [], qpos: 0 });
          const bids = new Map();
          teams.filter(t => t.needsPick).forEach(t => {
            const pk = t === human ? humanPick() : getAIPick(t);
            if (!pk) { t.needsPick = false; return; }
            if (!bids.has(pk.id)) bids.set(pk.id, { pl: pk, ts: [] });
            bids.get(pk.id).ts.push(t);
          });
          // 競合は抽選。外れた球団は needsPick のまま残って再指名する
          for (const { pl, ts } of bids.values()) take(ts[Math.floor(Math.random() * ts.length)], pl);
        }
      }
    }
    if (collectTimelines) timelines.push(tl);
    dec.forEach(d => {
      const nx = dec.find(e => e.round > d.round), nx2 = nx && dec.find(e => e.round > nx.round);
      const end1 = nx ? nx.time : tl.length - 1, end2 = nx2 ? nx2.time : tl.length - 1;
      POS.forEach((x, k) => {
        if (d.secured[k]) return;
        let g1 = 0, g2 = 0;
        for (let i = d.time; i <= end1; i++) if (tl[i][k] === 0) g1 = 1;
        for (let i = d.time; i <= end2; i++) if (tl[i][k] === 0) g2 = 1;
        events.push([k, d.R[k], d.n1, d.n2, g1, g2]);
      });
    });
  }
  return { timelines, events };
}

async function runPhase(seed, collectTimelines) {
  const ctx = await browser.newContext();
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.abort());
  await ctx.addInitScript(s => { // 乱数を固定（同じシードなら同じ結果）
    let x = s >>> 0; Math.random = () => { x |= 0; x = x + 0x6D2B79F5 | 0; let t = Math.imul(x ^ x >>> 15, 1 | x); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }, seed);
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof computeBoardN === 'function' && typeof getAIPick === 'function');
  const out = {};
  for (const mode of MODES) {
    process.stdout.write(`  ${mode}…`);
    out[mode] = await page.evaluate(simulate, { RUNS, T: TEAMS, mode, collectTimelines });
  }
  process.stdout.write('\n');
  await ctx.close();
  if (errs.length) throw new Error('ページでエラー: ' + errs[0]);
  return out;
}

const quantile = (sorted, q) => { // numpy.quantile(linear) と同じ
  const h = (sorted.length - 1) * q, lo = Math.floor(h), hi = Math.ceil(h);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
};

console.log(`シミュレーション：${TEAMS}球団 × 3方式 × 学習${RUNS}回（シード${SEED}）`);
const train = await runPhase(SEED, true);
console.log(`検証：${TEAMS}球団 × 3方式 × ${RUNS}回（シード${SEED + 1}、学習とは別）`);
const valid = await runPhase(SEED + 1, false);
await browser.close(); server.close();

// ---- 表を作る：N回の指名での減少数の99%点（Nが増えても下がらないようにする） ----
const table = {};
POS.forEach((p, k) => {
  const row = [0];
  for (let N = 1; N <= NMAX; N++) {
    const d = [];
    for (const m of MODES) for (const tl of train[m].timelines) for (let i = 0; i + N < tl.length; i++) d.push(tl[i][k] - tl[i + N][k]);
    d.sort((a, b) => a - b);
    row.push(Math.max(row[N - 1], Math.ceil(quantile(d, QUANTILE) - 1e-9)));
  }
  table[p] = row;
});

// ---- 検証（index.html の boardStatus() と同じ判定） ----
const D = (p, N) => { if (N == null || N <= 0) return 0; const t = table[p]; if (N < t.length) return t[N]; const last = t.length - 1, tail = (t[last] - t[last - 10]) / 10; return t[last] + Math.ceil((N - last) * tail); };
const validation = {};
let totalMiss = 0;
for (const m of MODES) {
  let n = 0, danger = 0, caution = 0, gone1 = 0, miss1 = 0, gone2 = 0, miss2 = 0;
  for (const [k, R, n1, n2, g1, g2] of valid[m].events) {
    const p = POS[k], d = D(p, n1), c = Math.max(D(p, n2), d + 2);
    const isD = R <= d || R === 0, isC = !isD && R <= c;
    n++; danger += isD; caution += isC;
    if (g1 && n1 > 0) { gone1++; if (!isD) miss1++; } // N=0（他球団が挟まらない）は自分で取れるので対象外
    if (g2 && !g1) { gone2++; if (!isD && !isC) miss2++; }
  }
  validation[m] = { decisions: n, dangerRate: +(danger / n * 100).toFixed(1), cautionRate: +(caution / n * 100).toFixed(1), gone1, miss1, gone2, miss2 };
  totalMiss += miss1 + miss2;
}

console.log('\n検証結果（未確保のポジションについて、自分の番ごとに判定）');
for (const m of MODES) {
  const v = validation[m];
  console.log(`  ${m.padEnd(8)} 判定${v.decisions}件  危険${v.dangerRate}%  注意${v.cautionRate}%  見逃し：危険 ${v.miss1}/${v.gone1}件・注意 ${v.miss2}/${v.gone2}件`);
}
console.log('\n基準表（N回の指名で最大何人減るか・99%点）');
console.log('  N:    ' + [1, 5, 11, 22, 33].map(n => String(n).padStart(3)).join(''));
POS.forEach(p => console.log(`  ${p.padEnd(3, '　')}  ` + [1, 5, 11, 22, 33].map(n => String(table[p][n]).padStart(3)).join('')));

const indexPath = path.join(ROOT, 'index.html');
const html = fs.readFileSync(indexPath, 'utf8');
const { hash, missing } = computeSourceHash(html);
if (missing.length) console.warn('\n⚠️ ハッシュ対象が見つからない関数・定数があります：' + missing.join(', '));

if (totalMiss > 0 && !FORCE) {
  console.error(`\n✗ 検証で見逃しが${totalMiss}件あったため、index.html は書き換えていません（--force で強制）。`);
  process.exit(1);
}
if (DRY) { console.log('\n--dry-run のため書き込みません。'); process.exit(0); }

const block = {
  generatedAt: new Date().toISOString().slice(0, 10),
  sourceHash: hash,
  method: { teams: TEAMS, modes: MODES, trainRuns: RUNS, validateRuns: RUNS, seed: SEED, quantile: QUANTILE },
  validation,
  table,
};
const re = /const POSITION_BOARD_THRESHOLDS = \{.*\};/;
if (!re.test(html)) { console.error('index.html に POSITION_BOARD_THRESHOLDS が見つかりません'); process.exit(1); }
fs.writeFileSync(indexPath, html.replace(re, `const POSITION_BOARD_THRESHOLDS = ${JSON.stringify(block)};`));
console.log(`\n✓ index.html の基準表を更新しました（sourceHash ${hash}）。changelog/devblog の更新は不要ですが、PRの説明に検証結果を貼ってください。`);
