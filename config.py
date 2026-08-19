"""GuardFrame 全域設定。

所有路徑與參數集中在此，程式任何地方都不得寫死數值。
上半部（到「§8 以外新增」為止）逐字照 CONVENTIONS.md §8，不要改動。
"""

from pathlib import Path

BASE_DIR = Path(__file__).parent

# 路徑
DATA_DIR = BASE_DIR / "data"
RAW_DIR = DATA_DIR / "raw"
PROCESSED_DIR = DATA_DIR / "processed"
RECORDINGS_DIR = DATA_DIR / "recordings"
# 2026-08-19：/verify 象徵性保存驗證影片用（見 PHASE1_NOTES §八），
# 跟上面 RECORDINGS_DIR（B 自己收集的自測/開發用影片）分開，避免混在
# 一起搞不清楚哪些是測試素材、哪些是「系統實際留存的驗證證據」。
# 屬於 data/ 底下，已經整個被 .gitignore 排除。
VERIFICATION_VIDEO_DIR = DATA_DIR / "verification_videos"
WEIGHTS_PATH = BASE_DIR / "track1_synthetic" / "weights" / "classifier.pth"
MODELS_DIR = BASE_DIR / "models"  # 第三方模型檔，不進 git

# 影像處理
FACE_SIZE = 224
FRAME_COUNT = 10  # Track 1 使用的臉部圖片數
TARGET_FPS = 30
VIDEO_SECONDS_MIN = 15  # 低於此 rPPG 頻譜解析度不足
VIDEO_SECONDS_MAX = 45  # 避免檔案過大與使用者疲乏

# 品質檢查
QUALITY_BLUR_MIN = 100.0
QUALITY_BRIGHTNESS_MIN = 60
QUALITY_BRIGHTNESS_MAX = 200
QUALITY_FACE_RATIO_MIN = 0.10

# Track 1
SYNTHETIC_THRESHOLD = 0.50

# Track 2
RPPG_BAND_LOW = 0.7  # Hz，約 42 bpm
RPPG_BAND_HIGH = 4.0  # Hz，約 240 bpm
RPPG_SNR_MIN = 3.0  # dB
RPPG_ROI_CONSISTENCY_MIN = 0.75

# Track 3
PHOTO_CORRELATION_MIN = 0.60
PHOTO_LATENCY_MAX_MS = 80
PHOTO_GEOMETRY_MIN = 0.50
PHOTO_SEGMENT_COUNT = 5
PHOTO_SEGMENT_MIN_MS = 400
PHOTO_SEGMENT_MAX_MS = 600

# Track 4
OCC_IDENTITY_STABILITY_MIN = 0.90
OCC_MAX_DROP_THRESHOLD = 0.20
OCC_LAYER_SCORE_MIN = 0.50

# 五層權重（Track 4 為核心防禦層，權重最高；實測後於階段4依 ROC 校準微調）
WEIGHT_BASELINE = 0.10
WEIGHT_SYNTHETIC = 0.20
WEIGHT_RPPG = 0.15
WEIGHT_PHOTOMETRIC = 0.20
WEIGHT_OCCLUSION = 0.35

# 決策區間
RISK_PASS_MAX = 30
RISK_REVIEW_MAX = 60

# 密碼雜湊（NFR-15）
BCRYPT_ROUNDS = 12


# ==========================================================================
# §8 以外新增（B 新增，尚未同步給 A）
#
# 以下常數 CONVENTIONS.md §8 沒有列出，但實作 §4.4 與 §4.7 時必須用到。
# 全部是「§8 已有規則的延伸」，沒有推翻任何既有數值。
# 對進度時要跟 A 講一聲，確認後再補進 CONVENTIONS.md §8。
# ==========================================================================

# Track 2｜ROI 一致度
# roiConsistency = max(0, 1 - 最大兩兩心率差 / RPPG_ROI_BPM_TOLERANCE)
# 容忍度設 20 bpm 是為了讓「差 5 bpm」剛好對應 0.75，
# 與 RPPG_ROI_CONSISTENCY_MIN 接上，兩套說法變成同一條線。
RPPG_ROI_BPM_TOLERANCE = 20.0

