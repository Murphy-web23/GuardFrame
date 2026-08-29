# CONVENTIONS.md
## GuardFrame 技術規則書

> **這份文件是給 AI 讀的。** 每次跟 AI 開新對話時，把這份文件連同任務一起貼上。
>
> AI 沒有跨對話記憶。不貼這份文件，它會用自己的習慣重新發明一套命名與結構，
> 導致兩人的程式無法合併。
>
> **本文件的規則優先於 AI 的任何預設偏好。** 若 AI 的建議與本文件衝突，以本文件為準。
>
> 執行流程、分工、環境安裝步驟另見 `PLAN.md`（不需貼給 AI）。

---

# 1. 專案概要

GuardFrame：銀行 B2B 驗證引擎，嵌入數位開戶流程，針對**即時生成式換臉攻擊**進行防禦。核心威脅是攻擊者本人於鏡頭前操作換臉工具——動作、光照反應皆來自真實環境，僅臉部影像遭置換，使傳統活體偵測（要求完成指定動作）失效。

**系統角色**：依風險分數自動產出建議結果（通過／人工複核／拒絕），供銀行系統採用作為開戶判定依據；銀行保留最終業務規則設定權，系統執行銀行已授權的風險判斷邏輯，非取代銀行決策權。

**前台六步驟流程**：①基本資料 → ②簡訊驗證（啟動 15 分鐘全域倒數）→ ③證件上傳與矯正 → ④人臉驗證（固定約 23 秒）→ ⑤帳戶設定 → ⑥結果。詳見 §5.6。

**人臉驗證固定約 23 秒**（動作挑戰 20 秒 + 照明挑戰 3 秒），四動作播滿全長不提前結束，此設計同時保證 rPPG 有足夠訊號長度。系統以五條獨立證據線判斷是否為真人現場拍攝、且未經即時換臉：

| 層 | 判斷什麼 | 負責 |
|---|---|---|
| 對照組 | 有沒有依序完成四項指定動作 | B |
| Track 1 | 這張臉是不是 AI 生成的 | A |
| Track 2 | 這個人有沒有心跳（rPPG） | B |
| Track 3 | 這段影像是不是現場拍的（照明響應） | B |
| Track 4 | 遮擋時身分特徵有沒有斷掉 | B |

**設計核心：各層的失效條件互不重疊。** 攻擊者要繞過，必須同時解決五個不同性質的技術問題。

**Track 4（遮擋一致性）是核心防禦層，五層權重中設為最高（見 §8）。** 理由：即時換臉攻擊能通過動作挑戰（真人操作）、能通過照明挑戰（人真的在現場，光真的照得到臉），**唯有遮擋層——手掃過臉時換臉演算法的管線斷裂——能抓到這類攻擊**。這是本專題相對現有商用方案的差異化重點，其餘四層為輔助與基礎過濾。

---

# 2. 不可協商的規則

以下五條若違反，會直接導致兩人的程式無法合併。修改前必須兩人同意並更新本文件。

1. **§4 的介面契約**（函式簽章、輸入輸出格式）不得單方面修改
2. **§5 的資料結構**欄位名稱不得修改，只能新增
3. **§6 的目錄結構**不得擅自調整
4. **§7 的命名規則**一律遵守
5. **兩人各自的資料夾互不侵入**（§6.2）

---

# 3. 技術選型（已定案，不要更換）

| 用途 | 選定 | 不要用 |
|---|---|---|
| 人臉偵測、對齊、身分嵌入 | InsightFace（SCRFD + ArcFace） | DeepFace、dlib、face_recognition |
| 臉部與手部關鍵點 | MediaPipe | dlib 68 點 |
| 影像處理 | OpenCV | PIL 為主的方案 |
| 證件角點偵測（§4.7，僅限此用途） | YOLO11n-pose（Ultralytics，自訓練 4 點 keypoint 模型），純古典 CV（Canny＋輪廓）為自動 fallback，兩者並存 | 不做一般物件偵測；不用更大量級的 YOLO 模型（CPU 推論考量） |
| 訊號處理 | SciPy | 自行實作 FFT |
| 深度學習 | PyTorch | TensorFlow |
| 視覺基礎模型（Track 1，見 §3.2） | google/siglip2-base-patch16-224（**凍結**，現行主線） | 從頭訓練 CNN、Xception 微調 |
| 資料增強 | Albumentations | 自行實作 |
| 評估 | scikit-learn | 自行實作 AUC |
| 後端 | FastAPI | Flask、Django |
| ORM | SQLAlchemy | 手寫 SQL |
| 資料庫 | PostgreSQL 17 | SQLite（開發時可暫用） |
| 密碼雜湊 | passlib（bcrypt） | 自行實作雜湊演算法 |
| 前端 | React + Vite + Tailwind | Vue、Next.js |
| 圖表 | Recharts | Chart.js、D3 |
| 部署 | Docker Compose | 裸機部署 |

## 3.1 LLM 的使用限制

**主流程不使用 LLM 做任何判定。** VLM 摘要模組（§4.2）為產品完整版本之核心功能，僅於人工複核案件觸發，且不參與判定、不影響風險分數。因需額外部署地端模型，於四週開發期程中排序在後，優先確保五層防禦主體完成後再行實作，但不屬於可拿掉的加分項。

理由：專題需要可量化的機率輸出以計算 AUC、ROC、FAR/FRR，LLM 輸出文字判斷無法支撐這些指標；且 deepfake 破綻在像素級高頻紋理，正是 VLM 相對不敏感之處。

**不要建議用 Ollama、Qwen 或任何 LLM 取代 Track 1。**

## 3.2 Track 1 模型交付程式（取代原 CLIP 單一路線）

