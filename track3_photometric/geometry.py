"""Track 3｜照明響應：立體幾何一致性檢查。

契約見 CONVENTIONS.md §4.5、PLAN.md 階段2 Track3、SRS FR-23。

原理：立體臉的額頭、鼻樑、臉頰因表面法線方向不同，面對同一個螢幕光源時
亮度反應幅度也不同——例如鼻樑正面迎光反差通常較大，臉頰角度較側、反差
較小。列印照片是一塊平面，翻拍時整塊反射會均勻地一起變亮變暗，各區域
反應幅度理論上會非常接近。

geometryScore 量化「各區反應幅度之間的分散程度」：分散度高（各區反應不
一樣）判定為立體、分散度低（各區反應幾乎一致）判定為平面。

**目前的 CV 正規化參考值（config.PHOTO_GEOMETRY_CV_REFERENCE）是未經真實
資料驗證的初始猜測**——Track 2 的 SNR 門檻就曾經在這個階段寫錯（見
PHASE1_NOTES.md §6.2：算法沒有鑑別力，純雜訊也會算出「有訊號」的高分），
之後靠真實影片對照才抓出來、重新校準。這個模組同樣需要等錄到真人與
列印照片翻拍樣本後，比照 PHASE1_NOTES §5.4 的方法重新驗證，現在的數字
先當佔位，不能直接信。
"""

import numpy as np

import config

# 四個檢查區域的 MediaPipe 478 點索引。
# 額頭／左右頰沿用 track2_rppg/analyzer.py 的定義（已對照官方
# FaceLandmarksConnections 驗證過）。鼻樑是新加的，索引取自 MediaPipe
# 官方拓撲中鼻樑中線一段（168 眉心下方、6/197/195 鼻樑、4 鼻尖上緣）——
# **這組還沒實際錄影驗證過**，第一次用真實影格跑這個模組前，
# 務必先呼叫 draw_geometry_overlay() 存圖目視確認，位置不對的話
# 這個模組的數字全部不可信，而且不會報錯。
FOREHEAD_INDICES = [
    10, 108, 151, 337, 9, 336, 296, 334, 293, 300,
    67, 109, 69, 104, 105, 66, 107,
]
NOSE_BRIDGE_INDICES = [168, 6, 197, 195, 5, 4]
LEFT_CHEEK_INDICES = [50, 101, 118, 117, 123, 116, 111, 137, 205, 36]
RIGHT_CHEEK_INDICES = [280, 330, 347, 346, 352, 345, 340, 366, 425, 266]

GEOMETRY_REGIONS = {
    "forehead": FOREHEAD_INDICES,
    "nose_bridge": NOSE_BRIDGE_INDICES,
    "left_cheek": LEFT_CHEEK_INDICES,
    "right_cheek": RIGHT_CHEEK_INDICES,
}


def region_brightness_series(frames, landmarks_list, indices):
    """算某個臉部區域逐格的平均灰階亮度。

    跟 track2_rppg/signal_utils.extract_roi_signal 是同樣的圈選邏輯，
    但這裡只要灰階亮度（給幾何分析用），不需要 RGB 三通道，所以另外寫
    一份而不是共用——共用要嘛讓這裡多算兩個用不到的通道，要嘛讓 Track 2
    多一層灰階轉換的分支，都不比各自維持單純划算。

    參數:
        frames: list[np.ndarray]，RGB，uint8
        landmarks_list: list[np.ndarray | None]，長度同 frames，(478, 2) 像素座標
        indices: list[int]

    回傳:
        np.ndarray，shape (len(frames),)。沒偵測到臉、或關鍵點退化成一條線
        （圍不出面積）的格填 np.nan，時間軸長度維持不變。
    """
    import cv2

    series = np.full(len(frames), np.nan, dtype=np.float64)

    for i, (frame, landmarks) in enumerate(zip(frames, landmarks_list)):
        if landmarks is None:
            continue

        h, w = frame.shape[:2]
        pts = np.asarray(landmarks, dtype=np.float64)[indices]
        pts = np.column_stack(
            [np.clip(pts[:, 0], 0, w - 1), np.clip(pts[:, 1], 0, h - 1)]
        ).astype(np.int32)

        mask = np.zeros((h, w), dtype=np.uint8)
        cv2.fillConvexPoly(mask, cv2.convexHull(pts), 255)
        if cv2.countNonZero(mask) == 0:
            continue

        gray = cv2.cvtColor(frame, cv2.COLOR_RGB2GRAY)
        series[i] = cv2.mean(gray, mask=mask)[0]

    return series


