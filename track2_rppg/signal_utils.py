"""Track 2 rPPG 的訊號處理核心。

這裡的函式全部只吃 numpy 陣列，不碰 MediaPipe、不碰攝影機，
所以可以用合成訊號單獨驗證數學是否正確（見 tests/test_signal_utils.py）。

管線：extract_roi_signal → detrend_signal → bandpass_filter → estimate_heart_rate
"""

import cv2
import numpy as np
from scipy.signal import butter, detrend, filtfilt, welch

import config


def extract_roi_signal(frames, landmarks_list, roi_indices):
    """把每一格指定 ROI 區域的顏色平均成三個數字。

    參數:
        frames: list[np.ndarray]
            原始影格，RGB，uint8，shape = (H, W, 3)
        landmarks_list: list[np.ndarray | None]
            長度與 frames 相同。每個元素是該格的臉部關鍵點「像素座標」，
            shape = (N, 2)，順序為 (x, y)。該格沒偵測到臉時放 None
        roi_indices: list[int]
            要圈出來的關鍵點索引，指向 landmarks 陣列的列

    回傳:
        np.ndarray，shape = (len(frames), 3)，dtype float64
        每一列是該格 ROI 多邊形內 R、G、B 三通道的像素平均值。
        沒偵測到臉、或關鍵點退化成一條線（圍不出面積）的格填 np.nan，
        時間軸長度維持不變 —— rPPG 靠的是等間隔取樣，
        缺格如果直接刪掉，頻率就會算錯。
    """
    if len(frames) != len(landmarks_list):
        raise ValueError(
            f"frames 與 landmarks_list 長度不符：{len(frames)} vs {len(landmarks_list)}"
        )

    signal = np.full((len(frames), 3), np.nan, dtype=np.float64)

    for i, (frame, landmarks) in enumerate(zip(frames, landmarks_list)):
        if landmarks is None:
            continue

        h, w = frame.shape[:2]
        pts = np.asarray(landmarks, dtype=np.float64)[roi_indices]
        pts = np.column_stack(
            [np.clip(pts[:, 0], 0, w - 1), np.clip(pts[:, 1], 0, h - 1)]
        ).astype(np.int32)

        mask = np.zeros((h, w), dtype=np.uint8)
        cv2.fillConvexPoly(mask, cv2.convexHull(pts), 255)
        if cv2.countNonZero(mask) == 0:
            continue

        # cv2.mean 依影像本身的通道順序回傳，frames 是 RGB 所以前三個就是 R,G,B
        signal[i] = cv2.mean(frame, mask=mask)[:3]

    return signal


def interpolate_missing(signal):
    """把 extract_roi_signal 留下的 np.nan 用線性內插補起來。

    偶爾幾格偵測失敗是常態（眨眼、輕微轉頭），補起來比丟掉好，
    因為丟掉會破壞等間隔取樣。頭尾的缺值用最近的有效值延伸。

    參數:
        signal: np.ndarray，shape = (T,) 或 (T, C)
    回傳:
        同 shape 的陣列。整條全是 nan 時原樣回傳。
    """
    arr = np.array(signal, dtype=np.float64, copy=True)
    single = arr.ndim == 1
    if single:
        arr = arr[:, None]

    idx = np.arange(len(arr))
    for c in range(arr.shape[1]):
        col = arr[:, c]
        valid = ~np.isnan(col)
        if valid.sum() == 0 or valid.all():
            continue
        col[~valid] = np.interp(idx[~valid], idx[valid], col[valid])

    return arr[:, 0] if single else arr


def detrend_signal(signal):
    """去除線性漂移。

    人會不自覺前後移動、環境光也會緩慢變化，這會讓整條曲線的基線
    慢慢往上或往下跑。這種趨勢集中在極低頻，功率遠大於心跳，
    不先扣掉的話頻譜會被它主導。

    參數:
        signal: array-like，1D
    回傳:
        np.ndarray，float64，長度不變
    """
    sig = np.asarray(signal, dtype=np.float64)
    if sig.ndim != 1:
        raise ValueError(f"detrend_signal 只吃 1D 訊號，收到 shape={sig.shape}")
    if len(sig) < 2:
        return sig.copy()
    return detrend(sig, type="linear")