# Track 2｜輸出長度
# §4.4 規定 spectrum 固定 64 點對應 0-4 Hz；waveform 長度未規定，
# 固定成 300 點以免整支影片（540-900 格）撐大單筆 record。
RPPG_SPECTRUM_POINTS = 64
RPPG_SPECTRUM_MAX_HZ = 4.0
RPPG_WAVEFORM_POINTS = 300

# Track 2｜信心分數的 sigmoid 平滑寬度
# 用於 common.risk.threshold_risk()，把 SNR/roiConsistency 的判定從
# 二值化改成連續信心分數。SNR 寬度抓 1.5 dB，依據 PHASE1_NOTES §5.4
# 記錄的真人/攻擊分離度（1.6-2 dB）取中間值，這個是少數有真實資料
# 依據的 scale；roiConsistency 寬度 0.15 沒有實測依據，是合理猜測，
# 兩者都待更多真實樣本後重新檢視。
RPPG_SNR_RISK_SCALE = 1.5
RPPG_CONSISTENCY_RISK_SCALE = 0.15

# Track 2｜SNR 訊號帶半寬（Hz）
# 算 SNR 時把「主峰 ±此值」與「二次諧波 ±此值」視為訊號，帶內其餘視為雜訊。
# 心跳波形不是純正弦，二次諧波帶有真實的生理能量，要算進訊號側。
RPPG_SNR_HARMONIC_WIDTH = 0.1

# MediaPipe Face Landmarker 模型檔
# MediaPipe 1.0.0 移除了舊的 mp.solutions API，改用 Tasks API，
# 而 Tasks API 必須自備 .task 模型檔（官方不會自動下載）。
MEDIAPIPE_FACE_MODEL = MODELS_DIR / "face_landmarker.task"
MEDIAPIPE_FACE_MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/face_landmarker/"
    "face_landmarker/float16/1/face_landmarker.task"
)
MEDIAPIPE_MIN_DETECTION_CONFIDENCE = 0.5
MEDIAPIPE_MIN_PRESENCE_CONFIDENCE = 0.5
MEDIAPIPE_MIN_TRACKING_CONFIDENCE = 0.5

# MediaPipe Hand Landmarker 模型檔（Track 4 專用，同一套 Tasks API 機制）
MEDIAPIPE_HAND_MODEL = MODELS_DIR / "hand_landmarker.task"
MEDIAPIPE_HAND_MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/"
    "hand_landmarker/float16/1/hand_landmarker.task"
)
MEDIAPIPE_HAND_MIN_DETECTION_CONFIDENCE = 0.5
MEDIAPIPE_HAND_MIN_PRESENCE_CONFIDENCE = 0.5
MEDIAPIPE_HAND_MIN_TRACKING_CONFIDENCE = 0.5

# Track 2｜訊號處理參數
RPPG_FILTER_ORDER = 3  # Butterworth 階數，PLAN 階段 1 用的就是 3
RPPG_MIN_FACE_RATIO = 0.5  # 偵測到臉的影格需佔多少比例，低於此 detected=False
RPPG_MIN_FRAMES = 64  # 少於此格數無法做出可信的頻譜

# 品質檢查｜§8 只給了模糊、亮度、臉部佔比的門檻，
# 但 §4.7 的回傳值還有對比度與過曝比例，補上對應門檻。
QUALITY_CONTRAST_MIN = 20.0  # 灰階標準差，過低代表畫面死白或死黑
QUALITY_OVEREXPOSED_MAX = 0.15  # 過曝像素比例上限
QUALITY_OVEREXPOSED_LEVEL = 250  # 灰階值 >= 此值視為過曝

