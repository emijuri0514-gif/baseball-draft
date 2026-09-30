// PRのチェック用：選手データやAIの指名・採点ロジックが、ポジション残数ボードの基準表を作ったときから
// 変わっていないかをハッシュで確かめる。変わっていたら「表の作り直しが必要かもしれない」と警告を出す。
// 表の作り直しが必須とは限らない（コメントの修正だけ等もある）ので、チェック自体は失敗させない（--strict で失敗させる）。
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { computeSourceHash, readThresholdsBlock, HASHED_NAMES } from './source-hash.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const block = readThresholdsBlock(html);
const { hash, missing } = computeSourceHash(html);
const strict = process.argv.includes('--strict');
const gh = !!process.env.GITHUB_ACTIONS;
const summary = msg => { if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, msg + '\n'); };

if (!block) { console.log('::error::index.html に POSITION_BOARD_THRESHOLDS が見つかりません'); process.exit(1); }
if (missing.length) {
  const m = `ハッシュ対象の関数・定数が見つかりません（名前が変わった？）：${missing.join(', ')}。scripts/position-thresholds/source-hash.mjs の HASHED_NAMES を直してください。`;
  console.log(gh ? `::warning file=index.html::${m}` : '⚠️ ' + m);
}
if (block.sourceHash === hash) {
  console.log(`✓ 基準表は最新の前提（sourceHash ${hash}、${block.generatedAt} 作成）のままです。`);
  process.exit(0);
}
const msg = `選手データかAIの指名・採点ロジック（${HASHED_NAMES.length}項目）が、ポジション残数ボードの基準表を作ったとき（${block.generatedAt}）から変わっています。` +
  `表の作り直しが必要かもしれません：npm run build:position-thresholds（手順は非公開リポジトリの docs/POSITION_BOARD_THRESHOLDS.md）。`;
console.log(gh ? `::warning file=index.html,title=ポジション残数ボードの基準表::${msg}` : '⚠️ ' + msg);
summary(`### ⚠️ ポジション残数ボードの基準表\n${msg}\n\n- 表の作成時：\`${block.sourceHash}\`\n- 現在：\`${hash}\``);
process.exit(strict ? 1 : 0);
