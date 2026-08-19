"""Track 3｜照明響應對外入口。

契約見 CONVENTIONS.md §4.5。

原理：使用者臉前的螢幕播放一段隨機顏色序列，若使用者真的在鏡頭前，
臉部反射亮度會跟著螢幕光切換同步變化；若是預錄影片注入或已經生成好的
假臉，反射不會跟著這次隨機序列走，互相關係數會很低。

列印照片翻拍是這一層設計上刻意留下的破綻——螢幕光真的會照到照片上，
確實會有反射訊號，相關係數可能不低。但照片是一塊平面，各區域反應幅度
理論上會一致；真人的臉是立體的，各區域反應幅度不同。這個破綻由
geometry.py 的立體幾何檢查負責抓，兩項判定合起來才完整。
"""

import numpy as np
from scipy.signal import correlate

import config
from common.landmarks import ModelNotFoundError, extract_landmarks
from common.risk import combine_risks, threshold_risk
from track3_photometric import geometry as geo
from track3_photometric import sequence as seq

# checks 的三個標籤，順序不可變（§4.5 規定固定 3 項）
CHECK_LABELS = (
    "臉部反射與螢幕光序列相關係數達標",
    "響應延遲在合理範圍內",
    "立體幾何反射模式合理",
)

# 「臉部區域」用 geometry.py 四個檢查區域的索引聯集近似，
# 不再另外引入一組沒驗證過的 face oval 索引——重用已經測過的點位，
# 涵蓋額頭、鼻樑、雙頰，眼嘴周圍本來就要避開（跟 Track 2 同樣的理由：
# 眨眼/說話造成的像素變化比反光大兩個數量級）。
_FACE_INDICES = sorted({idx for indices in geo.GEOMETRY_REGIONS.values() for idx in indices})


def _empty_result():
    """偵測失敗時的回傳值。checks 仍維持 3 項且順序不變，全部 passed=False。"""
    return {
        "detected": False,
        "correlation": 0.0,
        "latencyMs": None,
        "geometryScore": 0.0,
        "sequence": [],
        "checks": [{"label": label, "passed": False} for label in CHECK_LABELS],
        "lightCurve": [],
        "reflectCurve": [],
        "confidenceScore": 1.0,
    }


def _face_brightness_series(frames, landmarks_list):
    """臉部整體逐格平均灰階亮度，互相關分析用。"""
    return geo.region_brightness_series(frames, landmarks_list, _FACE_INDICES)


def _fill_missing(series):
    """把缺格（np.nan）用線性內插補起來，頭尾缺值用最近的有效值延伸。

    這裡只有一條 1D 亮度序列，比 Track 2 signal_utils.interpolate_missing
    要處理的情況單純，所以另外寫一份小的，不跨 track 互相依賴。
    """
    arr = np.asarray(series, dtype=np.float64).copy()
    idx = np.arange(len(arr))
    valid = ~np.isnan(arr)
    if valid.sum() == 0:
        return arr
    arr[~valid] = np.interp(idx[~valid], idx[valid], arr[valid])
    return arr


def _normalize_series(series):
    """把序列線性映射到 0-1（最小值→0、最大值→1）。

    lightCurve 的亮度值天生就在 0-1（COLOR_BRIGHTNESS 表），reflectCurve
    量的是像素灰階值（0-255 量級），要正規化到同一尺度，兩條線疊在
    同一張圖上比較才有意義。
    """
    arr = np.asarray(series, dtype=np.float64)
    if len(arr) == 0:
        return arr
    lo, hi = arr.min(), arr.max()
    if hi - lo < 1e-9:
        return np.zeros_like(arr)
    return (arr - lo) / (hi - lo)


def _resample(series, points):
    """等間隔重採樣成固定點數。§4.5 規定 reflectCurve 固定長度 100。"""
    arr = np.asarray(series, dtype=np.float64)
    if len(arr) == 0:
        return [0.0] * points
    if len(arr) == 1:
        return [float(arr[0])] * points
    src = np.linspace(0.0, 1.0, len(arr))
    dst = np.linspace(0.0, 1.0, points)
    return np.interp(dst, src, arr).tolist()


def _cross_correlate(reflect_series, light_series, fps):
    """對臉部反射曲線與螢幕光曲線做互相關，求最佳延遲與相關係數。

    兩條序列先各自標準化（減平均、除標準差）再互相關，算出來的峰值
    才能當作 -1 到 1 的相關係數，不受原始訊號尺度影響——reflect 是
    灰階值 0-255 量級，light 是 0-1 量級，直接比對沒有意義。

    只在合理的延遲範圍內搜尋峰值，不搜整段訊號：避免在雜訊裡找到一個
    時間上不合理的假峰值（例如相隔好幾秒的巧合相似）。

    參數:
        reflect_series, light_series: np.ndarray，長度需相同
        fps: float

    回傳:
        (correlation, latency_ms)
        correlation: float，0.0-1.0（負相關視為 0，代表反射方向不合理，
            不可能是「同步反光」該有的樣子）
        latency_ms: float，反射相對光源的延遲，正值代表反射晚於光源變化
    """
    n = len(reflect_series)
    if n < 2:
        return 0.0, 0.0

    reflect_std = reflect_series.std()
    light_std = light_series.std()
    if reflect_std < 1e-9 or light_std < 1e-9:
        return 0.0, 0.0

    z_reflect = (reflect_series - reflect_series.mean()) / reflect_std
    z_light = (light_series - light_series.mean()) / light_std

    xcorr = correlate(z_reflect, z_light, mode="full") / n
    lags = np.arange(-(n - 1), n)

    search_frames = max(int(config.PHOTO_LATENCY_SEARCH_MS / 1000.0 * fps), 1)
    window = np.abs(lags) <= search_frames

    windowed_xcorr = xcorr[window]
    windowed_lags = lags[window]
    peak_idx = int(np.argmax(windowed_xcorr))

    correlation = float(np.clip(windowed_xcorr[peak_idx], 0.0, 1.0))
    latency_ms = float(windowed_lags[peak_idx] / fps * 1000.0)

    return correlation, latency_ms