Track 1 的視覺基礎模型**已不是單一 CLIP ViT-L/14 路線**，改為多模型公平比較程式，狀態如下：

| 代號 | 模型 | 狀態 | 說明 |
|---|---|---|---|
| M0 | ResNet18 | 歷史基準參照 | 舊分數不得與新模型直接數值比較，僅供歷史對照 |
| M1 | **google/siglip2-base-patch16-224** | **現行主線（production mainline）** | `transformers.SiglipVisionModel` + `SiglipImageProcessor`，取 `pooler_output`，768 維，凍結不訓練 |
| M2 | facebook/dinov2-small（DINOv2） | 現行挑戰者，實驗中 | 需在相同資料集／Split／輸入／指標下證明優於 M1 才可能晉級；未證明前不得取代主線 |
| — | DINOv3 | 條件晉級 | 唯有 DINOv2 通過晉級 Gate 才投入驗證，不預先保證取代 |
| M3 | VLAForge | 平行研究，未採用 | 探索能否重構為自有實作取代主線；原始權重禁止直接使用（fail-closed），目前僅靜態可移植性研究，非主線候選 |

**不得**因本節更新就假設 SigLIP2 一定優於 CLIP，或假設 DINOv2/VLAForge 一定會取代 SigLIP2——這些都待公平比較實驗證據决定，尚未有定論的路線不得寫入正式報告當作已完成事實。

`detect_synthetic()` 的輸入輸出契約（§4.1）不因模型替換而改變；替換模型只能在 `track1_synthetic/` 內部實作切換，不得更動函式簽章。

`FRAME_COUNT = 10`（§8）是**目前的公平比較基準，不是永久上限**。日後若要測試更多影格，須先在 A 的實驗分支驗證效益，且不可未經協調就更動 §4.1 的共用輸入契約。

## 3.3 Track 1 訓練資料的三類標籤

| 標籤 | 定義 | 判別準則 |
|---|---|---|
| `REAL` | 真人影像，未經任何身份或臉部修改 | — |
| `MANIPULATED_REAL` | 底片為真人影片，臉部／身份／嘴型／表情經 AI 修改 | **有**一支真人完整原始影片作為底片 |
| `FULLY_AI_GENERATED` | 人物影像主體由生成模型產生 | **沒有**真人底片（憑空生成或由單張圖動起來） |

若模型採三分類架構，仍須收斂為單一 `fakeProbability`（例如取後兩類機率之和）以符合 §4.1 契約。三分類細節可置於 `topSignals`，**不得移除或改變 `fakeProbability` 的語意與方向**（數值越高越可疑）。

## 3.4 Track 1 的能力邊界（不得對外過度宣稱）

Track 1 只能判斷「畫面內容本身有無生成或操縱痕跡」，**無法判斷「這段影像是否為當下經由實體鏡頭擷取」**。

因此對於「臉是真的、背景是真的、畫面完全乾淨，但整段是預錄影片被注入系統」這類攻擊，Track 1 預期會判為正常——這是架構設計的預期結果，不是 Track 1 的缺陷。該情境由對照組動作挑戰與 Track 3 照明響應負責偵測。

完整的八種攻擊情境與五層防線對應表見 `04_SRS_系統需求規格書.md` §一之二。撰寫報告或說明系統能力時，不得把 Track 1 的分數當作「活體偵測」或「是否為真人現場」的證據。

---

# 4. 介面契約

**這是兩人合作的唯一接口。不得單方面修改。**

## 4.1 Track 1｜合成影像偵測（A 交付）

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

## 4.2 VLM 摘要（A 交付，核心功能，排序在後）

```python
# vlm_summary/summarizer.py

def summarize_verification(record: dict, anomaly_images: list) -> dict:
    """
    對人工複核案例逐格檢視異常影格，生成風控說明。
    僅在 record["decision"]["verdict"] == "review" 時呼叫。

    參數:
        record: dict
            完整驗證紀錄（五層分數皆已計算完成）
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
          判定由五層負責，VLM 只做描述，以降低幻覺
        - 不參與判定，不影響 riskScore 與 verdict
        - 執行失敗時回傳 available=False，前端隱藏該區塊
    """
```

## 4.3 對照組｜隨機動作挑戰（B）

```python
# baseline_challenge/analyzer.py

def analyze_baseline(frames: list, fps: float, challenges: list) -> dict:
    """
    傳統活體偵測：驗證使用者是否依序完成指定動作。

    參數:
        frames: list[np.ndarray]
            原始影格（未裁切），shape = (H, W, 3)，RGB，uint8
            **僅傳入動作挑戰階段的影格**（由 B 依 phases["action"] 切出，
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
        - 每個動作**一律播滿完整固定秒數**，不因偵測到動作就提前結束。
          原因：若允許提前結束，最快情況總長可能低於 rPPG 所需的 15 秒下限，
          且固定時長讓前端倒數與展示節奏更可預期
        - 判定方式是「該動作的時間視窗內，是否在任一時刻偵測到符合條件」，
          不要求動作發生在視窗的特定位置
        - blink：視窗內偵測到至少一次完整眨眼（EAR 下降後回升）即通過
        - turn_left / turn_right：視窗內頭部 yaw 角達到閾值即通過
        - wave_hand：本動作的影格同時交給 Track 4 做遮擋一致性分析
          （見 §4.6），此處只需判定「是否偵測到有效的揮手動作」
          （手部進入/離開臉部區域至少 2 次循環，證明是持續揮動而非單次經過）

    備註:
        本組必須認真實作，不得刻意做弱。它需要是一個合理的傳統活體偵測，
        被新型攻擊繞過才具說服力。
    """
```

## 4.4 Track 2｜生理訊號（B）