def bandpass_filter(signal, fps, low=config.RPPG_BAND_LOW, high=config.RPPG_BAND_HIGH):
    """Butterworth 帶通濾波，只留下人類心跳可能出現的頻段。

    預設 0.7-4.0 Hz 換算成每分鐘 42-240 下。低於 42 是呼吸與姿勢漂移，
    高於 240 是影像雜訊與壓縮假影，兩邊都不可能是心跳。

    用 filtfilt 而不是 lfilter：filtfilt 正反各跑一次，相位延遲抵銷。
    rPPG 之後要比對三個 ROI 的波形，相位不能被濾波器扭曲。

    參數:
        signal: array-like，1D
        fps: float，取樣率
        low, high: float，通帶上下界（Hz），預設讀 config
    回傳:
        np.ndarray，float64，長度不變
    例外:
        訊號太短或 fps 不合理時 raise ValueError
    """
    sig = np.asarray(signal, dtype=np.float64)
    if sig.ndim != 1:
        raise ValueError(f"bandpass_filter 只吃 1D 訊號，收到 shape={sig.shape}")
    if fps <= 0:
        raise ValueError(f"fps 必須為正數，收到 {fps}")

    nyquist = fps / 2.0
    if low >= nyquist:
        raise ValueError(f"通帶下界 {low} Hz 已達或超過 Nyquist {nyquist} Hz")
    # fps 太低時 Nyquist 可能低於 4 Hz，把上界壓下來而不是報錯
    high = min(high, nyquist * 0.99)

    order = config.RPPG_FILTER_ORDER
    b, a = butter(order, [low / nyquist, high / nyquist], btype="band")

    # filtfilt 兩端要各補 padlen 個點，訊號長度不夠會直接拋錯
    padlen = 3 * max(len(a), len(b))
    if len(sig) <= padlen:
        raise ValueError(
            f"訊號長度 {len(sig)} 不足以做 {order} 階帶通濾波，至少需要 {padlen + 1} 格"
        )

    return filtfilt(b, a, sig)