def analyze_photometric(frames: list, fps: float, light_log: dict) -> dict:
    """檢查臉部反射是否與螢幕光序列同步。

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
            "reflectCurve": list[float],   # 臉部反射強度，長度 100，標準化 0-1
            "confidenceScore": float       # 0.0-1.0，連續風險信心分數，數值
                                            # 越高代表越可疑，供 common/
                                            # fusion.py 加權融合用（§2 允許
                                            # 新增欄位，不在原始契約清單）
        }

    備註:
        執行階段的失敗一律回傳 detected=False 的完整結構，不拋例外——
        多數影格偵測不到臉、light_log 段數不足、單格 MediaPipe 出錯都算。

        唯一的例外是模型檔不存在時拋 ModelNotFoundError，那是環境沒裝好，
        不是影片的問題（比照 track2_rppg.analyzer 的處理方式）。
    """
    if not frames or fps <= 0:
        return _empty_result()

    segments = (light_log or {}).get("segments") or []
    if len(segments) < 2:
        return _empty_result()

    try:
        landmarks_list = extract_landmarks(frames, fps)
    except ModelNotFoundError:
        raise
    except Exception:
        return _empty_result()

    detected_ratio = sum(lm is not None for lm in landmarks_list) / len(frames)
    if detected_ratio < config.PHOTO_MIN_FACE_RATIO:
        return _empty_result()

    reflect_raw = _face_brightness_series(frames, landmarks_list)
    if np.isnan(reflect_raw).all():
        return _empty_result()
    reflect_filled = _fill_missing(reflect_raw)

    light_series = np.array(
        [seq.light_intensity_at(light_log, i / fps * 1000.0) for i in range(len(frames))]
    )

    correlation, latency_ms = _cross_correlate(reflect_filled, light_series, fps)
    geometry_score = geo.check_stereo_geometry(frames, landmarks_list, light_log, fps)

    # 三項判定
    # a. 相關係數要達標。
    correlation_ok = correlation >= config.PHOTO_CORRELATION_MIN
    # b. 延遲要在合理範圍內。取絕對值——量測雜訊可能讓真正同步的訊號
    #    測出微小負延遲，只看正值會誤殺。
    latency_ok = abs(latency_ms) <= config.PHOTO_LATENCY_MAX_MS
    # c. 立體幾何要合理，這項專門抓列印照片翻拍（相關係數可能不低，
    #    因為螢幕光真的照得到照片，但平面各區反應幅度一致）。
    geometry_ok = geometry_score >= config.PHOTO_GEOMETRY_MIN

    checks = [
        {"label": CHECK_LABELS[0], "passed": bool(correlation_ok)},
        {"label": CHECK_LABELS[1], "passed": bool(latency_ok)},
        {"label": CHECK_LABELS[2], "passed": bool(geometry_ok)},
    ]

    # 連續信心分數：三項判定各自平滑成風險分數後取最大值（理由見
    # common/risk.py 與 track2_rppg/analyzer.py 的同類註解）。
    confidence_score = combine_risks(
        threshold_risk(
            correlation, config.PHOTO_CORRELATION_MIN, config.PHOTO_CORRELATION_RISK_SCALE,
            higher_is_better=True,
        ),
        threshold_risk(
            abs(latency_ms), config.PHOTO_LATENCY_MAX_MS, config.PHOTO_LATENCY_RISK_SCALE,
            higher_is_better=False,
        ),
        threshold_risk(
            geometry_score, config.PHOTO_GEOMETRY_MIN, config.PHOTO_GEOMETRY_RISK_SCALE,
            higher_is_better=True,
        ),
    )

    return {
        # 三項判定全部要過，detected 才是 True——理由跟 Track 2 一樣：
        # 不能讓最弱的一項單獨決定結果（見 track2_rppg/analyzer.py 的說明）。
        "detected": bool(correlation_ok and latency_ok and geometry_ok),
        "correlation": float(correlation),
        # 相關係數太低時，互相關峰值本質上是在雜訊裡找出來的，
        # 延遲數字沒有意義，回傳 None（比照 Track 2 heartRate 的處理）。
        "latencyMs": float(latency_ms) if correlation_ok else None,
        "geometryScore": float(geometry_score),
        "sequence": [s["color"] for s in segments],
        "checks": checks,
        "lightCurve": seq.resample_light_curve(light_log, config.PHOTO_CURVE_POINTS),
        "reflectCurve": _resample(
            _normalize_series(reflect_filled), config.PHOTO_CURVE_POINTS
        ),
        "confidenceScore": confidence_score,
    }
