"""Track 4｜遮擋一致性的測試。

先驗證 identity.py 的純數學部分，全部用合成嵌入向量，不需要攝影機、
不需要真人影片。hand_tracking.py／analyzer.py 的測試會陸續補進來。
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np
import pytest

import config
from track4_occlusion import analyzer as an
from track4_occlusion import hand_tracking as ht
from track4_occlusion import identity


def _unit(v):
    v = np.array(v, dtype=np.float64)
    return v / np.linalg.norm(v)


IDENTITY_A = _unit([1.0, 0.0, 0.0])
IDENTITY_B = _unit([0.0, 1.0, 0.0])  # 跟 A 正交，代表完全不同的人


def _face(embedding):
    return {"bbox": np.zeros(4), "embedding": embedding}


# --------------------------------------------------------------------------
# cosine_similarity
# --------------------------------------------------------------------------


def test_cosine_similarity_identical_is_one():
    assert identity.cosine_similarity(IDENTITY_A, IDENTITY_A) == pytest.approx(1.0)


def test_cosine_similarity_orthogonal_is_zero():
    assert identity.cosine_similarity(IDENTITY_A, IDENTITY_B) == pytest.approx(0.0)


def test_cosine_similarity_clips_negative_to_zero():
    assert identity.cosine_similarity(IDENTITY_A, -IDENTITY_A) == 0.0


# --------------------------------------------------------------------------
# compute_stability_curve（顯示用曲線，缺格填 0.0）
# --------------------------------------------------------------------------


def test_compute_stability_curve_length_matches_contract():
    face_data = [_face(IDENTITY_A)] * 5
    curve = identity.compute_stability_curve(face_data)
    assert len(curve) == 4


def test_compute_stability_curve_fills_zero_at_gaps():
    face_data = [_face(IDENTITY_A), _face(IDENTITY_A), None, None, _face(IDENTITY_A)]
    curve = identity.compute_stability_curve(face_data)
    assert curve[0] == pytest.approx(1.0)  # 0→1 都有效
    assert curve[1] == 0.0                 # 1→2，第 2 格缺
    assert curve[2] == 0.0                 # 2→3，兩格都缺
    assert curve[3] == 0.0                 # 3→4，第 3 格缺


# --------------------------------------------------------------------------
# valid_transition_similarities（真正的判定依據，跳過缺格比較）
# --------------------------------------------------------------------------


def test_valid_transition_similarities_skips_gap_same_identity():
    face_data = [_face(IDENTITY_A), None, None, _face(IDENTITY_A)]
    transitions = identity.valid_transition_similarities(face_data)
    assert len(transitions) == 1
    idx, sim = transitions[0]
    assert idx == 3
    assert sim == pytest.approx(1.0)


def test_valid_transition_similarities_detects_swap_across_gap():
    face_data = [_face(IDENTITY_A), None, None, _face(IDENTITY_B)]
    transitions = identity.valid_transition_similarities(face_data)
    idx, sim = transitions[0]
    assert idx == 3
    assert sim == pytest.approx(0.0)


def test_valid_transition_similarities_too_few_valid_returns_empty():
    assert identity.valid_transition_similarities([_face(IDENTITY_A), None, None]) == []
    assert identity.valid_transition_similarities([None, None]) == []


# --------------------------------------------------------------------------
# max_identity_drop / identity_stability / find_anomaly_frames
# --------------------------------------------------------------------------


def test_max_identity_drop_picks_lowest_transition():
    transitions = [(1, 0.95), (2, 0.4), (3, 0.9)]
    assert identity.max_identity_drop(transitions) == pytest.approx(0.6)


def test_max_identity_drop_empty_is_conservative_one():
    assert identity.max_identity_drop([]) == 1.0


def test_identity_stability_averages_transitions():
    transitions = [(1, 0.9), (2, 0.8), (3, 1.0)]
    assert identity.identity_stability(transitions) == pytest.approx(0.9)


def test_identity_stability_empty_is_conservative_zero():
    assert identity.identity_stability([]) == 0.0


def test_find_anomaly_frames_detects_drop_above_threshold():
    transitions = [(1, 0.95), (2, 0.4), (3, 0.92)]
    assert identity.find_anomaly_frames(transitions, threshold=0.2) == [2]


def test_find_anomaly_frames_empty_when_all_stable():
    transitions = [(1, 0.95), (2, 0.93)]
    assert identity.find_anomaly_frames(transitions, threshold=0.2) == []


# --------------------------------------------------------------------------
# extract_face_data（真的跑 InsightFace，只驗證管線不會爆、無臉時回傳 None）
# --------------------------------------------------------------------------


def test_extract_face_data_returns_none_for_blank_frames():
    frame = np.zeros((100, 100, 3), dtype=np.uint8)
    results = identity.extract_face_data([frame, frame])
    assert results == [None, None]


# --------------------------------------------------------------------------
# hand_tracking.py：expand_bbox / _is_inside / _bbox_intersection（純數學）
# --------------------------------------------------------------------------


def test_expand_bbox_expands_each_side_by_margin_ratio():
    result = ht.expand_bbox((10, 10, 20, 30), margin=0.5)
    assert result == pytest.approx((5, 0, 25, 40))


def test_bbox_intersection_overlapping():
    assert ht._bbox_intersection((0, 0, 10, 10), (5, 5, 15, 15)) == (5, 5, 10, 10)


def test_bbox_intersection_no_overlap_returns_none():
    assert ht._bbox_intersection((0, 0, 5, 5), (10, 10, 15, 15)) is None


# --------------------------------------------------------------------------
# hand_tracking.py：detect_wave_cycles
# --------------------------------------------------------------------------

FACE_REGION = (0, 0, 10, 10)
OUTSIDE_POINT = np.array([100, 100])
INSIDE_POINT = np.array([5, 5])


def _hand(center, bbox=(0, 0, 1, 1)):
    return {"center": center, "bbox": bbox} if center is not None else None


def test_detect_wave_cycles_counts_complete_cycles():
    centers = [
        OUTSIDE_POINT, OUTSIDE_POINT,       # 尚未進入
        INSIDE_POINT, INSIDE_POINT,         # 第一次遮擋
        OUTSIDE_POINT, OUTSIDE_POINT,       # 露出來
        INSIDE_POINT, INSIDE_POINT,         # 第二次遮擋
        OUTSIDE_POINT,                      # 再度露出
    ]
    hand_data = [_hand(c) for c in centers]
    assert ht.detect_wave_cycles(hand_data, FACE_REGION) == [[2, 4], [6, 8]]


def test_detect_wave_cycles_ignores_trailing_incomplete_entry():
    centers = [OUTSIDE_POINT, INSIDE_POINT, INSIDE_POINT, INSIDE_POINT]
    hand_data = [_hand(c) for c in centers]
    assert ht.detect_wave_cycles(hand_data, FACE_REGION) == []


def test_detect_wave_cycles_treats_missing_detection_as_outside():
    hand_data = [_hand(INSIDE_POINT), None, _hand(INSIDE_POINT)]
    # frame0 進入,frame1（缺偵測→視為離開）結束第一段;frame2 再進入但沒收尾,不算
    assert ht.detect_wave_cycles(hand_data, FACE_REGION) == [[0, 1]]


# --------------------------------------------------------------------------
# hand_tracking.py：_region_mean_color / layer_consistency_score
# --------------------------------------------------------------------------


def test_region_mean_color_reads_correct_block():
    frame = np.zeros((20, 20, 3), dtype=np.uint8)
    frame[0:10, 0:10] = [200, 50, 50]
    color = ht._region_mean_color(frame, (0, 0, 10, 10))
    assert np.allclose(color, [200, 50, 50], atol=1.0)


def test_region_mean_color_out_of_bounds_returns_none():
    frame = np.zeros((10, 10, 3), dtype=np.uint8)
    assert ht._region_mean_color(frame, (20, 20, 30, 30)) is None


def _make_face_frame(size, face_region, face_color, overlap_bbox=None, overlap_color=None):
    frame = np.zeros((size, size, 3), dtype=np.uint8)
    x1, y1, x2, y2 = [int(v) for v in face_region]
    frame[y1:y2, x1:x2] = face_color
    if overlap_bbox is not None:
        ox1, oy1, ox2, oy2 = [int(v) for v in overlap_bbox]
        frame[oy1:oy2, ox1:ox2] = overlap_color
    return frame


def test_layer_consistency_score_high_when_occluder_color_differs_from_face():
    """真的有東西（顏色明顯不同）擋住臉 → layerScore 應該高。"""
    face_region = (0, 0, 40, 40)
    hand_bbox = (10, 10, 30, 30)
    skin_color = [200, 150, 120]
    hand_color = [30, 30, 200]

    frames = [
        _make_face_frame(50, face_region, skin_color),
        _make_face_frame(50, face_region, skin_color, hand_bbox, hand_color),
        _make_face_frame(50, face_region, skin_color),
    ]
    hand_data = [None, {"center": np.array([20, 20]), "bbox": hand_bbox}, None]
    segments = [[1, 2]]

    score = ht.layer_consistency_score(frames, hand_data, face_region, segments)
    assert score > 0.5


def test_layer_consistency_score_low_when_face_leaks_through():
    """重疊區域顏色還是跟臉一樣 → 換臉管線斷裂的破綻 → layerScore 應該低。"""
    face_region = (0, 0, 40, 40)
    hand_bbox = (10, 10, 30, 30)
    skin_color = [200, 150, 120]

    frames = [
        _make_face_frame(50, face_region, skin_color),
        _make_face_frame(50, face_region, skin_color, hand_bbox, skin_color),
        _make_face_frame(50, face_region, skin_color),
    ]
    hand_data = [None, {"center": np.array([20, 20]), "bbox": hand_bbox}, None]
    segments = [[1, 2]]

    score = ht.layer_consistency_score(frames, hand_data, face_region, segments)
    assert score < 0.2


def test_layer_consistency_score_zero_when_no_segments():
    frames = [np.zeros((10, 10, 3), dtype=np.uint8)]
    assert ht.layer_consistency_score(frames, [None], (0, 0, 5, 5), []) == 0.0


# --------------------------------------------------------------------------
# hand_tracking.py：extract_hand_landmarks（真的跑 MediaPipe Hands）
# --------------------------------------------------------------------------


requires_hand_model = pytest.mark.skipif(
    not config.MEDIAPIPE_HAND_MODEL.exists(),
    reason=f"缺少 MediaPipe Hand 模型檔：{config.MEDIAPIPE_HAND_MODEL}",
)


@requires_hand_model
def test_extract_hand_landmarks_returns_none_for_blank_frames():
    frame = np.zeros((100, 100, 3), dtype=np.uint8)
    results = ht.extract_hand_landmarks([frame, frame], fps=30.0)
    assert results == [None, None]


# --------------------------------------------------------------------------
# analyzer.py：_reference_face_region
# --------------------------------------------------------------------------


def _identity_face(embedding, bbox=(20, 20, 60, 60)):
    return {"bbox": np.array(bbox, dtype=np.float64), "embedding": embedding}


def test_reference_face_region_none_without_valid_detections():
    assert an._reference_face_region([None, None]) is None


def test_reference_face_region_computes_median_and_expands():
    face_data = [_identity_face(IDENTITY_A, bbox=(0, 0, 10, 10))] * 2
    region = an._reference_face_region(face_data)
    assert region == pytest.approx(ht.expand_bbox((0, 0, 10, 10), config.OCC_FACE_REGION_MARGIN))


# --------------------------------------------------------------------------
# analyzer.py：analyze_occlusion（端到端，合成 25 格「兩次揮手遮擋」情境）
# --------------------------------------------------------------------------

FACE_REGION_RAW = (20, 20, 60, 60)
OCC_SKIN_COLOR = [200, 150, 120]
OCC_HAND_COLOR = [30, 30, 200]
OCC_HAND_BBOX = (30, 30, 50, 50)  # 落在 FACE_REGION_RAW 擴張後的範圍內

# 0-4 可見、5-9 遮擋（第一次循環）、10-14 可見、
# 15-19 遮擋（第二次循環）、20-24 可見 —— 共兩次完整揮手循環
_VISIBLE_RANGES = [(0, 5), (10, 15), (20, 25)]
_OCCLUDED_RANGES = [(5, 10), (15, 20)]


def _make_occlusion_frame(size, face_color, overlap_bbox=None, overlap_color=None):
    """整張畫面先填臉色當背景，避免 analyzer 內部用擴張過的參考框取樣時，
    取到畫面裡沒特別上色、還是黑色的邊緣像素，稀釋掉參考色（真的踩過
    這個坑：第一版只塗 FACE_REGION_RAW 那塊，擴張框取樣到旁邊黑色像素，
    參考色被稀釋到不成比例，讓「臉透出來」的測試案例算出錯誤的高分）。
    """
    frame = np.full((size, size, 3), face_color, dtype=np.uint8)
    if overlap_bbox is not None:
        ox1, oy1, ox2, oy2 = [int(v) for v in overlap_bbox]
        frame[oy1:oy2, ox1:ox2] = overlap_color
    return frame


def _build_occlusion_scenario(embedding_before, embedding_after, hand_color=OCC_HAND_COLOR):
    frames, face_data, hand_data = [], [], []
    for i in range(25):
        occluded = any(s <= i < e for s, e in _OCCLUDED_RANGES)
        if occluded:
            face_data.append(None)
            hand_data.append({"center": np.array([40.0, 40.0]), "bbox": OCC_HAND_BBOX})
            frames.append(_make_occlusion_frame(100, OCC_SKIN_COLOR, OCC_HAND_BBOX, hand_color))
        else:
            embedding = embedding_before if i < 10 else embedding_after
            face_data.append(_identity_face(embedding, bbox=FACE_REGION_RAW))
            hand_data.append(None)
            frames.append(_make_occlusion_frame(100, OCC_SKIN_COLOR))
    return frames, face_data, hand_data


def test_analyze_occlusion_detects_consistent_real_wave(monkeypatch):
    """真人揮手模擬：身分全程一致、遮擋物顏色明顯不同於臉 → 三項判定應全過。"""
    frames, face_data, hand_data = _build_occlusion_scenario(IDENTITY_A, IDENTITY_A)
    monkeypatch.setattr(an.idt, "extract_face_data", lambda frames: face_data)
    monkeypatch.setattr(an.ht, "extract_hand_landmarks", lambda frames, fps: hand_data)

    result = an.analyze_occlusion(frames, 30.0)

    assert result["waveCyclesDetected"] == 2
    assert result["checks"][0]["passed"] is True
    assert result["identityStability"] > config.OCC_IDENTITY_STABILITY_MIN
    assert result["maxIdentityDrop"] < config.OCC_MAX_DROP_THRESHOLD
    assert result["checks"][1]["passed"] is True
    assert result["layerScore"] > config.OCC_LAYER_SCORE_MIN
    assert result["checks"][2]["passed"] is True
    assert result["detected"] is True
    assert len(result["stabilityCurve"]) == len(frames) - 1


def test_analyze_occlusion_rejects_identity_swap_during_occlusion(monkeypatch):
    """遮擋前後身分不一樣（即時換臉在遮擋時管線斷裂）→ 身分連續性判定應失敗。"""
    frames, face_data, hand_data = _build_occlusion_scenario(IDENTITY_A, IDENTITY_B)
    monkeypatch.setattr(an.idt, "extract_face_data", lambda frames: face_data)
    monkeypatch.setattr(an.ht, "extract_hand_landmarks", lambda frames, fps: hand_data)

    result = an.analyze_occlusion(frames, 30.0)

    assert result["checks"][1]["passed"] is False
    assert result["detected"] is False


def test_analyze_occlusion_rejects_face_leaking_through_hand(monkeypatch):
    """遮擋區域顏色還是跟臉一樣（臉透出來）→ 層級判定應失敗。"""
    frames, face_data, hand_data = _build_occlusion_scenario(
        IDENTITY_A, IDENTITY_A, hand_color=OCC_SKIN_COLOR
    )
    monkeypatch.setattr(an.idt, "extract_face_data", lambda frames: face_data)
    monkeypatch.setattr(an.ht, "extract_hand_landmarks", lambda frames, fps: hand_data)

    result = an.analyze_occlusion(frames, 30.0)

    assert result["checks"][2]["passed"] is False
    assert result["detected"] is False


def test_analyze_occlusion_rejects_no_waving(monkeypatch):
    """手從沒進入臉部區域 → 循環數判定應失敗。"""
    n = 25
    face_data = [_identity_face(IDENTITY_A, bbox=FACE_REGION_RAW) for _ in range(n)]
    hand_data = [None] * n
    frames = [_make_face_frame(100, FACE_REGION_RAW, OCC_SKIN_COLOR) for _ in range(n)]
    monkeypatch.setattr(an.idt, "extract_face_data", lambda frames: face_data)
    monkeypatch.setattr(an.ht, "extract_hand_landmarks", lambda frames, fps: hand_data)

    result = an.analyze_occlusion(frames, 30.0)

    assert result["waveCyclesDetected"] == 0
    assert result["checks"][0]["passed"] is False
    assert result["detected"] is False


def test_analyze_occlusion_empty_frames_returns_empty_result():
    result = an.analyze_occlusion([], 30.0)
    assert result["detected"] is False
    assert result["checks"] == [{"label": label, "passed": False} for label in an.CHECK_LABELS]
