"""Track 3｜照明響應的測試。

先驗證 sequence.py 的顏色/亮度/時間查詢邏輯，全部只吃合成的 light_log，
不需要瀏覽器、不需要真實錄影。analyzer.py／geometry.py 的測試會陸續補進來。
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np
import pytest

import config
from track3_photometric import analyzer as an
from track3_photometric import geometry as geo
from track3_photometric import sequence as seq

# --------------------------------------------------------------------------
# 顏色與亮度換算表
# --------------------------------------------------------------------------


def test_color_brightness_has_four_colors_in_valid_range():
    assert set(seq.COLOR_BRIGHTNESS) == {"灰白", "淡綠", "淡紅", "淡藍"}
    for value in seq.COLOR_BRIGHTNESS.values():
        assert 0.0 < value <= 1.0


def test_gray_white_is_brightest():
    """灰白是全反射的參考色，理論上該是四色中最亮的。"""
    assert seq.COLOR_BRIGHTNESS["灰白"] == max(seq.COLOR_BRIGHTNESS.values())


def test_color_hex_covers_same_names_as_brightness():
    assert set(seq.COLOR_HEX) == set(seq.COLOR_BRIGHTNESS)


# --------------------------------------------------------------------------
# light_intensity_at
# --------------------------------------------------------------------------

SAMPLE_LOG = {
    "startTimestamp": 0,
    "segments": [
        {"color": "淡紅", "hex": "#D98080", "startMs": 0, "durationMs": 500},
        {"color": "灰白", "hex": "#E8E8E8", "startMs": 500, "durationMs": 500},
        {"color": "淡藍", "hex": "#8098D9", "startMs": 1000, "durationMs": 500},
    ],
}


def test_light_intensity_at_returns_correct_segment_value():
    assert seq.light_intensity_at(SAMPLE_LOG, 100) == seq.COLOR_BRIGHTNESS["淡紅"]
    assert seq.light_intensity_at(SAMPLE_LOG, 500) == seq.COLOR_BRIGHTNESS["灰白"]
    assert seq.light_intensity_at(SAMPLE_LOG, 1400) == seq.COLOR_BRIGHTNESS["淡藍"]


def test_light_intensity_at_before_start_clamps_to_first_segment():
    assert seq.light_intensity_at(SAMPLE_LOG, -50) == seq.COLOR_BRIGHTNESS["淡紅"]


def test_light_intensity_at_after_end_clamps_to_last_segment():
    assert seq.light_intensity_at(SAMPLE_LOG, 9999) == seq.COLOR_BRIGHTNESS["淡藍"]


def test_light_intensity_at_empty_log_returns_zero():
    assert seq.light_intensity_at({"segments": []}, 100) == 0.0


# --------------------------------------------------------------------------
# sequence_duration_ms / resample_light_curve
# --------------------------------------------------------------------------


def test_sequence_duration_ms_sums_to_last_segment_end():
    assert seq.sequence_duration_ms(SAMPLE_LOG) == 1500.0


def test_sequence_duration_ms_empty_log_is_zero():
    assert seq.sequence_duration_ms({"segments": []}) == 0.0


def test_resample_light_curve_length_and_endpoints():
    curve = seq.resample_light_curve(SAMPLE_LOG, 100)
    assert len(curve) == 100
    assert curve[0] == seq.COLOR_BRIGHTNESS["淡紅"]
    assert curve[-1] == seq.COLOR_BRIGHTNESS["淡藍"]


def test_resample_light_curve_empty_log_returns_zeros():
    assert seq.resample_light_curve({"segments": []}, 10) == [0.0] * 10


# --------------------------------------------------------------------------
# generate_light_log
# --------------------------------------------------------------------------


def test_generate_light_log_matches_config_defaults():
    log = seq.generate_light_log(seed=1)
    segments = log["segments"]
    assert len(segments) == config.PHOTO_SEGMENT_COUNT
    for s in segments:
        assert s["color"] in seq.COLOR_NAMES
        assert s["hex"] == seq.COLOR_HEX[s["color"]]
        assert config.PHOTO_SEGMENT_MIN_MS <= s["durationMs"] <= config.PHOTO_SEGMENT_MAX_MS


def test_generate_light_log_segments_are_contiguous():
    log = seq.generate_light_log(seed=2)
    segments = log["segments"]
    for prev, cur in zip(segments, segments[1:]):
        assert cur["startMs"] == prev["startMs"] + prev["durationMs"]


def test_generate_light_log_seed_is_reproducible():
    log_a = seq.generate_light_log(seed=42)
    log_b = seq.generate_light_log(seed=42)
    assert log_a == log_b


def test_generate_light_log_respects_custom_segment_count():
    log = seq.generate_light_log(num_segments=8, seed=3)
    assert len(log["segments"]) == 8


def test_generate_light_log_covers_all_colors_before_repeating():
    """2026-09-07：段數（config.PHOTO_SEGMENT_COUNT=5）接近顏色數（4）
    時，原本每段各自獨立隨機抽色，容易連續抽到同一色——同色段落對應
    幾乎一樣的亮度（COLOR_BRIGHTNESS），讓拿去跟真人反光曲線算相關
    係數的「標準答案」曲線近乎一直線，真人測試因此反覆量不到相關
    係數。改成前面先把顏色洗牌各出現一次，這裡驗證：只要段數 >=
    顏色種類數，前 len(COLOR_NAMES) 段一定涵蓋全部顏色、不重複，不能
    再連續抽到同一色。用多組不同 seed 測，確保不是單一 seed 剛好通過。
    """
    for seed in range(20):
        log = seq.generate_light_log(seed=seed)
        colors = [s["color"] for s in log["segments"]]
        first_batch = colors[: len(seq.COLOR_NAMES)]
        assert set(first_batch) == set(seq.COLOR_NAMES)
        assert len(first_batch) == len(set(first_batch))


# --------------------------------------------------------------------------
# geometry.py：region_brightness_series
# --------------------------------------------------------------------------


def test_region_brightness_series_reads_correct_area():
    frame = np.zeros((20, 20, 3), dtype=np.uint8)
    frame[0:10, 0:10] = 200
    landmarks = np.zeros((478, 2))
    landmarks[[0, 1, 2, 3]] = [[0, 0], [9, 0], [9, 9], [0, 9]]

    series = geo.region_brightness_series([frame], [landmarks], [0, 1, 2, 3])
    assert series[0] == pytest.approx(200.0, abs=1.0)


def test_region_brightness_series_nan_when_landmarks_missing():
    frame = np.zeros((10, 10, 3), dtype=np.uint8)
    series = geo.region_brightness_series([frame], [None], [0, 1, 2, 3])
    assert np.isnan(series[0])


# --------------------------------------------------------------------------
# geometry.py：segment_response_amplitude
# --------------------------------------------------------------------------


def test_segment_response_amplitude_detects_varying_brightness():
    fps = 10.0
    brightness = np.array([50] * 5 + [100] * 5 + [50] * 5, dtype=np.float64)
    assert geo.segment_response_amplitude(brightness, fps, SAMPLE_LOG) > 0


def test_segment_response_amplitude_zero_for_constant_brightness():
    fps = 10.0
    brightness = np.full(15, 80.0)
    amp = geo.segment_response_amplitude(brightness, fps, SAMPLE_LOG)
    assert amp == pytest.approx(0.0, abs=1e-9)


def test_segment_response_amplitude_tolerates_missing_frames():
    fps = 10.0
    brightness = np.array([50] * 5 + [100] * 5 + [50] * 5, dtype=np.float64)
    brightness[0] = np.nan
    assert geo.segment_response_amplitude(brightness, fps, SAMPLE_LOG) > 0


def test_segment_response_amplitude_too_few_segments_returns_zero():
    single_segment_log = {
        "segments": [{"color": "灰白", "hex": "#E8E8E8", "startMs": 0, "durationMs": 500}]
    }
    amp = geo.segment_response_amplitude(np.array([1.0] * 5), 10.0, single_segment_log)
    assert amp == 0.0


def test_segment_response_amplitude_empty_series_returns_zero():
    assert geo.segment_response_amplitude(np.array([]), 10.0, SAMPLE_LOG) == 0.0


# --------------------------------------------------------------------------
# geometry.py：amplitude_dispersion_score
# --------------------------------------------------------------------------


def test_amplitude_dispersion_score_high_when_amplitudes_vary():
    assert geo.amplitude_dispersion_score([1.0, 1.0, 1.0, 20.0]) > 0.5


def test_amplitude_dispersion_score_low_when_amplitudes_uniform():
    assert geo.amplitude_dispersion_score([10.0, 10.1, 9.9, 10.0]) < 0.2


def test_amplitude_dispersion_score_zero_when_no_signal():
    assert geo.amplitude_dispersion_score([0.0, 0.0, 0.0, 0.0]) == 0.0


def test_amplitude_dispersion_score_clamped_to_one():
    assert geo.amplitude_dispersion_score([0.001, 0.001, 0.001, 1000.0]) == 1.0


def test_amplitude_dispersion_score_too_few_amplitudes_returns_zero():
    assert geo.amplitude_dispersion_score([5.0]) == 0.0
    assert geo.amplitude_dispersion_score([]) == 0.0


# --------------------------------------------------------------------------
# geometry.py：check_stereo_geometry（合成多區塊影格，端到端跑一次管線）
# --------------------------------------------------------------------------

REGION_RECTS = {
    "forehead": (0, 0, 25, 25),
    "nose_bridge": (25, 0, 50, 25),
    "left_cheek": (50, 0, 75, 25),
    "right_cheek": (75, 0, 100, 25),
}


def _make_region_frame(size, rects, region_values):
    """建一張合成影格：畫面切成不重疊矩形色塊，每塊填指定灰階值。"""
    frame = np.zeros((size, size, 3), dtype=np.uint8)
    for name, (x0, y0, x1, y1) in rects.items():
        frame[y0:y1, x0:x1] = region_values[name]
    return frame


def _make_region_landmarks(rects):
    """建一份 478 點假 landmarks，把每個幾何區域的索引都塞進對應矩形的角落，
    讓 region_brightness_series 能圈出正確範圍（不需要真的 MediaPipe 拓撲）。
    """
    landmarks = np.zeros((478, 2), dtype=np.float64)
    for name, indices in geo.GEOMETRY_REGIONS.items():
        x0, y0, x1, y1 = rects[name]
        corners = [(x0 + 1, y0 + 1), (x1 - 1, y0 + 1), (x1 - 1, y1 - 1), (x0 + 1, y1 - 1)]
        for i, idx in enumerate(indices):
            landmarks[idx] = corners[i % len(corners)]
    return landmarks


def _build_frames(values_per_segment, fps=10.0):
    landmarks = _make_region_landmarks(REGION_RECTS)
    frames_per_segment = 5  # SAMPLE_LOG 三段各 500ms @ fps=10
    frames = []
    for seg_i in range(3):
        for _ in range(frames_per_segment):
            values = {name: values_per_segment[name][seg_i] for name in REGION_RECTS}
            frames.append(_make_region_frame(100, REGION_RECTS, values))
    return frames, [landmarks] * len(frames)


def test_check_stereo_geometry_scores_higher_for_dispersed_amplitudes():
    """立體臉模擬：各區反應幅度差很多，geometryScore 應該比平面翻拍模擬高。"""
    dispersed_frames, landmarks_list = _build_frames(
        {
            "forehead": [50, 130, 50],      # 反應幅度大
            "nose_bridge": [80, 82, 80],    # 幾乎不變
            "left_cheek": [60, 100, 60],    # 中等反應
            "right_cheek": [70, 71, 70],    # 幾乎不變
        }
    )
    dispersed_score = geo.check_stereo_geometry(
        dispersed_frames, landmarks_list, SAMPLE_LOG, 10.0
    )

    uniform_frames, _ = _build_frames(
        {
            "forehead": [50, 90, 50],
            "nose_bridge": [50, 91, 50],
            "left_cheek": [50, 89, 50],
            "right_cheek": [50, 90, 50],
        }
    )
    uniform_score = geo.check_stereo_geometry(
        uniform_frames, landmarks_list, SAMPLE_LOG, 10.0
    )

    assert dispersed_score > uniform_score


# --------------------------------------------------------------------------
# analyzer.py：_cross_correlate（純數學，合成訊號，不需要影格/landmarks）
# --------------------------------------------------------------------------


def test_cross_correlate_zero_lag_high_correlation_for_identical_signal():
    fps = 30.0
    t = np.arange(150)
    light = np.sin(2 * np.pi * t / 25)
    reflect = light.copy()

    correlation, latency_ms = an._cross_correlate(reflect, light, fps)
    assert correlation > 0.95
    assert abs(latency_ms) < 1000.0 / fps  # 落在一格以內


def test_cross_correlate_finds_known_positive_lag():
    fps = 30.0
    t = np.arange(200)
    light = np.sin(2 * np.pi * t / 25)
    lag_frames = 5
    reflect = np.roll(light, lag_frames)  # reflect 比 light 晚 lag_frames 格

    correlation, latency_ms = an._cross_correlate(reflect, light, fps)
    assert correlation > 0.9
    assert latency_ms == pytest.approx(lag_frames / fps * 1000.0, abs=1000.0 / fps)


def test_cross_correlate_zero_for_constant_reflect():
    fps = 30.0
    reflect = np.full(50, 100.0)
    light = np.sin(np.arange(50))
    correlation, latency_ms = an._cross_correlate(reflect, light, fps)
    assert correlation == 0.0
    assert latency_ms == 0.0


def test_cross_correlate_low_for_unrelated_signals():
    fps = 30.0
    rng = np.random.default_rng(0)
    light = np.sin(2 * np.pi * np.arange(150) / 25)
    reflect = rng.normal(size=150)

    correlation, _ = an._cross_correlate(reflect, light, fps)
    assert correlation < 0.5


# --------------------------------------------------------------------------
# analyzer.py：_fill_missing / _normalize_series / _resample
# --------------------------------------------------------------------------


def test_fill_missing_interpolates_nan():
    filled = an._fill_missing(np.array([1.0, np.nan, 3.0]))
    assert filled[1] == pytest.approx(2.0)


def test_fill_missing_all_nan_returns_unchanged():
    filled = an._fill_missing(np.array([np.nan, np.nan]))
    assert np.isnan(filled).all()


def test_normalize_series_maps_to_zero_one():
    norm = an._normalize_series(np.array([10.0, 20.0, 30.0]))
    assert norm[0] == pytest.approx(0.0)
    assert norm[-1] == pytest.approx(1.0)


def test_normalize_series_constant_returns_zeros():
    norm = an._normalize_series(np.array([5.0, 5.0, 5.0]))
    assert (norm == 0.0).all()


def test_resample_output_length_matches_points():
    out = an._resample(np.array([0.0, 1.0, 0.0]), 10)
    assert len(out) == 10


# --------------------------------------------------------------------------
# analyzer.py：analyze_photometric（端到端，合成多區塊影格 + monkeypatch landmarks）
# --------------------------------------------------------------------------


def test_analyze_photometric_empty_frames_returns_empty_result():
    result = an.analyze_photometric([], 30.0, seq.generate_light_log(seed=1))
    assert result["detected"] is False
    assert result["checks"] == [{"label": label, "passed": False} for label in an.CHECK_LABELS]


def test_analyze_photometric_insufficient_segments_returns_empty_result():
    frame = np.zeros((10, 10, 3), dtype=np.uint8)
    one_segment_log = {
        "segments": [{"color": "灰白", "hex": "#E8E8E8", "startMs": 0, "durationMs": 500}]
    }
    result = an.analyze_photometric([frame], 30.0, one_segment_log)
    assert result["detected"] is False


def test_analyze_photometric_detects_synced_dispersed_reflection(monkeypatch):
    """立體臉模擬：反射亮度跟著 light_log 走、各區反應幅度分散 → 三項判定應全過。"""
    fps = 30.0
    light_log = seq.generate_light_log(seed=7)
    n_frames = int(seq.sequence_duration_ms(light_log) / 1000.0 * fps)

    landmarks = _make_region_landmarks(REGION_RECTS)
    monkeypatch.setattr(
        an, "extract_landmarks", lambda frames, fps: [landmarks] * len(frames)
    )

    amplitudes = {"forehead": 40, "nose_bridge": 5, "left_cheek": 25, "right_cheek": 2}
    frames = []
    for i in range(n_frames):
        light_val = seq.light_intensity_at(light_log, i / fps * 1000.0)
        values = {name: 120 + amplitudes[name] * light_val for name in REGION_RECTS}
        frames.append(_make_region_frame(100, REGION_RECTS, values))

    result = an.analyze_photometric(frames, fps, light_log)

    assert result["correlation"] > config.PHOTO_CORRELATION_MIN
    assert result["checks"][0]["passed"] is True
    assert result["checks"][1]["passed"] is True
    assert result["geometryScore"] > config.PHOTO_GEOMETRY_MIN
    assert result["detected"] is True
    assert len(result["lightCurve"]) == config.PHOTO_CURVE_POINTS
    assert len(result["reflectCurve"]) == config.PHOTO_CURVE_POINTS
    assert len(result["sequence"]) == len(light_log["segments"])
    assert result["confidenceScore"] < 0.5, "三項都清楚過關，信心分數該偏低風險"


def test_analyze_photometric_rejects_unrelated_reflection(monkeypatch):
    """反射亮度跟 light_log 無關（純雜訊）→ 相關係數判定不該過，detected 為 False。"""
    fps = 30.0
    light_log = seq.generate_light_log(seed=8)
    n_frames = int(seq.sequence_duration_ms(light_log) / 1000.0 * fps)

    landmarks = _make_region_landmarks(REGION_RECTS)
    monkeypatch.setattr(
        an, "extract_landmarks", lambda frames, fps: [landmarks] * len(frames)
    )

    rng = np.random.default_rng(1)
    frames = []
    for _ in range(n_frames):
        values = {name: 120 + rng.normal(scale=2.0) for name in REGION_RECTS}
        frames.append(_make_region_frame(100, REGION_RECTS, values))

    result = an.analyze_photometric(frames, fps, light_log)

    assert result["checks"][0]["passed"] is False
    assert result["detected"] is False
    assert result["confidenceScore"] > 0.5, "相關係數沒過，信心分數該偏高風險"


def test_analyze_photometric_rejects_large_negative_latency(monkeypatch):
    """2026-09-09：真人測試（applicant 1770，虛擬攝影機注入攻擊）量到
    -400.35ms 卻被舊版 abs() 判定合理放行——反射「領先」光源變化一大截
    在物理上不合理（見 _cross_correlate() 的說明：正值代表反射晚於
    光源變化）。這裡合成一個反射訊號提前 300ms 就對到未來的光值（等於
    「預知」光還沒發生的變化），相關係數本身很高（曲線形狀吻合），
    但延遲判定該擋下來。"""
    fps = 30.0
    light_log = seq.generate_light_log(seed=9)
    n_frames = int(seq.sequence_duration_ms(light_log) / 1000.0 * fps)

    landmarks = _make_region_landmarks(REGION_RECTS)
    monkeypatch.setattr(
        an, "extract_landmarks", lambda frames, fps: [landmarks] * len(frames)
    )

    amplitudes = {"forehead": 40, "nose_bridge": 5, "left_cheek": 25, "right_cheek": 2}
    lead_ms = 300.0
    frames = []
    for i in range(n_frames):
        light_val = seq.light_intensity_at(light_log, i / fps * 1000.0 + lead_ms)
        values = {name: 120 + amplitudes[name] * light_val for name in REGION_RECTS}
        frames.append(_make_region_frame(100, REGION_RECTS, values))

    result = an.analyze_photometric(frames, fps, light_log)

    assert result["correlation"] > config.PHOTO_CORRELATION_MIN, "曲線形狀吻合，相關係數本身該是高的"
    assert result["checks"][1]["passed"] is False, "延遲判定該擋下大幅負延遲"
    assert result["detected"] is False


def test_analyze_photometric_tolerates_small_negative_latency(monkeypatch):
    """小幅負延遲（量測雜訊範圍內，PHOTO_LATENCY_MIN_MS 以內）不該被誤殺，
    維持修法前 abs() 設計原本要保護的情境。"""
    fps = 30.0
    light_log = seq.generate_light_log(seed=10)
    n_frames = int(seq.sequence_duration_ms(light_log) / 1000.0 * fps)

    landmarks = _make_region_landmarks(REGION_RECTS)
    monkeypatch.setattr(
        an, "extract_landmarks", lambda frames, fps: [landmarks] * len(frames)
    )

    amplitudes = {"forehead": 40, "nose_bridge": 5, "left_cheek": 25, "right_cheek": 2}
    lead_ms = abs(config.PHOTO_LATENCY_MIN_MS) / 2  # 明顯小於容忍上限
    frames = []
    for i in range(n_frames):
        light_val = seq.light_intensity_at(light_log, i / fps * 1000.0 + lead_ms)
        values = {name: 120 + amplitudes[name] * light_val for name in REGION_RECTS}
        frames.append(_make_region_frame(100, REGION_RECTS, values))

    result = an.analyze_photometric(frames, fps, light_log)

    assert result["checks"][1]["passed"] is True, "小幅負延遲不該被誤殺"
