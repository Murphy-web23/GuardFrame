"""Track 2｜生理訊號（rPPG）對外入口。

契約見 CONVENTIONS.md §4.4。

原理：心臟每跳一次，微血管的血紅素含量就變一次，皮膚反射的綠光跟著變。
變化量不到 1%，肉眼與單格影像都看不出來，但在 20 秒的時序上做頻譜分析
就會冒出一個尖峰。合成的臉沒有真實的血流，做不出這個尖峰。

三個 ROI 分開算是這一層的核心。換臉常常只換臉部核心區域，
額頭是真人、臉頰是生成的話，兩邊心率會對不起來 ——
這比「有沒有心跳」更難偽造。
"""

import numpy as np

import config
from common.landmarks import ModelNotFoundError, extract_landmarks
from track2_rppg import signal_utils as su

# --------------------------------------------------------------------------
# ROI 關鍵點索引（MediaPipe Face Landmarker 478 點拓撲）
#
# 選點原則：要皮膚裸露、微血管豐富、不會被眼睛眉毛嘴巴的動作干擾。
# 眼睛與嘴唇周圍雖然血流豐富，但眨眼與說話造成的像素變化比心跳大兩個數量級，
# 一律避開。
#
# 下面三組索引都對照 MediaPipe 官方的 FaceLandmarksConnections 驗證過：
# 雙頰與 FACE_OVAL / 眼 / 眉 / 鼻 / 唇 五組官方區域完全不重疊，
# 左右頰互為鏡像（索引差 220-230，與官方眉毛、眼睛清單推導出的對稱偏移一致）。
# --------------------------------------------------------------------------

# 額頭：上界取髮際線輪廓（10、109、67 等在 FACE_OVAL 上），
# 下界取兩側眉毛頂端（105、107、66 屬 RIGHT_EYEBROW；334、336、296、293、300 屬 LEFT_EYEBROW），
# 中間補 108、151、337、9、69、104 幾個額頭中央點把區域填滿。
# 額頭是 rPPG 最常用的 ROI：面積大、平坦、沒有毛髮遮擋（瀏海除外）。
FOREHEAD_INDICES = [
    10, 108, 151, 337, 9, 336, 296, 334, 293, 300,
    67, 109, 69, 104, 105, 66, 107,
]

# 左頰（畫面左側，即受測者的右臉）：顴骨下方到鼻翼旁的一塊。
# 116、123 在顴骨外側，117、118 在眼下，111、137 靠耳前，
# 205、36 在鼻翼外側，50、101 是頰心。這塊皮膚厚度均勻、血流穩定。
LEFT_CHEEK_INDICES = [50, 101, 118, 117, 123, 116, 111, 137, 205, 36]

# 右頰：上面那組的鏡像點，一一對應。
RIGHT_CHEEK_INDICES = [280, 330, 347, 346, 352, 345, 340, 366, 425, 266]

ROI_DEFINITIONS = {
    "forehead": FOREHEAD_INDICES,
    "left_cheek": LEFT_CHEEK_INDICES,
    "right_cheek": RIGHT_CHEEK_INDICES,
}

# checks 的三個標籤，順序不可變（§4.4 規定固定 3 項）
CHECK_LABELS = (
    "主頻落在人類心率範圍",
    "頻譜峰值訊噪比達標",
    "額頭與雙頰心率一致",
)

def _empty_result(snr=0.0, roi_consistency=0.0):
    """偵測失敗時的回傳值。

    checks 仍維持 3 項且順序不變（§4.4 規定），全部 passed=False。
    waveform 與 spectrum 給空 list，與 §5.1 的範例一致。
    """
    return {
        "detected": False,
        "heartRate": None,
        "snr": float(snr),
        "roiConsistency": float(roi_consistency),
        "checks": [{"label": label, "passed": False} for label in CHECK_LABELS],
        "waveform": [],
        "spectrum": [],
    }


def _analyze_single_roi(roi_signal, fps):
    """對一個 ROI 跑完整訊號管線。

    參數:
        roi_signal: np.ndarray，shape (T, 3)，extract_roi_signal 的輸出
        fps: float
    回傳:
        dict 或 None（訊號不可用時）
    """
    # 只取綠通道。綠光被血紅素吸收最多，心跳訊號在三個通道裡最明顯；
    # 紅光穿透深、受深層組織干擾，藍光訊噪比差。
    green = roi_signal[:, 1]

    if np.isnan(green).all():
        return None

    green = su.interpolate_missing(green)

    try:
        filtered = su.bandpass_filter(su.detrend_signal(green), fps)
    except ValueError:
        return None

    heart_rate, psd, freqs, snr = su.estimate_heart_rate(filtered, fps)
    if heart_rate is None:
        return None

    return {
        "heart_rate": heart_rate,
        "snr": snr,
        "filtered": filtered,
        "psd": psd,
        "freqs": freqs,
    }


def _roi_consistency(heart_rates):
    """三個 ROI 的心率一致度，映射到 0.0-1.0。

    取「最大的兩兩差距」而不是標準差 —— 只要有一個 ROI 對不上就該扣分，
    這正是換臉會留下的破綻：只換了臉部核心區，額頭與臉頰的訊號就會分家。

    容忍度 20 bpm 的設計讓「差 5 bpm」剛好落在 0.75，
    與 config.RPPG_ROI_CONSISTENCY_MIN 接上。
    """
    if len(heart_rates) < 2:
        return 0.0

    max_diff = max(heart_rates) - min(heart_rates)
    return float(max(0.0, 1.0 - max_diff / config.RPPG_ROI_BPM_TOLERANCE))


