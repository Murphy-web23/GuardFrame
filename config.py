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
# 2026-08-25：桌面版真人測試回報「清晰度 90.6（需 100）、亮度 52.3
# （需 60）」被擋下來——兩個數值都只差門檻一點點，筆電內建鏡頭跟一般
# 室內光線本來就達不到原本這兩個從沒被真實資料驗證過的門檻（100／60
# 是任意選的整數，不是量測出來的基準）。放寬到還能擋住真的模糊/過暗
# 畫面、但不會卡住正常筆電鏡頭+室內光線的水準。
# 2026-08-27：!!! 暫時性 !!! 70 這個門檻經資料驗證分離度其實很乾淨
# （真人 20 筆最低 92.32，OBS 假影片 4 筆最高 81.64，中間有空隙，見
# 對話紀錄分析），是有效的防線，不建議永久調整。這裡暫時放寬純粹是
# 為了讓 OBS 注入的假影片能穿過畫質關卡、測試後面 Track2-4 的表現，
# 測完這輪一定要改回 70.0。
# 2026-08-28：從 1.0 收回到 50——1.0 等同完全關掉這道檢查，50 同樣還是
# 能讓 OBS 假影片（最高 81.64）通過以便繼續測試 Track2-4，但至少不是
# 形同虛設的數字。仍是暫時值，驗證告一段落後請改回 70.0。
QUALITY_BLUR_MIN = 50
QUALITY_BRIGHTNESS_MIN = 45
QUALITY_BRIGHTNESS_MAX = 200
QUALITY_FACE_RATIO_MIN = 0.10

# Track 1
SYNTHETIC_THRESHOLD = 0.50

# Track 2
RPPG_BAND_LOW = 0.7  # Hz，約 42 bpm
RPPG_BAND_HIGH = 4.0  # Hz，約 240 bpm
# 2026-08-23：累積到這裡已經有 7 筆真人樣本的 SNR（-4.49 ~ -0.17dB，
# 修完 10.11 的諧波誤判後多筆集中在 -0.2 ~ -0.4dB），從沒到過原本的
# 3.0dB，落差是系統性的，不是單一樣本的偶然。試過把門檻壓到 -4.0dB
# 跟 0.0dB，兩個都會讓測試案例裡「訊號良好」（6dB）跟「訊號普通」
# （3dB）的風險分數變成完全相同——算過數學才發現原因：這個測試情境
# 裡，roiConsistency 那個子項目的固定風險值剛好蓋過 SNR 本身在低門檻
# 時的差異（combine_risks 取最大值，SNR 風險只要低於那個固定值就會
# 被蓋掉不會顯現），不管 SNR 門檻怎麼調，沒辦法同時「讓真人受益」又
# 「保留測試分辨力」，中間沒有安全區間。改回原始值，這個問題不是
# 換數字能解決的，需要更根本的調查（例如 roiConsistency 那個子項目
# 本身的 scale 是不是也一起設計得太粗），見 PHASE1_NOTES.md。
RPPG_SNR_MIN = 3.0  # dB
RPPG_ROI_CONSISTENCY_MIN = 0.75

# Track 3
# 2026-08-23：累積到這裡已經有 5 筆真人樣本的 correlation（0.114 ~
# 0.523），從沒到過原本的 0.60，但都在 0.35 以上的範圍有一半以上
# 樣本。08-21 量過「完全跟燈光無關的純雜訊」correlation 是 0.189，
# 這裡改到 0.35——比雜訊的 0.189 高出足夠的安全邊際（correlation_ok
# 這個布林判定的門檻，雜訊 0.189 < 0.35 一樣會被擋下來，見
# track3_photometric/analyzer.py:219），同時真人最好的樣本（0.523）
# 已經能明顯降低風險分數。樣本數還是有限，之後有更多真人資料應該
# 再檢視。
PHOTO_CORRELATION_MIN = 0.35
# 2026-08-25：修正 phases.lighting 切片的時間基準誤差（見
# api/routes.py verify() 與 frontend FaceVerificationEngine.tsx 的
# 說明）後，真人測試 correlation 從 0.069 大幅提升到 0.581（遠超
# PHOTO_CORRELATION_MIN），證實那個修法有效；但同一筆測試量到的
# latencyMs 是 -468.6ms，遠超原本這裡的 80ms——80ms 這個數字從來
# 沒有用真實資料驗證過，對「螢幕顯示變色→攝影機真的拍到反光」這整條
# 瀏覽器管線（畫面渲染、攝影機曝光、MediaRecorder 編碼緩衝）而言太
# 嚴苛，不是真人也能常態達到的反應速度。放寬到還能抓出「完全沒對上」
# 的假訊號、但不會誤殺真人測試量到的正常管線延遲。
PHOTO_LATENCY_MAX_MS = 500
# 2026-08-25：跟前端 FaceVerificationEngine.tsx 的 LIGHTING_BUFFER_MS
# 是同一個數字，兩邊要一致——前端切 phases.lighting 時頭尾各多送
# 這麼多毫秒的緩衝影格，後端這裡用同一個值把 t=0 的偏移量扣回來，見
# track3_photometric/analyzer.py analyze_photometric() 的說明。
PHOTO_LIGHTING_BUFFER_MS = 400.0
# 2026-08-29：原本 0.50，用真人測試累積到的 30 筆有效樣本（含
# correlation>0.1 的所有紀錄）實測分佈：27/30 直接頂到滿分 1.000
# （PHOTO_GEOMETRY_CV_REFERENCE=0.3 這個參考值本身偏低，見那個常數
# 的說明），剩下 3 筆裡有 2 筆（申請人1038 correlation=0.708、966
# correlation=0.629，訊號品質都不差）卡在 0.50 門檻之下，跟最低分那
# 筆（1035=0.107，唯一數值異常低的樣本）之間有個乾淨的空隙（0.107~
# 0.321 之間完全沒有樣本）。改到 0.20，卡在這個空隙裡：讓 1038、966
# 通過，同時 1035 還是會被擋下。
PHOTO_GEOMETRY_MIN = 0.20
PHOTO_SEGMENT_COUNT = 5
PHOTO_SEGMENT_MIN_MS = 400
PHOTO_SEGMENT_MAX_MS = 600

