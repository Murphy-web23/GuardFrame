# GuardFrame Frontend

GuardFrame 的申請人端六步驟開戶流程與後台審核儀表板。React 19 + Vite + TypeScript + Tailwind CSS。

專案整體背景與完整規格見[根目錄 README](../README.md)。

## 執行

**環境需求**：Node.js

```bash
npm install
npm run dev
```

預設連線到後端 `http://localhost:8000`，可用 `VITE_API_BASE_URL` 環境變數覆蓋。

## 其他指令

```bash
npm run build   # 產生正式版靜態檔案
npm run preview # 預覽 build 結果
npm run lint    # TypeScript 型別檢查（tsc --noEmit）
```
