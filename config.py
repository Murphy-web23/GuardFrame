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
