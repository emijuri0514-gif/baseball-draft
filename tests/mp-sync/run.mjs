// 友達対戦（2人）の自動テスト：本物の Firebase の代わりに回数を数えるだけの通信先を使い、
// ホストとゲストの2つのブラウザで1試合を最後まで自動で進める。本物の Firebase・GA4 には一切送らない。
//
// 確かめること
//   1. 3つのドラフト方式（NPB方式・全巡同時指名・完全ウェーバー）で、ドラフト → スタメン → 試合の録画まで進む
//   2. 1試合あたりの書き込みが上限以下（2026-10-31 に通信を減らした：以前は約103〜120回）
//   3. 古い版のページのゲスト（投函に key を付けない）とも最後まで進む
//
// 使い方：npm run test:mp-sync（2〜4分）。Chromium は PW_CHROMIUM（既定 /opt/pw-browsers/chromium）
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
const { chromium } = await import(path.join(ROOT, 'node_modules/playwright-core/index.mjs'));
const fakeApp = fs.readFileSync(path.join(here, 'fake-firebase-app.js'), 'utf8');
const fakeFs = fs.readFileSync(path.join(here, 'fake-firestore.js'), 'utf8');
const SCALE = 0.25; // ゲームの中の待ち時間（演出）を 1/4 にして早く進める

// 書き込みの上限（1試合）。以前の回数：NPB方式 103・全巡同時指名 120（くじ3回）・完全ウェーバー 103
// くじの回数は試合ごとに変わるので、くじが1回あるごとに上限を8回ぶん足す（L＝くじの回数）
const CASES = [
  { mode: 'npb', maxWrites: (L) => 80 + 8 * L },
  { mode: 'lottery', maxWrites: (L) => 72 + 8 * L },
  { mode: 'waiver', maxWrites: () => 80 },
  { mode: 'npb', maxWrites: (L) => 92 + 8 * L, oldGuest: true },
];

const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, r));
const BASE = `http://localhost:${server.address().port}/`;
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium' });

