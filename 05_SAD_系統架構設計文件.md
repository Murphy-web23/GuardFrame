# SAD｜系統架構設計文件
## GuardFrame：即時生成式換臉攻擊防禦驗證引擎

---

## 一、系統分層架構

```
┌─────────────────────────────────────────┐
│              表現層（Presentation）        │
│   前台 React App  │  後台 React App        │
└─────────────────────┬─────────────────────┘
                      │ HTTPS / RESTful API
┌─────────────────────┴─────────────────────┐
│              應用層（Application）          │
│         FastAPI（路由、請求驗證、認證）        │
└─────────────────────┬─────────────────────┘
                      │
┌─────────────────────┴─────────────────────┐
│              服務層（Service）              │
│  影像前處理 │ 四層防禦 │ 決策融合 │ VLM輔助模組  │
└─────────────────────┬─────────────────────┘
                      │
┌─────────────────────┴─────────────────────┐
│              資料層（Data）                 │
│           PostgreSQL 17                    │
└─────────────────────────────────────────┘
```

### 認證機制（對應 SRS NFR-15）

後台採單一密碼登入，範圍限定為雜湊比對與簡易 token 驗證，不建置多帳號使用者系統：

```
使用者輸入密碼
   ↓
FastAPI 接收，以 bcrypt/passlib 對輸入密碼進行雜湊
   ↓
與資料庫存放之雜湊值比對（禁止明文比對）
   ↓
比對成功 → 發放簡易 session token
   ↓
後續後台 API 請求須攜帶 token 方可存取
```

---

## 二、服務層詳細模組圖

```
服務層／驗證引擎
│
├── baseline_challenge/（對照組）
│   └── analyzer.py
│       └── analyze_baseline() — 動作挑戰判定
│
├── track1_synthetic/（合成影像偵測）
│   └── detector.py
│       └── detect_synthetic() — 視覺基礎模型（現行主線 SigLIP2）特徵抽取＋線性分類頭推論
│
├── track2_rppg/（生理訊號）
│   ├── analyzer.py
│   │   └── analyze_rppg() — 主流程
│   └── signal_utils.py
│       └── detrend／濾波／FFT 訊號處理函式
│
├── track3_photometric/（照明響應）
│   ├── analyzer.py
│   │   └── analyze_photometric() — 主流程
│   ├── sequence.py
│   │   └── 隨機顏色序列產生與亮度換算
│   └── geometry.py
│       └── 立體幾何一致性檢查
│
├── track4_occlusion/（遮擋一致性，核心防禦層）
│   ├── analyzer.py
│   │   └── analyze_occlusion() — 主流程
│   ├── identity.py
│   │   └── 身分嵌入抽取與連續性計算
│   └── hand_tracking.py
│       └── 手部軌跡追蹤與循環偵測
│
├── image_utils/（影像前處理輔助）
│   ├── id_card.py
│   │   └── rectify_id_card() — 證件矯正
│   └── quality.py
│       └── check_image_quality() — 品質前置檢查
│
├── vlm_summary/（VLM輔助審核，排程於開發後期實作）
│   └── summarizer.py
│       └── summarize_verification() — 異常影格逐格摘要
│
└── common/（共用模組）
    ├── face_utils.py — 人臉偵測與對齊（InsightFace）
    ├── landmarks.py — 關鍵點封裝（MediaPipe）
    ├── schemas.py — 資料結構定義（Pydantic）
    └── fusion.py — 四層加權融合與決策邏輯
```

### 對外接口總表

| 模組 | 函式 | 負責人 |
|---|---|---|
| 對照組 | `analyze_baseline()` | B |
| Track 1 | `detect_synthetic()` | A |
| Track 2（已停用） | `analyze_rppg()` | B |
| Track 3 | `analyze_photometric()` | B |
| Track 4 | `analyze_occlusion()` | B |
| 證件矯正 | `rectify_id_card()` | B |
| 品質檢查 | `check_image_quality()` | B |
| VLM 摘要 | `summarize_verification()` | A |

---

## 附錄：模組完整介面契約

以下為服務層八個核心函式之完整輸入輸出規格。

### A-1｜Track 1：合成影像偵測

```python
# track1_synthetic/detector.py

def detect_synthetic(face_images: list) -> dict:
    """
    判斷臉部影像是否為 AI 生成。

    參數:
        face_images: list[np.ndarray]
            已對齊裁切的臉部圖片
            每張 shape = (224, 224, 3)，RGB 順序，dtype = uint8，值域 0-255
            長度固定為 10

    回傳:
        {
            "fakeProbability": float,      # 0.0 ~ 1.0
            "topSignals": [                # 固定 3 個，weight 由高到低排序
                {"label": str, "weight": float},
                {"label": str, "weight": float},
                {"label": str, "weight": float}
            ]
        }

    例外:
        輸入長度不為 10 或 shape 不符時，raise ValueError
    """
```

