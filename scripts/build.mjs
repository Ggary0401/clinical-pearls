#!/usr/bin/env node
// 靜態部落格建置腳本（零外部依賴）
// posts/*.md  ->  public/<slug>/index.html  +  public/index.html
//
// 設計重點：
//  - 首頁文章列表直接寫進 HTML（不靠 JavaScript 讀 JSON），利於 SEO
//  - 每篇文章的「更新日期」由 git 自動判定；有未提交的修改則視為今天
//  - 卡片依更新日期排序，最新的在前

import { readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const POSTS_DIR = join(ROOT, 'posts');
const ASSETS_DIR = join(ROOT, 'assets');
const OUT_DIR = join(ROOT, 'public');

/* ------------------------------------------------------------------ 站台設定 */

const SITE = {
  title: "Kylin's Note",
  subtitle: '林耿億醫師的醫療筆記',
  author: '林耿億醫師',
  description: '林耿億醫師的臨床筆記與心得整理。',
  lang: 'zh-Hant-TW',
  // 正式網址（canonical / sitemap 用）
  origin: 'https://drgarylin.com',
  // 舊網址轉址（文章改名時在這裡補一行，避免既有連結失效）
  redirects: [
    ['/20260912-introduction', '/20260912-sigmoid-colon-polyp'],
    ['/20260905-writing-format', '/20260905-two-worlds'],
  ],
  // 學經歷（首頁「關於我」區塊。要增修直接改這兩個陣列即可）
  cv: {
    education: [
      '台灣大學 EMBA',
      '中國醫藥大學醫學系畢業',
    ],
    experience: [
      '昕澄診所總院長',
      '康澄診所總院長',
      '沐澄診所總院長',
      '鹿基大腸直腸外科主任',
      '彰基大腸直腸外科主治醫師',
      '彰基外傷急診主治醫師',
      '台灣肥胖醫學會會員',
      '挪威 Tromsø 大學附設醫院進修',
      '韓國大邱 구병원 醫院進修',
    ],
  },
  // 分享連結時的預覽圖（og:image）。CC BY 2.0，出處標示於頁尾。
  preview: {
    src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/75/The_Stethoscope%2C_Peru.jpg/1280px-The_Stethoscope%2C_Peru.jpg',
    workTitle: 'The Stethoscope, Peru',
    workUrl: 'https://commons.wikimedia.org/wiki/File:The_Stethoscope,_Peru.jpg',
    creator: 'Alex Proimos',
    license: 'CC BY 2.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/2.0/',
    sourceName: 'Wikimedia Commons',
  },
  // 進站 Banner（與分享預覽圖同一張，CC BY 2.0，出處標示於頁尾）
  hero: {
    src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/75/The_Stethoscope%2C_Peru.jpg/1280px-The_Stethoscope%2C_Peru.jpg',
    width: 1280,
    height: 853,
    alt: '一位醫師手持聽診器',
  },
};

/* ------------------------------------------------------------------ 小工具 */

/** Banner 圖片網址 */
const heroPath = () => SITE.hero.src;

/** YouTube 縮圖
 *  maxresdefault 不是每支影片都有，而且缺少時會回 404 卻夾帶一張 120x90 佔位圖
 *  （onerror 不會觸發），所以預設用必定存在的 hqdefault，
 *  再由 site.js 確認 maxresdefault 真的可用時才升級。 */
const ytThumbSafe = (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
const ytImgTag = (id) =>
  `<img src="${ytThumbSafe(id)}" data-yt-thumb="${id}" alt="" width="1280" height="720" loading="lazy">`;

const esc = (s = '') =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const escAttr = esc;

function todayISO() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function git(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

/** 文章「最後更新日」：有未提交的改動 -> 今天；否則取該檔最後一次 commit 日期 */
function resolveUpdated(relPath, fm) {
  const dirty = git(['status', '--porcelain', '--', relPath]);
  if (dirty) return todayISO();
  const committed = git(['log', '-1', '--format=%cs', '--', relPath]);
  if (committed) return committed;
  return fm.updated || fm.date || todayISO();
}

/** 以 YYYY-MM-DD 呈現 */
const fmtDate = (iso) => (iso || '').slice(0, 10);

/* ------------------------------------------------------------------ Front matter */

function parseFrontMatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { data: {}, body: raw };
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    data[kv[1]] = v;
  }
  return { data, body: raw.slice(m[0].length) };
}

/* ------------------------------------------------------------------ Markdown */

function inline(text) {
  // 先切出 `code`，避免行內語法污染程式碼
  const parts = String(text).split(/(`[^`]+`)/g);
  return parts
    .map((part) => {
      if (part.startsWith('`') && part.endsWith('`') && part.length > 1) {
        return `<code>${esc(part.slice(1, -1))}</code>`;
      }
      let s = esc(part);
      s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) => {
        const local = src.match(/^\/assets\/([^?#]+)$/);
        const url = local ? assetUrl(local[1]) : src;
        return `<img src="${escAttr(url)}" alt="${escAttr(alt)}" loading="lazy">`;
      });
      s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, href) => {
        const ext = /^https?:\/\//.test(href);
        const rel = ext ? ' target="_blank" rel="noopener noreferrer"' : '';
        return `<a href="${escAttr(href)}"${rel}>${t}</a>`;
      });
      s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
      return s;
    })
    .join('');
}

function renderMarkdown(md) {
  const lines = String(md).replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;

  const YT = /^\s*(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/watch\?(?:[^\s]*&)?v=|youtu\.be\/|youtube\.com\/shorts\/)([A-Za-z0-9_-]{11})(?:[?&#][^\s]*)?\s*$/;
  const isTableSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
  const cells = (l) => l.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) { i++; continue; }

    // 程式碼區塊
    if (/^```/.test(line)) {
      const lang = line.slice(3).trim();
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      const cls = lang ? ` class="language-${escAttr(lang)}"` : '';
      out.push(`<pre><code${cls}>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }

    // 單獨一行的 YouTube 網址 -> 點擊才載入播放器（不跳頁、不拖慢首次載入）
    const yt = line.match(YT);
    if (yt) {
      const id = yt[1];
      out.push(`<div class="video">
  <a class="video-facade" href="https://www.youtube.com/watch?v=${id}" data-yt="${id}" aria-label="播放影片">
    ${ytImgTag(id)}
    <span class="video-play" aria-hidden="true">
      <svg viewBox="0 0 68 48" width="68" height="48" focusable="false"><path class="video-play-bg" d="M66.5 7.7a8.6 8.6 0 0 0-6-6C55.8 0 34 0 34 0S12.2 0 7.5 1.6a8.6 8.6 0 0 0-6 6.1A90 90 0 0 0 0 24a90 90 0 0 0 1.5 16.3 8.6 8.6 0 0 0 6 6C12.2 48 34 48 34 48s21.8 0 26.5-1.6a8.6 8.6 0 0 0 6-6.1A90 90 0 0 0 68 24a90 90 0 0 0-1.5-16.3z"/><path d="M45 24 27 14v20z" fill="#fff"/></svg>
    </span>
  </a>
</div>`);
      i++;
      continue;
    }

    // 分隔線
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { out.push('<hr>'); i++; continue; }

    // 標題（文章正文用 h2 起，h1 保留給文章標題）
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const lvl = Math.min(Math.max(h[1].length, 2), 4);
      out.push(`<h${lvl}>${inline(h[2].trim())}</h${lvl}>`);
      i++;
      continue;
    }

    // 表格
    if (/^\s*\|/.test(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(cells(lines[i++]));
      out.push(
        `<div class="table-wrap"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead>` +
          `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
      );
      continue;
    }

    // 引用
    if (/^\s*>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote>${renderMarkdown(buf.join('\n'))}</blockquote>`);
      continue;
    }

    // 清單
    const ul = /^\s*[-*+]\s+/;
    const ol = /^\s*\d+\.\s+/;
    if (ul.test(line) || ol.test(line)) {
      const ordered = ol.test(line);
      const re = ordered ? ol : ul;
      const items = [];
      while (i < lines.length && re.test(lines[i])) items.push(lines[i++].replace(re, ''));
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map((t) => `<li>${inline(t)}</li>`).join('')}</${tag}>`);
      continue;
    }

    // 段落
    const buf = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^```/.test(lines[i]) &&
      !/^(#{1,6})\s/.test(lines[i]) &&
      !/^\s*>\s?/.test(lines[i]) &&
      !ul.test(lines[i]) &&
      !ol.test(lines[i]) &&
      !/^\s*\|/.test(lines[i]) &&
      !/^\s*(-{3,}|\*{3,})\s*$/.test(lines[i]) &&
      !YT.test(lines[i])
    ) buf.push(lines[i++]);
    if (buf.length) out.push(`<p>${inline(buf.join(' '))}</p>`);
  }

  return out.join('\n');
}

/* ------------------------------------------------------------------ 資產版本 */

// 掃描 assets/ 產生內容雜湊表。任何檔案（含文章裡引用的圖片）都自動帶版號，
// 確保改版後瀏覽器不可能吃到舊快取。
const ASSET_HASHES = {};
function hashAssets() {
  for (const f of readdirSync(ASSETS_DIR)) {
    try {
      ASSET_HASHES[f] = createHash('sha256').update(readFileSync(join(ASSETS_DIR, f))).digest('hex').slice(0, 8);
    } catch { /* 讀不到就跳過 */ }
  }
}
const assetUrl = (file) => `/assets/${file}${ASSET_HASHES[file] ? `?v=${ASSET_HASHES[file]}` : ''}`;

/* ------------------------------------------------------------------ 版型 */

const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Jost:wght@200;300;400;500&family=Parisienne&display=swap" rel="stylesheet">`;

function head(title, description, canonicalPath, image = SITE.preview.src) {
  return `<!DOCTYPE html>
<html lang="${SITE.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${escAttr(description)}">
<meta name="author" content="${escAttr(SITE.author)}">
<link rel="canonical" href="${escAttr(SITE.origin + canonicalPath)}">
<meta property="og:title" content="${escAttr(title)}">
<meta property="og:description" content="${escAttr(description)}">
<meta property="og:type" content="${canonicalPath === '/' ? 'website' : 'article'}">
<meta property="og:url" content="${escAttr(SITE.origin + canonicalPath)}">
<meta property="og:site_name" content="${escAttr(SITE.title)}">
<meta property="og:image" content="${escAttr(image)}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🩺</text></svg>">
${FONTS}
<link rel="stylesheet" href="${assetUrl('style.css')}">
</head>`;
}

/** 站頭：左側品牌標記，右側膠囊按鈕（參考站的 CI 結構） */
function siteHeader() {
  return `<header class="site-header">
  <div class="wrap head-inner">
    <a class="brand" href="/">
      <span class="brand-mark" aria-hidden="true">KYL</span>
      <span class="brand-text">
        <span class="brand-en">${esc(SITE.title)}</span>
        <span class="brand-zh">${esc(SITE.subtitle)}</span>
      </span>
    </a>
    <a class="pill" href="/#notes">全部筆記</a>
  </div>
</header>`;
}

/** 區塊標題：英文大標 + 中文小副標 */
function sectionTitle(en, zh, id = '') {
  return `<div class="sec-head"${id ? ` id="${escAttr(id)}"` : ''}>
    <h2 class="sec-en">${esc(en)}</h2>
    <p class="sec-zh">${esc(zh)}</p>
  </div>`;
}

/** 學經歷區塊：中文標題 + 英文小標 + 條列 */
function cvGroup(zh, en, items) {
  return `<div class="cv-group">
          <h3 class="cv-label"><span>${esc(zh)}</span><span class="cv-en">${esc(en)}</span></h3>
          <ul class="cv-list">
${items.map((t) => `            <li>${esc(t)}</li>`).join('\n')}
          </ul>
        </div>`;
}

function footer() {
  return `<footer class="site-footer">
  <div class="wrap">
    <div class="foot-top">
      <div class="foot-brand">
        <span class="brand-mark" aria-hidden="true">KYL</span>
        <div>
          <p class="foot-en">${esc(SITE.title)}</p>
          <p class="foot-zh">${esc(SITE.subtitle)}</p>
        </div>
      </div>
      <p class="credit">
        Banner 與分享預覽圖：<a href="${escAttr(SITE.preview.workUrl)}" target="_blank" rel="noopener noreferrer">${esc(SITE.preview.workTitle)}</a>
        by ${esc(SITE.preview.creator)}，取自 ${esc(SITE.preview.sourceName)}，授權
        <a href="${escAttr(SITE.preview.licenseUrl)}" target="_blank" rel="noopener noreferrer">${esc(SITE.preview.license)}</a>。
      </p>
    </div>
    <p class="disclaimer">本站為 ${esc(SITE.author)} 的個人臨床筆記，僅供醫學教育與經驗交流，<strong>不構成醫療建議</strong>，亦不能取代專業診療。如有健康問題請諮詢您的主治醫師。</p>
    <p class="copyright">© ${new Date().getFullYear()} ${esc(SITE.author)} · ${esc(SITE.title)}</p>
  </div>
</footer>`;
}

function metaRow(p) {
  return `<p class="meta">
      <span class="byline">${esc(p.author)}</span>
      <span class="sep" aria-hidden="true">/</span>
      <time datetime="${escAttr(p.date)}">發布 ${fmtDate(p.date)}</time>
      <span class="sep" aria-hidden="true">/</span>
      <time datetime="${escAttr(p.updated)}">更新 ${fmtDate(p.updated)}</time>
      <span class="sep sep-views" aria-hidden="true">/</span>
      <span class="views"><span data-views="${escAttr(p.slug)}">—</span> 次瀏覽</span>
    </p>`;
}

function renderIndex(posts) {
  const latest = posts.length ? posts[0].updated : todayISO();

  const cards = posts
    .map((p, i) => {
      // 影片縮圖只是預覽，點任何位置都是進入文章頁；影片在文章頁才能播放
      const thumb = p.video
        ? `<span class="card-thumb">
              ${ytImgTag(p.video)}
              <span class="card-play" aria-hidden="true">
                <svg viewBox="0 0 68 48" width="68" height="48" focusable="false"><path class="video-play-bg" d="M66.5 7.7a8.6 8.6 0 0 0-6-6C55.8 0 34 0 34 0S12.2 0 7.5 1.6a8.6 8.6 0 0 0-6 6.1A90 90 0 0 0 0 24a90 90 0 0 0 1.5 16.3 8.6 8.6 0 0 0 6 6C12.2 48 34 48 34 48s21.8 0 26.5-1.6a8.6 8.6 0 0 0 6-6.1A90 90 0 0 0 68 24a90 90 0 0 0-1.5-16.3z"/><path d="M45 24 27 14v20z" fill="#fff"/></svg>
              </span>
            </span>
            `
        : '';
      return `        <li class="card">
          <a class="card-link" href="/${escAttr(p.slug)}">
            ${thumb}<span class="card-body">
              <span class="card-no">${String(i + 1).padStart(2, '0')}</span>
              <h3 class="card-title">${esc(p.title)}</h3>
              <p class="card-summary">${esc(p.summary)}</p>
              <p class="meta"><span class="byline">${esc(p.author)}</span></p>
              <span class="card-more">閱讀筆記 <span aria-hidden="true">→</span></span>
            </span>
          </a>
        </li>`;
    })
    .join('\n');

  return `${head(`${SITE.title} · ${SITE.subtitle}`, SITE.description, '/')}
<body>
<a class="skip" href="#main">跳至主要內容</a>
${siteHeader()}
<main id="main">

  <section class="hero">
    <img class="hero-img" src="${escAttr(heroPath())}" width="${SITE.hero.width}" height="${SITE.hero.height}" alt="${escAttr(SITE.hero.alt)}" fetchpriority="high">
    <div class="hero-inner wrap">
      <p class="hero-kicker">那些教科書沒有寫完的臨床經驗</p>
      <h1 class="hero-title">林耿億醫師的<br>醫療筆記</h1>
      <p class="hero-script">Kylin&#39;s Note</p>
    </div>
  </section>

  <div class="strip">
    <div class="wrap strip-inner">
      <span>共 ${posts.length} 篇筆記</span>
      <span class="strip-sep" aria-hidden="true"></span>
      <span>最後更新 ${fmtDate(latest)}</span>
    </div>
  </div>

  <section class="about">
    <div class="wrap about-grid">
      ${sectionTitle('ABOUT', '關於我')}
      <div class="about-body">
        <figure class="portrait">
          <img src="${assetUrl('portrait.jpg')}" width="675" height="900" alt="${escAttr(SITE.author)}" loading="lazy">
        </figure>
        <div class="cv">
          ${cvGroup('學歷', 'EDUCATION', SITE.cv.education)}
          ${cvGroup('經歷', 'EXPERIENCE', SITE.cv.experience)}
        </div>
      </div>
    </div>
  </section>

  <section class="notes">
    <div class="wrap">
      ${sectionTitle('NOTES', '全部筆記', 'notes')}
      <ul class="cards">
${cards}
      </ul>
    </div>
  </section>


</main>
${footer()}
<script src="${assetUrl('site.js')}" defer></script>
</body>
</html>
`;
}

/** 404 頁。沒有這個檔案時，Cloudflare Pages 會把不存在的路徑導回首頁並回傳 200（軟性 404，傷 SEO）。 */
function render404() {
  return `${head(`找不到頁面 · ${SITE.title}`, '找不到這個頁面。', '/404')}
<body>
<a class="skip" href="#main">跳至主要內容</a>
${siteHeader()}
<main id="main">
  <section class="notfound">
    <div class="wrap-narrow">
      <p class="nf-code">404</p>
      <h1 class="nf-title">找不到這個頁面</h1>
      <p class="nf-text">這個網址可能已經更動或不存在。你可以回到首頁，從全部筆記裡找找看。</p>
      <p class="back"><a href="/"><span aria-hidden="true">←</span> 回到全部筆記</a></p>
    </div>
  </section>
</main>
${footer()}
<script src="${assetUrl('site.js')}" defer></script>
</body>
</html>
`;
}

function renderPost(p) {
  const ogImage = p.video ? ytThumbSafe(p.video) : SITE.preview.src;
  return `${head(`${p.title} · ${SITE.title}`, p.summary, `/${p.slug}`, ogImage)}
<body data-slug="${escAttr(p.slug)}">
<a class="skip" href="#main">跳至主要內容</a>
${siteHeader()}
<main id="main">

  <section class="post-head">
    <div class="wrap-narrow">
      <p class="crumb"><a href="/">HOME</a> <span aria-hidden="true">/</span> NOTES</p>
      <h1 class="post-title">${esc(p.title)}</h1>
      ${metaRow(p)}
    </div>
  </section>

  <article class="post">
    <div class="wrap-narrow">
      <div class="post-body">
${p.html}
      </div>
      <p class="back"><a href="/"><span aria-hidden="true">←</span> 回到全部筆記</a></p>
    </div>
  </article>

</main>
${footer()}
<script src="${assetUrl('site.js')}" defer></script>
</body>
</html>
`;
}

/* ------------------------------------------------------------------ 主流程 */

function build() {
  if (!existsSync(POSTS_DIR)) {
    console.error('找不到 posts/ 目錄');
    process.exit(1);
  }

  hashAssets();

  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(join(OUT_DIR, 'assets'), { recursive: true });

  const files = readdirSync(POSTS_DIR).filter((f) => f.endsWith('.md')).sort();
  const posts = files.map((file) => {
    const slug = basename(file, '.md');
    const raw = readFileSync(join(POSTS_DIR, file), 'utf8');
    const { data, body } = parseFrontMatter(raw);
    const updated = resolveUpdated(`posts/${file}`, data);
    // 取出第一支影片的 ID，供卡片縮圖與分享預覽圖使用
    const vm = body.match(/(?:youtube\.com\/watch\?(?:[^\s]*&)?v=|youtu\.be\/|youtube\.com\/shorts\/)([A-Za-z0-9_-]{11})/);
    return {
      slug,
      title: data.title || slug,
      author: data.author || SITE.author,
      summary: data.summary || '',
      date: data.date || updated,
      updated,
      video: vm ? vm[1] : '',
      html: renderMarkdown(body),
    };
  });

  // 最新的在前：先比更新日，再比發布日
  posts.sort((a, b) => (b.updated.localeCompare(a.updated)) || (b.date.localeCompare(a.date)) || b.slug.localeCompare(a.slug));

  for (const p of posts) {
    const dir = join(OUT_DIR, p.slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.html'), renderPost(p), 'utf8');
  }

  writeFileSync(join(OUT_DIR, 'index.html'), renderIndex(posts), 'utf8');
  writeFileSync(join(OUT_DIR, '404.html'), render404(), 'utf8');

  // 舊網址 301 轉址
  if (SITE.redirects.length) {
    writeFileSync(
      join(OUT_DIR, '_redirects'),
      SITE.redirects.map(([from, to]) => `${from} ${to} 301`).join('\n') + '\n',
      'utf8'
    );
  }

  for (const f of readdirSync(ASSETS_DIR)) copyFileSync(join(ASSETS_DIR, f), join(OUT_DIR, 'assets', f));

  // sitemap / robots（SEO 小加分）
  const origin = SITE.origin;
  const entries = [
    { loc: '/', lastmod: posts.length ? posts[0].updated : todayISO() },
    ...posts.map((p) => ({ loc: `/${p.slug}`, lastmod: p.updated })),
  ];
  const urls = entries
    .map((e) => `  <url><loc>${origin}${e.loc}</loc><lastmod>${e.lastmod}</lastmod></url>`)
    .join('\n');
  writeFileSync(join(OUT_DIR, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`, 'utf8');
  writeFileSync(join(OUT_DIR, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`, 'utf8');

  // 快取規則：HTML 每次重新驗證（改版立即生效）；
  // 資產網址帶內容雜湊，所以可以長期快取。後面的規則覆蓋前面的。
  writeFileSync(
    join(OUT_DIR, '_headers'),
    ['/*', '  Cache-Control: public, max-age=0, must-revalidate', '', '/assets/*', '  Cache-Control: public, max-age=31536000, immutable', ''].join('\n'),
    'utf8'
  );

  console.log(`建置完成：${posts.length} 篇文章 -> public/`);
  for (const p of posts) console.log(`  /${p.slug}  發布 ${fmtDate(p.date)}  更新 ${fmtDate(p.updated)}  ${p.title}`);
}

build();
