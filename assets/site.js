/* 瀏覽計數器前端
   - 文章頁：每個瀏覽器分頁計 1 次（sessionStorage 去重），避免重整灌水
   - 首頁卡片：只讀取不累加
   - 後端掛掉時靜默降級顯示「—」，不影響閱讀 */
(function () {
  'use strict';

  var nodes = document.querySelectorAll('[data-views]');
  if (!nodes.length || !window.fetch) return;

  var pageSlug = document.body.getAttribute('data-slug') || '';

  function fmt(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '—';
    try { return new Intl.NumberFormat('zh-Hant').format(n); } catch (e) { return String(n); }
  }

  function paint(slug, n) {
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].getAttribute('data-views') === slug) nodes[i].textContent = fmt(n);
    }
  }

  function seenThisSession(slug) {
    try {
      var k = 'cp:seen:' + slug;
      if (sessionStorage.getItem(k)) return true;
      sessionStorage.setItem(k, '1');
      return false;
    } catch (e) {
      return false; // 隱私模式等情況：當作沒看過
    }
  }

  // 1) 文章頁：累加自己這一篇
  var pending = Promise.resolve();
  if (pageSlug) {
    var method = seenThisSession(pageSlug) ? 'GET' : 'POST';
    pending = fetch('/api/views/' + encodeURIComponent(pageSlug), { method: method })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { if (j && typeof j.views === 'number') paint(pageSlug, j.views); })
      .catch(function () {});
  }

  // 2) 其餘（首頁卡片）：批次讀取，不累加
  pending.then(function () {
    var slugs = [];
    for (var i = 0; i < nodes.length; i++) {
      var s = nodes[i].getAttribute('data-views');
      if (s && s !== pageSlug && slugs.indexOf(s) === -1) slugs.push(s);
    }
    if (!slugs.length) return;
    return fetch('/api/views?slugs=' + encodeURIComponent(slugs.join(',')))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !j.counts) return;
        for (var k in j.counts) paint(k, j.counts[k]);
      })
      .catch(function () {});
  });
})();