**Track 1 訓練資料的三類標籤**（不影響上述介面契約，僅說明模型內部訓練方式）：

| 標籤 | 定義 |
|---|---|
| `REAL` | 真人影像，未經任何身份或臉部修改 |
| `MANIPULATED_REAL` | 底片為真人影片，臉部／身份／嘴型／表情經 AI 修改 |
| `FULLY_AI_GENERATED` | 人物影像主體由生成模型產生，非以完整真人影片為底 |

若模型採三分類架構，仍須將結果收斂為單一 `fakeProbability`（例如取後兩類機率之和）以符合上述介面契約；三分類之細節可置於 `topSignals`，但不得移除或改變 `fakeProbability` 之語意與方向（數值越高越可疑）。

**Track 1 之能力邊界**：本模組僅分析畫面內容有無生成或操縱痕跡，無法判斷影像是否為當下經由實體鏡頭擷取。對於臉部與背景皆真實、僅擷取路徑異常之攻擊（預錄影片注入），本模組預期無法偵測，該情境由對照組動作挑戰與 Track 3 照明響應負責。此為架構設計之預期分工，非本模組之缺陷。

### A-2｜VLM 摘要模組

```python
# vlm_summary/summarizer.py

def summarize_verification(record: dict, anomaly_images: list) -> dict:
    """
    對人工複核案例逐格檢視異常影格，生成風控說明。
    僅在 record["decision"]["verdict"] == "review" 時呼叫。

    參數:
        record: dict
            完整驗證紀錄（四層分數皆已計算完成）
        anomaly_images: list[np.ndarray]
            Track 4 回傳的 anomalyFrames 對應的原始影格，通常 3-5 張
            由 B 依索引取出後傳入

    回傳:
        {
            "available": bool,             # VLM 是否成功執行
            "frameObservations": [
                {"frameIndex": int, "observation": str}
            ],
            "summary": str,                # 綜合說明
            "model": str,                  # 模型名稱與版本
            "latencyMs": float
        }

    實作要點:
        - 逐格提問只問「觀察到什麼」，不問「是不是偽造」
          判定由四層負責，VLM 只做描述，以降低幻覺
        - 不參與判定，不影響 riskScore 與 verdict
        - 執行失敗時回傳 available=False，前端隱藏該區塊
    """
```

### A-3｜對照組：隨機動作挑戰

```python
# baseline_challenge/analyzer.py

def analyze_baseline(frames: list, fps: float, challenges: list) -> dict:
    """
    傳統活體偵測：驗證使用者是否依序完成指定動作。

    參數:
        frames: list[np.ndarray]
            原始影格（未裁切），shape = (H, W, 3)，RGB，uint8
            僅傳入動作挑戰階段的影格（由 B 依 phases["action"] 切出，
            此區間涵蓋全部四個動作，總長固定 20 秒）
        fps: float
        challenges: list[dict]
            本次的動作順序，四項皆須完成，僅順序隨機：
            [
              {"action": "blink",      "durationSec": 3},
              {"action": "turn_left",  "durationSec": 5},
              {"action": "turn_right", "durationSec": 5},
              {"action": "wave_hand",  "durationSec": 7}
            ]
            四個時長固定不變，只有陣列順序隨機排列

    回傳:
        {
            "standard": "ISO/IEC 30107-3 動作挑戰",
            "challenges": [                     # 順序同輸入
                {
                    "action": str,               # blink | turn_left | turn_right | wave_hand
                    "name": str,                 # 中文標籤，供顯示
                    "durationSec": int,
                    "passed": bool
                }
            ],
            "verdict": str,                     # "pass" | "reject"
            "verdictLabel": str                 # "判定為真人" | "動作挑戰未完成"
        }

    實作要點:
        - 每個動作一律播滿完整固定秒數，不因偵測到動作就提前結束。
          原因：若允許提前結束，最快情況總長可能低於 rPPG 所需的 15 秒下限，
          且固定時長讓前端倒數與展示節奏更可預期
        - 判定方式是「該動作的時間視窗內，是否在任一時刻偵測到符合條件」，
          不要求動作發生在視窗的特定位置
        - blink：視窗內偵測到至少一次完整眨眼（EAR 下降後回升）即通過
        - turn_left / turn_right：視窗內頭部 yaw 角達到閾值即通過
        - wave_hand：本動作的影格同時交給 Track 4 做遮擋一致性分析，
          此處只需判定「是否偵測到有效的揮手動作」（手部進入/離開臉部
          區域至少 2 次循環，證明是持續揮動而非單次經過）

    備註:
        本組必須認真實作，不得刻意做弱。它需要是一個合理的傳統活體偵測，
        被新型攻擊繞過才具說服力。
    """
```