async function runMatch({ mode, oldGuest }) {
  const docs = {}; const listeners = []; const counts = { write: 0, read: 0 }; const kinds = {}; const errors = [];
  const deliver = (l) => {
    counts.read++;
    const snap = docs[l.path] ? JSON.parse(JSON.stringify(docs[l.path])) : null;
    setTimeout(() => l.page.evaluate(([id, d]) => window.__fsDeliver(id, d), [l.lid, snap]).catch(() => {}), 40);
  };
  const apply = (p, data, op) => {
    if (op === 'set') docs[p] = JSON.parse(JSON.stringify(data));
    else { const d = docs[p] || {}; for (const [k, v] of Object.entries(data)) d[k] = v && typeof v === 'object' && v.__au ? [...(d[k] || []), ...v.__au] : v; docs[p] = d; }
    for (const k of Object.keys(docs[p])) if (docs[p][k] && docs[p][k].__ts) docs[p][k] = Date.now();
  };
  const contexts = [];
  async function mkPage(who) {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    contexts.push(ctx);
    await ctx.route('**/*', (route) => {
      const u = route.request().url();
      if (u.includes('firebase-app.js')) return route.fulfill({ contentType: 'application/javascript', body: fakeApp });
      if (u.includes('firebase-firestore.js')) return route.fulfill({ contentType: 'application/javascript', body: fakeFs });
      if (u.startsWith(BASE)) return route.continue();
      return route.abort(); // GA4 など外への通信は止める
    });
    await ctx.addInitScript((scale) => {
      const st = window.setTimeout, si = window.setInterval;
      window.setTimeout = (f, d, ...a) => st(f, (d || 0) * scale, ...a);
      window.setInterval = (f, d, ...a) => si(f, Math.max(50, (d || 0) * scale), ...a);
    }, SCALE);
    await ctx.exposeBinding('__fs', async (src, q) => {
      if (q.op === 'listen') { const l = { page: src.page, lid: q.lid, path: q.path }; listeners.push(l); deliver(l); return null; }
      if (q.op === 'unlisten') { const i = listeners.findIndex(l => l.page === src.page && l.lid === q.lid); if (i >= 0) listeners.splice(i, 1); return null; }
      if (q.op === 'get') { counts.read++; return docs[q.path] ? JSON.parse(JSON.stringify(docs[q.path])) : null; }
      counts.write++;
      const k = Object.keys(q.data || {}).filter(x => x !== 'updatedAt').sort().join('+') || q.op;
      kinds[`${who}:${k}`] = (kinds[`${who}:${k}`] || 0) + 1;
      apply(q.path, q.data || {}, q.op);
      for (const l of listeners) if (l.path === q.path) deliver(l);
      return null;
    });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(`${who}: ${e.message}`));
    await page.goto(BASE + 'index.html');
    return page;
  }
  const host = await mkPage('host'), guest = await mkPage('guest');
  await host.selectOption('#draft-mode', mode);
  await host.evaluate(() => window.openMpLobby());
  await guest.evaluate(() => window.openMpLobby());
  await host.waitForFunction(() => window.MP);
  await host.evaluate(() => window.mpCreateRoom());
  await host.waitForFunction(() => /^[A-Z0-9]{5}$/.test(document.getElementById('mp-room-code').textContent));
  const code = await host.evaluate(() => document.getElementById('mp-room-code').textContent);
  await guest.waitForFunction(() => window.MP);
  // 古い版のゲスト：投函に key を付けない
  if (oldGuest) await guest.evaluate(() => { const o = window.MP.submitPendingPick; window.MP.submitPendingPick = (r, s, p) => o(r, s, p); });
  await guest.evaluate((c) => { document.getElementById('mp-join-code').value = c; document.getElementById('mp-join-team').selectedIndex = 1; return window.mpJoinRoom(); }, code);
  await host.waitForFunction(() => !document.getElementById('mp-start-btn').classList.contains('hidden'));
  await host.evaluate(() => window.mpStartRoom());

  // 人の代わりに操作する：自分の番なら指名、封筒、OK、スタメン（AIと同じ組み方）、試合（結果だけ）
  const step = (page, isHost) => page.evaluate((isHost) => {
    const vis = (id) => { const e = document.getElementById(id); return e && !e.classList.contains('hidden-screen'); };
    if (vis('app-modal')) { const bs = [...document.querySelectorAll('#app-modal-buttons button')]; const b = bs.find(x => x.textContent.trim() === 'OK') || bs[bs.length - 1]; if (b) b.click(); }
    if (vis('screen-stamen')) { try { window.stamenAnnounceContinue(); } catch (e) {} }
    if (vis('screen-lottery')) { const e = document.getElementById('env-0'); if (e && mpMyLotteryChoice === null) e.click(); }
    if (vis('screen-draft')) {
      const u = userTeamRef();
      if (u && u.needsPick && !u.currentPick && !mpSubmittedThisCycle) { const p = getAIPick(u); if (p) window.handleDraftSubmit(p.id); }
    }
    if (vis('screen-lineup') && !mpMyLineupSubmitted) {
      const L = buildAILineup(userTeamRef());
      lineupAssignments = {};
      L.batters.forEach((b, i) => { lineupAssignments['slot-b' + (i + 1)] = b.p.id; const s = document.getElementById('pos-b' + (i + 1)); if (s) { if (![...s.options].some(o => o.value === b.pos)) s.add(new Option(b.pos, b.pos)); s.value = b.pos; } });
      lineupAssignments['slot-p1'] = L.sp.id; lineupAssignments['slot-p2'] = L.rp.id; lineupAssignments['slot-p3'] = L.cp.id;
      mpSubmitOwnLineup();
    }
    if (vis('screen-ranking') && !window.__po) { window.__po = 1; window.startPlayoff(); }
    if (isHost && vis('screen-playoff')) { const m = getCurrentPlayoffMatch(); if (m && m.a && m.b && !m.resolved && window.__lastM !== m) { window.__lastM = m; window.playNextPlayoffMatch(true); } }
    return { round: currentRound, playoff: vis('screen-playoff') };
  }, isHost);

  const t0 = Date.now(); let done = false;
  while (Date.now() - t0 < 240000) {
    const h = await step(host, true), g = await step(guest, false);
    if (docs[Object.keys(docs)[0]]?.matchRecording && h.playoff && g.playoff) { done = true; break; }
    await new Promise(r => setTimeout(r, 150));
  }
  await new Promise(r => setTimeout(r, 500));
  const picks = (docs[Object.keys(docs)[0]]?.picks || []).length;
  for (const c of contexts) await c.close();
  return { done, picks, counts, kinds, errors, seconds: Math.round((Date.now() - t0) / 1000) };
}

let failed = 0;
for (const c of CASES) {
  const r = await runMatch(c);
  const label = `${c.mode}${c.oldGuest ? '（古い版のゲスト）' : ''}`;
  const problems = [];
  if (!r.done) problems.push('試合の録画まで進まなかった');
  if (r.picks !== 24) problems.push(`指名の数が ${r.picks}（24のはず）`);
  const lotteries = (r.kinds['host:lottery'] || 0) / 2;
  const limit = c.maxWrites(lotteries);
  if (r.counts.write > limit) problems.push(`書き込み ${r.counts.write} 回（上限 ${limit}・くじ ${lotteries} 回）`);
  if (r.errors.length) problems.push('ページのエラー：' + r.errors.slice(0, 3).join(' / '));
  console.log(`${problems.length ? 'NG' : 'OK'} ${label}：くじ ${lotteries} 回・書き込み ${r.counts.write}・読み取り ${r.counts.read}・指名 ${r.picks}・${r.seconds}秒${problems.length ? '\n   ' + problems.join('\n   ') : ''}`);
  if (problems.length) { failed++; console.log('   内訳', JSON.stringify(r.kinds)); }
}
await browser.close();
server.close();
if (failed) { console.log(`${failed} 件 NG`); process.exit(1); }
console.log('すべて OK');
