# SDS｜系統設計規格書
## GuardFrame：即時生成式換臉攻擊防禦驗證引擎

---

## 一、資料庫選型與整體 ER 圖

### 資料庫版本

PostgreSQL 17

### 三張表設計

| 表名 | 用途 |
|---|---|
| `applicants` | 申請人基本資料，一位申請人可對應多筆驗證嘗試 |
| `verification_records` | 每筆驗證的完整依據，含五層原始分數 |
| `admin_credentials` | 後台登入帳密，含 username，密碼以 bcrypt 雜湊儲存 |

### 正規化決策說明

`applicants` 與 `verification_records` 為一對多關係（一位申請人可產生多筆驗證嘗試，例如逾時重試），依正規化原則拆分為兩張表，避免申請人基本資料重複儲存。

`verification_records` 內的五層防禦結果（對照組、Track 1-4、決策融合）與該筆驗證紀錄之間為**一對一關係**——一筆驗證紀錄必然對應唯一一組五層結果，不存在一對多或多對多的情況。依正規化理論，拆分一對一關係不會消除資料重複或更新異常，僅會增加查詢時的 JOIN 成本，故本設計不將五層結果拆分為獨立資料表，而是以平面化欄位方式存於 `verification_records` 單表中。

若未來需求變更（例如同一驗證紀錄需支援多版本模型結果併存），屆時五層結果將轉為一對多關係，才具備拆分為獨立資料表之正規化效益。

> **2026-08-29 補充**：Track 2（生理訊號／rPPG）已停用、不再參與風險
> 融合（詳見 SRS／SAD 對應章節），但 `rppg_*` 欄位本身未從資料表移除
> ——`disabled_result()` 仍會回傳固定形狀的空結果寫入資料庫（`detected`
> 恆為 false、波形／頻譜陣列恆為空、`confidenceScore` 為 0），維持欄位
> 相容性，避免既有查詢與前端顯示邏輯需要跟著大改。因此上述「五層」
> 之表格結構描述仍屬實際現況，僅其中 Track 2 那組欄位不再有實質內容。

### 個資保護設計

`applicants.id_number_masked` 欄位僅儲存遮蔽後格式（如 `A12****789`），資料庫自始不存放完整身分證字號，呼應 SRS NFR-14。

### 完整 ER 圖

```
┌─────────────────────────┐
│      applicants           │
├─────────────────────────┤
│ PK  id                    │
│     name                  │
│     id_number_masked      │
│     phone                 │
│     email                 │
│     address                │
│     birth_date             │
│     created_at             │
└───────────┬───────────────┘
            │ 1
            │
            │ N
┌───────────┴───────────────┐
│  verification_records      │
├───────────────────────────┤
│ PK  id                     │
│ FK  applicant_id           │
│     timestamp               │
│     source_type             │
│     （錄影／品質／五層／決策／VLM 相關欄位，│
│       詳見第二節逐表定義）    │
└───────────────────────────┘

┌─────────────────────────┐
│   admin_credentials        │
├─────────────────────────┤
│ PK  id                    │
│     username                │
│     password_hash           │
│     created_at              │
└─────────────────────────┘
```

---

## 二、`verification_records` 逐欄定義

### 區塊一：基本資訊與錄影資料

| 欄位 | 型別 | 可為空 | 說明 |
|---|---|---|---|
| `id` | `SERIAL` (PK) | 否 | 自動遞增主鍵 |
| `applicant_id` | `INTEGER` (FK) | 否 | 關聯 `applicants.id` |
| `timestamp` | `TIMESTAMP` | 否 | 驗證發生時間 |
| `source_type` | `VARCHAR(20)` | 否 | 實體相機／虛擬攝影機／實體相機（翻拍） |
| `duration_sec` | `NUMERIC(5,2)` | 否 | 實際錄影長度 |
| `fps` | `NUMERIC(5,2)` | 否 | 影格率 |
| `total_frames` | `INTEGER` | 否 | 總影格數 |
| `phases` | `JSONB` | 否 | 各階段影格區間（action/lighting/occlusion） |

### 區塊二：影像品質檢查

| 欄位 | 型別 | 可為空 | 說明 |
|---|---|---|---|
| `quality_passed` | `BOOLEAN` | 否 | 是否通過品質檢查 |
| `blur_score` | `NUMERIC(8,2)` | 是 | Laplacian 變異數 |
| `brightness` | `NUMERIC(5,2)` | 是 | 灰階平均值 |
| `contrast` | `NUMERIC(5,2)` | 是 | 灰階標準差 |
| `overexposed_ratio` | `NUMERIC(4,3)` | 是 | 過曝比例 0-1 |
| `face_ratio` | `NUMERIC(4,3)` | 是 | 臉部佔畫面比例 |
| `quality_message` | `TEXT` | 是 | 不合格原因說明 |

