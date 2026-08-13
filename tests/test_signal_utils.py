"""Track 2 訊號處理的數學驗證。

這份測試不需要攝影機、不需要 MediaPipe、不需要真實影片。
做法是自己合成一段「已知心率」的訊號，餵進完整管線，
看算回來的數字對不對 —— 訊號處理寫錯了，這裡就會紅。

真實影片的測試等錄好素材後另外補。
"""

import sys
from pathlib import Path

import numpy as np
import pytest

# 用 pytest 跑時由根目錄的 conftest.py 處理，
# 直接 `python tests/test_signal_utils.py` 時則靠這一段。
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import config
from track2_rppg import signal_utils as su

TARGET_BPM = 72.0
TOLERANCE_BPM = 2.0
FPS = 30.0
DURATION_SEC = 20.0


def make_synthetic_signal(
    bpm=TARGET_BPM, fps=FPS, duration=DURATION_SEC, noise_std=0.3, seed=42
):
    """合成一段模擬額頭綠通道平均值的訊號。

    疊了三樣東西，對應真實錄影裡真的會出現的干擾：
      1. 心跳本身：bpm 換算成 Hz 的正弦波，振幅 1.0
      2. 線性漂移：模擬人緩慢前後移動或環境光變化，幅度是心跳的 8 倍
      3. 高斯雜訊：模擬感測器雜訊與壓縮假影

    基線設 120 是因為 8-bit 影像的通道平均值大概落在這個量級，
    心跳造成的變化只佔 1% 上下 —— 這正是 rPPG 難做的原因。
    """
    rng = np.random.default_rng(seed)
    t = np.arange(0.0, duration, 1.0 / fps)

    heartbeat = np.sin(2.0 * np.pi * (bpm / 60.0) * t)
    drift = 8.0 * t / duration
    noise = rng.normal(0.0, noise_std, size=len(t))

    return 120.0 + heartbeat + drift + noise


def run_pipeline(signal, fps=FPS):
    """跑完整管線：detrend → bandpass → estimate。"""
    detrended = su.detrend_signal(signal)
    filtered = su.bandpass_filter(detrended, fps)
    return su.estimate_heart_rate(filtered, fps)


# --------------------------------------------------------------------------
# 主測試：合成 72 bpm 訊號，管線要算得回來
# --------------------------------------------------------------------------


def test_pipeline_recovers_known_heart_rate():
    """72 bpm 的合成訊號跑完管線，估出來的心率誤差要在 2 bpm 內。"""
    signal = make_synthetic_signal()
    heart_rate, psd, freqs, snr = run_pipeline(signal)

    assert heart_rate is not None, "頻帶內找不到主峰"

    error = abs(heart_rate - TARGET_BPM)
    assert error < TOLERANCE_BPM, (
        f"估算心率 {heart_rate:.2f} bpm，目標 {TARGET_BPM} bpm，"
        f"誤差 {error:.2f} bpm 超過容忍值 {TOLERANCE_BPM} bpm"
    )

    assert snr >= config.RPPG_SNR_MIN, (
        f"合成訊號的心跳成分很乾淨，SNR 應該遠高於 {config.RPPG_SNR_MIN} dB，"
        f"實際只有 {snr:.2f} dB"
    )
    assert len(psd) == len(freqs)


@pytest.mark.parametrize("bpm", [50.0, 60.0, 72.0, 90.0, 110.0, 150.0])
def test_pipeline_across_heart_rate_range(bpm):
    """整個生理範圍都要準，不能只有 72 bpm 剛好對。"""
    heart_rate, _, _, _ = run_pipeline(make_synthetic_signal(bpm=bpm))

    assert heart_rate is not None
    assert abs(heart_rate - bpm) < TOLERANCE_BPM, (
        f"目標 {bpm} bpm，估出 {heart_rate:.2f} bpm"
    )


@pytest.mark.parametrize("noise_std", [0.5, 1.0, 2.0])
def test_pipeline_survives_noise(noise_std):
    """雜訊蓋過心跳振幅 2 倍時仍要抓得到主頻。

    noise_std=2.0 表示雜訊標準差是心跳振幅的兩倍，肉眼完全看不出週期，
    但雜訊是寬頻的、心跳是窄頻的，頻譜上仍分得開。
    """
    heart_rate, _, _, snr = run_pipeline(make_synthetic_signal(noise_std=noise_std))

    assert heart_rate is not None
    assert abs(heart_rate - TARGET_BPM) < TOLERANCE_BPM, (
        f"noise_std={noise_std} 時估出 {heart_rate:.2f} bpm，SNR {snr:.2f} dB"
    )


def test_pure_noise_has_low_snr():
    """沒有心跳、只有雜訊時 SNR 要低於門檻。

    這是判定 c 的反面：不能什麼訊號丟進去都說「偵測到心跳」。
    """
    rng = np.random.default_rng(7)
    noise = rng.normal(0.0, 1.0, size=int(FPS * DURATION_SEC))

    _, _, _, snr = run_pipeline(noise)

    assert snr < config.RPPG_SNR_MIN, (
        f"純雜訊的 SNR 應低於 {config.RPPG_SNR_MIN} dB，實際 {snr:.2f} dB"
    )


# --------------------------------------------------------------------------
# 各函式的獨立測試
# --------------------------------------------------------------------------


def test_detrend_removes_linear_drift():
    """detrend 後線性趨勢要消失，波形本身要留著。"""
    t = np.arange(0.0, DURATION_SEC, 1.0 / FPS)
    wave = np.sin(2.0 * np.pi * 1.2 * t)
    drifted = wave + 50.0 * t / DURATION_SEC + 100.0

    result = su.detrend_signal(drifted)

    slope = np.polyfit(t, result, 1)[0]
    assert abs(slope) < 1e-6, f"殘留斜率 {slope}"
    assert np.corrcoef(result, wave)[0, 1] > 0.99, "波形被 detrend 破壞了"


