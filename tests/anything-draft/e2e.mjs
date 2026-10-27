// なんでもドラフトの画面のテスト（Playwright）。実行：npm run test:anything-draft-e2e
// ・この場で小さなサーバーを立てて、リポジトリのファイルをそのまま配る（本番・利用者のデータは使わない）
// ・外への通信（GA4 など）は止める。乱数（crypto.getRandomValues）は固定して、抽選の結果を再現できるようにする
// ・ブラウザは playwright-core。CHROMIUM_PATH（なければ /opt/pw-browsers/chromium）を使う
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = process.env.E2E_OUT || null; // 画像を書き出す場所（任意）
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  const p = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' }); res.end(fs.readFileSync(p));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/anything-draft.html`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });

let fails = 0, passes = 0;
const ok = (c, m) => { if (c) passes++; else { fails++; console.log('NG  ' + m); } if (process.env.VERBOSE) console.log((c ? 'OK  ' : 'NG  ') + m); };
const section = t => console.log(`--- ${t}`);

// 乱数を固定する（同じ seed なら同じ順番・同じ当たりの封筒になる）
function seedScript(seed) {
  let x = seed >>> 0;
  const next = () => { x = (x + 0x6D2B79F5) | 0; let t = Math.imul(x ^ (x >>> 15), 1 | x); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return (t ^ (t >>> 14)) >>> 0; };
  crypto.getRandomValues = arr => { for (let i = 0; i < arr.length; i++) arr[i] = next(); return arr; };
}
async function open({ width = 390, height = 844, seed = 1, init = null, storage = null, context = null, enter = true } = {}) {
  const ctx = context || await browser.newContext({ viewport: { width, height }, isMobile: width < 640, hasTouch: width < 640 });
  if (!context) await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.abort());
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED|ERR_ABORTED/.test(m.text())) errs.push(m.text()); });
  await page.addInitScript(seedScript, seed);
  await page.addInitScript(() => { window.__opened = []; window.open = (...a) => { window.__opened.push(a); return null; }; });
  if (storage != null) await page.addInitScript(v => { if (!sessionStorage.getItem('__seeded')) { localStorage.setItem('dt9_anything_v1', v); sessionStorage.setItem('__seeded', '1'); } }, storage);
  if (init) await page.addInitScript(init);
  await page.goto(BASE);
  // はじめの画面（イラスト・説明）から、遊ぶ画面に入る（保存データがあるときは「続きから／最初から」を選ぶまで入らない）
  if (enter && await page.locator('#ad-enter').isVisible()) await page.click('#ad-enter');
  await page.waitForSelector('#ad-app > *', { state: 'attached' });
  return { ctx, page, errs };
}
const app = page => page.locator('#ad-app');
// 読み込み直して、はじめの画面なら遊ぶ画面に入る
async function reloadEnter(page) { await page.reload(); await page.waitForSelector('#ad-enter', { state: 'attached' }); if (await page.locator('#ad-enter').isVisible()) await page.click('#ad-enter'); await page.waitForSelector('#ad-title'); }
const text = async page => (await app(page).innerText());
const clickBtn = (page, re) => page.locator('#ad-app button', { hasText: re }).first().click();
const saved = page => page.evaluate(() => JSON.parse(localStorage.getItem('dt9_anything_v1') || 'null'));
async function setup(page, { title, players, options, mode = 'lottery', rounds, vote }) {
  await page.fill('#ad-title', title);
  for (let i = 2; i < players.length; i++) await page.locator('#ad-app button', { hasText: '＋ 参加者を足す' }).click();
  for (let i = 0; i < players.length; i++) await page.fill(`input[aria-label="参加者${i + 1}の名前"]`, players[i]);
  if (options) { await page.fill('#ad-opt-input', options.join('\n')); await clickBtn(page, /^選択肢に追加$/); }
  await page.check(`input[name="ad-mode"][value="${mode}"]`);
  if (vote) await page.check(`input[name="ad-vote"][value="${vote}"]`);
  if (rounds) await page.selectOption('#ad-rounds', String(rounds));
}
// 候補を選んでから「〜で指名する」（label を省くと一番上）
async function pick(page, label) {
  let b = label ? page.locator(`#ad-app button[aria-label="${label}を選ぶ"]`) : null;
  if (!b || !(await b.count())) b = page.locator('#ad-app button.ad-opt').first(); // もう取られていたら一番上
  await b.click();
  await page.locator('#ad-app button', { hasText: /で指名する$/ }).click();
}
// 進行を最後まで進める（同時指名・ウェーバー・抽選・投票）。choose：候補の選び方
async function playThrough(page, { choose = () => null, voteFor = () => 0, max = 3000 } = {}) {
  for (let g = 0; g < max; g++) {
    const t = await text(page);
    if (/優勝：|同率優勝：|ドラフト終了/.test(t) && /結果を残す/.test(t)) return true;
    if (/です（選ぶ）/.test(t)) { await clickBtn(page, /です（選ぶ）/); continue; }
    if (/で指名する|候補を選んでください/.test(t) && /さんが選ぶ番|さんの番です/.test(t)) { await pick(page, choose(t)); continue; }
    if (/さんに渡す$/m.test(t)) { await clickBtn(page, /さんに渡す$/); continue; }
    if (/発表する/.test(t)) { await clickBtn(page, /^発表する$/); continue; }
    if (/抽選へ（封筒を選ぶ）/.test(t)) { await clickBtn(page, /抽選へ（封筒を選ぶ）/); continue; }
    if (/封筒を1つ選んでください/.test(t)) { await page.locator('#ad-app button.ad-env:not([disabled])').first().click(); continue; }
    if (/一斉に開ける/.test(t)) { await clickBtn(page, /一斉に開ける/); continue; }
    if (/次の抽選へ|発表に戻る/.test(t)) { await clickBtn(page, /次の抽選へ|発表に戻る/); continue; }
    if (/外れた人が選び直す/.test(t)) { await clickBtn(page, /外れた人が選び直す/); continue; }
    if (/第\d+巡へ|結果へ進む/.test(t)) { await clickBtn(page, /第\d+巡へ|結果へ進む/); continue; }
    if (/です（投票する）/.test(t)) { await clickBtn(page, /です（投票する）/); continue; }
    if (/さんに投票/.test(t)) { const bs = page.locator('#ad-app button', { hasText: /さんに投票/ }); await bs.nth(Math.min(voteFor(t), (await bs.count()) - 1)).click(); continue; }
    throw new Error('進められない画面：' + t.slice(0, 120));
  }
  return false;
}
const noOverflow = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
const sushi = ['まぐろ', 'サーモン', 'えび', 'いか', 'たこ', 'うに', 'いくら', 'ほたて', 'あじ'];

