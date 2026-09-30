#!/usr/bin/env node
// 分享預覽檢查（零外部依賴）。npm run build 結尾會自動執行，有缺漏就 exit 1。
//
//   node scripts/check-share.mjs                 檢查 public/ 的靜態產出
//   node scripts/check-share.mjs --live [origin] 另外用 facebookexternalhit 的 UA 實際請求每頁的 og:url，
//                                                要求直接 200、沒有轉址（預設 origin 為 og:url 本身）
//
// 逐頁檢查：
//  - <head> 內有 og:title/description/type/url/site_name/locale=zh_TW、og:image 與其尺寸/alt、
//    twitter:card=summary_large_image、twitter:image、canonical
//  - og:url == canonical，且以 / 結尾、對應到 public 裡真的存在的 index.html、不在 _redirects 的來源
//  - og:image 為 https 絕對網址、在自己網域、檔案存在、1200x630、JPG/PNG、< 1MB
//  - sitemap.xml 的網址與頁面 og:url 完全一致；站內 href 都不是「沒有 / 的頁面網址」

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public');
const ORIGIN = 'https://drgarylin.com';
const IMG_W = 1200;
const IMG_H = 630;
const IMG_MAX = 1024 * 1024;

const errors = [];
const fail = (page, msg) => errors.push(`  ✗ ${page}  ${msg}`);

/* ---- 找出所有要檢查的頁面（404.html 不會被分享，略過） ---- */
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const f = join(dir, e.name);
    return e.isDirectory() ? (e.name === 'assets' ? [] : walk(f)) : [f];
  });
}
const pages = walk(OUT).filter((f) => f.endsWith('index.html'));

/* ---- 讀圖片尺寸（只支援 JPG / PNG） ---- */
function imageInfo(file) {
  const b = readFileSync(file);
  if (b.readUInt32BE(0) === 0x89504e47) return { type: 'png', w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) {
        return { type: 'jpg', h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
      }
      i += 2 + b.readUInt16BE(i + 2);
    }
  }
  return null;
}

/* ---- _redirects 的來源 ---- */
const redirectFrom = new Set(
  existsSync(join(OUT, '_redirects'))
    ? readFileSync(join(OUT, '_redirects'), 'utf8').split('\n').map((l) => l.trim().split(/\s+/)[0]).filter(Boolean)
    : []
);