```python
# track2_rppg/analyzer.py

def analyze_rppg(frames: list, fps: float) -> dict:
    """
    從影格序列提取心跳訊號。

    參數:
        frames: list[np.ndarray]
            原始影格，RGB。**傳入整支影片的全部影格**
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

## 4.5 Track 3｜照明挑戰（B）

```python
# track3_photometric/analyzer.py

def analyze_photometric(frames: list, fps: float, light_log: dict) -> dict:
    """
    檢查臉部反射是否與螢幕光序列同步。

    參數:
        frames: list[np.ndarray]
            原始影格，RGB
            **僅傳入照明挑戰階段的影格**（由 B 依 phases["lighting"] 切出）
            長度約 90-150（3-5 秒 @ 30fps）
        fps: float
        light_log: dict           前端錄影時記錄的光序列，格式見 §5.2

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

## 4.6 Track 4｜遮擋一致性（B）

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
            **僅傳入 wave_hand 動作的影格**（由 B 依 phases["occlusion"] 切出，
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
        - **occlusionSegments 與 anomalyFrames 的索引以「傳入的 frames」為基準
          （從 0 起算），不是全片索引。** B 在取影格給 VLM 或前端截圖時，需加上
          phases["occlusion"][0] 換算回全片索引
    """
```

## 4.7 影像處理模組（B）

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
        - 2026-08-28 起改為雙路徑，優先用 YOLO11n-pose（自訓練，4 個
          角點當 keypoint 直接學）偵測四角；模型不可用、偵測不到、
          或信心低於 config.ID_CARD_ML_MIN_CONFIDENCE 時，自動退回
          原本的古典 CV 路徑（灰階 → 高斯模糊 → Canny → 膚色遮罩濾除
          → findContours → 依面積排序 → approxPolyDP 逼近四邊形 →
          依形心角度排序四角），兩條路徑都保留，用
          config.ID_CARD_USE_ML_DETECTOR 開關切換，細節見
          id_card_detector/README.md 與 image_utils/id_card.py 內的
          說明
        - 改用 ML 路徑的理由：古典方法對「手指蓋住卡片一角」這種遮擋
          情況天生做不到「猜出被遮住的角落在哪」，因為 Canny 在那個
          角落完全沒有邊界資訊可用；YOLO-pose 是從整張卡片形狀學出來的
          關鍵點模型，可以依其餘三個角與卡片比例推斷被遮住的角落座標
        - 兩條路徑找到角點後的後續步驟共用：角點須排序為左上/右上/
          右下/左下才能做透視變換
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

## 4.8 簡訊驗證與全域倒數 Session（B）

前台六步驟流程中，簡訊驗證通過後啟動 15 分鐘全域倒數，涵蓋證件上傳與人臉驗證兩步驟。此邏輯主要在前端 React state 管理，後端僅需在 `/api/applications` 建立時記錄啟動時間，供逾時判定與稽核追溯。

```python
# api/routes.py（節錄邏輯，非獨立模組）

def start_verification_session(applicant_id: int) -> dict:
    """
    簡訊驗證通過後呼叫，啟動 15 分鐘全域倒數。

    回傳:
        {
            "sessionId": str,
            "smsVerifiedAt": str,      # ISO 時間戳
            "deadlineAt": str,         # smsVerifiedAt + 15 分鐘
        }

    實作要點:
        - deadlineAt 由後端計算並回傳，前端據此顯示倒數，
          不可讓前端自行計算截止時間（避免使用者調整系統時間繞過限制）
        - 倒數期間任何操作皆不重置 deadlineAt
        - 逾時後前端呼叫 /api/applications/{id}/reset，
          後端捨棄該筆 applicant 尚未提交的 verification_records，
          但 applicants 資料本身不刪除（供未來分析放棄率使用）
    """
```

## 4.9 後台認證（B）

```python
# api/auth.py

def verify_admin_login(username: str, password: str) -> dict:
    """
    後台登入驗證，密碼以 bcrypt 雜湊比對，禁止明文比對。

    回傳:
        {
            "success": bool,
            "token": str | None    # 成功時回傳簡易 session token，失敗為 None
        }

    實作要點:
        - 使用 passlib.hash.bcrypt 比對，不自行實作雜湊演算法
        - 失敗時不得透露是帳號不存在還是密碼錯誤（避免帳號枚舉）
        - token 有效期建議設定，過期需重新登入
        - 密碼欄位任何情況下不得記錄於 log
    """
```



## 4.10 對方還沒完成時怎麼辦（重要）

**不要等。寫一個假的同名函式繼續做自己的部分。**

B 需要及早開始寫後端，但 A 的模型會晚一些完成。所以 B 先自己寫：

```python
# track1_synthetic/detector.py  （B 暫時放的佔位版本）

def detect_synthetic(face_images: list) -> dict:
    """佔位版本。A 完成後取代此檔案。"""
    return {
        "fakeProbability": 0.87,
        "topSignals": [
            {"label": "臉部邊界混合痕跡", "weight": 0.38},
            {"label": "高頻紋理不一致", "weight": 0.31},
            {"label": "跨影格閃爍", "weight": 0.25}
        ]
    }