def segment_response_amplitude(brightness_series, fps, light_log):
    """算某區域在整段序列裡，逐段平均亮度的變化幅度。

    做法：依 light_log 的分段時間，把 brightness_series 切成對應的段，
    每段取平均亮度，再取這些段平均值的標準差，當作這個區域對燈光切換的
    「反應幅度」。用段平均而不是逐格差分，是因為單格雜訊（頭部微動、
    影像雜訊）在段平均裡會被抵銷掉，留下的才是真正跟著燈光切換的訊號——
    這跟 Track 2 用整段 welch 而不是逐格差分抓心跳頻率是同一個道理。

    參數:
        brightness_series: np.ndarray，region_brightness_series 的輸出
        fps: float
        light_log: dict，§5.2 格式

    回傳:
        float。訊號完全缺失、frames 為空、或 light_log 少於 2 段
        （無法比較段與段之間的差異）時回傳 0.0
    """
    segments = light_log.get("segments") or []
    if len(segments) < 2:
        return 0.0

    n = len(brightness_series)
    if n == 0:
        return 0.0

    means = []
    for seg in segments:
        start_frame = int(seg["startMs"] / 1000.0 * fps)
        end_frame = int((seg["startMs"] + seg["durationMs"]) / 1000.0 * fps)
        start_frame = max(0, min(start_frame, n))
        end_frame = max(start_frame, min(end_frame, n))
        if end_frame <= start_frame:
            continue

        window = brightness_series[start_frame:end_frame]
        valid = window[~np.isnan(window)]
        if len(valid) == 0:
            continue
        means.append(valid.mean())

    if len(means) < 2:
        return 0.0

    return float(np.std(means))


def amplitude_dispersion_score(amplitudes):
    """把各區反應幅度的分散程度映射成 0.0-1.0 的 geometryScore。

    用變異係數（標準差 / 平均值）當分散度指標，除以參考值後夾在 0-1。

    參數:
        amplitudes: list[float]，各區域的反應幅度
    回傳:
        float，0.0-1.0。有效樣本少於 2 筆、或平均反應幅度趨近 0
        （完全沒有跟著燈光變化，例如影片太暗或全遮擋）時回傳 0.0——
        沒有訊號時無法判斷是不是立體，不能預設給高分。
    """
    valid = [a for a in amplitudes if a is not None]
    if len(valid) < 2:
        return 0.0

    mean_amp = float(np.mean(valid))
    if mean_amp <= 1e-6:
        return 0.0

    cv = float(np.std(valid) / mean_amp)
    return float(np.clip(cv / config.PHOTO_GEOMETRY_CV_REFERENCE, 0.0, 1.0))


def check_stereo_geometry(frames, landmarks_list, light_log, fps):
    """立體幾何一致性檢查主流程：額頭／鼻樑／雙頰四區反應幅度的分散程度。

    參數:
        frames: list[np.ndarray]，RGB
        landmarks_list: list[np.ndarray | None]，長度同 frames
        light_log: dict，§5.2 格式
        fps: float

    回傳:
        float，geometryScore，0.0-1.0
    """
    amplitudes = []
    for indices in GEOMETRY_REGIONS.values():
        series = region_brightness_series(frames, landmarks_list, indices)
        amplitudes.append(segment_response_amplitude(series, fps, light_log))

    return amplitude_dispersion_score(amplitudes)


def draw_geometry_overlay(frame, landmarks):
    """把四個幾何檢查區域疊在影格上，用來目視確認選點有沒有框對。

    第一次用真實影格跑這個模組前一定要看一次這張圖——鼻樑索引目前只是
    參照 MediaPipe 官方拓撲推算的，還沒實際驗證過，框錯位置的話這個
    模組的數字全部不可信，而且不會報錯（比照 track2_rppg 的教訓）。

    參數:
        frame: np.ndarray，RGB，uint8
        landmarks: np.ndarray，(478, 2) 像素座標
    回傳:
        np.ndarray，疊了半透明色塊的影格副本
    """
    import cv2

    colors = {
        "forehead": (0, 255, 0),
        "nose_bridge": (255, 255, 0),
        "left_cheek": (255, 0, 0),
        "right_cheek": (0, 0, 255),
    }

    overlay = frame.copy()
    for name, indices in GEOMETRY_REGIONS.items():
        pts = np.asarray(landmarks, dtype=np.int32)[indices]
        cv2.fillConvexPoly(overlay, cv2.convexHull(pts), colors[name])

    return cv2.addWeighted(frame, 0.6, overlay, 0.4, 0)