# Track 4
OCC_IDENTITY_STABILITY_MIN = 0.90
# 2026-08-21：原本 0.20，真人測試（真的揮手遮擋）實測 maxIdentityDrop
# 高達 0.904，跟 README 記錄過的「對手部部分遮擋過度敏感」問題吻合。
# 這裡刻意只調到 0.95、不是更寬鬆的 1.0——Track 4 是五層裡權重最高
# （0.35）、專案定位的核心防禦層，調太鬆等於讓這個核心機制形同虛設。
# 只有一筆真實資料，這個調整比其他兩個保守，之後有更多樣本（尤其是
# 真的身分置換攻擊的樣本）應該優先重新檢視這個門檻。
OCC_MAX_DROP_THRESHOLD = 0.95
OCC_LAYER_SCORE_MIN = 0.50

# 四層權重（原五層，2026-08-29 起 Track2 rPPG 停用，見
# track2_rppg/analyzer.py::disabled_result() 的說明）。
# 釋出的 0.15 全部給 Track4——它本來就是設計上的核心防禦層，且是四層
# 裡唯一在真人測試中有清楚分離度的（真人身分穩定度 vs 攻擊樣本落差
# 明顯，見 OCC_IDENTITY_STABILITY_MIN 的說明）；沒有平均分給其餘三層，
# 是因為 Track1 模型還沒訓練完成、Track3 穩定度也還在處理中，兩者都
# 還沒有足夠證據支持該拿更高權重。
# Track 4 為核心防禦層，權重最高；實測後於階段4依 ROC 校準微調
WEIGHT_BASELINE = 0.10
WEIGHT_SYNTHETIC = 0.20
WEIGHT_PHOTOMETRIC = 0.20
WEIGHT_OCCLUSION = 0.50

# 決策區間
# 2026-08-21：原本 PASS_MAX=30、REVIEW_MAX=60，是 CONVENTIONS.md §8
# 訂的初始猜測值，本來就標記等真實資料 ROC 校準。試過把兩個門檻都
# 放寬 25%（PASS_MAX→38、REVIEW_MAX→75），發現兩個問題：(1)
# REVIEW_MAX 放到 75 會把 test_fusion.py 裡「即時換臉攻擊」情境測試
# （risk_score=69）從「拒絕」推進「人工複核」——這是驗證「只有
# Track 4 抓得到即時換臉」這個論點的關鍵測試，不能鬆動；(2) 真人測試
# （申請人 344）risk_score=52，原本 REVIEW_MAX=60 就已經落在
# review 區間，放寬 REVIEW_MAX 對這筆真實案例根本沒有幫助。所以
# REVIEW_MAX 改回原始值。PASS_MAX 放寬到 38 沒有破壞任何測試，先保留，
# 但對目前這筆真人案例（52 分）也沒有實際幫助——risk_score 51 分還是
# 落在人工複核區間，不是「調門檻」能解決的，根因還是在 Track 2/3
# 訊號品質，見上面對應章節。
# 2026-08-27：918（OBS 注入假影片）risk_score=36，用 38 這個門檻剛好
# 壓線 pass。查過現有 20 筆真人樣本＋920，最低分是 885（31）跟 920
# （29），兩筆都還在 32 以下——門檻降到 32 完全不影響任何真人樣本的
# 判定，卻能把 918 從 pass 推到 review，是乾淨、無副作用的調整。
RISK_PASS_MAX = 32  # 原本 38（更早是 30），見上方 918 案例分析
RISK_REVIEW_MAX = 60  # 原本 60，試過放寬到 75 但會弱化核心攻擊情境測試，改回原值

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

