# GuardFrame

**GuardFrame 是一套防禦「即時換臉攻擊」的身分驗證引擎，設計給銀行數位開戶流程使用。**

## 這個專案在解決什麼問題

現在許多銀行的數位開戶，會要求使用者打開鏡頭、跟著指示眨眼、轉頭，用這個方式證明「鏡頭前的人是本人」。這個機制背後的假設很簡單：只有本人才能即時做出正確反應。

但「即時換臉」技術打破了這個假設。攻擊者只要拿到一份被害人的身分證件照片（買來的、偷來的，或社交工程騙來的），自己坐在鏡頭前操作換臉軟體，把自己的臉即時置換成被害人的臉——系統要求的眨眼、轉頭這些動作，攻擊者本人都能正確完成，因為驅動畫面的確實是一個真實存在、正在鏡頭前的人，只是臉被換掉了。這種攻擊已經不是理論：2026 年 3 月，荷蘭 ABN AMRO 銀行的案件被揭露，攻擊者用竊取的身分證件加上即時換臉技術，透過該行的手機開戶流程開出 46 個詐欺帳戶。

## GuardFrame 做了什麼

我們的做法不是單一「這張臉看起來像不像真人」的判斷，而是同時用**幾種原理各自獨立的檢查**——包括畫面本身有沒有 AI 生成痕跡、臉部反光跟不跟得上螢幕光線變化、以及使用者揮手遮臉時身分特徵有沒有斷掉。攻擊者要通過驗證，必須同時騙過好幾種完全不同性質的偵測方式，而不是只騙過一個。

系統最後產出的不是一個「通過／拒絕」的黑箱結果，而是完整的判斷依據（各項分數、曲線圖），交給銀行後台的審核人員查閱，最終決策權仍在銀行手上——GuardFrame 的角色是驗證引擎，不是取代銀行業務判斷的系統。

## 四道防線（技術細節）

| 層 | 原理 | 主要工具 |
|---|---|---|
| 對照組（動作挑戰） | 隨機順序的眨眼／轉頭指令，伺服器端出題防止預錄影片 | MediaPipe Face Landmarker |
| Track 1（合成偵測） | 分析畫面本身有無 AI 生成痕跡 | 視覺基礎模型 + 分類器 |
| Track 3（照明響應） | 螢幕隨機閃色，比對臉部反光與立體幾何是否符合真實物理反應 | MediaPipe + SciPy（互相關分析） |
| Track 4（遮擋一致性，核心防線） | 使用者揮手遮臉，換臉演算法在遮擋瞬間最容易露出破綻，比對遮擋前後的身分特徵連續性 | MediaPipe Hands + InsightFace（512 維人臉嵌入） |

**Track 2（生理訊號／rPPG 心跳偵測）已停用，不參與目前的風險判定。** 團隊實測 20 筆真人樣本後發現一般消費級鏡頭的訊噪比無法穩定達標，且主流商用活體驗證廠商亦未見以此作為正式產品技術，判斷為現階段消費級硬體的限制而非工程缺陷。完整訊號處理管線（MediaPipe 抓 ROI、POS 演算法、SciPy 濾波與頻譜分析）程式碼保留在 `track2_rppg/`，僅不再計入風險融合，見 `track2_rppg/analyzer.py::disabled_result()`。

四層之後，人工複核案件會另外呼叫本地部署的多模態模型（Ollama + Qwen2.5-VL）針對可疑影格生成文字摘要，依觸發複核的層（合成/光線/遮擋）動態調整提問內容，協助審核人員快速定位問題，但不參與最終判定。

## 技術棧

- **後端**：FastAPI、PostgreSQL、SQLAlchemy，非同步背景任務處理四層分析
- **電腦視覺**：MediaPipe（臉部/手部關鍵點）、InsightFace（人臉嵌入）、YOLO11n-pose（證件角點偵測，古典 CV 作自動 fallback）、OpenCV
- **訊號處理**：SciPy（帶通濾波、頻譜分析、互相關）
- **多模態 AI**：Ollama 本地部署 Qwen2.5-VL，用於人工複核輔助摘要
- **前端**：React 19 + Vite + TypeScript + Tailwind CSS
- **通知**：Resend API（自動判定與人工複核結果通知信）

## 環境設定

### 後端（Python 3.12）

```bash
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python test_env.py
```

`test_env.py` 會逐一 import 所有套件並實際跑一次運算，全部通過才會印出「全部 OK」。

在專案根目錄建立 `.env`（不會進 git）：

```
DATABASE_URL=postgresql://<user>:<password>@localhost:5432/<db>
RESEND_API_KEY=<Resend 的 API Key，選填，沒設定時通知信功能會自動跳過不寄信>
FRONTEND_BASE_URL=http://localhost:3000
```

建立後台行員帳號：

```bash
venv\Scripts\python.exe scripts\init_admin.py
```

需要另外取得的模型檔（皆不進 git，見 `.gitignore`）：

| 模型 | 大小 | 用途 | 取得方式 |
|---|---|---|---|
| `models/face_landmarker.task` | 3.6 MB | MediaPipe 臉部關鍵點 | 網址見 `config.MEDIAPIPE_FACE_MODEL_URL` |
| `models/hand_landmarker.task` | 7.5 MB | MediaPipe 手部關鍵點（Track 4） | 網址見 `config.MEDIAPIPE_HAND_MODEL_URL` |
| InsightFace `buffalo_l` | ~300 MB | 人臉偵測與身分嵌入 | 首次呼叫時自動下載至 `~/.insightface` |
| Ollama `qwen2.5vl:3b` | — | 人工複核 VLM 摘要 | 需先裝 [Ollama](https://ollama.com)，執行 `ollama pull qwen2.5vl:3b` |

啟動後端：

```bash
venv\Scripts\python.exe -m uvicorn api.main:app --port 8000 --host 0.0.0.0
```

### 前端

```bash
cd frontend
npm install
npm run dev
```

預設連線到 `http://localhost:8000`，可用 `VITE_API_BASE_URL` 環境變數覆蓋。

## 跑測試

```bash
pytest tests/ -q
```

**不需要攝影機、真實影片或真人照片。** 訊號處理用合成訊號驗證，影像品質用程式生成的測試圖驗證。端到端測試需要 `models/face_landmarker.task`、`models/hand_landmarker.task`，缺檔時會自動 skip。

## API 概覽

申請人端流程用 `X-Session-Id` header 驗證身分，後台端用 `Authorization: Bearer <token>`，兩套機制不互通。

| 端點 | 用途 |
|---|---|
| `POST /api/applicants` ~ `/account-setup` | 申請人六步驟開戶流程（基本資料、簡訊驗證、證件矯正、人臉驗證、帳戶設定） |
| `POST /api/admin/login` | 後台行員登入 |
| `GET /api/admin/records`、`/{id}` | 後台驗證紀錄列表與單筆詳情 |
| `POST /api/admin/records/{id}/action` | 人工複核案件的行員操作（發送補件通知／通知前往實體分行／確認核准通過），會透過 Resend 寄出對應通知信 |
