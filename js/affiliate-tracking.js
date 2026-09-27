// アフィリエイトリンクのクリックをGA4に送る共通スクリプト。
// 各リンクにdata属性を付けて回るのではなく、documentレベルのクリック委譲＋
// hrefのドメイン判定で自動検出する方式にすることで、リンクを追加するたびの
// 修正箇所を「対応表に1行足すだけ」に抑えている。
(function () {
  // 新しいアフィリエイトプログラムを追加したときは、ここに1行足すだけでよい。
  var AFFILIATE_SERVICES = [
    { service: 'a8net',   test: function (host) { return host === 'px.a8.net' || host === 'www10.a8.net'; } },
    { service: 'rakuten', test: function (host) { return /(^|\.)afl\.rakuten\.co\.jp$/.test(host); } },
    { service: 'amazon',  test: function (host) { return host === 'link.amazon' || /(^|\.)amazon\.co\.jp$/.test(host) || host === 'amzn.to'; } }
  ];

  function detectService(href) {
    var url;
    try { url = new URL(href, location.href); } catch (e) { return null; }
    for (var i = 0; i < AFFILIATE_SERVICES.length; i++) {
      if (AFFILIATE_SERVICES[i].test(url.hostname)) return { service: AFFILIATE_SERVICES[i].service, url: url };
    }
    return null;
  }

  // a8matの値（プログラムを識別するID）が取れる場合はservice詳細として一緒に送る
  function detectA8Program(url) {
    return url.searchParams.get('a8mat') || '';
  }

  // どの見出し/要素配下のリンクかを、祖先→手前の兄弟要素の順にざっくり探す
  function findPosition(el) {
    var ancestor = el.closest('section, article');
    if (ancestor) {
      var h = ancestor.querySelector('h1, h2, h3, h4');
      if (h && h.textContent.trim()) return h.textContent.trim().slice(0, 60);
    }
    var node = el;
    while (node) {
      var sib = node.previousElementSibling;
      while (sib) {
        if (/^H[1-4]$/.test(sib.tagName) && sib.textContent.trim()) return sib.textContent.trim().slice(0, 60);
        sib = sib.previousElementSibling;
      }
      node = node.parentElement;
    }
    return '';
  }

  document.addEventListener('click', function (e) {
    var a = e.target.closest('a[href]');
    if (!a) return;
    var detected = detectService(a.href);
    if (!detected) return;
    if (typeof gtag !== 'function') return;

    gtag('event', 'affiliate_click', {
      service: detected.service,
      a8_program: detected.service === 'a8net' ? detectA8Program(detected.url) : '',
      page: location.pathname,
      position: findPosition(a),
      link_url: a.href
    });
  }, true);
})();