# 2026-08-22：真人測試發現，estimate_heart_rate() 原本單純取頻帶內功率
# 最大值當主頻，沒有排除「抓到二次諧波」的狀況——心跳波形不是純正弦
# （收縮期陡、舒張期緩），二次諧波本來就有真實能量，雜訊/動作干擾一多，
# 諧波那格功率有機會反超真正的基頻，估出來的心率剛好是真實值的兩倍。
# 真人樣本額頭/左臉頰估出 110+ bpm、右臉頰估出 55 bpm 就是這個模式。
# 這個比例是「半頻附近候選峰值功率 ÷ 目前選到的峰值功率」要達到多少，
# 才改採較低頻的那個當真正基頻——先用尚未經過大量真實資料調校的合理
# 猜測值，之後有更多真人樣本應該重新檢視。
RPPG_HARMONIC_DEMOTE_RATIO = 0.3

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
ID_CARD_CONTOUR_TOP_N = 10
# 2026-08-25：原本只試單一 epsilon（0.02），找不到剛好 4 個頂點就放棄。
# 真人測試追出真正的根因是 contourArea 對細線輪廓算出錯誤面積（見
# image_utils/id_card.py `_find_quad_contour` 的說明），改用凸包面積後
# 這裡也一併放寬：依序嘗試多個 epsilon，不同雜訊程度的畫面需要的簡化
# 程度不一樣，只用一個固定值太脆弱。
ID_CARD_APPROX_EPSILON_RATIOS = (0.02, 0.03, 0.04, 0.05, 0.06, 0.08)
ID_CARD_OUTPUT_WIDTH = 856
ID_CARD_OUTPUT_HEIGHT = 540
ID_CARD_ASPECT_RATIO = ID_CARD_OUTPUT_WIDTH / ID_CARD_OUTPUT_HEIGHT  # ≈ 1.585

# 2026-08-24：真人測試發現，_find_quad_contour() 原本只挑「面積最大的
# 四邊形」，沒有下限——如果背景剛好有其他小尺寸的規律紋理（磁磚、織物
# 花紋），在沒有真的證件邊界可偵測時，這種小碎形狀反而可能排進前
# ID_CARD_CONTOUR_TOP_N 名，被誤判成證件邊界，透視變換後放大成一片
# 模糊的特寫。加兩道下限：偵測到的四邊形面積至少要佔畫面的
# ID_CARD_MIN_AREA_RATIO，且 _compute_confidence()（長寬比比對）算出來
# 至少要達到 ID_CARD_MIN_CONFIDENCE，兩者都是未經大量真實資料校準的
# 合理猜測值，之後有更多真人測試樣本應該重新檢視。
# 2026-08-24：真人測試發現這兩個門檻太嚴，把真的有對準的證件也擋掉了
# ——根因主要是鏡頭解析度跟畫面容器比例對不起來（見 IdUploadScreen.tsx
# 的說明），已經修正解析度，這裡同時放寬當安全邊際，因為這兩個數值
# 從來沒有真實資料驗證過。
ID_CARD_MIN_AREA_RATIO = 0.05
ID_CARD_MIN_CONFIDENCE = 0.35

# 2026-08-27：找到四邊形只代表「有一個長寬比接近證件的矩形」，完全沒
# 檢查裡面的內容——隨便拍書本封面、桌墊、螢幕邊框，只要長寬比湊巧接近
# 1.585:1 就會被判定成功。加一道文字密度檢查：用 MSER 抓小尺寸、密集
# 排列的候選文字區域，真證件（或有文字欄位的示範證件）內部文字密度會
# 明顯高於隨便拍到的背景。用「文字候選區域數量」而非邊緣密度，因為
# 邊緣密度會被木紋桌面、磁磚這類雜亂紋理背景騙過（本模組另一處已經
# 踩過這個坑，見 _find_quad_contour 的說明），文字的統計特徵（小尺寸、
# 密集、規則間距）比較不會被一般紋理背景誤觸發。門檻尚未用大量真實
# 證件樣本校準，是合理猜測值。
ID_CARD_MIN_TEXT_REGIONS = 15

# 2026-08-27：真人測試發現，光線昏暗（灰階平均亮度 47~64）加上背景
# 有反光雜物（例如包裝塑膠的平行反光線條）時，膚色遮罩把手指蓋住的
# 卡片角切掉一塊後，卡片本身的候選輪廓信心不足被排除，演算法退而求
# 其次選中背景反光雜物形成的四邊形——湊巧長寬比也接近身分證規格，
# 被誤判成功，矯正出來的是背景不是證件。與其繼續在幾何判定上打補丁，
# 加一道最基本的亮度檢查，太暗直接擋掉要求重拍——這類昏暗環境下
# Canny 邊緣品質本來就差，幾何演算法在這種輸入上不可靠。門檻取在
# 已知失敗案例（47、64）之上、已知成功案例（71、73）之下，未經大量
# 真實資料驗證，是合理猜測值。
ID_CARD_MIN_BRIGHTNESS = 65.0