### A-4｜Track 2：生理訊號 **【2026-08-29 停用，不參與風險融合】**

> 實測 20 筆真人樣本後，訊噪比未曾達到判定門檻，且主流商用活體驗證
> 廠商亦未見以 rPPG 作為正式產品技術，判斷為消費級鏡頭硬體限制而非
> 工程缺陷，決定停用。以下規格為原始設計，程式碼保留，見
> `track2_rppg/analyzer.py::disabled_result()`。

```python
# track2_rppg/analyzer.py

def analyze_rppg(frames: list, fps: float) -> dict:
    """
    從影格序列提取心跳訊號。

    參數:
        frames: list[np.ndarray]
            原始影格，RGB。傳入整支影片的全部影格
            長度固定約 693（約 23 秒 @ 30fps，動作挑戰 20 秒＋照明 3 秒）
            rPPG 需要足夠時長以取得頻譜解析度，因此使用全片而非單一階段
        fps: float

    回傳:
        {
            "detected": bool,
            "heartRate": float | None,     # bpm；未偵測到為 None
            "snr": float,                  # dB
            "roiConsistency": float,       # 0.0-1.0，額頭與雙頰心率一致度
            "checks": [                    # 固定 3 項，順序不可變
                {"label": str, "passed": bool},
                {"label": str, "passed": bool},
                {"label": str, "passed": bool}
            ],
            "waveform": list[float],       # 濾波後訊號
            "spectrum": list[float]        # 功率頻譜，長度 64，對應 0-4 Hz
        }
    """
```

### A-5｜Track 3：照明挑戰

```python
# track3_photometric/analyzer.py

def analyze_photometric(frames: list, fps: float, light_log: dict) -> dict:
    """
    檢查臉部反射是否與螢幕光序列同步。

    參數:
        frames: list[np.ndarray]
            原始影格，RGB
            僅傳入照明挑戰階段的影格（由 B 依 phases["lighting"] 切出）
            長度約 90-150（3-5 秒 @ 30fps）
        fps: float
        light_log: dict           前端錄影時記錄的光序列

    回傳:
        {
            "detected": bool,
            "correlation": float,          # 0.0-1.0
            "latencyMs": float | None,     # 毫秒；未偵測到為 None
            "geometryScore": float,        # 0.0-1.0，立體幾何合理性
            "sequence": list[str],         # 實際播放的顏色名稱，5 個
            "checks": [                    # 固定 3 項，順序不可變
                {"label": str, "passed": bool},
                {"label": str, "passed": bool},
                {"label": str, "passed": bool}
            ],
            "lightCurve": list[float],     # 螢幕光強度，長度 100，標準化 0-1
            "reflectCurve": list[float]    # 臉部反射強度，長度 100，標準化 0-1
        }
    """
```

### A-6｜Track 4：遮擋一致性（核心防禦層）

```python
# track4_occlusion/analyzer.py

def analyze_occlusion(frames: list, fps: float) -> dict:
    """
    遮擋一致性檢查：使用者在臉前揮手時，身分特徵是否連續。

    這個動作與對照組的 wave_hand 挑戰共用同一段影格——使用者被要求在臉前
    揮手 7 秒，這段影格同時交給 analyze_baseline() 判定「有沒有揮手」，
    也交給這裡分析「揮手遮擋期間身分有沒有斷」。

    參數:
        frames: list[np.ndarray]
            原始影格，RGB
            僅傳入 wave_hand 動作的影格（由 B 依 phases["occlusion"] 切出，
            此區間等同 challenges 中 action="wave_hand" 那一項的時間範圍）
            長度固定約 210（7 秒 @ 30fps）
        fps: float

    回傳:
        {
            "detected": bool,              # 是否偵測到有效的揮手遮擋動作
            "waveCyclesDetected": int,      # 偵測到幾次完整的「進入→離開」循環
            "identityStability": float,    # 0.0-1.0，全程身分連續性平均分數
            "maxIdentityDrop": float,      # 0.0-1.0，所有循環中最大的單格身分突降幅度
            "occlusionSegments": [          # 每次遮擋循環的起訖影格索引，可能有多段
                [int, int],
                [int, int]
            ],
            "layerScore": float,           # 0.0-1.0，深度層級合理性（所有循環的平均）
            "anomalyFrames": list[int],    # 異常影格索引（跨所有循環彙整），供 VLM 與前端截圖
            "checks": [                    # 固定 3 項，順序不可變
                {"label": "偵測到至少 2 次揮手遮擋循環", "passed": bool},
                {"label": "身分特徵連續無突變", "passed": bool},
                {"label": "遮擋區域層級關係正確", "passed": bool}
            ],
            "stabilityCurve": list[float]  # 身分穩定度曲線，長度 = len(frames) - 1
        }

    實作要點:
        - 核心指標是身分連續性，不是偵測手本身
        - 反覆揮手比單次掃過能產生更多次「遮住/露出」循環，每一次都是一個
          偵測機會，因此不再要求指定方向，改為偵測循環次數
        - 遮擋期間可能偵測不到臉，必須 try/except 處理並記錄為缺失影格，
          不可讓程式中斷
        - occlusionSegments 與 anomalyFrames 的索引以「傳入的 frames」為基準
          （從 0 起算），不是全片索引。B 在取影格給 VLM 或前端截圖時，需加上
          phases["occlusion"][0] 換算回全片索引
    """
```