### 區塊三：對照組（動作挑戰）

| 欄位 | 型別 | 可為空 | 說明 |
|---|---|---|---|
| `baseline_challenges` | `JSONB` | 否 | 四個動作的順序與各自通過狀態 |
| `baseline_verdict` | `VARCHAR(10)` | 否 | pass / reject |

### 區塊四：Track 1（合成偵測）

| 欄位 | 型別 | 可為空 | 說明 |
|---|---|---|---|
| `synthetic_fake_probability` | `NUMERIC(5,4)` | 否 | 0.0000-1.0000，連續分數，數值越高越可疑 |
| `synthetic_threshold` | `NUMERIC(5,4)` | 否 | 判定閾值 |
| `synthetic_verdict` | `VARCHAR(10)` | 否 | pass / reject |
| `synthetic_top_signals` | `JSONB` | 否 | 三項判斷依據 |
| `synthetic_model_id` | `VARCHAR(32)` | 是 | 產生本筆分數的模型識別（siglip2 / dinov2 / resnet18），供事後追溯與版本比對 |
| `synthetic_class_scores` | `JSONB` | 是 | 三分類架構時的各類機率（real / manipulated_real / fully_ai_generated）；二分類架構時為 NULL |

**`synthetic_fake_probability` 儲存的是未經二值化的原始連續分數**。`synthetic_verdict` 為依 `synthetic_threshold` 產生的解讀結果，兩者並存，不可僅存後者——融合層（`common/fusion.py`）取用的是連續分數，且金融稽核要求保留完整判斷依據而非僅存結論。

**`synthetic_model_id` 與 `synthetic_class_scores` 為新增欄位**，對應 Track 1 多模型比較與三類標籤體系；兩者皆可為空，既有資料不需回填，符合「欄位只能新增不能修改」的原則。

### 區塊五：Track 2（生理訊號）**【已停用，欄位保留但恆為空值／預設值，見上方補充說明】**

| 欄位 | 型別 | 可為空 | 說明 |
|---|---|---|---|
| `rppg_detected` | `BOOLEAN` | 否 | 是否偵測到有效訊號 |
| `rppg_heart_rate` | `NUMERIC(5,2)` | 是 | bpm，未偵測到為 NULL |
| `rppg_snr` | `NUMERIC(5,2)` | 否 | 訊噪比 |
| `rppg_roi_consistency` | `NUMERIC(4,3)` | 否 | 三區域一致性 |
| `rppg_checks` | `JSONB` | 否 | 三項判定明細 |
| `rppg_waveform` | `JSONB` | 否 | 濾波後訊號陣列 |
| `rppg_spectrum` | `JSONB` | 否 | 功率頻譜陣列 |

### 區塊六：Track 3（照明響應）

| 欄位 | 型別 | 可為空 | 說明 |
|---|---|---|---|
| `photo_detected` | `BOOLEAN` | 否 | |
| `photo_correlation` | `NUMERIC(4,3)` | 否 | |
| `photo_latency_ms` | `NUMERIC(6,2)` | 是 | 未偵測到為 NULL |
| `photo_geometry_score` | `NUMERIC(4,3)` | 否 | |
| `photo_sequence` | `JSONB` | 否 | 5 段顏色序列 |
| `photo_checks` | `JSONB` | 否 | |
| `photo_light_curve` | `JSONB` | 否 | |
| `photo_reflect_curve` | `JSONB` | 否 | |

### 區塊七：Track 4（遮擋一致性，核心防禦層）

| 欄位 | 型別 | 可為空 | 說明 |
|---|---|---|---|
| `occ_detected` | `BOOLEAN` | 否 | |
| `occ_wave_cycles` | `INTEGER` | 否 | 揮手循環次數 |
| `occ_identity_stability` | `NUMERIC(4,3)` | 否 | |
| `occ_max_identity_drop` | `NUMERIC(4,3)` | 否 | |
| `occ_segments` | `JSONB` | 否 | 每次循環起訖影格 |
| `occ_layer_score` | `NUMERIC(4,3)` | 否 | |
| `occ_anomaly_frames` | `JSONB` | 否 | 異常影格索引陣列 |
| `occ_checks` | `JSONB` | 否 | |
| `occ_stability_curve` | `JSONB` | 否 | |

### 區塊八：決策融合

| 欄位 | 型別 | 可為空 | 說明 |
|---|---|---|---|
| `risk_score` | `INTEGER` | 否 | 0-100 |
| `verdict` | `VARCHAR(10)` | 否 | pass / review / reject |
| `verdict_label` | `VARCHAR(20)` | 否 | 中文顯示標籤 |
| `reasons` | `JSONB` | 否 | 判定理由陣列 |
| `account_result` | `VARCHAR(14)` | 否 | pending_setup / opened / pending / rejected |