// ================= P1 =================
section('R1 設定の途中の保存と復元・未追加の入力');
{
  const { ctx, page, errs } = await open();
  await setup(page, { title: '寿司', players: ['あおい', 'かいと'], options: ['まぐろ', 'サーモン', 'えび', 'いか'], mode: 'waiver', vote: 'none', rounds: 2 });
  await page.fill('#ad-opt-input', 'うに\nいくら');
  await page.waitForTimeout(500);
  const s = await saved(page);
  ok(s && s.version === 3 && s.phase === 'setup' && s.title === '寿司' && s.players.join() === 'あおい,かいと' && s.options.length === 4 && s.draftText === 'うに\nいくら' && s.mode === 'waiver' && s.voteMode === 'none' && s.rounds === 2, `設定の途中を保存（${JSON.stringify(s && { t: s.title, p: s.players, o: s.options.length, d: s.draftText, m: s.mode, v: s.voteMode, r: s.rounds })}）`);
  await page.reload(); await page.waitForSelector('#ad-title');
  ok(await page.inputValue('#ad-title') === '寿司', '開き直してもお題が残る');
  ok(await page.inputValue('input[aria-label="参加者2の名前"]') === 'かいと', '名前が残る');
  ok(await page.inputValue('#ad-opt-input') === 'うに\nいくら', '追加していない入力も残る');
  ok(await page.locator('#ad-app li[data-label]').count() === 4, '候補が残る');
  ok(await page.isChecked('input[name="ad-mode"][value="waiver"]') && await page.isChecked('input[name="ad-vote"][value="none"]') && await page.inputValue('#ad-rounds') === '2', '方式・投票・巡の数が残る（画面と保存が同じ）');
  // 未追加の入力があるまま始めると、自動で追加してから始める（使えない言葉があれば始めない）
  await page.fill('#ad-opt-input', 'うに\nばか');
  await page.click('#ad-start');
  ok(/使えない言葉が含まれています/.test(await page.locator('#ad-app [role=alert]').innerText()) && (await saved(page)).phase === 'setup' && await page.inputValue('#ad-opt-input') === 'うに\nばか', '入力欄に使えない言葉があると、自動で追加せず・始めない（入力はそのまま）');
  await page.fill('#ad-opt-input', 'うに\nいくら\nまぐろ');
  await page.click('#ad-start');
  const s2 = await saved(page);
  ok(s2.phase === 'draft' && s2.options.length === 6 && s2.options.some(o => o.label === 'いくら') && s2.options.filter(o => o.label === 'まぐろ').length === 1, `「選択肢に追加」を押さずに始めても、入力欄の分を自動で追加して始める（重複は除く。${s2.options.length}個）`);
  ok(/入力欄に残っていた2個を、選択肢に追加してから始めました/.test(await text(page)), '自動で追加したことを一言表示する');
  ok(s2.rounds === 2, '開始後の巡の数が、画面で選んだ数と同じ');
  // 変換中（確定前）は入力を書き換えない
  const p2 = (await open()).page;
  const long = 'あ'.repeat(35);
  const during = await p2.evaluate(v => { const i = document.getElementById('ad-title'); i.value = v; i.dispatchEvent(new InputEvent('input', { isComposing: true, bubbles: true })); const a = i.value.length; i.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })); return [a, i.value.length]; }, long);
  ok(during[0] === 35 && during[1] === 30, `日本語の変換中は書き換えず、確定後に30文字にそろえる（${during}）`);
  ok(errs.length === 0, 'エラーなし ' + errs.join('|'));
  await ctx.close(); await p2.context().close();
}