### A-7｜影像處理模組

```python
# image_utils/id_card.py

def rectify_id_card(image: np.ndarray) -> dict:
    """
    偵測證件四角並做透視變換矯正。

    回傳:
        {
            "success": bool,               # 是否成功偵測到四邊形
            "rectified": np.ndarray | None, # 矯正後影像，856×540
                                            # success 為 False 時為 None，不回傳任何影像
            "corners": list | None,        # 四個角座標 [[x,y]×4]，失敗為 None
            "confidence": float,           # 0.0-1.0
            "message": str                 # 供前端顯示的失敗訊息
        }

    實作要點:
        - 雙路徑：優先用自訓練的 YOLO11n-pose keypoint 模型直接偵測
          四個角點（可處理手指遮擋角落的情況）；模型不可用或信心不足
          時，自動退回古典路徑（灰階 → 高斯模糊 → Canny → findContours
          → 依面積排序 → approxPolyDP 逼近四邊形）
        - 角點依左上/右上/右下/左下排序後才能做透視變換
        - 找不到四邊形時，rectified 與 corners 皆回傳 None，success=False，
          並附上清楚的 message（例如「未偵測到證件邊界，請重新拍攝」），
          前端僅顯示此訊息，不顯示任何影像。不可拋例外
    """


# image_utils/quality.py

def check_image_quality(frames: list) -> dict:
    """
    影像品質前置檢查，不合格則退回要求重錄。

    回傳:
        {
            "passed": bool,
            "blurScore": float,            # Laplacian 變異數
            "brightness": float,           # 灰階平均值
            "contrast": float,             # 灰階標準差
            "overexposedRatio": float,     # 0.0-1.0
            "faceRatio": float,            # 臉部框面積 / 畫面面積
            "message": str                 # 不合格時說明原因
        }
    """
```

---

## 三、資料流與部署架構

### 完整資料流程圖

```
使用者提交驗證請求
        ↓
FastAPI /api/applications/{id}/verify 接收
        ↓
影像品質前置檢查（check_image_quality）
        ↓
   ┌─不合格─┐
   │ 回傳錯誤 │
   │ 訊息    │
   └────────┘
        ↓ 合格
影像前處理（抽影格、InsightFace 對齊）
        ↓
   ┌────┬────┬────┬────┐
   ↓    ↓    ↓    ↓
 對照組 Track1 Track3 Track4
   └────┴────┴────┴────┘
        ↓
fusion.py 加權融合
        ↓
產出風險分數與決策
        ↓
   ┌────不為 review────┐
   ↓                    ↓
寫入資料庫          VLM 摘要模組（review 才觸發）
   │                    ↓
   │              寫入資料庫（含摘要）
   └────────┬───────────┘
            ↓
    回傳完整 record 給前端
```

### 部署架構

展示採單機部署，前端、後端、資料庫、Track 1 模型推論皆運行於同一台裝置（配備 GPU），以簡化投影與現場操作流程。

```
┌─────────────────────────────────────┐
│         Docker Compose               │
│      （展示當天使用配備 GPU 之裝置）      │
│                                       │
│  ┌──────────┐  ┌──────────┐          │
│  │ frontend │  │ backend  │          │
│  │ (React)  │  │(FastAPI) │          │
│  │  :5173   │  │  :8000   │          │
│  └──────────┘  └────┬─────┘          │
│                      │                │
│         ┌────────────┼────────────┐   │
│         │             │            │   │
│  ┌──────┴─────┐ ┌────┴─────┐      │   │
│  │ PostgreSQL │ │ SigLIP2  │      │   │
│  │   :5432    │ │ (GPU推論) │      │   │
│  └────────────┘ └──────────┘      │   │
└─────────────────────────────────────┘
        單機一鍵啟動（docker-compose up）
```

**已知限制**：展示架構採單機部署以簡化投影與操作流程，惟此設計使系統可用性依賴單一裝置。建議事前準備完整 Demo 錄影作為備援，以因應現場網路、硬體或環境問題導致無法即時展示之情況。
