// ポジション残数ボードの基準表（index.html の POSITION_BOARD_THRESHOLDS）が前提にしている
// 「選手データ」と「AIの指名・採点ロジック」のハッシュを計算する。
// 表を作ったときのハッシュと今のハッシュが違えば、表の作り直しが必要かもしれない。
import crypto from 'crypto';

// ハッシュの対象（どれかを変えたら表の作り直しを検討する）
export const HASHED_NAMES = [
  // 選手データ
  'initialDatabase',
  // 守備位置の適性・点数（「守れる選手」の判定に直結）
  'expandBestPos', 'posAptitude', 'offPositionKind', 'getPosScore', 'getBaseStat', 'canPlayForBoard',
  // AIの指名ロジック（1回の指名で各ポジションがどれだけ減るかに直結）
  'getAIPick', 'getMissingPositions', 'getOpenDefensiveSlots', 'getOpenPitcherRoles', 'assignDefense', 'aptitudeMatchSize',
  'getPositionalStandoutBonus', 'comboApproachBonus', 'comboProximity', 'BATTER_TOOL_WEIGHT', 'TEAM_SCOUTING', 'DEFAULT_SCOUTING',
  'isForeignPlayer', 'foreignCount', 'FOREIGN_PLAYER_LIMIT', 'TOTAL_ROUNDS', 'LINEUP_POSITIONS', 'FIELD_POSITIONS', 'DEF_PRIORITY',
  // 指名順（N）の数え方
  'computeBoardN', 'isWaiverRound',
];

// `function name(...) {...}` または `const name = ...;` の定義本体をソースから切り出す
function extract(src, name) {
  const re = new RegExp(`(?:function\\s+${name}\\s*\\(|(?:const|let|var)\\s+${name}\\s*=)`);
  const m = re.exec(src);
  if (!m) return null;
  let i = m.index;
  // 最初の { / [ / ; のうち先に来るもの
  const rest = src.slice(i);
  const firstBrace = rest.search(/[{[]/), firstSemi = rest.indexOf(';');
  if (firstSemi !== -1 && (firstBrace === -1 || firstSemi < firstBrace)) return rest.slice(0, firstSemi + 1);
  // 関数は引数リストの後の { から数える
  let j = firstBrace;
  if (rest.startsWith('function')) j = rest.indexOf('{', rest.indexOf(')'));
  const open = rest[j], close = open === '{' ? '}' : ']';
  let depth = 0, k = j, inStr = null;
  for (; k < rest.length; k++) {
    const c = rest[k];
    if (inStr) { if (c === '\\') { k++; continue; } if (c === inStr) inStr = null; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') { depth--; if (depth === 0) break; }
  }
  return rest.slice(0, k + 1);
}

export function computeSourceHash(indexHtml) {
  const h = crypto.createHash('sha256');
  const missing = [];
  for (const name of HASHED_NAMES) {
    const body = extract(indexHtml, name);
    if (body == null) { missing.push(name); continue; }
    h.update(name + '\n' + body + '\n');
  }
  return { hash: h.digest('hex').slice(0, 16), missing };
}

export function readThresholdsBlock(indexHtml) {
  const m = /const POSITION_BOARD_THRESHOLDS = (\{.*\});/.exec(indexHtml);
  return m ? JSON.parse(m[1]) : null;
}