```

它永遠回傳固定值，但**格式正確**。B 可以用它把整個後端串通、接上前端、存進資料庫。A 完成後只換掉這個檔案，**其他一行都不用改。**

VLM 模組同理，佔位版本直接 `return {"available": False, "frameObservations": [], "summary": "", "model": "", "latencyMs": 0.0}`。

---

# 5. 資料結構

## 5.1 完整驗證紀錄

前端、後端、資料庫共用。**欄位名稱不得修改，只能新增。**

```python
{
    "id": "VF-20260813-0042",
    "timestamp": "2026-08-13 14:32:07",
    "applicantName": "陳彥廷",
    "applicantIdMasked": "A12****789",
    "sourceType": "虛擬攝影機",

    "recording": {
        "durationSec": 23.1,             # 實際錄影長度，四動作固定 20 秒 + 照明約 3 秒
        "fps": 30.0,
        "totalFrames": 693,
        "phases": {                      # 各階段的影格區間 [起, 訖]，全片索引
            "action":    [0, 599],       # 涵蓋全部四個動作，固定總長 20 秒
            "lighting":  [600, 692],     # 約 3 秒
            "occlusion": [420, 599]      # = challenges 中 wave_hand 那一項的區間，
                                          #   是 action 區間內的子區間，非額外階段
        }
    },

    "quality": {
        "passed": True,
        "blurScore": 142.6,
        "brightness": 118.4,
        "contrast": 52.1,
        "overexposedRatio": 0.02,
        "faceRatio": 0.31,
        "message": ""
    },

    "baseline": {
        "standard": "ISO/IEC 30107-3 動作挑戰",
        "challenges": [                  # 順序隨機，四項皆須完成
            {"action": "turn_right", "name": "頭部向右轉", "durationSec": 5, "passed": True},
            {"action": "blink",      "name": "眨眼",       "durationSec": 3, "passed": True},
            {"action": "wave_hand",  "name": "臉前揮手",   "durationSec": 7, "passed": True},
            {"action": "turn_left",  "name": "頭部向左轉", "durationSec": 5, "passed": True}
        ],
        "verdict": "pass",
        "verdictLabel": "判定為真人"
    },

    "synthetic": {
        "fakeProbability": 0.942,
        "threshold": 0.5,
        "verdict": "reject",
        "topSignals": [{"label": "臉部邊界混合痕跡", "weight": 0.38}]
    },

    "rppg": {
        "detected": False,
        "heartRate": None,
        "snr": 0.7,
        "roiConsistency": 0.21,
        "checks": [{"label": "...", "passed": False}],
        "waveform": [],
        "spectrum": []
    },

    "photometric": {
        "detected": False,
        "correlation": 0.06,
        "latencyMs": None,
        "geometryScore": 0.09,
        "sequence": ["淡紅", "灰白", "淡藍", "淡綠", "灰白"],
        "checks": [{"label": "...", "passed": False}],
        "lightCurve": [],
        "reflectCurve": []
    },

    "occlusion": {
        "detected": True,
        "waveCyclesDetected": 3,
        "identityStability": 0.71,
        "maxIdentityDrop": 0.34,
        "occlusionSegments": [[12, 34], [58, 79], [103, 121]],   # 相對 occlusion 區間，從 0 起算
        "layerScore": 0.28,
        "anomalyFrames": [15, 62],                               # 同樣以 occlusion 區間為基準
        "checks": [{"label": "...", "passed": False}],
        "stabilityCurve": []
    },

    "decision": {
        "riskScore": 94,
        "verdict": "reject",
        "verdictLabel": "拒絕",
        "reasons": ["未偵測到照明響應，影像可能未經實體鏡頭擷取"]
    },

    "vlmSummary": None,
    "accountResult": "rejected"
}
```

## 5.2 光序列記錄格式

前端錄影時產生，與影片一起送給後端。

```json
{
  "startTimestamp": 1755066727543,
  "segments": [
    {"color": "淡紅", "hex": "#D98080", "startMs": 0,    "durationMs": 480},
    {"color": "灰白", "hex": "#E8E8E8", "startMs": 480,  "durationMs": 520},
    {"color": "淡藍", "hex": "#8098D9", "startMs": 1000, "durationMs": 440},
    {"color": "淡綠", "hex": "#80D9A0", "startMs": 1440, "durationMs": 600},
    {"color": "灰白", "hex": "#E8E8E8", "startMs": 2040, "durationMs": 460}
  ]
}
```

四色亮度換算值（Track 3 計算用）：灰白 1.00、淡綠 0.72、淡紅 0.68、淡藍 0.62。

## 5.3 挑戰指定格式與階段區間

前端在驗證開始時決定 `challenges`（四個動作、順序隨機、時長固定），錄影過程中記錄 `phases`，最後與影片一起送給後端。

```json
{
  "challenges": [
    {"action": "turn_right", "durationSec": 5},
    {"action": "blink",      "durationSec": 3},
    {"action": "wave_hand",  "durationSec": 7},
    {"action": "turn_left",  "durationSec": 5}
  ],
  "recording": {
    "durationSec": 23.1,
    "fps": 30.0,
    "totalFrames": 693,
    "phases": {
      "action":    [0, 599],
      "lighting":  [600, 692],
      "occlusion": [420, 599]
    }
  }
}
```

**四個動作固定時長，只有順序隨機**：`blink` 3 秒、`turn_left` 5 秒、`turn_right` 5 秒、`wave_hand` 7 秒。總計固定 20 秒，**每個動作一律播滿完整秒數，不因偵測到動作就提前結束**——這保證了總時長穩定，也讓 rPPG 有足夠訊號長度（整支影片含照明約 23 秒，高於 15 秒下限）。

**`phases["occlusion"]` 是 `phases["action"]` 內的子區間**，對應 `challenges` 陣列中 `action: "wave_hand"` 那一項實際發生的時間範圍，不是獨立於動作挑戰之外的額外階段。B 依這個子區間切出影格，同時交給 `analyze_baseline()` 判斷有沒有揮手，也交給 `analyze_occlusion()` 分析遮擋期間的身分連續性。

**前端記錄方式**：每個動作開始與結束時記下 `performance.now()`，最後除以 fps 換算成影格索引。建議在動作交界處加一次短暫的畫面標記（例如邊框閃一下）作為驗證用的視覺錨點。

**長度限制**

| 項目 | 值 | 原因 |
|---|---|---|
| 動作階段 | 固定 20 秒（3+5+5+7） | 四動作皆播滿全長，不提前結束 |
| 照明階段 | 固定約 3 秒 | 5 段顏色 × 400-600ms |
| 總長 | 固定約 23 秒 | 高於 rPPG 所需的 15 秒下限，行為可預期 |

因總長已固定，不再需要動態上下限判斷；若使用者中途離開鏡頭導致偵測異常，由各層自身的 `detected: False` 反映，不影響整體錄影流程繼續進行到 23 秒結束。

## 5.4 列舉值（只能用這些）

| 欄位 | 允許值 |
|---|---|
| `baseline.verdict` | `pass` / `reject` |
| `synthetic.verdict` | `pass` / `reject` |
| `decision.verdict` | `pass` / `review` / `reject` |
| `accountResult` | `pending_setup` / `opened` / `pending` / `rejected`（`pending_setup` 為 verdict=pass 但尚未完成帳戶設定的中繼狀態，見 §5.8） |
| `sourceType` | `實體相機` / `虛擬攝影機` / `實體相機（翻拍）` |
| 顏色名稱 | `淡紅` / `淡綠` / `淡藍` / `灰白` |
| 動作 | `blink`（3秒）/ `turn_left`（5秒）/ `turn_right`（5秒）/ `wave_hand`（7秒） |
| 階段名稱 | `action` / `lighting` / `occlusion` |

## 5.5 API 契約

```
POST /api/applicants
  Request:  { name, idNumber, birthDate, phone, email, address }
  Response: 201 — { applicantId }