section('R2 テンプレートの読み込みの遅れ・取り消し・失敗・件数');
{
  let delay = 1500, fail = false;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.abort());
  const reqs = [];
  await ctx.route('**/data/anything-draft-players.json', async r => { reqs.push(Date.now()); if (fail) return r.abort(); await new Promise(z => setTimeout(z, delay)); await r.continue(); });
  ctx.on('request', q => { if (/index\.html$/.test(q.url())) reqs.push('index'); });
  const { page, errs } = await open({ context: ctx });
  await setup(page, { title: '推し', players: ['A太', 'B子'], options: ['まぐろ', 'サーモン', 'えび', 'いか'], mode: 'waiver' });
  await page.check('input[name="ad-tpl"][value="oshi"]');
  await page.check('#ad-app input[type=checkbox][value="巨人"]');
  await clickBtn(page, /選んだ球団の選手を選択肢に読み込む/);
  ok(/読み込んでいます/.test(await text(page)), '読み込み中と分かる');
  await page.click('#ad-start');
  ok(/読み込んでいます。読み込みが終わるまで待つか/.test(await page.locator('#ad-app [role=alert]').innerText()), '読み込み中は、黙って始めない（取り消す道がある）');
  await page.locator('#ad-app [role=alert] button', { hasText: '読み込みを取り消す' }).click();
  await page.click('#ad-start');
  await page.waitForTimeout(delay + 500);
  const s = await saved(page);
  ok(s.phase === 'draft' && s.options.length === 4, `始めた後に遅れて届いた選手は、候補に入らない（候補${s.options.length}個）`);
  ok(await page.locator('#ad-app button.ad-opt').count() === 4, '選ぶ画面の候補も4個のまま');
  await clickBtn(page, /^最初から$/).catch(() => {});
  // 古い読み込みが新しい読み込みを上書きしない：巨人を読み込み→取り消し→阪神を読み込み
  const p2 = (await open({ context: ctx })).page;
  await p2.evaluate(() => localStorage.clear()); await reloadEnter(p2);
  await p2.check('input[name="ad-tpl"][value="oshi"]');
  await p2.check('#ad-app input[type=checkbox][value="巨人"]');
  delay = 1500; await clickBtn(p2, /選んだ球団の選手を選択肢に読み込む/);
  await clickBtn(p2, /^読み込みを取り消す$/);
  await p2.uncheck('#ad-app input[type=checkbox][value="巨人"]'); await p2.check('#ad-app input[type=checkbox][value="阪神"]');
  delay = 100; await clickBtn(p2, /選んだ球団の選手を選択肢に読み込む/);
  await p2.waitForTimeout(2200);
  const s2 = await saved(p2);
  const teams2 = [...new Set(s2.options.map(o => o.team))];
  ok(teams2.length === 1 && teams2[0] === '阪神', `取り消した古い読み込みは反映しない（${teams2}）`);
  // 件数：すでにある1人＋巨人・西武をまとめて読み込む
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/anything-draft-players.json'), 'utf8')).players;
  const giants = data.filter(p => p.team === '巨人'), lions = data.filter(p => p.team === '西武');
  const p3 = (await open({ context: ctx })).page;
  await p3.evaluate(() => localStorage.clear()); await reloadEnter(p3);
  await p3.fill('#ad-opt-input', giants[0].name + '\n' + lions[0].name); await clickBtn(p3, /^選択肢に追加$/);
  await p3.check('input[name="ad-tpl"][value="oshi"]');
  await p3.check('#ad-app input[type=checkbox][value="巨人"]'); await p3.check('#ad-app input[type=checkbox][value="西武"]');
  await clickBtn(p3, /選んだ球団の選手を選択肢に読み込む/);
  await p3.waitForFunction(() => /人読み込みました/.test(document.getElementById('ad-app').innerText), null, { timeout: 5000 });
  const msg = await text(p3);
  const exp = `2球団の選手を${giants.length + lions.length - 2}人読み込みました（すでにある2件は除きました）`;
  ok(msg.includes(exp), `追加・重複の件数を、全部の球団分で数える（${msg} / 期待：${exp}）`);
  // 失敗しても、また読み込める・始められる
  fail = true;
  const p4 = (await open({ context: ctx })).page;
  await p4.evaluate(() => localStorage.clear()); await reloadEnter(p4);
  await p4.check('input[name="ad-tpl"][value="oshi"]'); await p4.check('#ad-app input[type=checkbox][value="広島"]');
  await clickBtn(p4, /選んだ球団の選手を選択肢に読み込む/);
  await p4.waitForFunction(() => /読み込めませんでした/.test(document.getElementById('ad-app').innerText));
  ok(await p4.locator('#ad-app button', { hasText: '選んだ球団の選手を選択肢に読み込む' }).isEnabled(), '読み込みに失敗しても、もう一度押せる（始められない状態にならない）');
  ok(!reqs.includes('index'), 'テンプレートは index.html を読まない（data/anything-draft-players.json だけ）');
  ok(errs.length === 0, 'エラーなし ' + errs.join('|'));
  await ctx.close();
}

section('R3 保存・削除の失敗を知らせる');
{
  const { ctx, page, errs } = await open({ init: () => {
    const orig = Storage.prototype.setItem, origRm = Storage.prototype.removeItem;
    window.__failSave = true; window.__failRemove = true;
    Storage.prototype.setItem = function (k, v) { if (window.__failSave && k === 'dt9_anything_v1') throw new DOMException('quota', 'QuotaExceededError'); return orig.call(this, k, v); };
    Storage.prototype.removeItem = function (k) { if (window.__failRemove && k === 'dt9_anything_v1') throw new DOMException('denied', 'SecurityError'); return origRm.call(this, k); };
  } });
  ok(await page.isVisible('#ad-status') && /途中保存できません/.test(await page.locator('#ad-status').innerText()), '保存できないことを画面の上に出す');
  await setup(page, { title: '寿司', players: ['A', 'B'], options: sushi.slice(0, 4), mode: 'waiver' });
  await page.click('#ad-start'); await pick(page);
  ok((await text(page)).includes('さんの番です'), '保存できなくても、今の画面の進行は続く');
  await page.evaluate(() => { window.__failSave = false; });
  await pick(page);
  ok(!(await page.isVisible('#ad-status')), '保存できるようになったら、知らせを消す');
  await page.evaluate(() => { window.__failSave = false; });
  await playThrough(page);
  await clickBtn(page, /^最初から$/);
  ok(/途中のデータを消せませんでした/.test(await page.locator('#ad-status').innerText()), '削除に失敗したことも知らせる');
  ok(errs.length === 0, 'エラーなし ' + errs.join('|'));
  await ctx.close();
}

