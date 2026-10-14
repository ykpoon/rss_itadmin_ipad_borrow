# 共用 Supabase 的 Preview 測試版

此分支供發佈前試用多日期／多課節預約、Google 登入後本週提醒及「我的借用總表」。它沿用現有 `supabase-config.js`、資料表及 API，不需要執行 SQL。正式 `main` 分支繼續提供舊版服務。

**這是受限制的共用資料庫測試版，不能直接合併或 Promote to Production。** 正式網址會禁止此版本寫入。正式發佈須另外準備完整版本及確認相容、權限與並發處理。

## 開啟測試

1. 在 Vercel 對此分支產生的 Preview Deployment 按 Visit，記下完整網址。
2. 在現有 Supabase 專案的 Authentication → URL Configuration → Redirect URLs 加入該 Preview 網址的路徑規則，例如 `https://實際測試網址.vercel.app/**`，然後儲存。
3. 保留現有 Site URL 和原本正式 Redirect URLs。Supabase Google callback URL 不變，不用修改 Google 的 callback 設定。
4. 回到同一 Preview 網址，以已列於教師名單的學校 Google 帳號登入。登入後應留在 Preview，而不是正式網站。

參考：[Supabase Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)、[Vercel Git Deployments](https://vercel.com/docs/git)。

## 人手驗收

- 登入後查看本週借用提醒，再開啟「我的借用總表」。歷史記錄、同電郵的不同教師姓名及管理員代登記均應包含，其他老師不應出現在個人總表。
- 選擇沒有正式預約的日期／課節／設備。填妥借用表單，新增另一日期或課節後按「確認提交全部日期／課節」。原本一筆應自動包括在批量內。
- 確認兩筆均出現在總表，且數量各為 **1 部**。備註自動以 `[PREVIEW_TEST_20261014] ` 開頭。
- 測試日期、狀態和設備篩選、重新整理，以及手機版的左右捲動。
- 用管理員帳號到同一 Preview 的 `/admin.html`，對有標記的測試記錄逐筆「已取」、「歸還」，再刷新個人總表確認狀態。
- 確認正式借用記錄只供查閱；欠取、停借、教師名單及庫存修改不可操作。
- 用另一個教師帳號登入，確認總表不殘留上一人的記錄。沒有任何教師姓名配對的管理員，其個人總表為空。

## 清理假資料

在此 Preview 管理後台，只刪除備註以 **`[PREVIEW_TEST_20261014] ` 開頭**的記錄。也可在 Supabase Table Editor 的 `bookings` 表篩選同一標記，逐筆核對後刪除。不要清空整張表，也不要刪除教師或庫存資料。

此 Preview 的刪除不會自動扶正候補，避免修改其他人的正式預約。請用 Preview 後台清理，因為舊版後台的刪除仍可能執行它原有的候補處理。

## 已完成的自動驗證及限制

執行 `node --test tests/preview.test.mjs`，不需要安裝套件。涵蓋測試標記、遺失回應後重試、整批預檢、正式資料防誤改、姓名配對、身份與數量檢查、狀態操作及正式網址禁止寫入。

另外以 Chromium、真正 supabase-js、記憶體 PGlite SQL 及本機 Auth/REST 測試橋接驗證前後台流程；這不代表真實 Supabase Auth/PostgREST、Google OAuth 或多連線並發驗證。雲端登入及現有政策相容性仍須在 Preview 上人手驗收。

Preview 和正式網站使用**同一資料庫**；新增的假記錄會立即出現在正式網站，也會佔用該日期／課節 1 部設備。請在同事不用的課節測試，完成後清理。提交前檢查不能阻止同時出現的新正式預約；現有 API 沒有伺服器端庫存鎖或全域冪等保證。

這些前端限制是防止操作失誤的措施，不是資料庫安全隔離或 RLS 升級。本分支沒有更改任何 Supabase 權限、資料結構或正式資料。
