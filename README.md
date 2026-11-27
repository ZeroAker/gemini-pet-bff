# 🐱 Gemini Pet BFF (`gemini-pet-bff`)

一個建構於 **Cloudflare Workers + TypeScript (Hono) + Vertex AI Gemini + Upstash Redis + Mem0 + GitHub Actions** 的跨裝置 AI Agent 桌寵後端與 PWA 介面。

支援 **PC / Android 無縫同步記憶與狀態**、**動態複雜度模型路由**、**每小時生理時鐘演化**、**深夜發夢記憶整理與性格成長**，以及**受安全沙盒保護的多步驟自主升級（Self-Upgrade）系統**。

---

## ✨ 核心功能亮點

### 1. 動態複雜度路由與 Agent 工具鏈
- **三級自動模型切換**：根據訊息複雜度與意圖自動分派模型，並內建跨世代參數相容與自動降級備援鏈：
  - `simple`（閒聊 / 路由器）：`gemini-3.5-flash-lite` → `gemini-3.8-flash` → `gemini-4-hydrogen`
  - `medium`（工具呼叫 / 整理）：`gemini-4-hydrogen` → `gemini-3.8-flash` → `gemini-3.5-flash-lite`
  - `complex`（深度分析 / 程式架構）：`gemini-4-argon` → `gemini-4-hydrogen` → `gemini-3.8-flash` → `gemini-3.5-flash-lite`
- **多輪 Function Calling（最多 4 輪）**：完整保留 Gemini 3 / 4 工具呼叫所需的 `thoughtSignature`。

### 2. 跨裝置分層記憶與深夜「發夢」系統
- **即時短期記憶（Upstash Redis）**：保存最近 12 輪對話、好感度、活力值、無聊度、跨裝置待辦與分散式並發鎖（25s TTL）。
- **語意長期記憶（Mem0 v3）**：自動檢索與非同步提煉使用者長期偏好與生活習慣。
- **深夜發夢引擎（`nightly-dream.yml` / `scripts/nightly-dream.mjs`）**：
  - 每日香港時間 **03:00** 自動執行（亦支援從 PWA 或 API 手動觸發）。
  - 整理當日 `dream_inbox` 對話，產出**第一人稱桌寵日記**（最多保留 60 篇）與翌日注入用的**近期近況快照**（`recent_snapshot`）。
  - **四軸性格微演化**：溫柔（`warmth`）、俏皮（`playfulness`）、吐槽（`teasing`）、詳盡（`chattiness`），每日漂移嚴格限制在 `±5` 以內，內建 Prompt Injection 過濾，並保留最近 **7 個歷史版本**支援一鍵回滾。
  - 將新發現的高價值事實非破壞性追加至 Mem0。

### 3. 生理時鐘作息系統（Cloudflare Cron）
- 每小時由 Cloudflare Cron Trigger (`0 * * * *`) 執行 `src/plugins/lifecycle.ts`。
- 依香港時區區分**平日與週末作息**（深夜睡眠回血、週末賴床、上班打氣、放工關懷）。
- 追蹤**無聊度（`boredom`）**（無互動每小時 +8，互動即歸零）與即時廣東話小動作（`activity`），超過 24 小時未互動會觸發想念狀態。

### 4. 安全沙盒化多步自主升級（Agentic Self-Upgrade）
- 當使用者透過對話要求新增/修改/刪除功能或調整 PWA 介面時，Worker 於 1 秒內派發 `workflow_dispatch` 至 GitHub Actions（`self-upgrade-runner.yml`），徹底避開 Serverless 逾時限制。
- **20 輪自主工程師 Agent（`scripts/self-upgrade.mjs`）**：
  - 內建 `list_files`、`read_file`、`search_in_file`、`write_file`、`patch_file`、`delete_file`、`run_checks`、`finish_upgrade`、`reject_upgrade` 工具，並具備舊輪次長輸出自動摺疊（Context Pruning）機制。
  - 使用 `node:https` 原生 SSE 串流搭配 **5 分鐘 Idle Watchdog**、逾時自動原地重試、與 **20 秒 Redis 即時心跳**同步給 PWA 進度面板。
- **多層核心保護防線**：
  - **白名單隔離**：僅允許修改 `src/plugins/*.ts`、`src/ui.ts` 與 `src/ui/**`（包含各功能子資料夾下的 `.ts`、`.html`、`.css`）；核心架構檔案僅供唯讀參考。
  - **核心不可破壞**：嚴禁刪除 `src/plugins/registry.ts`、`src/plugins/lifecycle.ts`、`src/plugins/stickers.ts`、`src/ui.ts`，禁止覆寫核心保留工具名稱與使用 `eval` / `new Function`。
  - **自動驗證閘門**：合併前強制通過跨檔 VM 沙盒 UI 契約檢查、所有內嵌 `<script>` 語法驗證與全專案 `npx tsc --noEmit`，通過後自動建分支、開 PR 並 Squash Merge 觸發 Cloudflare 部署。

