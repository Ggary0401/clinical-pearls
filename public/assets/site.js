/* 瀏覽計數器前端
   - 文章頁：每個瀏覽器分頁計 1 次（sessionStorage 去重），避免重整灌水
   - 首頁卡片：只讀取不累加
   - 後端掛掉時靜默降級顯示「—」，不影響閱讀 */
/* YouTube 縮圖升級
   預設載入必定存在的 hqdefault（480x360）。若該影片真的有 maxresdefault
   （1280x720）才換上去 —— 缺少時 YouTube 會回 404 並夾帶 120x90 佔位圖，
   直接使用會變成模糊小圖被拉大，所以先驗證尺寸再替換。 */
(function () {
  'use strict';

  var thumbs = document.querySelectorAll('img[data-yt-thumb]');

  for (var i = 0; i < thumbs.length; i++) {
    (function (img) {
      var id = img.getAttribute('data-yt-thumb');
      if (!id) return;
      var probe = new Image();
      probe.onload = function () {
        if (probe.naturalWidth >= 1280) img.src = probe.src;
      };
      probe.src = 'https://i.ytimg.com/vi/' + encodeURIComponent(id) + '/maxresdefault.jpg';
    })(thumbs[i]);
  }
})();

/* YouTube 點擊播放
   預設只載入縮圖；點擊後在原地換成播放器，不跳離頁面。
   沒有 JavaScript 時，連結仍可正常前往 YouTube。 */
(function () {
  'use strict';

  var facades = document.querySelectorAll('.video-facade');

  for (var i = 0; i < facades.length; i++) {
    facades[i].addEventListener('click', function (e) {
      var a = e.currentTarget;
      var id = a.getAttribute('data-yt');
      if (!id) return;
      e.preventDefault();

      var frame = document.createElement('iframe');
      frame.className = 'video-frame';
      frame.src = 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(id) +
                  '?autoplay=1&rel=0&playsinline=1';
      frame.title = '影片';
      frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
      frame.setAttribute('allowfullscreen', '');
      frame.setAttribute('frameborder', '0');

      a.parentNode.replaceChild(frame, a);
      frame.focus();
    });
  }
})();

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