POST /api/applicants/{id}/sms/send
  Request:  { phone }
  Response: 200 — { sent: true }（Demo 模式固定驗證碼 123456）

POST /api/applicants/{id}/sms/verify
  Request:  { code }
  Response: 200 — { success, sessionId, smsVerifiedAt, deadlineAt }
            403 — 連續錯誤 3 次需重新發送

POST /api/id-card/rectify
  Request:  multipart/form-data — image: File
  Response: 200 — { success, corners, confidence, message }
            （success 為 False 時不含 rectified 影像，見 §4.7）

POST /api/applicants/{id}/verify
  Request:  multipart/form-data
            video: File（固定約 23 秒，≤50MB）
            light_log: JSON string（§5.2）
            challenges: JSON string（§5.3，含 recording.phases）
  Response: 200 — 完整 record 物件（§5.1）
            409 — sessionId 已逾時（15 分鐘倒數歸零）

POST /api/applicants/{id}/reset
  說明:     15 分鐘倒數歸零時前端呼叫，捨棄本輪未提交資料
  Response: 200 — { reset: true }

POST /api/applicants/{id}/account-setup
  Request:  { accountType, transactionPassword, notificationPreference, termsAccepted }
            詳細規格見 §5.8
  Response: 200 — { success: true, accountResult: "opened" }
            400 — termsAccepted 為 false，或密碼格式不符

POST /api/admin/login
  Request:  { username, password }
  Response: 200 — { success, token }（密碼經 bcrypt 比對，見 §4.9）

GET  /api/admin/records?limit=50&verdict=reject
  Response: 200 — { records: [ ...record ] }

GET  /api/admin/records/{id}
  Response: 200 — 單筆完整 record

POST /api/admin/records/{id}/action
  說明:     後台「發送補件通知／通知前往實體分行／確認核准通過」三顆
            按鈕的實作（2026-08-29 新增，見 notifications.py）。只有
            verdict == "review" 的案件可以呼叫；approve 會把該筆紀錄的
            verdict 改為 "pass"（最終結果），三種動作都會呼叫 Resend API
            寄出對應內容的通知信給申請人。寄信失敗不影響本次呼叫成功
            （success 仍為 true），emailSent 會誠實回報實際寄送結果。
  Request:  { action: "approve" | "request_docs" | "branch_visit" }
  Response: 200 — { success: true, emailSent: boolean }
            400 — 該筆紀錄 verdict 不是 "review"
            404 — 找不到該筆紀錄
```

## 5.6 前台六步驟流程（對應 PRD F1-F7）

```
① 基本資料填寫
        ↓
② 簡訊驗證碼（通過後啟動 15 分鐘全域倒數，涵蓋③④兩步驟）
        ↓
③ 證件上傳與四角自動矯正
        ↓
④ 人臉驗證（動作挑戰 20 秒 + 照明挑戰 3 秒 = 固定約 23 秒）
        ↓  進入④時若全域剩餘時間 < 23 秒，先提示時間不足
   風險分數與決策回傳
        ↓
   ┌────┼────┐
  通過  人工複核  拒絕
   ↓      ↓      ↓
⑤帳戶設定 待審核提示 ⑥驗證未通過（不揭露原因）
   ↓
⑥ 開戶成功

15 分鐘倒數歸零 → 捨棄本輪資料 → 退回①，需重新填寫
```

## 5.7 正式資料庫結構（對應 SDS）

前台/API 使用的 JSON 巢狀結構（§5.1）與資料庫實際儲存的平面化欄位不同，兩者轉換在 `common/schemas.py` 用 Pydantic 處理。B 撰寫 `api/models.py`（SQLAlchemy）時須依此對照。

**三張表**：`applicants`、`verification_records`、`admin_credentials`。完整欄位定義（型別、可為空、說明）請參照 SDS 文件第二、三節，此處僅列核心結構供快速查閱：

```sql
-- applicants：申請人基本資料，一對多對應 verification_records
id, name, id_number_masked, phone, email, address, birth_date, created_at