section('R4 保存データの確かめ');
{
  for (const [raw, word] of [['{"version":2,"phase":"draft"}', '読み込めませんでした'], ['{"version":9}', '対応していない'], ['{nojson', '形が読み取れません']]) {
    const { ctx, page, errs } = await open({ storage: raw });
    const box = await page.locator('#ad-resume').innerText();
    ok(box.includes(word) && box.includes('理由'), `壊れた保存データは理由を出す（${word}）`);
    ok((await page.evaluate(() => localStorage.getItem('dt9_anything_v1'))) === raw, '選ぶまで、保存データを消さない・上書きしない');
    await page.locator('#ad-resume button', { hasText: '新しく始める' }).click();
    ok(await page.isVisible('#ad-title'), '「新しく始める」で設定の画面へ');
    ok(errs.length === 0, 'エラーなし ' + errs.join('|'));
    await ctx.close();
  }
  // 正しい v2 の抽選の途中（10/26 版の形）
  const v2 = { version: 2, phase: 'draft', title: '寿司', template: 'free', teams: [], players: ['あ', 'い', 'う'], options: sushi.slice(0, 6).map((l, i) => ({ id: i + 1, label: l })), mode: 'lottery', rounds: 2,
    order: [0, 1, 2], round: 1, picks: [{ round: 1, player: 2, optionId: 4, via: 'single' }], turn: 0, sub: {}, queue: [0, 1, 2], redo: [],
    rv: { sub: { 0: 1, 1: 1, 2: 4 }, lots: [{ optionId: 1, players: [0, 1], drawOrder: [1, 0], winEnv: 0, taken: { 1: 1 }, opened: false, winner: null }], idx: 0, stage: 'lottery', redo: false }, votes: {}, voteIdx: 0, msg: '' };
  const { ctx, page, errs } = await open({ storage: JSON.stringify(v2) });
  ok(/途中のドラフトがあります（寿司）/.test(await page.locator('#ad-resume').innerText()), '正しい v2 の途中のデータは「続きから」を出す');
  await page.click('#ad-resume-yes');
  const t = await text(page);
  ok(/あ さんの番：封筒を1つ選んでください/.test(t) && await page.locator('#ad-app button.ad-env[disabled]').count() === 1, '抽選の途中（1人が封筒を取った）から再開');
  ok((await saved(page)).version === 3, '再開すると v3 の形で保存し直す');
  ok(errs.length === 0, 'エラーなし ' + errs.join('|'));
  await ctx.close();
}

// ================= P2 =================
section('R5 選ぶ→指名する・連打');
{
  const { ctx, page, errs } = await open();
  await setup(page, { title: '寿司', players: ['A太', 'B子', 'C介'], options: sushi, mode: 'waiver', rounds: 3 });
  await page.click('#ad-start');
  await page.locator('#ad-app button[aria-label="まぐろを選ぶ"]').click();
  ok((await saved(page)).picks.length === 0, '候補を押しただけでは指名にならない');
  await page.locator('#ad-app button[aria-label="えびを選ぶ"]').click();
  ok((await page.locator('#ad-app .p-slip-name').innerText()) === 'えび' && await page.locator('#ad-app button[aria-label="まぐろを選ぶ"]').getAttribute('aria-pressed') === 'false', '選び直せる（指名票に選んだ候補）');
  const slip = await page.locator('#ad-app .p-slip').innerText();
  ok(/指名票/.test(slip) && /第1巡/.test(slip) && /(A太|B子|C介) さん/.test(slip) && /お題：寿司/.test(slip), `指名票に、お題・巡・誰の指名か（${slip.replace(/\n/g, ' ').slice(0, 60)}）`);
  const cb = await page.locator('#ad-app button', { hasText: /で指名する$/ }).boundingBox();
  // 指名するボタンを素早く3回押す（次の人の画面の操作として通らないこと）
  for (let i = 0; i < 3; i++) await page.mouse.click(cb.x + cb.width / 2, cb.y + cb.height / 2);
  await page.waitForTimeout(500);
  const s = await saved(page);
  ok(s.picks.length === 1 && s.picks[0].optionId === 3, `連打しても指名は1つだけ（${s.picks.length}）`);
  ok(/さんの番です/.test(await text(page)) && /上の一覧から候補を選んでください/.test(await text(page)) && await page.locator('#ad-app .p-slip button').isDisabled(), '次の人の画面は、何も選んでいない状態から（指名するボタンは押せない）');
  await pick(page);
  const f = await page.evaluate(() => document.activeElement && document.activeElement.hasAttribute('data-focus'));
  ok(f, '画面が変わったら、見出しにフォーカスを移す');
  ok(errs.length === 0, 'エラーなし ' + errs.join('|'));
  await ctx.close();
}

