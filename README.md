# Kylin's Note · 林耿億醫師的醫療筆記

用 Markdown 寫筆記，`npm run build` 產生純靜態 HTML，推上 GitHub 後由 Cloudflare Pages 自動部署。

## 新增一篇筆記

1. 在 `posts/` 新增 `YYYYMMDD-英文短名.md`，檔名就是網址
2. 填好檔頭：

   ```
   ---
   title: 文章標題
   date: 2026-09-12
   author: 林耿億醫師
   summary: 首頁卡片上的一兩句摘要。
   ---
   ```

   **更新日不用自己寫**，建置時依 git 紀錄自動判定。

3. 寫內容（支援標題、清單、表格、引用、程式碼區塊、連結、圖片）
4. 建置並推送：

   ```bash
   npm run build
   git add -A && git commit -m "新增筆記：文章標題"
   git push
   ```

推上去之後 Cloudflare Pages 會自動重新部署，首頁卡片自動新增、依更新日排序（最新的在前）。

## 常用指令

| 指令 | 用途 |
| --- | --- |
| `npm run build` | 產生 `public/` 靜態檔案 |
| `npm run dev` | 本機預覽（含 Functions 與 KV 模擬），http://localhost:8788 |

## 專案結構

```
posts/                  Markdown 原稿（唯一需要手動編輯的地方）
assets/                 CSS 與前端 JS
scripts/build.mjs       建置腳本（零外部依賴）
functions/api/views/    瀏覽計數器 API（Cloudflare Pages Functions + KV）
public/                 建置輸出，由 Pages 部署
wrangler.toml           Pages 設定與 KV binding
```

## 設計重點

- **首頁文章列表是靜態 HTML**，不靠 JavaScript 讀 JSON 產生，利於搜尋引擎索引
- **手機優先**，表格與程式碼區塊各自橫向捲動，版面不會被撐破
- **瀏覽計數器**存在自家 Cloudflare KV，不需註冊第三方服務、不需 API 金鑰；後端異常時靜默降級顯示「—」，不影響閱讀
- **深淺色**依系統設定自動切換

## 圖片授權

HERO 圖片 [The Stethoscope, Peru](https://commons.wikimedia.org/wiki/File:The_Stethoscope,_Peru.jpg) by Alex Proimos，取自 Wikimedia Commons，授權 [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/)。出處同時標示於網站頁尾。

## 免責聲明

本站為個人臨床筆記，僅供醫學教育與經驗交流，不構成醫療建議，亦不能取代專業診療。