-- verification_records：每筆驗證完整依據，含五層原始分數（平面化欄位，見 SDS §二）
-- 不拆分五層為獨立資料表，因彼此為一對一關係，拆分無正規化效益（詳見 SDS §一）
id, applicant_id (FK),
timestamp, source_type, duration_sec, fps, total_frames, phases (JSONB),
quality_passed, blur_score, brightness, ...,
baseline_challenges (JSONB), baseline_verdict,
synthetic_fake_probability, synthetic_verdict, synthetic_top_signals (JSONB),
rppg_detected, rppg_heart_rate, rppg_waveform (JSONB), ...,
photo_detected, photo_correlation, photo_light_curve (JSONB), ...,
occ_detected, occ_wave_cycles, occ_identity_stability, occ_stability_curve (JSONB), ...,
risk_score, verdict, reasons (JSONB), account_result,
vlm_available, vlm_summary, ...

-- admin_credentials：後台帳號，密碼須雜湊儲存（NFR-15）
id, username, password_hash, created_at
```

**個資保護**：`applicants.id_number_masked` 僅存遮蔽格式（如 `A12****789`），資料庫自始不存完整身分證字號。

**密碼欄位**：`password_hash` 型別 `VARCHAR(60)`，對應 bcrypt 固定輸出長度。初始化方式見 §8.1。

## 5.8 帳戶設定（對應 PRD 步驟⑤，前次規格缺口，已補齊）

**沿用金管會《銀行受理客戶以網路方式開立數位存款帳戶作業範本》第四條的帳戶分類**，與 BRD 參考資料引用同一份法規，論述一致。

**API**

```
POST /api/applicants/{id}/account-setup
  Request:
    {
      accountType: "type1" | "type3",   # 僅提供第一類與第三類，理由見下方
      transactionPassword: string,       # 6 位數字
      notificationPreference: {
        sms: boolean,
        email: boolean
      },
      termsAccepted: boolean             # 必須為 true 才能送出
    }
  Response:
    200 — { success: true, accountResult: "opened" }
    400 — termsAccepted 為 false，或密碼格式不符
```

**帳戶類型顯示文字**

| 值 | 顯示文字 | 說明文字 |
|---|---|---|
| `type1` | 數位存款帳戶（第一類） | 最高信賴等級驗證，交易額度最高 |
| `type3` | 數位存款帳戶（第三類） | 基礎額度，適合小額交易 |

**為什麼不提供第二類**：法規第四條規定第二類帳戶「應確認本人為經臨櫃辦理及人工查驗身分之自行舊戶」，本系統為全線上開戶，無臨櫃資料可比對此條件，故畫面僅呈現第一、三類。這不是遺漏，是刻意的範圍界定，如被問到可直接引用此條文說明。

**`accountResult` 狀態機**

```
verify 完成，decision.verdict === "pass"
        ↓
accountResult 初始值為 "pending_setup"（新增的中繼狀態）
        ↓
使用者完成步驟⑤，呼叫 account-setup 成功
        ↓
accountResult 更新為 "opened"
```

`decision.verdict === "pass"` 只代表「可進入帳戶設定」，不代表帳戶已真正開通。這與 `review`（`accountResult = "pending"`）跟 `reject`（`accountResult = "rejected"`）不同——那兩種情況直接跳過步驟⑤到結果頁，不會經過 `pending_setup` 這個中繼狀態。

---

# 6. 目錄結構

```
guardframe/
├── CONVENTIONS.md              ← 本文件（貼給 AI）
├── PLAN.md                     ← 執行流程與分工（人看的）
├── README.md
├── requirements.txt
├── config.py                   ← 所有路徑與參數，共用
├── .env.example
├── .gitignore
│
├── track1_synthetic/           ← A 專屬
│   ├── __init__.py
│   ├── detector.py             ← 對外入口：detect_synthetic()
│   ├── data_prep.py            ← 資料集處理、抽影格、切臉
│   ├── train.py                ← 訓練分類頭
│   ├── evaluate.py             ← AUC、ROC、混淆矩陣
│   └── weights/                ← 不進 git，含 M1 SigLIP2／M2 DINOv2 等各候選模型 checkpoint，見 §3.2
│
├── vlm_summary/                ← A 專屬（核心功能，排序在後）
│   ├── __init__.py
│   └── summarizer.py           ← 對外入口：summarize_verification()
│
├── track2_rppg/                ← B 專屬
│   ├── __init__.py
│   ├── analyzer.py             ← 對外入口：analyze_rppg()
│   └── signal_utils.py         ← detrend、濾波、FFT
│
├── track3_photometric/         ← B 專屬
│   ├── __init__.py
│   ├── analyzer.py             ← 對外入口：analyze_photometric()
│   ├── sequence.py             ← 隨機顏色序列與亮度換算
│   └── geometry.py             ← 立體幾何一致性檢查
│
├── track4_occlusion/           ← B 專屬
│   ├── __init__.py
│   ├── analyzer.py             ← 對外入口：analyze_occlusion()
│   ├── identity.py             ← 身分嵌入與連續性計算
│   └── hand_tracking.py        ← 手部追蹤與方向判定
│
├── baseline_challenge/         ← B 專屬
│   ├── __init__.py
│   └── analyzer.py             ← 對外入口：analyze_baseline()
│
├── image_utils/                ← B 專屬
│   ├── __init__.py
│   ├── id_card.py              ← 對外入口：rectify_id_card()
│   └── quality.py              ← 對外入口：check_image_quality()
│
├── id_card_detector/           ← B 專屬，證件角點 YOLO-pose 模型
│   ├── dataset/                ← 訓練圖片與標註（不進 git，.gitkeep 保留結構）
│   ├── weights/best.pt         ← 訓練好的權重（不進 git）
│   ├── train_colab.ipynb       ← 訓練 notebook
│   ├── convert_cvat_to_yolo.py ← 標註格式轉換工具
│   ├── test_model.py           ← 驗證用一次性腳本，非正式系統一部分
│   └── README.md               ← 標註格式、訓練指令、與 id_card.py 的接法
│
├── common/                     ← 共用，修改前須告知對方
│   ├── __init__.py
│   ├── face_utils.py           ← 抽影格、InsightFace 偵測與對齊
│   ├── landmarks.py            ← MediaPipe 封裝
│   ├── schemas.py              ← Pydantic 模型
│   └── fusion.py               ← 五層分數融合與決策
│
├── api/                        ← B 專屬
│   ├── main.py
│   ├── routes.py
│   ├── database.py
│   └── models.py
│
├── frontend/                   ← B 專屬
│
├── data/                       ← 不進 git
│   ├── raw/
│   ├── processed/
│   └── recordings/
│
├── notebooks/                  ← 探索與實驗，不放正式程式
│   ├── a_*.ipynb
│   └── b_*.ipynb
│
└── tests/
    ├── test_track1.py
    ├── test_track2.py
    ├── test_track3.py
    └── test_track4.py