# 證件矯正｜Canny + 透視變換參數
# 數值沿用 PLAN.md 階段1 範例（縮小到 800px 加速處理、Canny 50/150、
# 取前 5 大輪廓），矯正後輸出尺寸 856x540 對應 §4.7 規定的 ISO/IEC 7810
# ID-1 卡片比例。
ID_CARD_RESIZE_WIDTH = 800
ID_CARD_CANNY_LOW = 50
ID_CARD_CANNY_HIGH = 150
ID_CARD_BLUR_KERNEL = (5, 5)
ID_CARD_CONTOUR_TOP_N = 5
ID_CARD_APPROX_EPSILON_RATIO = 0.02
ID_CARD_OUTPUT_WIDTH = 856
ID_CARD_OUTPUT_HEIGHT = 540
ID_CARD_ASPECT_RATIO = ID_CARD_OUTPUT_WIDTH / ID_CARD_OUTPUT_HEIGHT  # ≈ 1.585

# 對照組｜眨眼 EAR 閾值
# 標準 6 點 EAR 公式（Soukupová & Čech）的文獻常見值：睜眼約 0.25-0.35，
# 閉眼約 0.10-0.15，0.21 是常見的中間門檻。尚未用真實眨眼影片驗證過，
# 待階段2校準。
BASELINE_EAR_THRESHOLD = 0.21

# 對照組｜左右轉頭的不對稱比例門檻
# 這裡沒有用 PLAN.md 建議的「頭部變換矩陣 yaw 角」，改用鼻尖到左右臉頰
# 邊緣的距離不對稱比例——理由見 baseline_challenge/analyzer.py 頂部說明。
# 這是自創的量化方式，沒有文獻參考值。
# 2026-08-18 用真實自錄影片驗證過方向（見 _YAW_SIGN 的說明）：轉頭時
# 量到的比例幅度約 ±0.8，遠超過這裡的 0.15 門檻，數量級沒問題；
# 0.15 這個確切數字本身還是猜的，尚未用邊界案例（例如轉頭幅度很小）
# 校準過，可能偏鬆或偏緊，待更多真實樣本後調整。
BASELINE_YAW_RATIO_MIN = 0.15

# Track 4｜信心分數的 sigmoid 平滑寬度
# 全部沒有真實資料依據，是合理猜測，待真實樣本後重新檢視——這一層
# 尤其該優先處理，因為 PHASE1_NOTES §2.6 已經記錄過一個真實案例
# （手部部分遮擋造成 maxIdentityDrop 誤判），連帶影響這裡的 scale
# 選得合不合理。
OCC_CYCLES_RISK_SCALE = 1.0  # 次數
OCC_STABILITY_RISK_SCALE = 0.05
OCC_DROP_RISK_SCALE = 0.10
OCC_LAYER_RISK_SCALE = 0.15

# Track 4｜臉部參考框擴張比例
# 手部中心座標要落在「擴張過的臉部框」內才算遮擋中，不是原始 bbox——
# 揮手經過臉頰外緣、下巴附近也算數，原始 InsightFace bbox 通常只框到
# 五官核心區域，太緊會漏掉合理的遮擋。
OCC_FACE_REGION_MARGIN = 0.35

# Track 4｜遮擋層級顏色距離參考值
# layer_consistency_score() 算出的顏色歐氏距離除以這個值、夾在 0-1，
# 映射成 layerScore。目前是未經真實資料驗證的初始猜測（沿用 Track 2/3
# 同樣的教訓：算法與門檻必須配套用真實資料驗證，不能只憑經驗寫死）——
# 待錄到真人與即時換臉遮擋樣本後才能校準。
OCC_LAYER_COLOR_REFERENCE = 40.0

# Track 4｜InsightFace 偵測參數
# ctx_id=-1 強制用 CPU（B 沒有 GPU，見 CONVENTIONS §3）。
# det_size 沿用 PLAN.md 階段1 範例的 640x640，正確性優先，效能優化留待
# PHASE1_NOTES §七 提到的「隔格抽樣」階段再做，不在這裡先猜著調。
INSIGHTFACE_CTX_ID = -1
INSIGHTFACE_DET_SIZE = (640, 640)

