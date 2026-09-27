// data/draft-2026-results.json の形式チェック。
// 使い方: node scripts/validate-draft-results.mjs [対象ファイルのパス]
// 省略時は data/draft-2026-results.json を検証する。
//
// エラー（終了コード1）: JSONとして壊れている、必須項目が無い、球団名が不正、
//   lottery/competedWith/fallbackの値が仕様と食い違っている、など
// 警告（終了コードには影響しない）: 12球団のうち未入力の球団がある、
//   指名された選手が候補リスト（data/draft-2026-candidates.json）に見つからない、など
//   （候補リスト外の選手が実際に指名されることは普通にあるため、警告のみでエラーにはしない）

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const RESULTS_PATH = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : path.join(repoRoot, 'data', 'draft-2026-results.json');
const CANDIDATES_PATH = path.join(repoRoot, 'data', 'draft-2026-candidates.json');

const TEAMS = ['巨人', '阪神', 'DeNA', 'ヤクルト', '中日', '広島', 'オリックス', 'ロッテ', 'ソフトバンク', '楽天', '日本ハム', '西武'];

// draft-predict.html内のnormalizeName()と同じロジック（1か所にまとめてあるものを両方に複製）。
// 新しい異体字が見つかったら、このファイルとdraft-predict.htmlの両方に追記すること。
const CHAR_VARIANTS = {
  '邉': '辺', '邊': '辺',
  '髙': '高',
  '﨑': '崎',
  '濵': '浜',
  '德': '徳'
};
function normalizeName(str) {
  if (!str) return '';
  const noSpace = String(str).replace(/[\s　]/g, '');
  return noSpace.split('').map(ch => CHAR_VARIANTS[ch] || ch).join('');
}

const errors = [];
const warnings = [];

function fail(msg) { errors.push(msg); }
function warn(msg) { warnings.push(msg); }

async function loadJson(filePath, label) {
  let raw;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (e) {
    fail(`${label}が見つかりません: ${filePath}`);
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    fail(`${label}のJSONが壊れています: ${e.message}`);
    return null;
  }
}

function validatePlayerShape(label, obj, requireAll) {
  if (typeof obj !== 'object' || obj === null) {
    fail(`${label}: オブジェクトではありません`);
    return;
  }
  ['name', 'org', 'pos'].forEach(key => {
    if (requireAll && (typeof obj[key] !== 'string' || obj[key].trim() === '')) {
      fail(`${label}: ${key}が空、または文字列ではありません`);
    }
  });
}

async function main() {
  console.log(`検証対象: ${RESULTS_PATH}`);
  const results = await loadJson(RESULTS_PATH, '結果ファイル');
  if (!results) {
    printSummary();
    process.exit(1);
  }

  if (typeof results.version !== 'string' || !results.version) fail('version が文字列で入っていません');
  if (typeof results.updatedAt !== 'string' || Number.isNaN(Date.parse(results.updatedAt))) {
    fail('updatedAt が有効な日時文字列ではありません（例: 2026-10-22T21:00:00+09:00）');
  }
  if (typeof results.picks !== 'object' || results.picks === null) {
    fail('picks がオブジェクトではありません');
    printSummary();
    process.exit(1);
  }

  const enteredTeams = Object.keys(results.picks);
  enteredTeams.forEach(team => {
    if (!TEAMS.includes(team)) {
      fail(`picks に不正な球団名があります: "${team}"（正しい球団名: ${TEAMS.join('・')}）`);
    }
  });

  const missingTeams = TEAMS.filter(t => !enteredTeams.includes(t));
  if (missingTeams.length) {
    warn(`まだ入力されていない球団: ${missingTeams.join('・')}（${missingTeams.length}/12球団）`);
  }

  const namesToCheckAgainstCandidates = [];

  for (const team of enteredTeams) {
    const pick = results.picks[team];
    const label = `picks.${team}`;
    validatePlayerShape(label, pick, true);
    if (typeof pick !== 'object' || pick === null) continue;

    namesToCheckAgainstCandidates.push({ team, field: 'name', name: pick.name });

    if (pick.competedWith !== undefined) {
      if (!Array.isArray(pick.competedWith)) {
        fail(`${label}.competedWith は配列である必要があります`);
      } else {
        pick.competedWith.forEach(otherTeam => {
          if (!TEAMS.includes(otherTeam)) {
            fail(`${label}.competedWith に不正な球団名があります: "${otherTeam}"`);
          }
          if (otherTeam === team) {
            fail(`${label}.competedWith に自分自身の球団名が入っています`);
          }
        });
      }
    }

    if (pick.lottery !== undefined && pick.lottery !== 'won' && pick.lottery !== 'lost') {
      fail(`${label}.lottery は "won" か "lost" である必要があります（実際: ${JSON.stringify(pick.lottery)}）`);
    }

    if (pick.lottery === 'lost') {
      if (!pick.fallback) {
        warn(`${label}: lottery が "lost" ですが fallback（外れ1位で獲得した選手）が入力されていません`);
      } else {
        validatePlayerShape(`${label}.fallback`, pick.fallback, true);
        namesToCheckAgainstCandidates.push({ team, field: 'fallback', name: pick.fallback && pick.fallback.name });
      }
    }
    if (pick.lottery === 'won' && pick.fallback) {
      warn(`${label}: lottery が "won" なのに fallback が入力されています（不要な項目です）`);
    }
    if (pick.fallback && pick.lottery !== 'lost') {
      warn(`${label}: fallback があるのに lottery が "lost" になっていません`);
    }
  }

  // 候補リストとの突き合わせ（警告のみ。候補外の選手が指名されるのは普通にあり得る）
  const candidatesData = await loadJson(CANDIDATES_PATH, '候補選手リスト');
  if (candidatesData && Array.isArray(candidatesData.players)) {
    const candidateNameSet = new Set(candidatesData.players.map(p => normalizeName(p.name)));
    const notInCandidates = namesToCheckAgainstCandidates.filter(x => x.name && !candidateNameSet.has(normalizeName(x.name)));
    if (notInCandidates.length) {
      warn(`候補リスト（data/draft-2026-candidates.json）に見つからない選手が${notInCandidates.length}件あります（候補外の指名は珍しくないため警告のみ）:`);
      notInCandidates.forEach(x => warn(`  - ${x.team}（${x.field}）: ${x.name}`));
    }
  } else {
    warn('候補選手リストの読み込みに失敗したため、候補外選手のチェックはスキップしました');
  }

  printSummary();
  process.exit(errors.length ? 1 : 0);
}

function printSummary() {
  console.log('');
  if (errors.length) {
    console.log(`❌ エラー ${errors.length}件（このままでは公開できません）`);
    errors.forEach(e => console.log(`  - ${e}`));
  } else {
    console.log('✅ エラーはありません');
  }
  console.log('');
  if (warnings.length) {
    console.log(`⚠️ 警告 ${warnings.length}件（内容を確認のうえ、問題なければそのまま公開してOK）`);
    warnings.forEach(w => console.log(`  - ${w}`));
  } else {
    console.log('警告はありません');
  }
}

main();