```

## 6.2 資料夾歸屬（不可侵入）

| 資料夾 | 誰可以改 |
|---|---|
| `track1_synthetic/`、`vlm_summary/` | 只有 A |
| `track2_rppg/`、`track3_photometric/`、`track4_occlusion/`、`baseline_challenge/`、`image_utils/`、`id_card_detector/`、`api/`、`frontend/` | 只有 B |
| `common/`、`config.py` | 兩人皆可，但**修改前必須先講一聲** |

`common/` 是最容易產生衝突的地方。要改先問對方。

---

# 7. 命名規則

| 對象 | 規則 | 範例 |
|---|---|---|
| Python 檔案 | `snake_case.py` | `signal_utils.py` |
| Python 函式與變數 | `snake_case` | `analyze_rppg`、`heart_rate` |
| Python 類別 | `PascalCase` | `VerificationRecord` |
| 常數 | `UPPER_SNAKE` | `FRAME_COUNT` |
| **API 回傳的 JSON 欄位** | **`camelCase`** | `fakeProbability`、`maxIdentityDrop` |
| React 元件檔 | `PascalCase.jsx` | `OcclusionResult.jsx` |
| React 函式與變數 | `camelCase` | `handleSubmit` |
| 資料庫表名 | `snake_case` 複數 | `verification_records` |
| 資料庫欄位 | `snake_case` | `max_identity_drop` |

**這條容易搞錯**：Python 內部用 `snake_case`，但**送給前端的 JSON 一律 `camelCase`**。轉換在 `common/schemas.py` 用 Pydantic 的 alias 處理，不要在各處手動轉。

## 7.1 錄影檔案命名

```
{類型}_{條件}_{三位編號}.mp4
{類型}_{條件}_{三位編號}.json
```

| 類型 | 條件 | 範例 |
|---|---|---|
| `real` | `normal` / `dark` / `bright` / `near` / `far` / `moving` / `glasses` | `real_normal_001.mp4` |
| `inject` | `df` / `plain` | `inject_df_001.mp4` |
| `print` | `photo` / `screen` | `print_photo_001.mp4` |
| `occ` | `real` / `realtime` / `swap` | `occ_real_015.mp4` |

**影片與 json 必須成對且同名。**

---

# 8. 設定管理

所有路徑與參數集中在 `config.py`，**任何地方都不准寫死**。

```python
from pathlib import Path
BASE_DIR = Path(__file__).parent

# 路徑
DATA_DIR       = BASE_DIR / "data"
RAW_DIR        = DATA_DIR / "raw"
PROCESSED_DIR  = DATA_DIR / "processed"
RECORDINGS_DIR = DATA_DIR / "recordings"
WEIGHTS_PATH   = BASE_DIR / "track1_synthetic" / "weights" / "classifier.pth"

# 影像處理
FACE_SIZE      = 224
FRAME_COUNT    = 10          # Track 1 使用的臉部圖片數
TARGET_FPS     = 30
VIDEO_SECONDS_MIN = 15       # 低於此 rPPG 頻譜解析度不足
VIDEO_SECONDS_MAX = 45       # 避免檔案過大與使用者疲乏

# 品質檢查
QUALITY_BLUR_MIN       = 100.0
QUALITY_BRIGHTNESS_MIN = 60
QUALITY_BRIGHTNESS_MAX = 200
QUALITY_FACE_RATIO_MIN = 0.10

# Track 1
SYNTHETIC_THRESHOLD = 0.50

# Track 2
RPPG_BAND_LOW  = 0.7         # Hz，約 42 bpm
RPPG_BAND_HIGH = 4.0         # Hz，約 240 bpm
RPPG_SNR_MIN   = 3.0         # dB
RPPG_ROI_CONSISTENCY_MIN = 0.75

# Track 3
PHOTO_CORRELATION_MIN = 0.60
PHOTO_LATENCY_MAX_MS  = 80
PHOTO_GEOMETRY_MIN    = 0.50
PHOTO_SEGMENT_COUNT   = 5
PHOTO_SEGMENT_MIN_MS  = 400
PHOTO_SEGMENT_MAX_MS  = 600

# Track 4
OCC_IDENTITY_STABILITY_MIN = 0.90
OCC_MAX_DROP_THRESHOLD     = 0.20
OCC_LAYER_SCORE_MIN        = 0.50

# 五層權重（Track 4 為核心防禦層，權重最高；實測後於階段4依 ROC 校準微調）
WEIGHT_BASELINE    = 0.10
WEIGHT_SYNTHETIC   = 0.20
WEIGHT_RPPG        = 0.15
WEIGHT_PHOTOMETRIC = 0.20
WEIGHT_OCCLUSION   = 0.35

# 決策區間
RISK_PASS_MAX   = 30
RISK_REVIEW_MAX = 60