# 2026-08-28：YOLO-pose 角點偵測（見 id_card_detector/README.md、
# image_utils/id_card.py 的 _find_quad_ml() 說明）——用真人標註的 354
# 張照片訓練，測試起來對「手指蓋住卡片一角」這種情況明顯比古典 CV
# 方法準（能猜出被遮住的角落在哪，古典方法完全做不到這件事）。
#
# ID_CARD_USE_ML_DETECTOR 這個開關可以隨時關掉退回純古典方法——ML
# 路徑找不到權重檔／`ultralytics` 沒裝／信心不足，本來就會自動退回
# 古典流程（見 _get_id_card_pose_model()），這個開關是給「想整個跳過
# ML、直接用古典方法」的情境用的，例如懷疑是 ML 路徑造成的問題想
# 排除變因時。
#
# ID_CARD_ML_MIN_CONFIDENCE 門檻是拿 5 張真實測試照片實測校準的：
# 表現好的案例（手指蓋角、正常拿法）confidence 落在 0.8~0.94，表現
# 不穩的暗光案例只有 0.34，0.5 剛好落在中間，能把不穩的案例擋掉、
# 讓它退回古典方法（此時古典方法有 config.ID_CARD_MIN_BRIGHTNESS
# 這道亮度檢查頂著，暗光照片通常還沒走到這裡就已經被擋掉了）。
ID_CARD_USE_ML_DETECTOR = True
ID_CARD_ML_MIN_CONFIDENCE = 0.5
ID_CARD_ML_WEIGHTS_PATH = BASE_DIR / "id_card_detector" / "weights" / "best.pt"

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

# --------------------------------------------------------------------------
# §5.3 對照組動作挑戰：固定時長，只有出現順序隨機
# 2026-08-19 補上「誰來產生隨機順序」這塊實作前，這幾個時長只寫在
# CONVENTIONS.md 的文字說明跟各處測試 fixture 裡，沒有集中成常數。
# --------------------------------------------------------------------------
BASELINE_ACTION_DURATIONS = {
    "blink": 3,
    "turn_left": 5,
    "turn_right": 5,
    "wave_hand": 7,
}

# --------------------------------------------------------------------------
# 結果通知信（自動判定案件用，見 notifications.py）
# 改用 Resend 的 API 寄信，不用 SMTP——Gmail 應用程式密碼這條路在
# 2026-08-29 demo 前測試時發現該帳戶已被 Google 直接關閉這項設定
# （帳戶層級限制，不是操作問題），改走 API Key 的方式更穩定、不依賴
# Google 帳戶安全設定的變動。RESEND_API_KEY 吃環境變數，不寫死在
# 程式碼裡；沒設定時 notifications.py 會直接跳過寄信，不拋例外。
# --------------------------------------------------------------------------
import os

from dotenv import load_dotenv

# 讀 .env（已在 .gitignore 排除，金鑰不會進 git）。放在這裡而不是只靠
# api/database.py 的 load_dotenv() 呼叫，是因為不能保證 config.py 一定
# 在 database.py 之後被匯入——直接在這裡也呼叫一次，不管匯入順序為何，
# 這幾個環境變數都保證讀得到。load_dotenv() 預設不會覆蓋已存在的環境
# 變數，重複呼叫多次是安全的。
load_dotenv()

RESEND_API_KEY = os.getenv("RESEND_API_KEY")
# 沒有驗證過自己網域時，Resend 只允許用這個測試寄件人，收件人也只能是
# 你自己註冊帳號的信箱——demo 用途足夠，之後若要寄給任意信箱需要驗證
# 網域（見 https://resend.com/domains）。
RESEND_FROM_ADDRESS = os.getenv("RESEND_FROM_ADDRESS", "onboarding@resend.dev")
RESEND_FROM_NAME = "GuardFrame 開戶驗證"

# 通知信裡「回開戶頁面」連結用的網址。前端是純前端狀態機（沒有路由，
# 見 frontend/src/App.tsx），沒辦法產生指回使用者當下那一步的深連結，
# 這裡只能給網站首頁，信件文字也照實寫「請重新登入」而不是「點此繼續」。
# demo 用手機掃 QR code 連線時（見開發伺服器改監聽區網那次修改），
# 記得把這個改成當下那台電腦的區網 IP，不要用 localhost。
FRONTEND_BASE_URL = os.getenv("FRONTEND_BASE_URL", "http://localhost:3000")