### 5. 模組化 PWA 互動介面
- 採用**按功能垂直拆分的子資料夾架構（`src/ui/<module>/`）**：每個功能模組獨立一個子資料夾（內含原生 `.html`、`.css` 與 `service.ts`），透過 `src/ui/ui-module-types.ts` 定義統一插槽介面，由 `src/ui.ts` 匯總組裝輸出於根路由 `/`。
- 支援**日／黃昏／夜動態主題**、情緒動畫頭像、好感／活力／無聊度進度條、快捷互動列（摸頭／餵零食／哄瞓覺／刷新狀態）與貼圖抽屜。
- 內建五大功能模組資料夾：
  1. **`src/ui/core/`（核心骨架與聊天）**：全域與動態主題樣式、頂部狀態列、聊天視窗、快捷互動列、貼圖抽屜、連線設定彈窗與 `/v1/pet/interact`、`/v1/pet/state`、`/v1/pet/lifecycle/tick` 同步邏輯。
  2. **`src/ui/upgrade/`（🪵 Log Cabin 升級日誌面板）**：即時輪詢進度條、步驟日誌、PR 與 GitHub Actions 雙源狀態校準。
  3. **`src/ui/proactive/`（🔔 主動關懷排程面板）**：每日／固定間隔／閒置提醒規則、AI 隨機生成句子開關、主動關懷氣泡與升級完成通知。
  4. **`src/ui/care-game/`（🎮 餵食與互動小遊戲）**：香烤小魚乾／草莓蛋糕／星光特調咖啡餵食、猜拳大作戰、10 秒點擊接愛心挑戰。
  5. **`src/ui/diary-persona/`（📖 日記與性格演化面板）**：時間軸日記本、四軸性格條、共同梗標籤、對主人的印象、一鍵還原性格與手動「立即發夢」。
- 預留 `#petStage` 區域供未來整合 3D 模型（`<model-viewer>` / WebGL）。

---

## 🗂️ 專案結構

```text
gemini-pet-bff/
├── .github/
│   └── workflows/
│       ├── nightly-dream.yml            # 每日 03:00 HKT 發夢記憶整理與性格演化排程
│       └── self-upgrade-runner.yml      # Agentic 自主升級遠端執行環境（含 concurrency 鎖）
├── scripts/
│   ├── nightly-dream.mjs                # 深宵反思、日記生成、性格微調與 Mem0 精煉腳本
│   └── self-upgrade.mjs                 # 20 輪多步自主寫碼、沙盒檢查、PR 與自動合併引擎
├── src/
│   ├── index.ts                         # Hono 路由入口、認證 API 與 Cloudflare Cron Handler
│   ├── services.ts                      # StateService (Redis)、MemoryService (Mem0)、GeminiService (Vertex AI)
│   ├── tools.ts                         # 核心工具實作、按意圖動態掛載與自訂插件沙盒派發器
│   ├── types.ts                         # 全專案 TypeScript Strict 型別與 .html/.css 模組宣告
│   ├── upgrader.ts                      # 自我升級任務派發器與核心保護工具清單
│   ├── ui.ts                            # PWA HTML 組裝入口（核心受保護）
│   ├── ui/                              # 按功能垂直模組化的前端子資料夾（可由自我升級維護）
│   │   ├── ui-module-types.ts           # UI 功能模組共用介面定義
│   │   ├── core/                        # 核心骨架、聊天、貼圖、設定彈窗與狀態同步
│   │   │   ├── header.html
│   │   │   ├── main.html
│   │   │   ├── footer.html
│   │   │   ├── modal.html
│   │   │   ├── styles.css
│   │   │   └── service.ts
│   │   ├── upgrade/                     # 頂部進度條與 Log Cabin 升級日誌面板
│   │   │   ├── top.html
│   │   │   ├── styles.css
│   │   │   └── service.ts
│   │   ├── proactive/                   # 主動關懷氣泡與排程管理面板
│   │   │   ├── top.html
│   │   │   ├── modal.html
│   │   │   ├── styles.css
│   │   │   └── service.ts
│   │   ├── care-game/                   # 點心餵食、猜拳與 10 秒接愛心小遊戲
│   │   │   ├── modal.html
│   │   │   ├── styles.css
│   │   │   └── service.ts
│   │   └── diary-persona/               # 桌寵日記時間軸與四軸性格演化面板
│   │       ├── modal.html
│   │       ├── styles.css
│   │       └── service.ts
│   └── plugins/                         # 可由自我升級維護的插件沙盒
│       ├── registry.ts                  # 插件註冊表（禁止刪除）
│       ├── lifecycle.ts                 # 每小時生理時鐘作息與無聊度規則（禁止刪除）
│       ├── stickers.ts                  # 貼圖註冊表與提示目錄（禁止刪除）
│       ├── github-actions-upgrade-status.ts  # 查詢 GitHub Actions 升級詳情、Annotations 與判決
│       ├── proactive-messages.ts        # 主動關懷排程與雙源升級完成追蹤
│       └── pet-care-game.ts             # 餵食點心、猜拳與點擊接愛心小遊戲
├── package.json
├── tsconfig.json
└── wrangler.toml
