# MealForward · Monad Testnet 真實鏈上 E2E 測試門禁（第一輪）

## Live 入口

https://mealforward-d1-offchain-staging.mealforward-lab-3956ray.workers.dev/chain-check

此頁已透過 Cloudflare Worker 部署，但 **只讀取 Monad Testnet**。不是付款/領券/結算操作。D1 三角色 Off-chain Staging 使用不同的假金額記錄，不應拿去驗證任何真實鏈上交易。

## 已經驗證

GitHub Actions `staging-d1/monad-live-rpc-preflight.mjs` 對公共 Monad Testnet RPC 發起實際 JSON-RPC read calls：

- `eth_chainId` 返回 `10143`；
- `eth_blockNumber` 返回正數；
- `eth_getCode` 確認 Circle Monad Testnet USDC 真有合約；
- `eth_call` ERC20 `decimals()` 返回 `6`；
- 這些都不需要任何私鑰、MetaMask 簽名或交易。

官方 Chain ID: 10143；Circle Testnet USDC: `0x534b2f3A21130d7a60830c2Df862319e593943A3`；原生 Gas: 測試 MON。

## 你現在可以親自測試的清單（手機 / 桌面）

- [ ] **M1** 開啟上述 URL；頂部應寫明 `LIVE READ-ONLY GATE`，不能要求匯入錢包私鑰、助記詞。
- [ ] **M2** 點選「驗證真實 RPC 網路」，Chain ID 顯示 10143，且測試 USDC 合約存在。
- [ ] **M3** 使用專門測試的 MetaMask 帳戶，點選「連接測試錢包（僅請求地址）」；只允許分享測試地址，不應彈出交易簽名。
- [ ] **M4** 若錢包不是 Monad Testnet，點選切換網路，核對 Chain ID 10143。
- [ ] **M5** 點選「讀取鏈上餘額」，應顯示測試 MON、Circle Testnet USDC 的真實鏈上餘額。
- [ ] **M6** 在沒有新部署的 Escrow 地址時，合約輸入框保持空白；不能將原 CP30 舊 Escrow 或 Circle USDC 合約假裝是新店合約。
- [ ] **M7** 如果有一個你**另行確認**的新獨立 StoreEscrow 部署地址，貼到檢查框，點「檢查新合約是否真的部署」；要看到 bytecode，而不是僅顯示「模擬部署成功」。
- [ ] **M8** 若你有剛剛本人提交的 Monad Testnet TX Hash，填入 Receipt 查詢框核實區塊、狀態及合約地址；不應要求發送交易。
- [ ] **M9** 切換 MetaMask 帳戶/網路後，頁面應要求重新核驗，不應沿用舊帳戶餘額。
- [ ] **M10** 按「複製當前測試結果摘要」，回傳安全摘要與失敗畫面；**不要發送**私鑰、助記詞或簽名。

## 尚未通過的真正資金 E2E

### T0 — 新合約與憑證

- 不能復用原 Mac CP30 的 escrow/funded USDC/Journals。新測試的合約必須完整獨立，必須核對合約來源、bytecode、Chain ID、Owner/quote/issuer/operator/catelog 權限。
- 已有 `cp30-contracts/contracts/StoreEscrow.sol` 實現新店 escrow，但 `ThreeStoreFactory.sol` 只會在 constructor 中**一次性建 3 個固定店**，不是動態建店工廠。
- 真正測試的一家店應針對 `StoreEscrow` 審查獨立 constructor 部署方式，不要把網頁 D1「創建餐館」等同於鏈上合約創建。
- 原合約生命週期最大 10 個 lifetime funded units，餐品條款和領取窗口有限制。

### T1 — 資助者真實 Fund

- [ ] 新測試 ERC20 地址及 Escrow 來源驗收；MetaMask 專用測試錢包餘額足夠。
- [ ] 獨立 `quoteAuthority` 根據原 EIP-712 規則授權指定 payer / meal / version / unitPrice / amount / deadline。
- [ ] 資助者本人確認 USDC Approve（如需）和 Fund，保存兩筆真實交易 hash、receipt、區塊以及事件。
- [ ] 完成後才允許在 My Contributions 顯示實際 `FINAL_SUCCEEDED`，不得用 D1 模擬訂單假裝成功。

### T2 — Issue 真券

- [ ] 原合約的 `nextCandidate(mealId)` 確認可用 unitSeq / nextGeneration / termsHash。
- [ ] 授權 issuer 發送真正的 `issue(opId, mealId, expectedSeq, generation, termsHash, deadline)`；記錄事件和 TX hash，判斷 original voucher。
- [ ] 確保不同使用者不能取得別人的私有券資料；不能把簽名/QR 值放到公開帳本。

### T3 — 商家 Check / Lock / MarkHandover / Report

- [ ] Check 是獨立讀取鏈上券狀態，不代表已鎖券。
- [ ] `lock` 只有 operator 能執行，需符合原條款指定 UTC+8 營業時間窗口、券期限及 deadline。
- [ ] `markHandover` 是獨立鏈上操作；`report` 必須引用已保存的 lockId 和 markerId。不能跳過真實交餐確認。

### T4 — 真正 Settle

- [ ] 由 owner 錢包發送 `settle(opId, voucherId, generation)`；receipt status 成功。
- [ ] 同時核對 Escrow 資產餘額下降、Owner 錢包測試 USDC 增加、鏈上 Settled event 金額與資助份數一致。
- [ ] 發生 UNKNOWN 或 pending 時不得換 opId 重新發款；必須先查原交易及事件。原 CP30 已提交未 ACK 的資料絕不可重發。

## 實際下一個最小工程任務

- 編譯並固定新 StoreEscrow 的 creation bytecode / ABI/source hash，建立 browser wallet-mediated deployment（需要你本人授權 MetaMask 交易），不匯入原 CP30 密鑰。
- 用新測試的 quote/issuer/operator/owner 權限建立隔離的鏈上一次餐 MVP，接上新的可持久化 worker。
- 每一步獨立 TX Hash / Receipt / 角色和會計對賬，前端不得把 SQL 成功誤稱鏈上成功。

**目前本頁只讀準備已可測；T0–T4 尚未放行，不該要求用戶資助真 USDC。**