section('R6 最後の人の案内・お題の表示・選び直しの最後の人');
{
  const { ctx, page, errs } = await open({ seed: 7 });
  await setup(page, { title: '好きな寿司ネタ', players: ['あおい', 'かいと', 'さくら'], options: sushi, rounds: 2 });
  await page.click('#ad-start');
  let t = await text(page);
  ok(/お題：好きな寿司ネタ/.test(t) && /1人目／3人（あと3人）/.test(t), 'お題と、何人目か・あと何人かを出す');
  for (let k = 0; k < 3; k++) {
    await clickBtn(page, /です（選ぶ）/);
    ok(/お題：好きな寿司ネタ/.test(await text(page)), '選ぶ画面にもお題');
    await pick(page, 'まぐろ');
    t = await text(page);
    if (k < 2) { ok(/選びました/.test(t) && /さんに渡す/.test(t) && !/まぐろ/.test(t), '途中の人：選んだ内容を出さずに、次の人の名前で渡す'); await clickBtn(page, /さんに渡す$/); }
  }
  ok(/全員の指名がそろいました/.test(t) && !/渡してください|さんに渡す/.test(t) && !/まぐろ/.test(t), `最後の人：「次の人に渡して」を出さず「全員の指名がそろいました」（${t.slice(0, 60)}）`);
  await clickBtn(page, /^発表する$/);
  await clickBtn(page, /抽選へ（封筒を選ぶ）/);
  for (let k = 0; k < 3; k++) await page.locator('#ad-app button.ad-env:not([disabled])').first().click();
  await clickBtn(page, /一斉に開ける/); await clickBtn(page, /発表に戻る/);
  await clickBtn(page, /外れた人が選び直す/);
  t = await text(page);
  ok(/1人目／2人（あと2人）/.test(t), '選び直しは、選び直す人数で数える');
  for (let k = 0; k < 2; k++) { await clickBtn(page, /です（選ぶ）/); await pick(page, 'サーモン'); if (k === 0) await clickBtn(page, /さんに渡す$/); }
  ok(/選び直しの指名がそろいました/.test(await text(page)), '選び直しの最後の人も「そろいました」');
  ok(errs.length === 0, 'エラーなし ' + errs.join('|'));
  await ctx.close();
}

section('R7 候補の例・たたむ・まとめて外す→元に戻す・上限超えを入力欄に残す');
{
  const { ctx, page, errs } = await open();
  await page.fill('#ad-opt-input', 'じぶんの候補'); await clickBtn(page, /^選択肢に追加$/);
  await clickBtn(page, /^好きな寿司ネタ（24個）$/);
  const s = await saved(page);
  ok(s.options.length === 25 && s.options.some(o => o.label === 'じぶんの候補') && s.title === '好きな寿司ネタ', '候補の例は、今の候補に足す（手入力を消さない）・お題が空なら入れる');
  ok(await page.locator('#ad-app details.p-fold').count() === 1 && !(await page.locator('#ad-app li[data-label="まぐろ"]').isVisible()), '候補が多いと「登録済み○個」にたたむ');
  const startTop = await page.locator('#ad-start').evaluate(e => e.getBoundingClientRect().top + scrollY);
  const titleTop = await page.locator('#ad-title').evaluate(e => e.getBoundingClientRect().top + scrollY);
  ok(startTop - titleTop < 2600, `開始の設定まで、候補のチップを全部スクロールしなくてよい（${Math.round(startTop - titleTop)}px）`);
  await page.locator('#ad-app details.p-fold > summary').click();
  await page.fill('#ad-app input[aria-label="登録した候補を探す"]', 'とろ');
  ok(await page.locator('#ad-app li[data-label="中トロ"]').isVisible() && !(await page.locator('#ad-app li[data-label="まぐろ"]').isVisible()), '開くと、探して確かめられる');
  await page.fill('#ad-app input[aria-label="登録した候補を探す"]', '');
  await page.locator('#ad-app button', { hasText: /まとめて外す（24個）/ }).click();
  ok((await saved(page)).options.length === 1, 'まとめて外す');
  await page.locator('#ad-app button', { hasText: '元に戻す' }).click();
  ok((await saved(page)).options.length === 25, '「元に戻す」で戻る');
  await page.fill('#ad-opt-input', Array.from({ length: 240 }, (_, i) => `追加${i}`).join('\n') + '\n🍣');
  await clickBtn(page, /^選択肢に追加$/);
  const left = await page.inputValue('#ad-opt-input');
  ok((await saved(page)).options.length === 250 && left.split('\n').length === 16 && left.endsWith('🍣'), `上限を超えた分・記号だけの行は、入力欄に残す（残り${left.split('\n').length}行）`);
  ok(errs.length === 0, 'エラーなし ' + errs.join('|'));
  await ctx.close();
}

section('R8 投票なし（3人以上）');
{
  const { ctx, page, errs } = await open();
  await setup(page, { title: '鍋', players: ['A', 'B', 'C'], options: sushi, mode: 'waiver', rounds: 2, vote: 'none' });
  await page.click('#ad-start');
  await playThrough(page);
  const t = await text(page);
  ok(/ドラフト終了（結果を見せ合いましょう）/.test(t) && !/優勝|票/.test(t.split('結果を残す')[0]), '投票なし：投票の画面に行かず、勝者も票数も出さない');
  ok(errs.length === 0, 'エラーなし ' + errs.join('|'));
  await ctx.close();
}