def estimate_heart_rate(
    filtered_signal, fps, low=config.RPPG_BAND_LOW, high=config.RPPG_BAND_HIGH
):
    """從濾波後的訊號找出主頻並換算成心率。

    參數:
        filtered_signal: array-like，1D，已經過帶通濾波
        fps: float
        low, high: float，搜尋主峰的頻帶（Hz），預設讀 config

    回傳:
        (heart_rate, psd, freqs, snr)
        heart_rate: float，bpm。頻帶內找不到有效峰值時為 None
        psd: np.ndarray，功率頻譜密度
        freqs: np.ndarray，psd 對應的頻率（Hz）
        snr: float，dB。主峰功率 / 頻帶內其餘功率平均，取 10log10
    """
    sig = np.asarray(filtered_signal, dtype=np.float64)
    if sig.ndim != 1:
        raise ValueError(f"estimate_heart_rate 只吃 1D 訊號，收到 shape={sig.shape}")
    if fps <= 0:
        raise ValueError(f"fps 必須為正數，收到 {fps}")

    # 每段取 10 秒。段長決定頻譜解析度（1/10s = 0.1 Hz ≈ 6 bpm），
    # 分段平均則壓掉隨機雜訊造成的假峰。用秒數而不是固定樣本數，
    # 換一台 fps 不同的相機時解析度才不會跟著變。
    nperseg = int(min(len(sig), max(fps * 10, 16)))
    freqs, psd = welch(sig, fs=fps, nperseg=nperseg, noverlap=nperseg // 2)

    band = (freqs >= low) & (freqs <= high)
    if band.sum() < 3 or not np.any(psd[band] > 0):
        return None, psd, freqs, 0.0

    band_idx = np.flatnonzero(band)
    peak_idx = band_idx[np.argmax(psd[band])]
    peak_idx = _prefer_fundamental_over_harmonic(freqs, psd, band, peak_idx, low)

    peak_freq = _refine_peak(freqs, psd, peak_idx)
    snr = _band_snr(freqs, psd, peak_freq, low, high)

    return float(peak_freq * 60.0), psd, freqs, snr


def _band_snr(freqs, psd, peak_freq, low, high):
    """訊噪比：心跳帶的能量總和，除以頻帶內其餘部分的能量總和，取 10log10。

    「心跳帶」= 主峰 ±0.1 Hz，加上二次諧波 ±0.1 Hz。心跳的波形不是純正弦
    （收縮期陡、舒張期緩），二次諧波帶有真實的生理能量，算進訊號側才不會低估。

    PLAN.md 階段 2 寫的是另一種算法「主峰功率 / 頻帶內其餘功率的平均」。
    實測後改成現在這個版本，原因是前者沒有鑑別力：
    純高斯雜訊用前者算出來是 3.5-8.0 dB，全部高於 config.RPPG_SNR_MIN(3.0)，
    等於任何影片都會被判定「偵測到心跳」。原因是頻帶內最大的那一格
    本來就會比平均高好幾倍，就算裡面根本沒有訊號。
    改用能量比之後，純雜訊落在 -11 到 -5 dB、真訊號 +2 到 +7 dB，
    3 dB 門檻剛好切在中間 —— §8 既定的閾值不用改就能用。
    這個改動要在對進度時跟 A 講一聲。
    """
    width = config.RPPG_SNR_HARMONIC_WIDTH
    band = (freqs >= low) & (freqs <= high)

    # 二次諧波若超出頻帶上界，會自然被 band 濾掉，不必特別處理
    signal_mask = band & (
        (np.abs(freqs - peak_freq) <= width)
        | (np.abs(freqs - 2.0 * peak_freq) <= width)
    )
    noise_mask = band & ~signal_mask

    signal_power = psd[signal_mask].sum()
    noise_power = psd[noise_mask].sum()

    if noise_power <= 0 or signal_power <= 0:
        return 0.0

    return float(10.0 * np.log10(signal_power / noise_power))


def _prefer_fundamental_over_harmonic(freqs, psd, band, peak_idx, low):
    """如果目前選到的峰值很可能是真正基頻的二次諧波，改選較低頻那個。

    2026-08-22：真人測試發現的問題——心跳波形不是純正弦（收縮期陡、
    舒張期緩），二次諧波本來就帶有真實的生理能量（`_band_snr()` 的
    docstring 也是這樣算 SNR 的）。單純取頻帶內功率最大值當主頻，沒有
    排除「雜訊/動作干擾讓諧波那格功率反超基頻」這種狀況，會估出剛好
    兩倍的心率。真人樣本裡，額頭/左臉頰估出 110+ bpm、右臉頰估出
    55 bpm，前兩者剛好是後者的兩倍，就是誤選到諧波的典型模式。

    做法：檢查目前峰值頻率的一半是否還落在合法頻帶內，附近有沒有一個
    功率不算太低的候選峰值（達到 config.RPPG_HARMONIC_DEMOTE_RATIO
    這個比例）——如果有，代表基頻訊號其實還在、只是被諧波蓋過去，
    改採這個較低頻的峰值。

    參數:
        freqs, psd: welch() 的輸出
        band: bool 陣列，跟 freqs 同長度，標出合法搜尋頻帶
        peak_idx: int，目前選到（頻帶內全域最大值）的索引
        low: float，頻帶下界（Hz）

    回傳:
        int，最終採用的峰值索引（可能跟輸入的 peak_idx 相同）
    """
    half_freq = freqs[peak_idx] / 2.0
    if half_freq < low:
        return peak_idx

    width = config.RPPG_SNR_HARMONIC_WIDTH
    sub_mask = band & (np.abs(freqs - half_freq) <= width)
    if not np.any(sub_mask):
        return peak_idx

    sub_band_idx = np.flatnonzero(sub_mask)
    sub_peak_idx = sub_band_idx[np.argmax(psd[sub_mask])]

    peak_power = psd[peak_idx]
    if peak_power <= 0:
        return peak_idx

    if psd[sub_peak_idx] / peak_power >= config.RPPG_HARMONIC_DEMOTE_RATIO:
        return sub_peak_idx

    return peak_idx


def _refine_peak(freqs, psd, peak_idx):
    """用峰值左右兩格做拋物線內插，把主頻定位到格點之間。

    頻譜的格點間隔是 0.1 Hz（= 6 bpm），只取最大格當答案，誤差會固定在
    ±3 bpm 上下，達不到專案要求的 5 bpm 以內。真實的峰形在對數尺度上
    接近拋物線，用左中右三格擬合就能把峰頂位置算出來，精度提升一個數量級。
    """
    if peak_idx == 0 or peak_idx >= len(psd) - 1:
        return freqs[peak_idx]

    y0, y1, y2 = np.log(psd[peak_idx - 1 : peak_idx + 2] + 1e-20)
    denom = y0 - 2.0 * y1 + y2
    if denom == 0:
        return freqs[peak_idx]

    # 峰頂相對於中央格的偏移量，理論上落在 ±0.5 格內
    delta = 0.5 * (y0 - y2) / denom
    if abs(delta) > 0.5:
        return freqs[peak_idx]

    return freqs[peak_idx] + delta * (freqs[1] - freqs[0])


def resample_curve(values, points):
    """把任意長度的曲線等間隔重採樣成固定點數。

    §4.4 規定 spectrum 固定 64 點、waveform 這邊固定 300 點，
    但 welch 的輸出長度會隨 fps 與影片長度變動，所以統一在這裡拉齊。

    參數:
        values: array-like，1D
        points: int，目標點數
    回傳:
        list[float]，長度為 points。輸入為空時回傳全 0
    """
    arr = np.asarray(values, dtype=np.float64)
    if len(arr) == 0:
        return [0.0] * points
    if len(arr) == 1:
        return [float(arr[0])] * points

    src = np.linspace(0.0, 1.0, len(arr))
    dst = np.linspace(0.0, 1.0, points)
    return np.interp(dst, src, arr).tolist()


def resample_spectrum(freqs, psd, points, max_hz):
    """把功率頻譜重採樣到 0 至 max_hz 的固定格點上。

    §4.4 要求 spectrum 是「長度 64，對應 0-4 Hz」，
    也就是第 i 個值代表 i * 4/63 Hz 的功率。

    參數:
        freqs, psd: np.ndarray，welch 的輸出
        points: int，目標點數
        max_hz: float，頻率上界
    回傳:
        list[float]，長度為 points
    """
    if len(freqs) == 0:
        return [0.0] * points
    grid = np.linspace(0.0, max_hz, points)
    return np.interp(grid, freqs, psd, left=0.0, right=0.0).tolist()
