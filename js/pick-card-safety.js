// ★ 指名カードメーカー（pick-card.html）の入力チェック。
//   1. 実在の選手名（予想ページの候補選手＋ゲームの現役選手）は使えない
//   2. 禁止語（差別・性的・暴力・侮辱・犯罪・公式に見える言葉）と、URL・メールアドレス・電話番号・@ID は使えない
//   判定はすべてブラウザの中で行い、入力した文字はどこにも送らない。
//   禁止語のリストは、差別語などがそのままの文字でソースに並ばないよう、Base64にして埋め込んでいる
//   （元のリストは非公開の管理用リポジトリにあり、そこから生成する。ここを手で書き換えない）。
//   ブラウザでも node（テスト）でも globalThis.PickCardSafety で使える（CommonJSで読んだときは module.exports にも入る）。
(function (root) {
  const ENCODED_LIST = 'eyJ3IjogWyLjgqzjgqTjgrgiLCAi44GM44GE44GYIiwgIuOBjeOBoeOBjOOBhCIsICLjgq3jg4HjgqzjgqQiLCAi5rCX6YGV44GEIiwgIuOBi+OBn+OCjyIsICLjgoHjgY/jgokiLCAi44Gk44KT44G8IiwgIj3jgYrjgZciLCAiPeOBs+OBo+OBkyIsICLpg6jokL3msJEiLCAi44GI44Gf6Z2e5Lq6IiwgIuepouWkmiIsICLpnZ7kuroiLCAiPeODgeODp+ODsyIsICLjgrfjg4rkuroiLCAi5pSv6YKj5Lq6IiwgIuWcn+S6uiIsICLpu5LjgpPjgbwiLCAi44GP44KN44KT44G8IiwgIuOCuOODo+ODg+ODlyIsICLmr5vllJAiLCAi44Ob44Oi6YeO6YOOIiwgIuOCquOCq+ODnumHjumDjiIsICLjg6zjgrrph47pg44iLCAi5rGg5rK8IiwgIuefpeaBtemBheOCjCIsICLkvY7og70iLCAi6Zqc5a6z6ICF44GvIiwgIuWcqOaXpeOBryIsICLlpJbkurrjga/lh7rjgaYiLCAi5Ye644Gm44GE44GRIiwgIuOBp+OBpuOBhOOBkSIsICLjgrTjgq3jg5bjg6rkuroiLCAi44Gh44KT44GTIiwgIuOBoeOCk+OBvSIsICLjgb7jgpPjgZMiLCAi44GK44G+44KT44GTIiwgIuOCu+ODg+OCr+OCuSIsICLjgZvjgaPjgY/jgZkiLCAic2V4IiwgIuODleOCoeODg+OCryIsICJmdWNrIiwgIuOBiuOBo+OBseOBhCIsICLjg5HjgqTjg5Hjg7MiLCAi44OV44Kn44OpIiwgIuOCr+ODs+ODiyIsICLjgqrjg4rjg4vjg7wiLCAi44GK44Gq44Gr44O8IiwgIuOBm+OCk+OBmuOCiiIsICLjgqjjg60iLCAi44GI44KN44GEIiwgImF25aWz5YSqIiwgImF255S35YSqIiwgIuODneODq+ODjiIsICJwb3JuIiwgIueXtOa8oiIsICLjg6zjgqTjg5ciLCAi44KM44GE44G3IiwgIuW8t+WnpiIsICLlo7LmmKUiLCAi5o+05LqkIiwgIuaPtOWKqeS6pOmamyIsICLjg5Hjg5HmtLsiLCAi44Ok44Oq44Oe44OzIiwgIuODpOODquODgeODsyIsICLli4PotbciLCAi5bCE57K+IiwgIuerpeiyniIsICLlh6blpbMiLCAiIeatu+OBrSIsICI944GX44GtIiwgIiHmsI/jga0iLCAi44K/44OS44GtIiwgIiHmrrrjgZkiLCAi44GT44KN44GZIiwgIuauuuOBl+OBnyIsICLmrrrlrrMiLCAi5q665Lq6IiwgIuOBtuOBo+auuiIsICLjgbbjgaPjgZPjgo0iLCAi6Ieq5q66IiwgIuOBmOOBleOBpCIsICLpppblkIrjgooiLCAi6aaW44Gk44KKIiwgIueIhuegtCIsICLniIbnoLTkuojlkYoiLCAi44OG44OtIiwgIuWIuuOBmSIsICLliLrjgZfjgabjgoTjgosiLCAi44G244KT5q60IiwgIuODquODs+ODgSIsICLomZDmrroiLCAi5oOo5q66IiwgIuaSsuauuiIsICLlsITmrroiLCAi57We5q66IiwgIueKr+OBmSIsICLjgYrjgYvjgZkiLCAiPeOCr+OCuiIsICI944GP44GaIiwgIj3jgrTjg58iLCAiPeOBlOOBvyIsICI944Kr44K5IiwgIj3jgYvjgZkiLCAiPeeEoeiDvSIsICI95a6z5oKqIiwgIj3mtojjgYjjgo0iLCAi44Kv44K66YeO6YOOIiwgIuOCtOODn+mHjumDjiIsICLjgqvjgrnph47pg44iLCAi44K044Of44Kv44K6IiwgIueUn+OCtOODnyIsICLlvbnnq4vjgZ/jgZoiLCAi57Wm5paZ5rOl5qOSIiwgIueojumHkeazpeajkiIsICLmiKbniq8iLCAi6ICB5a6zIiwgIuODluOCuSIsICLjg4fjg5YiLCAi44OP44KyIiwgIuODgeODkyIsICLjgq3jg6LjgYQiLCAi44GN44KC44GEIiwgIuOBhuOBluOBhCIsICLjgqbjgrbjgYQiLCAi44OQ44KrIiwgIuOBsOOBiyIsICLppqzpub8iLCAi44Ki44ObIiwgIuOBguOBuyIsICLpmL/lkYYiLCAi44G+44Gs44GRIiwgIumWk+aKnOOBkSIsICLjg5zjgrEiLCAi44Kr44K544GMIiwgIumbkemtmiIsICLjgZbjgZMiLCAi6Kaa6YaS5YmkIiwgIuimmuOBm+OBhOWJpCIsICLjgrfjg6Pjg5YiLCAi5aSn6bq7IiwgIuODnuODquODleOCoeODiiIsICLjgrPjgqvjgqTjg7MiLCAi44OY44Ot44Kk44OzIiwgIm1kbWEiLCAi5Y2x6Zm644OJ44Op44OD44KwIiwgIuiEseazlSIsICLolqzniakiLCAi6YeO55CD6LOt5Y2aIiwgIuizreWNmiIsICLlhavnmb7plbciLCAi6KOP6YeRIiwgIuiEseeojiIsICLoqZDmrLoiLCAi56qD55uXIiwgIuW8t+eblyIsICLkuIflvJXjgY0iLCAi5o+05LqkIiwgIumXh+ODkOOCpOODiCIsICLlj43npL4iLCAi5pq05Yqb5ZujIiwgIuODpOOCr+OCtiIsICLjgoTjgY/jgZYiLCAiIeWFrOW8jyIsICLlhazlvI/nmbrooagiLCAiIemAn+WgsSIsICJucGIiLCAi5pel5pys6YeO55CD5qmf5qeLIiwgIiHnt4rmgKUiLCAiIeWPt+WkliIsICLmraPlvI/nmbrooagiLCAi5q2j5byP5rG65a6aIiwgIuODieODqeODleODiOS8muitsOS6i+WLmeWxgCJdLCAiYSI6IFsi5L215q66IiwgIuWIuuauuiIsICLoo5zmrroiLCAi5q2755CDIiwgIuWbm+atu+eQgyIsICLmrrrliLAiLCAi5b+F5q66IiwgIuebuOauuiIsICLlsIHmrroiXX0=';

  let LIST = null;
  function list() {
    if (LIST) return LIST;
    try {
      const bin = atob(ENCODED_LIST);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      LIST = JSON.parse(new TextDecoder('utf-8').decode(bytes));
    } catch (e) {
      LIST = { w: [], a: [] };
    }
    LIST.words = LIST.w.map(raw => {
      const forceContains = raw[0] === '!';
      const forceWhole = raw[0] === '=';
      const word = normalize(raw.replace(/^[!=]/, ''));
      // 2文字以下の言葉は、欄全体がその言葉のときだけ止める（「カス」で「カステラ」を止めないため）
      return { word, whole: forceWhole || (!forceContains && [...word].length <= 2) };
    }).filter(x => x.word);
    LIST.allow = LIST.a.map(normalize).filter(Boolean);
    return LIST;
  }

  // 比べる前にそろえる：全角半角（NFKC）、英字は小文字、カタカナはひらがな、空白・記号・絵文字は取り除く
  function normalize(s) {
    return String(s || '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60))
      .replace(/[^\p{L}\p{N}]/gu, '');
  }

  // 表示を崩す文字を取り除く：改行・制御文字（Cc）、右から左に書く指定やゼロ幅の文字（Cf）、
  // 文字を重ねる記号（結合文字 M。濁点などはNFCで1文字にまとめてから取り除く）、私用領域の文字、行・段落の区切り。
  // ただし絵文字は、家族の絵文字（ゼロ幅でつなぐ）・肌の色・キーキャップ（1️⃣）などの組み合わせを1文字のまま残す。
  // そのため見た目の1文字（書記素）ごとに見て、絵文字を含むものは右から左の指定などだけを取り除く。
  const BIDI = /[\u200E\u200F\u202A-\u202E\u2066-\u2069\u061C]/g;
  function stripChars(s) {
    return graphemes(String(s || '').normalize('NFC')).map(g => {
      if (/\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20E3/u.test(g)) return g.replace(BIDI, '').replace(/\p{Cc}/gu, '');
      return g.replace(/[\p{Cc}\p{Cf}\p{Co}\p{M}\p{Zl}\p{Zp}]/gu, '');
    }).join('')
      .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
  }
  // 入力中に使う：取り除くだけ（打っている途中の空白は残す）
  function sanitizeTyping(s) { return stripChars(String(s || '').replace(/[\r\n\t]+/g, ' ')); }
  // 画像に使う：取り除いたうえで、続いた空白を1つにまとめ、前後の空白を取る
  function sanitize(s) {
    return stripChars(s).replace(/\p{Zs}+/gu, ' ').trim();
  }

  // 文字数は見た目の1文字ずつ数える（絵文字も1文字。Intl.Segmenterがない古いブラウザはコードポイントで数える）
  function graphemes(s) {
    const str = String(s || '');
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      return Array.from(new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(str), x => x.segment);
    }
    return Array.from(str);
  }
  function countChars(s) { return graphemes(s).length; }
  function truncateChars(s, max) { return graphemes(s).slice(0, max).join(''); }

  // URL・メールアドレス・電話番号・@ID（記号を取り除く前の文字で見る）
  function looksLikeContact(s) {
    const t = String(s || '').normalize('NFKC').toLowerCase();
    if (/https?:|www\.|\.(com|jp|net|org|info|me|io|co)\b/.test(t)) return true;
    if (/[^\s@]+@[^\s@]+\.[a-z]{2,}/.test(t)) return true;
    if (/(^|\s)@[a-z0-9_]{2,}/.test(t)) return true;
    if (/line\s*id|ラインid/.test(t)) return true;
    if (t.replace(/[\s\-ー－()（）]/g, '').match(/\d{10,}/)) return true;
    return false;
  }

  function hasBannedWord(s) {
    const L = list();
    let n = normalize(s);
    if (!n) return false;
    const whole = n;
    // 野球用語（併殺・死球など）に当たる部分は先に取り除いてから比べる
    L.allow.forEach(a => { n = n.split(a).join(''); });
    return L.words.some(x => x.whole ? whole === x.word : n.includes(x.word));
  }

  // 実在の選手名の一覧から、比べるための形を作る。外国人選手は「・」の後ろ（例：カナリオ）も止める
  function buildRealNameSet(names) {
    const set = new Set();
    (names || []).forEach(name => {
      const full = normalize(name);
      if (full) set.add(full);
      const parts = String(name || '').split(/[・･]/);
      if (parts.length > 1) {
        const last = normalize(parts[parts.length - 1]);
        if ([...last].length >= 3) set.add(last);
      }
    });
    return set;
  }

  // 入力がその選手名と同じか、選手名を含んでいたら止める（3文字以上の名前だけ「含む」で見る）
  function isRealName(s, nameSet) {
    const n = normalize(s);
    if (!n || !nameSet) return false;
    if (nameSet.has(n)) return true;
    for (const name of nameSet) {
      if ([...name].length >= 3 && n.includes(name)) return true;
    }
    return false;
  }

  // 1つの欄をチェックする。戻り値：null（問題なし）／'real_name'／'banned_word'
  function check(s, nameSet) {
    if (!String(s || '').trim()) return null;
    if (isRealName(s, nameSet)) return 'real_name';
    if (looksLikeContact(s) || hasBannedWord(s)) return 'banned_word';
    return null;
  }

  const api = { normalize, sanitize, sanitizeTyping, countChars, truncateChars, buildRealNameSet, isRealName, hasBannedWord, looksLikeContact, check };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PickCardSafety = api;
})(typeof window !== 'undefined' ? window : globalThis);