section('R9 8人×15巡：全体の画像・1人ずつの画像・文章・共有の失敗');
{
  const { ctx, page, errs } = await open({ seed: 3, init: () => {
    navigator.canShare = () => true;
    navigator.share = () => Promise.reject(window.__shareAbort ? new DOMException('x', 'AbortError') : new Error('fail'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) } });
  } });
  const names = ['いちろう', 'じろう', 'さぶろう', 'しろう', 'ごろう', 'ろくろう', 'ななこ', 'はちこ'];
  const opts = Array.from({ length: 120 }, (_, i) => `とても長い名前の候補その${i + 1}番目のもの（三十文字に近い）`.slice(0, 30));
  await setup(page, { title: '三十文字ちかいとても長いお題の名前をここに入れてみるテスト', players: names, options: opts, mode: 'waiver', rounds: 15, vote: 'none' });
  await page.click('#ad-start');
  await playThrough(page);
  ok(await page.locator('#ad-app img.p-preview:not(.hidden-screen)').count() === 1, '結果の画面を開くと、画像の見本が自動で出る');
  ok(await page.locator('#ad-app button', { hasText: /^画像を作る$|画像を作って保存/ }).count() === 0 && await page.locator('#ad-app button', { hasText: /^画像を保存$/ }).count() === 1, '画像のボタンは「画像を保存」の1つ');
  ok(/ほか◯個」とまとめています/.test(await text(page)), '全体の画像で省略したときは、そう伝えて別の残し方を案内する');
  if (OUT) fs.writeFileSync(path.join(OUT, 'e2e_overview_8x15.png'), Buffer.from((await page.locator('#ad-app img.p-preview').first().getAttribute('src')).split(',')[1], 'base64'));
  await clickBtn(page, /1人ずつの画像を作る/);
  const imgs = page.locator('#ad-app figure img');
  ok(await imgs.count() === 8, '1人ずつの画像を8枚');
  const dim = await imgs.first().evaluate(i => new Promise(r => i.complete ? r([i.naturalWidth, i.naturalHeight]) : i.onload = () => r([i.naturalWidth, i.naturalHeight])));
  ok(dim[0] === 1080 && dim[1] === 1350, `1人ずつの画像は1080×1350（${dim}）`);
  if (OUT) fs.writeFileSync(path.join(OUT, 'e2e_detail_15.png'), Buffer.from((await imgs.first().getAttribute('src')).split(',')[1], 'base64'));
  await clickBtn(page, /文章でコピー/);
  const area = page.locator('#ad-app textarea[aria-label="結果の文章"]');
  const txt = await area.inputValue();
  ok(txt.split('\n').filter(l => /^\d+\. /.test(l)).length === 120, '自動でコピーできないときは、全部の指名を文章で表示して選べるようにする（120行）');
  await clickBtn(page, /^画像を保存$/);
  await page.waitForTimeout(200);
  ok(/共有メニューを開けませんでした/.test(await text(page)), '共有に失敗したら、保存の仕方を案内する');
  await page.evaluate(() => { window.__shareAbort = true; });
  await page.locator('input[name="ad-fmt"][value="story"]').check();
  ok(await page.locator('#ad-app img.p-preview').first().evaluate(i => new Promise(r => i.complete && i.naturalWidth ? r(i.naturalHeight) : i.onload = () => r(i.naturalHeight))) === 1920, '縦長を選ぶと、見本もすぐ縦長に変わる');
  await clickBtn(page, /^画像を保存$/); await page.waitForTimeout(200);
  ok(!/共有メニューを開けませんでした/.test(await page.locator('#ad-app [role=alert]').allInnerTexts().then(a => a.join(''))), '利用者が共有を閉じただけなら、失敗と出さない');
  ok(/お題・参加者の名前・選択肢が入ります/.test(await text(page)), '画像・文章に名前やお題が入ることを、出す前に伝える');
  const ev = await page.evaluate(() => window.dataLayer.filter(a => a[0] === 'event').map(a => [a[1], a[2]]));
  const evs = JSON.stringify(ev);
  ok(!/いちろう|長いお題|候補その/.test(evs), 'GA4 に入力した文字を送らない');
  ok(await noOverflow(page), '横にはみ出さない（結果）');
  ok(errs.length === 0, 'エラーなし ' + errs.join('|'));
  await ctx.close();
}

section('同時指名の通し・抽選の再現・2人・投票・同率優勝');
{
  const winners = [];
  for (const run of [1, 2]) {
    const { ctx, page, errs } = await open({ seed: 42 });
    await setup(page, { title: '寿司', players: ['あおい', 'かいと', 'さくら'], options: sushi, rounds: 3 });
    await page.click('#ad-start');
    await playThrough(page, { choose: () => 'まぐろ', voteFor: () => 0 });
    const s = await saved(page);
    const counts = [0, 1, 2].map(i => s.picks.filter(p => p.player === i).length);
    ok(counts.every(c => c === 3) && new Set(s.picks.map(p => p.optionId)).size === 9, `全員3つずつ・同じ候補を2人が持たない（${counts}）`);
    winners.push(JSON.stringify(s.picks.map(p => [p.player, p.optionId])));
    ok(errs.length === 0, 'エラーなし ' + errs.join('|'));
    await ctx.close();
  }
  ok(winners[0] === winners[1], '乱数を固定すると、抽選の結果が同じになる（再現できる）');
  const { ctx, page, errs } = await open({ width: 320, height: 640 });
  await setup(page, { title: '2人', players: ['X', 'Y'], options: sushi.slice(0, 2), mode: 'waiver', rounds: 1 });
  ok(await noOverflow(page), '320px：設定の画面がはみ出さない');
  await page.click('#ad-start');
  ok(await noOverflow(page), '320px：選ぶ画面がはみ出さない');
  await playThrough(page);
  ok(/2人のときは投票なし/.test(await text(page)) && await noOverflow(page), '2人（1巡）は投票なしで結果・はみ出さない');
  ok(errs.length === 0, 'エラーなし ' + errs.join('|'));
  await ctx.close();
}

section('投票の途中から再開・複数のタブ');
{
  const { ctx, page, errs } = await open();
  await setup(page, { title: '寿司', players: ['A', 'B', 'C'], options: sushi, mode: 'waiver', rounds: 1 });
  await page.click('#ad-start');
  for (let k = 0; k < 3; k++) await pick(page);
  await clickBtn(page, /です（投票する）/);
  await page.locator('#ad-app button', { hasText: /さんに投票/ }).first().click();
  await page.reload(); await page.click('#ad-resume-yes');
  ok(/投票 2\/3人目/.test(await text(page)), '投票の途中から再開');
  // 同じ端末の別のタブで書き換わったら知らせる
  const other = await ctx.newPage();
  await other.goto(BASE); await other.waitForSelector('#ad-resume-yes'); await other.click('#ad-resume-yes');
  await other.locator('#ad-app button', { hasText: /です（投票する）/ }).click();
  await other.locator('#ad-app button', { hasText: /さんに投票/ }).first().click();
  await page.waitForTimeout(300);
  ok(/別のタブ/.test(await page.locator('#ad-status').innerText()), 'ほかのタブで書き換わったら知らせる');
  ok(errs.length === 0, 'エラーなし ' + errs.join('|'));
  await ctx.close();
}