const metaContent = (head, attr, name) => {
  const re = new RegExp(`<meta\\s+${attr}="${name}"\\s+content="([^"]*)"`);
  const m = head.match(re);
  return m ? m[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'") : null;
};

const ogUrls = new Map(); // og:url -> 檔案路徑（相對 public）

for (const file of pages) {
  const rel = relative(OUT, file).split(sep).join('/');
  const expectedPath = rel === 'index.html' ? '/' : `/${rel.replace(/index\.html$/, '')}`;
  const html = readFileSync(file, 'utf8');
  const head = (html.match(/<head>([\s\S]*?)<\/head>/) || [])[1];
  if (!head) { fail(rel, '找不到 <head>'); continue; }

  const og = (n) => metaContent(head, 'property', n);
  const tw = (n) => metaContent(head, 'name', n);

  for (const n of ['og:title', 'og:description', 'og:type', 'og:url', 'og:site_name', 'og:locale', 'og:image',
    'og:image:width', 'og:image:height', 'og:image:alt']) {
    if (!og(n)) fail(rel, `缺少 ${n}`);
  }
  for (const n of ['twitter:card', 'twitter:image']) if (!tw(n)) fail(rel, `缺少 ${n}`);

  if (og('og:locale') && og('og:locale') !== 'zh_TW') fail(rel, `og:locale 應為 zh_TW，目前是 ${og('og:locale')}`);
  if (tw('twitter:card') && tw('twitter:card') !== 'summary_large_image') fail(rel, 'twitter:card 應為 summary_large_image');
  if (og('og:image:width') && og('og:image:width') !== String(IMG_W)) fail(rel, `og:image:width 應為 ${IMG_W}`);
  if (og('og:image:height') && og('og:image:height') !== String(IMG_H)) fail(rel, `og:image:height 應為 ${IMG_H}`);

  /* canonical / og:url */
  const canonical = (head.match(/<link rel="canonical" href="([^"]*)"/) || [])[1];
  const ogUrl = og('og:url');
  if (!canonical) fail(rel, '缺少 canonical');
  if (canonical && ogUrl && canonical !== ogUrl) fail(rel, `og:url 與 canonical 不同：${ogUrl} ≠ ${canonical}`);
  if (ogUrl) {
    if (ogUrl !== ORIGIN + expectedPath) fail(rel, `og:url 應為 ${ORIGIN + expectedPath}，目前是 ${ogUrl}`);
    if (!ogUrl.endsWith('/')) fail(rel, 'og:url 沒有以 / 結尾');
    const p = ogUrl.replace(ORIGIN, '');
    if (redirectFrom.has(p) || redirectFrom.has(p.replace(/\/$/, '') + '/')) fail(rel, `og:url ${p} 在 _redirects 裡是轉址來源，會形成轉址`);
    ogUrls.set(ogUrl, rel);
  }
  if (tw('twitter:image') && og('og:image') && tw('twitter:image') !== og('og:image')) fail(rel, 'twitter:image 與 og:image 不同');

  /* og:image */
  const img = og('og:image');
  if (img) {
    if (!img.startsWith(ORIGIN + '/')) fail(rel, `og:image 必須是 ${ORIGIN}/ 底下的 https 網址：${img}`);
    else {
      const path = img.slice(ORIGIN.length).split('?')[0];
      const f = join(OUT, decodeURIComponent(path));
      if (!existsSync(f)) fail(rel, `og:image 檔案不存在：${path}`);
      else {
        const size = statSync(f).size;
        const info = imageInfo(f);
        if (!info) fail(rel, `og:image 不是 JPG/PNG：${path}`);
        else if (info.w !== IMG_W || info.h !== IMG_H) fail(rel, `og:image 尺寸應為 ${IMG_W}x${IMG_H}，目前是 ${info.w}x${info.h}：${path}`);
        if (size >= IMG_MAX) fail(rel, `og:image 必須小於 1MB，目前 ${(size / 1024).toFixed(0)}KB：${path}`);
      }
    }
  }

  /* 站內連結：頁面網址一律要有結尾 /（有副檔名的檔案、#、?、/assets/ 除外） */
  for (const m of html.matchAll(/\shref="(\/[^"]*)"/g)) {
    const h = m[1].replace(/&amp;/g, '&');
    const path = h.split(/[?#]/)[0];
    if (path === '/' || path.startsWith('/assets/') || /\.[a-z0-9]+$/i.test(path)) continue;
    if (!path.endsWith('/')) fail(rel, `站內連結沒有結尾 /：${h}`);
  }
}

/* ---- sitemap ---- */
const sitemapFile = join(OUT, 'sitemap.xml');
if (!existsSync(sitemapFile)) fail('sitemap.xml', '不存在');
else {
  const locs = [...readFileSync(sitemapFile, 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  for (const l of locs) {
    if (!l.endsWith('/')) fail('sitemap.xml', `網址沒有結尾 /：${l}`);
    if (!ogUrls.has(l)) fail('sitemap.xml', `有網址沒有對應頁面的 og:url：${l}`);
  }
  for (const u of ogUrls.keys()) if (!locs.includes(u)) fail('sitemap.xml', `缺少 ${u}`);
}

/* ---- 選用：對線上（或指定 origin）實際請求 ---- */
const liveIdx = process.argv.indexOf('--live');
if (liveIdx !== -1 && errors.length === 0) {
  const base = process.argv[liveIdx + 1] && !process.argv[liveIdx + 1].startsWith('--') ? process.argv[liveIdx + 1] : null;
  const UA = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';
  for (const [url, rel] of ogUrls) {
    const target = base ? base.replace(/\/$/, '') + url.replace(ORIGIN, '') : url;
    try {
      const res = await fetch(target, { redirect: 'manual', headers: { 'user-agent': UA } });
      if (res.status !== 200) fail(rel, `${target} 回 ${res.status}${res.headers.get('location') ? ` → ${res.headers.get('location')}` : ''}，應為直接 200`);
    } catch (e) {
      fail(rel, `${target} 請求失敗：${e.message}`);
    }
  }
}

if (errors.length) {
  console.error(`\n分享預覽檢查失敗（${errors.length} 項）：`);
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`分享預覽檢查通過：${ogUrls.size} 頁的 OG／Twitter 標籤、og:url、og:image 皆正確${liveIdx !== -1 ? '，線上請求皆直接 200' : ''}`);