def analyze_rppg(frames: list, fps: float) -> dict:
    """從影格序列提取心跳訊號。

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

    備註:
        執行階段的失敗一律回傳 detected=False 的完整結構，不拋例外 ——
        多數影格偵測不到臉、影片太短、單格 MediaPipe 出錯都算。

        唯一的例外是模型檔不存在時拋 ModelNotFoundError。那是環境沒裝好，
        不是影片的問題；靜默回傳 detected=False 只會讓人跑去 debug 演算法。
    """
    if not frames or fps <= 0:
        return _empty_result()

    if len(frames) < config.RPPG_MIN_FRAMES:
        return _empty_result()

    try:
        landmarks_list = extract_landmarks(frames, fps)
    except ModelNotFoundError:
        raise
    except Exception:
        return _empty_result()

    # 偵測率太低時訊號會被大量內插值填滿，算出來的頻譜不可信
    detected_ratio = sum(lm is not None for lm in landmarks_list) / len(frames)
    if detected_ratio < config.RPPG_MIN_FACE_RATIO:
        return _empty_result()

    roi_results = {}
    for name, indices in ROI_DEFINITIONS.items():
        try:
            roi_signal = su.extract_roi_signal(frames, landmarks_list, indices)
            result = _analyze_single_roi(roi_signal, fps)
        except Exception:
            result = None
        if result is not None:
            roi_results[name] = result

    if not roi_results:
        return _empty_result()

    # 代表值取 SNR 最高的 ROI：額頭可能被瀏海遮住、臉頰可能因轉頭而受光不均，
    # 挑訊號品質最好的那一組，heartRate 與 snr 才會是同一組訊號的描述。
    best_name = max(roi_results, key=lambda k: roi_results[k]["snr"])
    best = roi_results[best_name]

    heart_rates = [r["heart_rate"] for r in roi_results.values()]
    consistency = _roi_consistency(heart_rates)

    # 三項判定
    # a. 主頻要落在 0.7-4 Hz。estimate_heart_rate 只在這個頻帶內找峰值，
    #    所以這裡是複查換算回 bpm 之後仍在範圍內。
    in_band = (
        config.RPPG_BAND_LOW * 60.0
        <= best["heart_rate"]
        <= config.RPPG_BAND_HIGH * 60.0
    )
    # b. 訊噪比要夠。純雜訊算出來是負值，真實心跳約 +2 到 +7 dB。
    snr_ok = best["snr"] >= config.RPPG_SNR_MIN
    # c. 三個 ROI 心率要一致。只有一個 ROI 算得出來時直接判失敗，
    #    因為這一項的意義就是跨區域交叉驗證。
    consistency_ok = (
        len(roi_results) == len(ROI_DEFINITIONS)
        and consistency >= config.RPPG_ROI_CONSISTENCY_MIN
    )

    checks = [
        {"label": CHECK_LABELS[0], "passed": bool(in_band)},
        {"label": CHECK_LABELS[1], "passed": bool(snr_ok)},
        {"label": CHECK_LABELS[2], "passed": bool(consistency_ok)},
    ]

    return {
        # 三項判定全部要過，detected 才是 True。
        # SNR 的真人/攻擊分離度只有 1.6-2 dB（見 PHASE1_NOTES §5.4），跟
        # roiConsistency 的 2.3-2.6 倍分離度比起來窄很多，容易被踩線通過；
        # 若只看 a+b 兩項，一支 SNR 剛好壓線過關但 roiConsistency 很差的攻擊樣本
        # 會被誤判為 detected=True。三項都要過，才不會讓最弱的一項單獨決定結果。
        "detected": bool(in_band and snr_ok and consistency_ok),
        "heartRate": float(best["heart_rate"]) if in_band else None,
        "snr": float(best["snr"]),
        "roiConsistency": float(consistency),
        "checks": checks,
        "waveform": su.resample_curve(
            best["filtered"], config.RPPG_WAVEFORM_POINTS
        ),
        "spectrum": su.resample_spectrum(
            best["freqs"],
            best["psd"],
            config.RPPG_SPECTRUM_POINTS,
            config.RPPG_SPECTRUM_MAX_HZ,
        ),
    }


def draw_roi_overlay(frame, landmarks):
    """把三個 ROI 疊在影格上，用來目視確認選點有沒有框對。

    錄好第一支影片後一定要看一次這張圖 —— ROI 框錯位置的話，
    後面所有數字都是錯的，而且不會報錯，很難查。

    參數:
        frame: np.ndarray，RGB，uint8
        landmarks: np.ndarray，(478, 2) 像素座標
    回傳:
        np.ndarray，疊了半透明色塊的影格副本
    """
    import cv2

    colors = {
        "forehead": (0, 255, 0),
        "left_cheek": (255, 0, 0),
        "right_cheek": (0, 0, 255),
    }

    overlay = frame.copy()
    for name, indices in ROI_DEFINITIONS.items():
        pts = np.asarray(landmarks, dtype=np.int32)[indices]
        cv2.fillConvexPoly(overlay, cv2.convexHull(pts), colors[name])

    return cv2.addWeighted(frame, 0.6, overlay, 0.4, 0)