# 密碼雜湊（NFR-15）
BCRYPT_ROUNDS = 12
```

資料庫連線字串等機密放 `.env`，不進 git。

## 8.1 密碼雜湊初始化腳本範例

後台帳號密碼須以 bcrypt 雜湊儲存，明文密碼不得出現於任何程式碼、文件或版本控制紀錄。初始化時由 B 自行執行一次性腳本設定：

```python
# scripts/init_admin.py（僅本機執行一次，不進 git）
from passlib.hash import bcrypt
import getpass

username = input("設定後台帳號: ")
password = getpass.getpass("設定密碼（不會顯示）: ")
password_hash = bcrypt.using(rounds=12).hash(password)

# 將 username 與 password_hash 寫入 admin_credentials 表
# 明文 password 僅存在於此次執行過程中，不寫入任何檔案
```

展示當天由操作者憑記憶輸入密碼，後台登入畫面不顯示任何密碼提示。

---

# 9. Git 規則

## 9.1 分支

```
main            ← 只放能跑的版本
├── track1      ← A 的工作分支
└── tracks234   ← B 的工作分支
```

各自在自己的分支做，對進度時才合併回 `main`。

## 9.2 Commit 訊息

```
<類型>(<範圍>): <說明>
```

類型：`feat` / `fix` / `refactor` / `docs` / `test` / `chore`
範圍：`track1` / `track2` / `track3` / `track4` / `baseline` / `image` / `api` / `frontend` / `common` / `vlm`

```
feat(track4): 實作身分嵌入連續性分析
fix(track3): 修正光序列與影格的時間對齊偏移
feat(image): 證件四角偵測與透視變換
```

## 9.3 .gitignore 必須包含

```
__pycache__/
*.pyc
.env
venv/
node_modules/
data/
track1_synthetic/weights/
*.mp4
*.pth
*.onnx
```

**模型權重和影片絕對不要進 git。** 用雲端硬碟共享。

---

# 10. 給 AI 的行為準則

## 10.1 每次對話開頭要貼的內容

```
以下是我們專案的技術規則書，請完整遵守。
特別注意：§4 介面契約與 §5 資料結構不可修改，§7 命名規則一律遵守。

[貼上 CONVENTIONS.md 全文]

我負責的是 [A / B]，請只修改我負責的資料夾。
我現在要做的任務是：[具體描述]
```

## 10.2 必須遵守

1. **只修改任務相關的檔案。** 不要順手重構其他地方，不要「順便優化」沒被要求的程式碼
2. **不得修改 §4 的函式簽章。** 若認為現有設計有問題，先說明理由並詢問，不要直接改
3. **不得修改 §5 的欄位名稱。** 只能新增
4. **不得引入 §3 未列出的新依賴套件。** 需要時先詢問並說明理由
5. **所有路徑與閾值從 `config.py` 讀取**，不得寫死
6. **不確定的地方先問，不要自行假設。** 尤其是介面相關的部分
7. **產出後主動說明改了哪些檔案**，方便人工確認
8. **對方使用者是程式新手。** 解釋要具體，不要只給程式碼而不說明為什麼；但也不要每行都加註解

## 10.3 明確禁止的行為

| 錯誤 | 說明 |
|---|---|
| 自行改名 | 把 `fakeProbability` 改成 `fake_probability` 或 `isFake`。**JSON 一律 camelCase** |
| 擅自重構 | 「我順便把這段整理得更好」——不要，這會製造合併衝突 |
| 寫死路徑或閾值 | `"./data/train"` 應改為 `config.PROCESSED_DIR`；`0.5` 應改為 `config.SYNTHETIC_THRESHOLD` |
| 換套件 | 「用 DeepFace 比 InsightFace 好」——已定案，不要換 |
| 引入 LLM 做判定 | 見 §3.1 |
| 一次改太多檔 | 一個任務只碰必要的檔案 |
| 猜測介面 | 不確定對方的函式回傳什麼時，回頭看 §4，不要自己猜一個 |
| 遮擋時未處理偵測失敗 | Track 4 在遮擋期間可能偵測不到臉，必須 try/except 並記錄為缺失影格，不可讓程式中斷 |
| 註解過度 | 每行都加中文註解會讓程式難讀。只在邏輯不明顯處註解 |
| 忽略容錯 | `rectify_id_card` 找不到四邊形時，`rectified`／`corners` 須為 None，不可回傳原圖或任何影像，並標記失敗，不可拋例外 |
| 密碼明文化 | 後台密碼一律用 bcrypt 雜湊儲存與比對，不得寫死明文密碼、不得在畫面或 log 顯示密碼，見 §4.9、§8.1 |
| 擴充非目標功能 | 不得主動加入 §11 列出的非目標項目（證件 OCR、裝置層驗證、外部資料介接、持續監控等），即使技術上容易實作 |

---

# 11. 產品範圍邊界（Out of Scope）

以下項目為 PRD 明文排除之範圍，AI 協助開發時不得主動新增這些功能，即使看似順手可以一併做：

- 不含證件真偽辨識與 OCR 欄位抽取（`rectify_id_card()` 僅做四角矯正，不做內容辨識）
- 不含裝置層 capture-source 驗證（虛擬攝影機偵測、SDK hook 防禦等）
- 不含金融聯徵中心等外部資料查詢介接
- 不含帳戶開通後的持續監控機制（定期核對身分等）
- 不含多帳號權限分級（後台僅單一組帳密，不分角色權限）
- 系統不取代銀行對開戶結果的最終法律責任，僅產出建議結果

上述項目若被提及為「可以順便加上」，回頭確認 PRD 非目標清單與 SDS 未來擴充建議章節，這些是刻意排除、留待正式產品化階段的項目，不是本專題的遺漏。
