// ★ 2026-10 画面のエラー（JavaScriptのエラー）をGA4へ送る（js_error）。
//   ドラフト当日に、手元では再現できない不具合に早く気づくため。
//   送るのはメッセージの先頭100字とページ名だけ。同じエラーは1回の訪問（タブを閉じるまで）で1回まで。
//   他サイトのスクリプト由来で中身の分からない "Script error." は送らない。
//   表示を遅らせないよう async で読み込むため、読み込みが終わる前（ページを開いた直後）のエラーは拾えない。
(function () {
  var KEY = 'dt9_js_errors_sent';
  function alreadySent(sig) {
    try {
      var list = JSON.parse(sessionStorage.getItem(KEY) || '[]');
      if (list.indexOf(sig) !== -1) return true;
      list.push(sig);
      sessionStorage.setItem(KEY, JSON.stringify(list.slice(-30)));
      return false;
    } catch (e) {
      // sessionStorage が使えない環境では、このページの中だけで重複を防ぐ
      window.__dt9JsErrors = window.__dt9JsErrors || {};
      if (window.__dt9JsErrors[sig]) return true;
      window.__dt9JsErrors[sig] = 1;
      return false;
    }
  }
  function send(message) {
    var msg = String(message || '').replace(/\s+/g, ' ').trim().slice(0, 100);
    if (!msg || /^Script error\.?$/i.test(msg)) return;
    var page = location.pathname.replace(/^\//, '') || 'index.html';
    if (alreadySent(page + '|' + msg)) return;
    if (typeof gtag === 'function') gtag('event', 'js_error', { error_message: msg, page_name: page });
  }
  window.addEventListener('error', function (e) {
    // 画像などの読み込み失敗（e.message がない）は対象外
    if (!e || !e.message) return;
    send(e.message);
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason;
    send(r && r.message ? r.message : r);
  });
})();
