/* 縮圖處理（首頁卡片與文章內影片）
   1. YouTube 縮圖升級：預設載入必定存在的 hqdefault（480x360），
      確認該影片真的有 maxresdefault（1280x720）才換上去 —— 缺少時 YouTube
      會回 404 並夾帶 120x90 佔位圖，直接使用會變成模糊小圖被拉大。
   2. 自動裁掉黑邊：不少醫療影片（內視鏡等）原始畫面四周就是黑的，
      縮圖直接放進卡片會留下大片黑邊。偵測四周的純黑列／行後放大填滿。 */
(function () {
  'use strict';

  var DARK = 20;        // 視為黑邊的亮度上限（0-255）
  var MIN_TRIM = 0.02;  // 黑邊不到 2% 就不處理
  var MAX_TRIM = 0.55;  // 單軸最多裁掉 55%，超過視為誤判而放棄

  function contentRect(img) {
    var W = 160;
    var H = Math.max(1, Math.round(W * img.naturalHeight / img.naturalWidth));
    var canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, W, H);
    var d = ctx.getImageData(0, 0, W, H).data;

    function lum(x, y) {
      var i = (y * W + x) * 4;
      return d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    }
    function rowDark(y) {
      for (var x = 0; x < W; x++) if (lum(x, y) > DARK) return false;
      return true;
    }
    function colDark(x) {
      for (var y = 0; y < H; y++) if (lum(x, y) > DARK) return false;
      return true;
    }

    var top = 0; while (top < H - 1 && rowDark(top)) top++;
    var bot = H - 1; while (bot > top && rowDark(bot)) bot--;
    var left = 0; while (left < W - 1 && colDark(left)) left++;
    var right = W - 1; while (right > left && colDark(right)) right--;

    return { l: left / W, r: (right + 1) / W, t: top / H, b: (bot + 1) / H };
  }

  function trimBars(img) {
    try {
      if (!img.naturalWidth || !img.naturalHeight) return;
      var a = contentRect(img);
      var cw = a.r - a.l;
      var ch = a.b - a.t;
      if (cw <= 0 || ch <= 0) return;
      if (1 - cw < MIN_TRIM && 1 - ch < MIN_TRIM) return;   // 幾乎沒有黑邊
      if (1 - cw > MAX_TRIM || 1 - ch > MAX_TRIM) return;   // 疑似誤判

      var scale = Math.max(1 / cw, 1 / ch);
      var tx = (0.5 - (a.l + a.r) / 2) * 100;
      var ty = (0.5 - (a.t + a.b) / 2) * 100;
      img.style.transform =
        'scale(' + scale.toFixed(4) + ') translate(' + tx.toFixed(2) + '%, ' + ty.toFixed(2) + '%)';
    } catch (e) {
      /* 跨網域或瀏覽器限制：維持原樣，不影響閱讀 */
    }
  }

  function whenReady(img, fn) {
    if (img.complete && img.naturalWidth) fn();
    else img.addEventListener('load', fn, { once: true });
  }

  var thumbs = document.querySelectorAll('.card-thumb img, .video-facade img');

  for (var i = 0; i < thumbs.length; i++) {
    (function (img) {
      whenReady(img, function () { trimBars(img); });

      var id = img.getAttribute('data-yt-thumb');
      if (!id) return;

      var probe = new Image();
      probe.crossOrigin = 'anonymous';
      probe.onload = function () {
        if (probe.naturalWidth < 1280) return;
        img.addEventListener('load', function () { trimBars(img); }, { once: true });
        img.src = probe.src;
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

/* 瀏覽計數器
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