section('デザイン：封筒（2・4・8人、320・390px）・形式の選択・選択時の枠・画像の色');
for (const width of [320, 390]) for (const n of [2, 4, 8]) {
  const { ctx, page, errs } = await open({ width, height: 700, seed: 5 });
  const names = Array.from({ length: n }, (_, i) => `十二文字の参加者名${'ABCDEFGH'[i]}${i}あ`.slice(0, 12));
  await setup(page, { title: '寿司', players: names, options: sushi.concat(['かんぱち', 'はまち', 'いわし', 'さば', 'かつお', 'ぶり', 'あなご']), rounds: 1 });
  await page.click('#ad-start');
  for (let k = 0; k < n; k++) { await clickBtn(page, /です（選ぶ）/); await pick(page, 'まぐろ'); if (k < n - 1) await clickBtn(page, /さんに渡す$/); }
  await clickBtn(page, /^発表する$/); await clickBtn(page, /抽選へ（封筒を選ぶ）/);
  for (let k = 0; k < n; k++) await page.locator('#ad-app button.ad-env:not([disabled])').first().click();
  await clickBtn(page, /一斉に開ける/);
  await page.waitForTimeout(600); // 判子の動き（0.32秒）が終わってから測る
  const m = await page.evaluate(() => [...document.querySelectorAll('#ad-app button.ad-env')].map(b => {
    const r = b.getBoundingClientRect(), card = b.querySelector('.ad-env-card').getBoundingClientRect(), nm = b.querySelector('.ad-env-name');
    const st = b.querySelector('.ad-stamp'); const sr = st && st.getBoundingClientRect();
    return { w: r.width, left: r.left, right: r.right, nameFits: nm.scrollWidth <= nm.clientWidth + 1 && nm.textContent.length > 0, stampIn: !sr || (sr.left >= card.left - 4 && sr.right <= card.right + 4 && sr.top >= card.top - 4 && sr.bottom <= card.bottom + 4) };
  }));
  const cols = new Set(m.map(x => Math.round(x.left))).size;
  ok(m.every(x => x.w >= 100 && x.right <= width) && m.every(x => x.nameFits) && m.every(x => x.stampIn) && cols === 2, `${width}px・${n}人：封筒は2列・幅${Math.round(Math.min(...m.map(x => x.w)))}px以上・名前が欠けない・判子が封筒の中（列${cols}）`);
  ok(await noOverflow(page), `${width}px・${n}人：はみ出さない`);
  if (OUT && n === 8) await page.screenshot({ path: path.join(OUT, `e2e_lottery_${width}_${n}.png`), fullPage: true });
  ok(errs.length === 0, 'エラーなし ' + errs.join('|'));
  await ctx.close();
}
{
  const { ctx, page, errs } = await open({ width: 320, height: 640 });
  const bw = await page.evaluate(() => [...document.querySelectorAll('#ad-app label.p-choice')].map(l => getComputedStyle(l).borderTopWidth));
  ok(new Set(bw).size === 1 && bw[0] === '2px', `選択肢の枠は、選んでも選ばなくても2px（${[...new Set(bw)]}）`);
  const before = await page.locator('label.p-choice:has(input[value="waiver"])').boundingBox();
  await page.check('input[name="ad-mode"][value="waiver"]');
  const after = await page.locator('label.p-choice:has(input[value="waiver"])').boundingBox();
  ok(before.width === after.width && before.height === after.height, '選んでも大きさが変わらない（隣が動かない）');
  // テンプレートはお題より上（2026-10-27 オーナー指示）
  const secs = await page.evaluate(() => [...document.querySelectorAll('#ad-app .p-sec-h')].map(h => h.textContent));
  ok(/テンプレート/.test(secs[0]) && /お題/.test(secs[1]), `設定の画面：テンプレートがお題より上（${secs.map(t => t.slice(0, 8)).join(' / ')}）`);
  // テンプレートを選んでも、入力済みのお題・候補は消えない
  await page.fill('#ad-title', 'じぶんのお題');
  await page.fill('#ad-opt-input', 'りんご\nみかん'); await clickBtn(page, /^選択肢に追加$/);
  await page.check('input[name="ad-tpl"][value="oshi"]');
  await clickBtn(page, /^好きな寿司ネタ/);
  ok(await page.inputValue('#ad-title') === 'じぶんのお題' && (await saved(page)).options.some(o => o.label === 'りんご'), 'テンプレート・候補の例を選んでも、入力したお題と候補は消えない');
  await page.locator('label.p-choice:has(input[value="free"])').click();
  await setup(page, { title: '寿司', players: ['A', 'B'], options: sushi.slice(0, 2), mode: 'waiver', rounds: 1 });
  await page.click('#ad-start');
  const marks = await page.evaluate(() => { const rows = [...document.querySelectorAll('#ad-app button.ad-opt')]; const r = rows.map(b => b.getBoundingClientRect()); return { h: rows.map(b => b.querySelector('.p-pickmark').getBoundingClientRect().height), gap: r.length > 1 ? r[1].top - r[0].bottom : 99 }; });
  ok(marks.h.every(h => h >= 44) && marks.gap >= 12, `指名の画面：「選ぶ」は高さ44px以上・行の間は12px以上（${marks.h.map(Math.round)} / ${marks.gap}px）`);
  await playThrough(page);
  const labels = await page.evaluate(() => [...document.querySelectorAll('#ad-app label.p-choice')].map(l => { const r = l.getBoundingClientRect(); return { t: l.textContent, ok: r.right <= innerWidth && l.scrollWidth <= l.clientWidth + 1 }; }));
  ok(labels.length === 2 && labels.every(x => x.ok) && labels.map(x => x.t).join('|') === '横長（X用）|縦長（ストーリー用）', `320px：画像の形式の選択が全文読めて、はみ出さない（${labels.map(x => x.t)}）`);
  await page.locator('label.p-choice', { hasText: '縦長' }).click();
  ok(await page.isChecked('input[name="ad-fmt"][value="story"]'), 'ラベルを押しても選べる');
  const px = await page.evaluate(() => new Promise(r => { const img = document.querySelector('#ad-app img.p-preview'); const go = () => { const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; const x = c.getContext('2d'); x.drawImage(img, 0, 0); r([img.naturalWidth, img.naturalHeight, [...x.getImageData(5, 5, 1, 1).data].slice(0, 3)]); }; img.complete && img.naturalWidth ? go() : img.onload = go; }));
  ok(px[0] === 1080 && px[1] === 1920 && px[2].join() === '244,241,232', `縦長の画像：1080×1920、背景は画面と同じ紙白（${px[2]}）`);
  if (OUT) fs.writeFileSync(path.join(OUT, 'e2e_story_2.png'), Buffer.from((await page.locator('#ad-app img.p-preview').first().getAttribute('src')).split(',')[1], 'base64'));
  ok(await noOverflow(page), '320px：結果の画面がはみ出さない');
  ok(errs.length === 0, 'エラーなし ' + errs.join('|'));
  await ctx.close();
}

