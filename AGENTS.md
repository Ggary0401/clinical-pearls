# clinical-pearls — 給 AI agent 的作業須知

醫療筆記靜態網站，正式站 **https://drgarylin.com**。
專案本身怎麼運作看 `README.md`，這份只寫「動手前必須知道的事」。

## 🚨 絕對不要編輯 `public/`

`scripts/build.mjs:576` 會先把整個目錄刪掉再重建：

```js
rmSync(OUT_DIR, { recursive: true, force: true });
```

所以改 `public/` 底下任何檔案都是白做工——下次 build 整個目錄會消失。
`public/assets/` 也一樣，它是從 `assets/` 複製過去的。

| 想改什麼 | 改這裡 |
|---|---|
| 文章內容 | `posts/*.md` |
| 樣式、前端行為 | `assets/style.css`、`assets/site.js` |
| 版面、HTML 結構 | `scripts/build.mjs` |
| 瀏覽計數 API | `functions/api/views/` |

改完一律跑 `npm run build` 重新產生 `public/`，並把產出一起提交
（Pages 直接部署 `public/`，不提交等於沒生效）。

## 🚨 推送 = 正式站立即上線

`main` 推上 GitHub 會觸發 Cloudflare Pages 自動部署，幾十秒後
drgarylin.com 就是新版。**沒有預備環境。**

所以：**除非使用者明確說要推，否則只 commit 不 push。**
也不要把 `git push` 放進可一鍵執行的指令區塊裡。

上線前先本機確認：

```bash
npm run dev     # http://localhost:8788，含 Functions 與 KV 模擬
```

## 慣例

- **零外部依賴**。`package.json` 沒有 dependencies，`build.mjs` 只用 node 內建模組。
  不要為了省事引入套件。
- **文章更新日期由 git 決定**（`build.mjs:97-109`）：讀該檔最後一次 commit 日期，
  有未提交修改則視為今天。所以改完沒 commit 就 build，日期會是今天。
- **assets 自動帶內容雜湊版號**（`?v=...`），不必手動處理快取。
- **手機優先**。表格與程式碼區塊各自橫向捲動，頁面本身不得出現橫向捲軸。
- commit 訊息用中文，簡短描述做了什麼，與既有歷史一致。

## 驗證

改完樣式或版面，至少確認：

1. `npm run build` 無錯誤
2. `git diff --stat public/` 的變動範圍符合預期
3. 手機寬度（375px）下沒有橫向捲軸
