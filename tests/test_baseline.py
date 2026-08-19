"""對照組（baseline_challenge）的測試。

眨眼／轉頭的判定邏輯用合成 landmark 座標驗證，揮手重用 Track 4 已經
驗證過的邏輯（這裡只驗證 wiring 正確，不重覆驗證循環偵測本身）。
最後端到端測試四動作組合，全部用 monkeypatch 掉真正的 MediaPipe/
InsightFace 呼叫，不需要攝影機或真人影片。
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np
import pytest

import config
from baseline_challenge import analyzer as ba


def _make_landmarks(overrides, size=478):
    lm = np.zeros((size, 2))
    for idx, point in overrides.items():
        lm[idx] = point
    return lm


# --------------------------------------------------------------------------
# 眨眼：_average_ear / _has_blink_pattern
# --------------------------------------------------------------------------


def _eye_points(indices, half_open, horizontal=10.0, x0=0.0):
    p1i, p2i, p3i, p4i, p5i, p6i = indices
    return {
        p1i: np.array([x0, 0.0]),
        p4i: np.array([x0 + horizontal, 0.0]),
        p2i: np.array([x0 + horizontal * 0.3, -half_open]),
        p3i: np.array([x0 + horizontal * 0.7, -half_open]),
        p6i: np.array([x0 + horizontal * 0.3, half_open]),
        p5i: np.array([x0 + horizontal * 0.7, half_open]),
    }


def _eyes_landmarks(half_open):
    overrides = {}
    overrides.update(_eye_points(ba.RIGHT_EYE_INDICES, half_open))
    overrides.update(_eye_points(ba.LEFT_EYE_INDICES, half_open, x0=100.0))
    return _make_landmarks(overrides)


def test_average_ear_higher_when_eyes_open_than_closed():
    open_ear = ba._average_ear(_eyes_landmarks(half_open=3.0))
    closed_ear = ba._average_ear(_eyes_landmarks(half_open=0.3))
    assert open_ear > closed_ear
    assert closed_ear < config.BASELINE_EAR_THRESHOLD
    assert open_ear > config.BASELINE_EAR_THRESHOLD


def test_has_blink_pattern_detects_close_then_open():
    ear_values = np.array([0.35, 0.34, 0.10, 0.09, 0.33, 0.34])
    assert ba._has_blink_pattern(ear_values, config.BASELINE_EAR_THRESHOLD) is True


def test_has_blink_pattern_false_when_never_closes():
    ear_values = np.array([0.35, 0.34, 0.33, 0.32])
    assert ba._has_blink_pattern(ear_values, config.BASELINE_EAR_THRESHOLD) is False


def test_has_blink_pattern_false_when_stays_closed():
    ear_values = np.array([0.35, 0.10, 0.09, 0.08])
    assert ba._has_blink_pattern(ear_values, config.BASELINE_EAR_THRESHOLD) is False


def test_has_blink_pattern_ignores_nan_gaps():
    ear_values = np.array([0.35, np.nan, 0.10, np.nan, 0.33])
    assert ba._has_blink_pattern(ear_values, config.BASELINE_EAR_THRESHOLD) is True


def test_has_blink_pattern_too_few_valid_returns_false():
    ear_values = np.array([np.nan, np.nan, 0.10])
    assert ba._has_blink_pattern(ear_values, config.BASELINE_EAR_THRESHOLD) is False


# --------------------------------------------------------------------------
# 轉頭：_yaw_ratio
#
# 這裡只驗證數學本身的方向一致性（鼻尖偏兩側該給相反正負號、對稱），
# 不驗證這對應真實世界的左轉或右轉——那需要真實影片才能確認，
# 見 baseline_challenge/analyzer.py 頂部說明。
# --------------------------------------------------------------------------


def _yaw_landmarks(nose_offset):
    overrides = {
        ba.LEFT_FACE_EDGE_INDEX: np.array([-10.0, 0.0]),
        ba.RIGHT_FACE_EDGE_INDEX: np.array([10.0, 0.0]),
        ba.NOSE_TIP_INDEX: np.array([nose_offset, 0.0]),
    }
    return _make_landmarks(overrides)


def test_yaw_ratio_zero_when_nose_centered():
    assert ba._yaw_ratio(_yaw_landmarks(0.0)) == pytest.approx(0.0, abs=1e-9)


def test_yaw_ratio_opposite_sign_for_opposite_offsets():
    toward_left_edge = ba._yaw_ratio(_yaw_landmarks(-5.0))
    toward_right_edge = ba._yaw_ratio(_yaw_landmarks(5.0))
    assert toward_left_edge > 0
    assert toward_right_edge < 0
    assert toward_left_edge == pytest.approx(-toward_right_edge)


def test_check_turn_left_and_right_respond_oppositely(monkeypatch):
    landmarks_list = [_yaw_landmarks(-5.0)] * 5
    monkeypatch.setattr(ba, "extract_landmarks", lambda frames, fps: landmarks_list)

    left_passed = ba._check_turn_left([None] * 5, 30.0)
    right_passed = ba._check_turn_right([None] * 5, 30.0)

    assert left_passed != right_passed


# --------------------------------------------------------------------------
# 揮手：_check_wave_hand（重用 Track 4，只驗證 wiring）
# --------------------------------------------------------------------------


def test_check_wave_hand_true_when_two_cycles_detected(monkeypatch):
    face_bbox = np.array([0.0, 0.0, 10.0, 10.0])
    inside, outside = np.array([5.0, 5.0]), np.array([100.0, 100.0])
    # out, in, out, in, out -> 2 個完整循環
    face_data = [{"bbox": face_bbox, "embedding": np.zeros(3)}, None,
                 {"bbox": face_bbox, "embedding": np.zeros(3)}, None,
                 {"bbox": face_bbox, "embedding": np.zeros(3)}]
    hand_data = [None, {"center": inside, "bbox": (4.0, 4.0, 6.0, 6.0)},
                 None, {"center": inside, "bbox": (4.0, 4.0, 6.0, 6.0)}, None]

    monkeypatch.setattr(ba.idt, "extract_face_data", lambda frames: face_data)
    monkeypatch.setattr(ba.ht, "extract_hand_landmarks", lambda frames, fps: hand_data)

    assert ba._check_wave_hand([None] * 5, 30.0) is True


def test_check_wave_hand_false_when_no_face_detected(monkeypatch):
    monkeypatch.setattr(ba.idt, "extract_face_data", lambda frames: [None, None])
    monkeypatch.setattr(ba.ht, "extract_hand_landmarks", lambda frames, fps: [None, None])
    assert ba._check_wave_hand([None] * 2, 30.0) is False


# --------------------------------------------------------------------------
# analyze_baseline：端到端，四動作合成情境
#
# 用 fps=1.0 讓 durationSec 直接等於格數（3/5/5/7 秒 -> 3/5/5/7 格），
# 方便手動構造合成資料，不代表真實 fps。
# --------------------------------------------------------------------------

CHALLENGES_ORDER = [
    {"action": "blink", "durationSec": 3},
    {"action": "turn_left", "durationSec": 5},
    {"action": "turn_right", "durationSec": 5},
    {"action": "wave_hand", "durationSec": 7},
]

_WAVE_FACE_BBOX = np.array([0.0, 0.0, 10.0, 10.0])
_WAVE_INSIDE = np.array([5.0, 5.0])


def _build_all_pass_scenario():
    landmarks = {}
    landmarks[0] = _eyes_landmarks(half_open=3.0)   # 睜眼
    landmarks[1] = _eyes_landmarks(half_open=0.3)   # 閉眼
    landmarks[2] = _eyes_landmarks(half_open=3.0)   # 再睜開 -> 完整一次眨眼
    for i in range(3, 8):
        landmarks[i] = _yaw_landmarks(5.0)           # turn_left 視窗，比例為負（真實驗證過的方向）
    for i in range(8, 13):
        landmarks[i] = _yaw_landmarks(-5.0)          # turn_right 視窗，比例為正

    face_data, hand_data = {}, {}
    # wave_hand 視窗（13-19）：out,in,out,in,out,in,out -> 3 個完整循環
    pattern = ["out", "in", "out", "in", "out", "in", "out"]
    for offset, state in enumerate(pattern):
        idx = 13 + offset
        if state == "out":
            face_data[idx] = {"bbox": _WAVE_FACE_BBOX, "embedding": np.zeros(3)}
            hand_data[idx] = None
        else:
            face_data[idx] = None
            hand_data[idx] = {"center": _WAVE_INSIDE, "bbox": (4.0, 4.0, 6.0, 6.0)}

    return landmarks, face_data, hand_data


def _patch_all(monkeypatch, landmarks, face_data, hand_data):
    monkeypatch.setattr(
        ba, "extract_landmarks", lambda frames, fps: [landmarks.get(f) for f in frames]
    )
    monkeypatch.setattr(
        ba.idt, "extract_face_data", lambda frames: [face_data.get(f) for f in frames]
    )
    monkeypatch.setattr(
        ba.ht, "extract_hand_landmarks", lambda frames, fps: [hand_data.get(f) for f in frames]
    )


def test_analyze_baseline_all_pass_when_all_actions_satisfied(monkeypatch):
    landmarks, face_data, hand_data = _build_all_pass_scenario()
    _patch_all(monkeypatch, landmarks, face_data, hand_data)

    result = ba.analyze_baseline(list(range(20)), 1.0, CHALLENGES_ORDER)

    assert [c["action"] for c in result["challenges"]] == [
        "blink", "turn_left", "turn_right", "wave_hand"
    ]
    assert [c["name"] for c in result["challenges"]] == [
        "眨眼", "頭部向左轉", "頭部向右轉", "臉前揮手"
    ]
    assert [c["passed"] for c in result["challenges"]] == [True, True, True, True]
    assert result["verdict"] == "pass"
    assert result["verdictLabel"] == "判定為真人"
    assert result["standard"] == "ISO/IEC 30107-3 動作挑戰"
    assert result["confidenceScore"] == 0.0


def test_analyze_baseline_rejects_when_one_action_fails(monkeypatch):
    landmarks, face_data, hand_data = _build_all_pass_scenario()
    for i in range(8, 13):
        landmarks[i] = _yaw_landmarks(0.0)  # turn_right 視窗改成鼻尖置中，達不到門檻
    _patch_all(monkeypatch, landmarks, face_data, hand_data)

    result = ba.analyze_baseline(list(range(20)), 1.0, CHALLENGES_ORDER)

    assert [c["passed"] for c in result["challenges"]] == [True, True, False, True]
    assert result["verdict"] == "reject"
    assert result["verdictLabel"] == "動作挑戰未完成"
    assert result["confidenceScore"] == pytest.approx(0.25)  # 4 項裡失敗 1 項


def test_analyze_baseline_empty_frames_returns_reject():
    result = ba.analyze_baseline([], 30.0, CHALLENGES_ORDER)
    assert result["verdict"] == "reject"
    assert all(c["passed"] is False for c in result["challenges"])


def test_analyze_baseline_no_challenges_returns_reject():
    result = ba.analyze_baseline([1, 2, 3], 30.0, [])
    assert result["verdict"] == "reject"
    assert result["challenges"] == []