# Track 3｜信心分數的 sigmoid 平滑寬度
# 三個都沒有真實資料依據，是合理猜測，待真實樣本後重新檢視。
PHOTO_CORRELATION_RISK_SCALE = 0.15
PHOTO_LATENCY_RISK_SCALE = 30.0  # 毫秒
PHOTO_GEOMETRY_RISK_SCALE = 0.15

# Track 3｜臉部偵測率門檻
# 跟 RPPG_MIN_FACE_RATIO 同樣的道理：偵測到臉的影格佔比太低，
# 補值會蓋過真訊號，算出來的相關係數不可信。
PHOTO_MIN_FACE_RATIO = 0.5

# Track 3｜互相關搜尋延遲範圍（毫秒）
# 遠大於 PHOTO_LATENCY_MAX_MS 的 80ms，這樣即使真實延遲超標，
# 也還是能被搜尋到、正確報告出來，而不是被搜尋窗排除在外。
PHOTO_LATENCY_SEARCH_MS = 500.0

# Track 3｜lightCurve／reflectCurve 輸出點數（§4.5 規定固定 100）
PHOTO_CURVE_POINTS = 100

# Track 3｜立體幾何一致性
# 三個檢查區域（額頭、鼻樑、雙頰）對照明變化的反應幅度，各區反應幅度的
# 變異係數（CV）除以這個參考值、夾在 0-1 之間，映射成 geometryScore。
# 目前是未經真實資料驗證的初始猜測（沿用 Track 2 SNR 門檻的教訓：算法與
# 門檻必須配套用真實資料驗證，見 PHASE1_NOTES §6.2）——待錄到真人與
# 列印照片翻拍樣本後，比照 PHASE1_NOTES §5.4 的方法重新校準，不能直接信。
PHOTO_GEOMETRY_CV_REFERENCE = 0.3

# VIDEO_SECONDS_MIN/MAX（上方 §8 區塊）語意更新：
# 新版設計錄影總長已固定約 23 秒（動作 20 秒＋照明 3 秒，CONVENTIONS §5.3），
# 不再是使用者依速度完成、長度可變的舊流程，因此不再需要動態上下限判斷。
# 這兩個常數保留給 API 層日後做上傳影片的合理性檢查（例如擋掉被截斷、
# 竄改或明顯不合規格的檔案），不是給前端動態配速用。數值本身仍照 §8，未更動。

# --------------------------------------------------------------------------
# §4.8 簡訊驗證與全域倒數 Session（2026-08-19 補上實作，§8 未列出這幾個數值）
# session_id 是 sms/verify 成功後產生的不透明 token，之後 /verify、
# /account-setup、/reset 都要求呼叫端在 X-Session-Id header 帶上同一個值，
# 用來證明「這個請求真的是剛剛完成簡訊驗證的那個人送出的」，不是有人
# 猜到 applicantId 就能亂設。deadline 只約束 /verify（§5.6 流程圖：倒數
# 只涵蓋③④兩步驟），/account-setup 不檢查是否逾時。
# --------------------------------------------------------------------------
SESSION_DEADLINE_MINUTES = 15  # §4.8：簡訊驗證通過後啟動 15 分鐘全域倒數
SESSION_TOKEN_BYTES = 32  # secrets.token_urlsafe(32) 產生的隨機 token 長度

# Demo 模式固定驗證碼（§5.5 明文規定：sms/send 不接真的簡訊服務）
SMS_DEMO_CODE = "123456"
SMS_MAX_ATTEMPTS = 3  # §5.5：連續錯誤 3 次需重新發送

# --------------------------------------------------------------------------
# §4.9 後台認證（2026-08-19 補上實作，§8 沒列出 token 有效期這個數值，
# 只規定要設定「建議值」，見 §4.9 實作要點）
# --------------------------------------------------------------------------
ADMIN_TOKEN_HOURS = 8  # 一個工作班次的長度，過期需重新登入，沒有文獻依據