section('はじめの画面と遊ぶ画面・遊び方（画面の写真つき）');
{
  const { ctx, page, errs } = await open({ enter: false });
  const vis = sel => page.locator(sel).first().isVisible();
  ok(!(await vis('#ad-app')) && await vis('#ad-enter') && await vis('main section.home-only'), 'はじめの画面：イラストと「はじめる」だけ（ゲームの画面はまだ出さない）');
  await page.click('#ad-enter');
  ok(await vis('#ad-app') && !(await vis('main section.home-only')) && !(await vis('article')) && !(await vis('footer')), '遊ぶ画面：イラスト・説明・下の帯を出さず、ゲームの画面だけ');
  ok(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize) === '17px', '遊ぶ画面は文字を少し大きく');
  await page.fill('#ad-title', 'もどるテスト');
  await page.goBack();
  ok(!(await vis('#ad-app')) && await vis('#ad-enter'), 'スマホの「戻る」で、はじめの画面に戻る');
  await page.click('#ad-enter');
  ok(await page.inputValue('#ad-title') === 'もどるテスト', '戻ってから入り直しても、入力はそのまま');
  await page.reload(); await page.waitForTimeout(300);
  ok(await vis('#ad-app') && await page.inputValue('#ad-title') === 'もどるテスト', '設定の途中で読み込み直しても、設定の画面のまま');
  // 遊び方
  await page.click('#ad-howto-open');
  const shown = async () => page.evaluate(() => [...document.querySelectorAll('#ad-howto [data-step]')].map((li, i) => [i, !li.classList.contains('hidden-screen')]).filter(x => x[1]).map(x => x[0]));
  ok(await page.locator('#ad-howto').evaluate(d => d.open) && JSON.stringify(await shown()) === '[0]', '「遊び方」で、STEP 1 から開く');
  for (let i = 0; i < 4; i++) await page.click('#ad-howto-next');
  ok(JSON.stringify(await shown()) === '[4]' && (await page.textContent('#ad-howto-next')) === '閉じる', '「次へ」で STEP 5 まで進む');
  const imgs = await page.evaluate(() => Promise.all([...document.querySelectorAll('#ad-howto img')].map(i => fetch(i.src).then(r => r.ok))));
  ok(imgs.length === 5 && imgs.every(Boolean), '遊び方の写真5枚が読める');
  await page.click('#ad-howto-next');
  ok(!(await page.locator('#ad-howto').evaluate(d => d.open)), '最後の「閉じる」で閉じる');
  ok(await noOverflow(page), 'はみ出さない');
  ok(errs.length === 0, 'エラーなし ' + errs.join('|'));
  await ctx.close();
}

section('PC幅');
{
  const { ctx, page, errs } = await open({ width: 1280, height: 800 });
  await setup(page, { title: '寿司', players: ['A', 'B', 'C', 'D'], options: sushi.concat(['かんぱち', 'はまち', 'いわし']), rounds: 3 });
  await page.click('#ad-start');
  await playThrough(page, { choose: () => null, voteFor: () => 0 });
  ok(/優勝/.test(await text(page)) && await noOverflow(page), 'PC幅：4人の同時指名で最後まで');
  if (OUT) fs.writeFileSync(path.join(OUT, 'e2e_x_4.png'), Buffer.from((await page.locator('#ad-app img.p-preview').first().getAttribute('src')).split(',')[1], 'base64'));
  ok(errs.length === 0, 'エラーなし ' + errs.join('|'));
  await ctx.close();
}

await browser.close(); server.close();
console.log(fails ? `NG ${fails}件（OK ${passes}件）` : `すべてOK（${passes}件）`);
process.exit(fails ? 1 : 0);
