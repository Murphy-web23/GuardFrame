# GuardFrame

eKYC 線上開戶的即時生成式換臉與注入式攻擊偵測系統。使用者錄一段臉部影片，期間依序完成隨機動作挑戰、
照明挑戰、遮擋挑戰，系統用五條獨立的證據線判斷是否為真人現場拍攝。

> 技術規則書（介面契約、資料結構、命名規則）與執行計畫是團隊內部文件，
> 不在這個 repo 裡，請向團隊成員索取。

## 環境

Python **3.12**（兩人必須完全一致）。

```bash
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python test_env.py
```

`test_env.py` 會逐一 import 所有套件並實際跑一次運算，全部通過才會印出「全部 OK」。

## 跑測試

```bash
pytest tests/ -q
```

**不需要攝影機、真實影片或真人照片。** 訊號處理用合成訊號驗證，
影像品質用程式生成的測試圖驗證，Track 2 的端到端測試則是畫一張臉、
讓皮膚區域隨心跳週期變色，合成出一段「有心跳」的影片來跑。

端到端測試需要 `models/face_landmarker.task`、`models/hand_landmarker.task`，缺檔時會自動 skip。

## 目前進度

| 模組 | 狀態 |
|---|---|
| `track2_rppg/` | 完成。合成影片端到端驗證：72 bpm 目標，估算誤差 0.02 bpm |
| `track3_photometric/` | 完成（後端）。合成多區塊影格端到端驗證。`PHOTO_GEOMETRY_CV_REFERENCE` 待真實資料校準；真實影片驗證需前端顏色播放器，排階段 3 |
| `track4_occlusion/` | 完成（後端）。合成「兩次揮手遮擋」情境端到端驗證（含身分互換、臉透出來、沒揮手三種失敗情境）。真人自測發現 `maxIdentityDrop` 對手部部分遮擋過度敏感，待更多樣本後校準，見 PHASE1_NOTES §2.6 |
| `image_utils/quality.py` | 完成，`faceRatio` 需 InsightFace 模型 |
| `image_utils/id_card.py` | 完成，合成矩形卡片驗證，真實證件照片待驗證 |
| `baseline_challenge/` | 完成。左右轉判定用自創的幾何比例，方向已用真實自錄影片驗證並修正（2026-08-18） |
| `common/fusion.py` | 完成。五層加權融合＋三段式決策，2026-08-19 改用連續信心分數（見下方說明），不再是二值化風險 |
| `common/risk.py` | 完成。sigmoid 平滑「數值 vs 門檻」判定的共用工具，供各 track 算 `confidenceScore` |
| `common/schemas.py` | 完成。Pydantic 契約模型（snake_case 欄位＋camelCase 別名） |
| `common/face_utils.py` | 完成 `extract_frames()`；`extract_face()`/CLIP 對齊留給 A |
| `api/` | 核心端點完成：`POST /api/applicants`、`POST /api/applicants/{id}/verify`（含真的接 PostgreSQL）。CORS 已開放（開發階段 `allow_origins=["*"]`，正式環境要改成前端實際網域）。sms/admin/account-setup 端點與 `frontend/` 尚未開始 |
| `track1_synthetic/`、`vlm_summary/` | A 負責，目前放了 B 的佔位版本讓系統能先跑通 |

### 2026-08-19：五層改用連續信心分數

對照組、Track 2/3/4 原本用二值化風險（沒過門檻=100分風險、過了=0分），
現在跟 Track 1 一樣統一輸出 `confidenceScore`（0.0-1.0，數值越高代表
越可疑），能反映「證據有多強」而不只是「有沒有超過門檻」。詳細設計、
新增常數、優缺點見 `PHASE1_NOTES.md` §四之二。

## 需要另外取得的模型檔

三者都不進 git（見 `.gitignore`）：

| 模型 | 大小 | 用途 | 取得方式 |
|---|---|---|---|
| `models/face_landmarker.task` | 3.6 MB | MediaPipe 臉部關鍵點 | 已下載。網址見 `config.MEDIAPIPE_FACE_MODEL_URL` |
| `models/hand_landmarker.task` | 7.5 MB | MediaPipe 手部關鍵點（Track 4） | 已下載。網址見 `config.MEDIAPIPE_HAND_MODEL_URL` |
| InsightFace `buffalo_l` | ~300 MB | 人臉偵測與身分嵌入 | 首次呼叫時自動下載至 `~/.insightface` |

> MediaPipe 1.0.0 移除了舊的 `mp.solutions` API，改用 Tasks API，
> 而 Tasks API 必須自備 `.task` 模型檔。PLAN.md 裡的 `mp.solutions.face_mesh`
> 寫法在這個版本已經不能用。