def test_bandpass_rejects_out_of_band():
    """帶外的訊號要被壓掉，帶內的要留下。"""
    t = np.arange(0.0, DURATION_SEC, 1.0 / FPS)
    in_band = np.sin(2.0 * np.pi * 1.2 * t)  # 72 bpm，在 0.7-4 Hz 內
    out_of_band = np.sin(2.0 * np.pi * 0.15 * t)  # 9 bpm，呼吸的頻率

    filtered_in = su.bandpass_filter(in_band, FPS)
    filtered_out = su.bandpass_filter(out_of_band, FPS)

    # 掐掉頭尾各 1 秒，filtfilt 的邊界效應集中在這裡
    edge = int(FPS)
    assert np.std(filtered_in[edge:-edge]) > 0.5, "帶內訊號被削掉了"
    assert np.std(filtered_out[edge:-edge]) < 0.05, "帶外訊號沒被濾掉"


def test_bandpass_rejects_too_short_signal():
    """訊號短到不能濾波時要明確報錯，不要回傳垃圾數字。"""
    with pytest.raises(ValueError, match="不足以做"):
        su.bandpass_filter(np.zeros(10), FPS)


def test_bandpass_rejects_bad_fps():
    with pytest.raises(ValueError, match="fps"):
        su.bandpass_filter(np.zeros(600), 0.0)


def test_extract_roi_signal_shape_and_missing_frames():
    """ROI 抽訊號：形狀要對，沒偵測到臉的格要留 nan 佔位。

    用純色方塊當測試圖，不需要真實人臉 —— 這裡驗的是遮罩與平均的邏輯。
    """
    h, w = 120, 160
    frames = []
    for value in (60, 90, 120):
        frame = np.zeros((h, w, 3), dtype=np.uint8)
        frame[40:80, 50:110] = (value, value + 10, value + 20)  # R, G, B
        frames.append(frame)

    # 四個角圍出上面那塊方形區域。用 109/79 而不是 110/80，
    # 因為 frame[40:80, 50:110] 的最後一列/行索引是 79 與 109，
    # 多圈一格會把外圍的黑色像素納入平均。
    box = np.array([[50, 40], [109, 40], [109, 79], [50, 79]], dtype=np.float64)
    landmarks_list = [box, None, box]  # 中間那格模擬偵測失敗

    result = su.extract_roi_signal(frames, landmarks_list, [0, 1, 2, 3])

    assert result.shape == (3, 3)
    assert np.isnan(result[1]).all(), "沒偵測到臉的格應該是 nan"
    # 第 0 格 ROI 內是 (60, 70, 80)，允許邊界像素造成的些微誤差
    assert np.allclose(result[0], [60, 70, 80], atol=3.0)
    assert np.allclose(result[2], [120, 130, 140], atol=3.0)


def test_extract_roi_signal_length_mismatch():
    with pytest.raises(ValueError, match="長度不符"):
        su.extract_roi_signal([np.zeros((10, 10, 3), np.uint8)], [None, None], [0])


def test_interpolate_missing_fills_gaps():
    """缺格內插：中間補線性值，頭尾用最近的有效值延伸。"""
    signal = np.array([np.nan, 1.0, np.nan, 3.0, np.nan])

    result = su.interpolate_missing(signal)

    assert not np.isnan(result).any()
    assert result[2] == pytest.approx(2.0)
    assert result[0] == pytest.approx(1.0)
    assert result[4] == pytest.approx(3.0)


def test_interpolate_missing_all_nan_stays_nan():
    """整條都沒偵測到臉時不要硬編出數字。"""
    result = su.interpolate_missing(np.full(5, np.nan))
    assert np.isnan(result).all()


def test_interpolate_missing_keeps_2d_shape():
    signal = np.array([[1.0, np.nan], [np.nan, 4.0], [3.0, 6.0]])

    result = su.interpolate_missing(signal)

    assert result.shape == (3, 2)
    assert not np.isnan(result).any()


def test_resample_spectrum_matches_contract_length():
    """§4.4 規定 spectrum 是 64 點對應 0-4 Hz。"""
    freqs = np.linspace(0.0, 15.0, 257)
    psd = np.exp(-((freqs - 1.2) ** 2) / 0.01)

    result = su.resample_spectrum(
        freqs, psd, config.RPPG_SPECTRUM_POINTS, config.RPPG_SPECTRUM_MAX_HZ
    )

    assert len(result) == 64
    # 1.2 Hz 的峰重採樣後仍應落在對應的格點附近
    grid = np.linspace(0.0, config.RPPG_SPECTRUM_MAX_HZ, config.RPPG_SPECTRUM_POINTS)
    assert abs(grid[int(np.argmax(result))] - 1.2) < 0.1


def test_resample_curve_fixed_length():
    assert len(su.resample_curve(np.arange(937), 300)) == 300
    assert len(su.resample_curve([], 300)) == 300
    assert su.resample_curve([5.0], 4) == [5.0] * 4


# --------------------------------------------------------------------------
# 執行 `python tests/test_signal_utils.py` 時印出實際數字，方便肉眼確認
# --------------------------------------------------------------------------

if __name__ == "__main__":
    hr, _, _, s = run_pipeline(make_synthetic_signal())
    print(f"目標心率：{TARGET_BPM:.1f} bpm")
    print(f"估算心率：{hr:.2f} bpm")
    print(f"誤差　　：{abs(hr - TARGET_BPM):.2f} bpm")
    print(f"SNR　　 ：{s:.2f} dB")
