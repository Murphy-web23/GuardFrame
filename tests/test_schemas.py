"""common/schemas.py 的測試。

用符合各 analyzer 真實契約格式（camelCase 鍵）的合成 dict 驗證解析，
不需要真的跑任何 analyzer。
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest
from pydantic import ValidationError

from common import schemas


# --------------------------------------------------------------------------
# CamelModel 基本行為：alias 雙向都能用
# --------------------------------------------------------------------------


def test_parses_camelcase_dict_like_real_analyzer_output():
    item = schemas.CheckItem.model_validate({"label": "主頻落在人類心率範圍", "passed": True})
    assert item.label == "主頻落在人類心率範圍"
    assert item.passed is True


def test_constructs_via_snake_case_kwargs():
    item = schemas.TopSignal(label="臉部邊界混合痕跡", weight=0.38)
    assert item.weight == 0.38


def test_model_dump_by_alias_produces_camelcase():
    result = schemas.RppgResult(
        detected=False, heart_rate=None, snr=0.7, roi_consistency=0.21,
        checks=[], waveform=[], spectrum=[], confidence_score=0.5,
    )
    dumped = result.model_dump(by_alias=True)
    assert "heartRate" in dumped
    assert "roiConsistency" in dumped
    assert "heart_rate" not in dumped


def test_model_dump_without_by_alias_stays_snake_case():
    result = schemas.RppgResult(
        detected=False, heart_rate=None, snr=0.7, roi_consistency=0.21,
        checks=[], waveform=[], spectrum=[], confidence_score=0.5,
    )
    dumped = result.model_dump()
    assert "heart_rate" in dumped
    assert "heartRate" not in dumped


# --------------------------------------------------------------------------
# 各 track 的回傳格式，用真實契約鍵名的 dict 解析
# --------------------------------------------------------------------------


def test_rppg_result_parses_real_shaped_dict():
    raw = {
        "detected": True,
        "heartRate": 68.5,
        "snr": 5.2,
        "roiConsistency": 0.91,
        "checks": [
            {"label": "主頻落在人類心率範圍", "passed": True},
            {"label": "頻譜峰值訊噪比達標", "passed": True},
            {"label": "額頭與雙頰心率一致", "passed": True},
        ],
        "waveform": [0.1, 0.2],
        "spectrum": [0.0] * 64,
        "confidenceScore": 0.05,
    }
    result = schemas.RppgResult.model_validate(raw)
    assert result.heart_rate == pytest.approx(68.5)
    assert len(result.checks) == 3
    assert len(result.spectrum) == 64


def test_photometric_result_parses_real_shaped_dict():
    raw = {
        "detected": False,
        "correlation": 0.06,
        "latencyMs": None,
        "geometryScore": 0.09,
        "sequence": ["淡紅", "灰白", "淡藍", "淡綠", "灰白"],
        "checks": [{"label": "x", "passed": False}] * 3,
        "lightCurve": [0.0] * 100,
        "reflectCurve": [0.0] * 100,
        "confidenceScore": 0.9,
    }
    result = schemas.PhotometricResult.model_validate(raw)
    assert result.latency_ms is None
    assert result.sequence == ["淡紅", "灰白", "淡藍", "淡綠", "灰白"]


def test_occlusion_result_parses_segments_as_tuples():
    raw = {
        "detected": True,
        "waveCyclesDetected": 3,
        "identityStability": 0.71,
        "maxIdentityDrop": 0.34,
        "occlusionSegments": [[12, 34], [58, 79], [103, 121]],
        "layerScore": 0.28,
        "anomalyFrames": [15, 62],
        "checks": [{"label": "x", "passed": True}] * 3,
        "stabilityCurve": [],
        "confidenceScore": 0.2,
    }
    result = schemas.OcclusionResult.model_validate(raw)
    assert result.occlusion_segments == [(12, 34), (58, 79), (103, 121)]
    assert result.anomaly_frames == [15, 62]


def test_baseline_result_rejects_invalid_action_literal():
    raw = {
        "standard": "ISO/IEC 30107-3 動作挑戰",
        "challenges": [{"action": "shrug", "name": "聳肩", "durationSec": 3, "passed": True}],
        "verdict": "pass",
        "verdictLabel": "判定為真人",
    }
    with pytest.raises(ValidationError):
        schemas.BaselineResult.model_validate(raw)


def test_recording_phases_requires_exactly_two_ints():
    with pytest.raises(ValidationError):
        schemas.RecordingPhases.model_validate(
            {"action": [0, 100, 200], "lighting": [100, 200], "occlusion": [50, 100]}
        )


# --------------------------------------------------------------------------
# 輸入結構：light_log（§5.2）、challenges（§5.3）
# --------------------------------------------------------------------------


def test_light_log_parses_segments():
    raw = {
        "startTimestamp": 1755066727543,
        "segments": [
            {"color": "淡紅", "hex": "#D98080", "startMs": 0, "durationMs": 480},
            {"color": "灰白", "hex": "#E8E8E8", "startMs": 480, "durationMs": 520},
        ],
    }
    log = schemas.LightLog.model_validate(raw)
    assert len(log.segments) == 2
    assert log.segments[0].color == "淡紅"


def test_light_log_rejects_invalid_color():
    raw = {
        "startTimestamp": 0,
        "segments": [{"color": "紫色", "hex": "#000000", "startMs": 0, "durationMs": 480}],
    }
    with pytest.raises(ValidationError):
        schemas.LightLog.model_validate(raw)


def test_challenges_payload_parses_full_structure():
    raw = {
        "challenges": [
            {"action": "turn_right", "durationSec": 5},
            {"action": "blink", "durationSec": 3},
            {"action": "wave_hand", "durationSec": 7},
            {"action": "turn_left", "durationSec": 5},
        ],
        "recording": {
            "durationSec": 23.1,
            "fps": 30.0,
            "totalFrames": 693,
            "phases": {"action": [0, 599], "lighting": [600, 692], "occlusion": [420, 599]},
        },
    }
    payload = schemas.ChallengesPayload.model_validate(raw)
    assert len(payload.challenges) == 4
    assert payload.recording.phases.occlusion == (420, 599)


# --------------------------------------------------------------------------
# VerificationRecord：完整組裝
# --------------------------------------------------------------------------


def test_verification_record_full_assembly():
    record = schemas.VerificationRecord(
        id="VF-20260817-0001",
        timestamp="2026-08-17 10:00:00",
        applicant_name="測試用戶",
        applicant_id_masked="A12****789",
        source_type="虛擬攝影機",
        recording=schemas.RecordingInfo(
            duration_sec=23.1, fps=30.0, total_frames=693,
            phases=schemas.RecordingPhases(action=(0, 599), lighting=(600, 692), occlusion=(420, 599)),
        ),
        quality=schemas.QualityResult(
            passed=True, blur_score=142.6, brightness=118.4, contrast=52.1,
            overexposed_ratio=0.02, face_ratio=0.31, message="",
        ),
        baseline=schemas.BaselineResult(
            standard="ISO/IEC 30107-3 動作挑戰", challenges=[], verdict="pass", verdict_label="判定為真人",
            confidence_score=0.0,
        ),
        synthetic=schemas.SyntheticResult(
            fake_probability=0.94, threshold=0.5, verdict="reject", top_signals=[],
        ),
        rppg=schemas.RppgResult(
            detected=False, heart_rate=None, snr=0.7, roi_consistency=0.21,
            checks=[], waveform=[], spectrum=[], confidence_score=0.85,
        ),
        photometric=schemas.PhotometricResult(
            detected=False, correlation=0.06, latency_ms=None, geometry_score=0.09,
            sequence=[], checks=[], light_curve=[], reflect_curve=[], confidence_score=0.9,
        ),
        occlusion=schemas.OcclusionResult(
            detected=True, wave_cycles_detected=3, identity_stability=0.71, max_identity_drop=0.34,
            occlusion_segments=[], layer_score=0.28, anomaly_frames=[], checks=[], stability_curve=[],
            confidence_score=0.3,
        ),
        decision=schemas.DecisionResult(
            risk_score=94, verdict="reject", verdict_label="拒絕",
            reasons=["未偵測到照明響應，影像可能未經實體鏡頭擷取"],
        ),
        vlm_summary=None,
        account_result="rejected",
    )

    dumped = record.model_dump(by_alias=True)
    assert dumped["applicantIdMasked"] == "A12****789"
    assert dumped["decision"]["riskScore"] == 94
    # model_dump() 保留 Python 原生型別（tuple 維持 tuple）；
    # 真的送出去的 JSON（model_dump_json()／FastAPI response）會是陣列。
    assert dumped["recording"]["phases"]["occlusion"] == (420, 599)
    # phases 現在是 float（毫秒），不是 int（影格索引），見
    # common/schemas.py RecordingPhases 的說明——JSON 序列化因此是
    # [420.0,599.0]，不是 [420,599]。
    assert record.model_dump_json(by_alias=True).find('"occlusion":[420.0,599.0]') != -1
    assert dumped["vlmSummary"] is None
    assert dumped["accountResult"] == "rejected"