### 區塊九：VLM 輔助審核

| 欄位 | 型別 | 可為空 | 說明 |
|---|---|---|---|
| `vlm_available` | `BOOLEAN` | 是 | 三態設計：NULL＝未觸發（非 review 案件）／FALSE＝觸發但失敗／TRUE＝觸發且成功 |
| `vlm_frame_observations` | `JSONB` | 是 | 逐格觀察 |
| `vlm_summary` | `TEXT` | 是 | 綜合說明 |
| `vlm_model` | `VARCHAR(50)` | 是 | 模型名稱版本 |
| `vlm_latency_ms` | `NUMERIC(8,2)` | 是 | |

---

## 三、`applicants` 與 `admin_credentials`

### `applicants`

| 欄位 | 型別 | 可為空 | 說明 |
|---|---|---|---|
| `id` | `SERIAL` (PK) | 否 | |
| `name` | `VARCHAR(50)` | 否 | |
| `id_number_masked` | `VARCHAR(15)` | 否 | 遮蔽格式，如 A12****789 |
| `phone` | `VARCHAR(20)` | 否 | |
| `email` | `VARCHAR(100)` | 否 | |
| `address` | `VARCHAR(200)` | 否 | |
| `birth_date` | `DATE` | 否 | |
| `created_at` | `TIMESTAMP` | 否 | 預設為建立當下時間 |

### `admin_credentials`

| 欄位 | 型別 | 可為空 | 說明 |
|---|---|---|---|
| `id` | `SERIAL` (PK) | 否 | |
| `username` | `VARCHAR(50)` | 否 | 需唯一 |
| `password_hash` | `VARCHAR(60)` | 否 | bcrypt 雜湊輸出固定長度 60 字元 |
| `created_at` | `TIMESTAMP` | 否 | |

密碼由後端初始化腳本以 bcrypt 產生雜湊值寫入，明文密碼不出現於任何程式碼、文件或版本控制紀錄中。展示當天由操作者憑記憶輸入，畫面不顯示任何密碼提示。

---

## 四、未來擴充建議

以下項目為本專題開發過程中識別、但基於四週期程與展示規模刻意排除於本輪實作範圍的擴充方向，供簡報「未來展望」與後續產品化規劃參考。

### 資料儲存

| 項目 | 現況 | 未來擴充方向 |
|---|---|---|
| 大型陣列儲存 | `rppg_waveform`、`rppg_spectrum`、`photo_light_curve`、`occ_stability_curve` 等時序陣列直接存於 `JSONB` 欄位 | 資料量成長至百萬筆等級時，改將大型陣列存為物件儲存（如 S3／MinIO），資料庫僅存取路徑，避免單表過度膨脹 |
| 五層結果正規化 | 五層防禦結果以平面化欄位存於 `verification_records` 單表 | 若未來支援同一驗證紀錄併存多版本模型結果，五層結果轉為一對多關係，屆時具備拆分為獨立資料表之正規化效益 |

### 身分與權限

| 項目 | 現況 | 未來擴充方向 |
|---|---|---|
| 後台帳號 | 單一組帳密，不分權限層級 | 擴充為多帳號系統，區分一般風控人員／法遵稽核人員等不同權限層級與資料存取範圍 |
| 密碼原則 | bcrypt 雜湊儲存，展示用密碼由開發者自行設定 | 正式產品化須加入密碼複雜度原則、定期更換機制、多因子驗證 |

### 系統邊界

| 項目 | 現況 | 未來擴充方向 |
|---|---|---|
| 裝置層驗證 | 未實作 capture-source 驗證 | 補上虛擬攝影機偵測、SDK hook 防禦等裝置層機制，與現有影像內容層防禦互補 |
| 證件真偽 | 僅實作四角矯正，不含真偽辨識 | 擴充證件 OCR 欄位抽取、防偽紋理辨識、與政府資料庫比對 |
| 持續監控 | 僅涵蓋開戶當下單次驗證 | 依金管會作業範本第八條，擴充帳戶開通後之定期身分核對、異常交易監控機制 |
| 外部資料介接 | 未串接金融聯徵中心等外部查詢 | 依作業範本第三條，串接 Z21／Z22 等外部驗證資料源 |

### 部署與維運

| 項目 | 現況 | 未來擴充方向 |
|---|---|---|
| 部署架構 | 單機 Docker Compose，展示用途 | 正式產品化改為多節點分散式部署，模型推論服務與應用服務分離，具備高可用性與水平擴展能力 |
| 語意流模組 | VLM 輔助審核為原型階段實作，排程於開發後期 | 正式產品化後擴大 VLM 涵蓋範圍、優化提問策略、建立輸出品質監控機制 |
