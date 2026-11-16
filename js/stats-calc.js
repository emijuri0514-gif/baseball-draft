// 野球の指標の計算（打者・投手）。入力した数字はこのページの中だけで使い、送信も保存もしない
(function (root) {
  const ok = x => typeof x === 'number' && isFinite(x);
  // 打率などの表記：1未満は「.288」、1以上は「1.250」
  const rate3 = x => { const s = x.toFixed(3); return s.startsWith('0.') ? s.slice(1) : s; };
  const dec2 = x => x.toFixed(2);
  function batter(v) {
    const errors = [], rows = [];
    const keys = ['ab', 'h', 'd', 't', 'hr', 'bb', 'hbp', 'sf', 'so', 'pa'];
    for (const k of keys) if (v[k] != null && (!ok(v[k]) || v[k] < 0 || !Number.isInteger(v[k]))) { errors.push('0以上の整数で入れてください。'); return { errors, rows }; }
    const g = k => v[k] || 0;
    if (v.ab == null || v.h == null) return { errors, rows };
    if (g('h') > g('ab')) errors.push('安打が打数より多くなっています。');
    if (g('d') + g('t') + g('hr') > g('h')) errors.push('二塁打・三塁打・本塁打の合計が安打より多くなっています。');
    if (g('so') > g('ab')) errors.push('三振が打数より多くなっています。');
    if (v.pa != null && g('ab') + g('bb') + g('hbp') + g('sf') > g('pa')) errors.push('打数・四球・死球・犠飛の合計が打席より多くなっています。');
    if (errors.length) return { errors, rows };
    const ab = g('ab'), h = g('h'), single = h - g('d') - g('t') - g('hr');
    const tb = single + 2 * g('d') + 3 * g('t') + 4 * g('hr');
    const obpDen = ab + g('bb') + g('hbp') + g('sf');
    const avg = ab ? h / ab : null, slg = ab ? tb / ab : null;
    const obp = obpDen ? (h + g('bb') + g('hbp')) / obpDen : null;
    const babipDen = ab - g('so') - g('hr') + g('sf');
    const na = '計算できません';
    rows.push(['打率', avg == null ? na : rate3(avg)]);
    rows.push(['出塁率', obp == null ? na : rate3(obp)]);
    rows.push(['長打率', slg == null ? na : rate3(slg)]);
    rows.push(['OPS', obp == null || slg == null ? na : rate3(obp + slg)]);
    rows.push(['ISO', avg == null ? na : rate3(slg - avg)]);
    rows.push(['BABIP', babipDen > 0 ? rate3((h - g('hr')) / babipDen) : na]);
    rows.push(['塁打', String(tb)]);
    return { errors, rows };
  }
  function pitcher(v) {
    const errors = [], rows = [];
    for (const k of ['ipw', 'h', 'bb', 'hbp', 'so', 'hr', 'er']) if (v[k] != null && (!ok(v[k]) || v[k] < 0 || !Number.isInteger(v[k]))) { errors.push('0以上の整数で入れてください（投球回の端数は右の欄で選びます）。'); return { errors, rows }; }
    if (v.c != null && !ok(v.c)) { errors.push('FIPの定数は数字で入れてください。'); return { errors, rows }; }
    if (v.ipw == null) return { errors, rows };
    const g = k => v[k] || 0;
    const ip = g('ipw') + (Number(v.ipf) || 0) / 3;
    if (g('hr') > g('h')) errors.push('被本塁打が被安打より多くなっています。');
    if (errors.length) return { errors, rows };
    const na = '計算できません（投球回が0）';
    const per9 = x => ip > 0 ? dec2(x * 9 / ip) : na;
    rows.push(['防御率', per9(g('er'))]);
    rows.push(['WHIP', ip > 0 ? dec2((g('h') + g('bb')) / ip) : na]);
    rows.push(['奪三振率（K/9）', per9(g('so'))]);
    rows.push(['与四球率（BB/9）', per9(g('bb'))]);
    rows.push(['K/BB', g('bb') > 0 ? dec2(g('so') / g('bb')) : '計算できません（与四球が0）']);
    if (ip > 0) {
      const raw = (13 * g('hr') + 3 * (g('bb') + g('hbp')) - 2 * g('so')) / ip;
      rows.push(v.c == null ? ['FIP（定数なし）', dec2(raw)] : ['FIP（定数 ' + v.c + ' を足した値）', dec2(raw + v.c)]);
    } else rows.push(['FIP', na]);
    return { errors, rows };
  }
  const api = { batter, pitcher };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.StatsCalc = api;
})(this);
