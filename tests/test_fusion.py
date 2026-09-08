"""common/fusion.py 的測試。

四個 track 的回傳值都用符合各自契約格式的合成 dict，不需要真的跑
任何 analyzer，純粹驗證融合與決策的數學、reasons 組裝、對照組漏判
標記是否正確。

2026-08-19 改版：對照組/Track2-4 改成用 confidenceScore（連續信心分數）
取代原本的二值化風險，這裡的合成 dict 也跟著加上這個欄位。

2026-08-29：Track2 rPPG 停用不參與融合，這裡的測試移除所有 rppg 參數，
改測四層。RPPG_PASS/RPPG_FAIL 這兩個合成 dict 保留在檔案裡供未來
重新啟用時參考，但不再傳給 fusion 的任何函式。
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest

import config
from common import fusion


def _baseline(verdict="pass", confidence_score=None):
    if confidence_score is None:
        confidence_score = 0.0 if verdict == "pass" else 1.0
    return {
        "standard": "ISO/IEC 30107-3 動作挑戰", "challenges": [], "verdict": verdict,
        "verdictLabel": "判定為真人" if verdict == "pass" else "動作挑戰未完成",
        "confidenceScore": confidence_score,
    }


def _synthetic(fake_probability=0.05):
    return {"fakeProbability": fake_probability, "topSignals": []}


def _track_result(detected=True, confidence_score=None, **extra):
    if confidence_score is None:
        confidence_score = 0.0 if detected else 1.0
    result = {"detected": detected, "checks": [], "confidenceScore": confidence_score}
    result.update(extra)
    return result


BASELINE_PASS = _baseline("pass")
BASELINE_FAIL = _baseline("reject")
SYNTHETIC_ZERO = _synthetic(0.0)  # 用於「其他層都乾淨」的背景值，隔離出單層測試
SYNTHETIC_LOW = _synthetic(0.05)
SYNTHETIC_HIGH = _synthetic(0.94)
RPPG_PASS = _track_result(True, heartRate=70.0, snr=5.0, roiConsistency=0.9, waveform=[], spectrum=[])
RPPG_FAIL = _track_result(False, heartRate=None, snr=0.5, roiConsistency=0.2, waveform=[], spectrum=[])
PHOTO_PASS = _track_result(True, correlation=0.8, latencyMs=20.0, geometryScore=0.9,
                            sequence=[], lightCurve=[], reflectCurve=[])
PHOTO_FAIL = _track_result(False, correlation=0.05, latencyMs=None, geometryScore=0.1,
                            sequence=[], lightCurve=[], reflectCurve=[])
OCC_PASS = _track_result(True, waveCyclesDetected=3, identityStability=0.95, maxIdentityDrop=0.05,
                          occlusionSegments=[], layerScore=0.8, anomalyFrames=[], stabilityCurve=[])
OCC_FAIL = _track_result(False, waveCyclesDetected=3, identityStability=0.5, maxIdentityDrop=0.6,
                          occlusionSegments=[], layerScore=0.2, anomalyFrames=[1, 2], stabilityCurve=[])


# --------------------------------------------------------------------------
# _layer_passed（不受這次改版影響，仍然只看 detected/verdict）
# --------------------------------------------------------------------------


def test_layer_passed_baseline_uses_verdict_field():
    assert fusion._layer_passed("baseline", BASELINE_PASS) is True
    assert fusion._layer_passed("baseline", BASELINE_FAIL) is False


def test_layer_passed_synthetic_uses_threshold_not_detected_field():
    assert fusion._layer_passed("synthetic", SYNTHETIC_LOW) is True
    assert fusion._layer_passed("synthetic", SYNTHETIC_HIGH) is False


def test_layer_passed_others_use_detected_field():
    assert fusion._layer_passed("photometric", PHOTO_PASS) is True
    assert fusion._layer_passed("occlusion", OCC_FAIL) is False


# --------------------------------------------------------------------------
# _layer_risk
# --------------------------------------------------------------------------


def test_layer_risk_synthetic_scales_probability_to_100():
    assert fusion._layer_risk("synthetic", _synthetic(0.3)) == pytest.approx(30.0)


def test_layer_risk_synthetic_clamps_out_of_range_probability():
    assert fusion._layer_risk("synthetic", _synthetic(1.5)) == pytest.approx(100.0)
    assert fusion._layer_risk("synthetic", _synthetic(-0.5)) == pytest.approx(0.0)


def test_layer_risk_others_use_confidence_score_field():
    """對照組/Track2-4 現在讀 confidenceScore，不是二值化 detected。"""
    assert fusion._layer_risk("occlusion", OCC_PASS) == pytest.approx(0.0)
    assert fusion._layer_risk("occlusion", OCC_FAIL) == pytest.approx(100.0)
    assert fusion._layer_risk("occlusion", {"confidenceScore": 0.62}) == pytest.approx(62.0)


def test_layer_risk_clamps_confidence_score_out_of_range():
    assert fusion._layer_risk("occlusion", {"confidenceScore": 1.5}) == pytest.approx(100.0)
    assert fusion._layer_risk("occlusion", {"confidenceScore": -0.5}) == pytest.approx(0.0)


def test_layer_risk_defaults_to_max_risk_when_confidence_score_missing():
    """缺 confidenceScore 欄位時保守給最高風險，不能預設安全。"""
    assert fusion._layer_risk("photometric", {"detected": True}) == pytest.approx(100.0)


# --------------------------------------------------------------------------
# compute_risk_score
# --------------------------------------------------------------------------


def test_compute_risk_score_all_pass_is_zero():
    score = fusion.compute_risk_score(BASELINE_PASS, SYNTHETIC_ZERO, PHOTO_PASS, OCC_PASS)
    assert score == 0


def test_compute_risk_score_all_fail_is_hundred():
    score = fusion.compute_risk_score(
        BASELINE_FAIL, _synthetic(1.0), PHOTO_FAIL, OCC_FAIL
    )
    assert score == 100


def test_compute_risk_score_uses_intermediate_confidence_scores():
    """信心分數不是只有 0 或 1 時，風險分數應該落在對應的中間值——
    這是這次改版要達到的效果，跟舊版二值化只會出現整數倍權重不同。
    """
    mid_occlusion = _track_result(False, confidence_score=0.5, waveCyclesDetected=2,
                                   identityStability=0.85, maxIdentityDrop=0.25,
                                   occlusionSegments=[], layerScore=0.6, anomalyFrames=[],
                                   stabilityCurve=[])
    score = fusion.compute_risk_score(
        BASELINE_PASS, SYNTHETIC_ZERO, PHOTO_PASS, mid_occlusion
    )
    # 只有 occlusion 貢獻風險：0.50 權重 × 0.5 信心分數 × 100 = 25 → 四捨五入 25
    assert score == round(config.WEIGHT_OCCLUSION * 0.5 * 100)


@pytest.mark.parametrize(
    "failing_layer,expected",
    [
        ("baseline", config.WEIGHT_BASELINE),
        ("synthetic", config.WEIGHT_SYNTHETIC),
        ("photometric", config.WEIGHT_PHOTOMETRIC),
        ("occlusion", config.WEIGHT_OCCLUSION),
    ],
)
def test_compute_risk_score_single_layer_failure_matches_its_weight(failing_layer, expected):
    args = {
        "baseline": BASELINE_PASS,
        "synthetic": SYNTHETIC_ZERO,
        "photometric": PHOTO_PASS,
        "occlusion": OCC_PASS,
    }
    fail_values = {
        "baseline": BASELINE_FAIL,
        "synthetic": _synthetic(1.0),
        "photometric": PHOTO_FAIL,
        "occlusion": OCC_FAIL,
    }
    args[failing_layer] = fail_values[failing_layer]

    score = fusion.compute_risk_score(
        args["baseline"], args["synthetic"], args["photometric"], args["occlusion"]
    )
    assert score == round(expected * 100)


# --------------------------------------------------------------------------
# compute_verdict（區間邊界）
# --------------------------------------------------------------------------


def test_compute_verdict_boundaries():
    assert fusion.compute_verdict(config.RISK_PASS_MAX) == "pass"
    assert fusion.compute_verdict(config.RISK_PASS_MAX + 1) == "review"
    assert fusion.compute_verdict(config.RISK_REVIEW_MAX) == "review"
    assert fusion.compute_verdict(config.RISK_REVIEW_MAX + 1) == "reject"


# --------------------------------------------------------------------------
# build_reasons（不受這次改版影響，仍然只看 detected/verdict）
# --------------------------------------------------------------------------


def test_build_reasons_empty_when_all_pass():
    reasons = fusion.build_reasons(BASELINE_PASS, SYNTHETIC_LOW, PHOTO_PASS, OCC_PASS)
    assert reasons == []


def test_build_reasons_matches_failing_layers_in_fixed_order():
    reasons = fusion.build_reasons(BASELINE_PASS, SYNTHETIC_LOW, PHOTO_FAIL, OCC_FAIL)
    assert reasons == [
        fusion._FAILURE_REASONS["photometric"],
        fusion._FAILURE_REASONS["occlusion"],
    ]


def test_build_reasons_occlusion_wording_depends_on_which_check_failed():
    """2026-09-07：applicant 1687 真人測試撞到的案例——身分連續性
    （checks[1]）明明通過，只是揮手循環數沒過，理由文字卻寫死「疑似
    即時換臉攻擊」，跟系統自己算出來的數字矛盾。三項子判定裡只有身分
    連續性真的沒過，才該用最嚴重的措辭；其餘兩項沒過用比較中性的
    說法，見 fusion._occlusion_reason()。"""
    occ_cycles_fail_only = dict(
        OCC_FAIL,
        checks=[
            {"label": "偵測到至少 2 次揮手遮擋循環", "passed": False},
            {"label": "身分特徵連續無突變", "passed": True},
            {"label": "遮擋區域層級關係正確", "passed": True},
        ],
    )
    reasons = fusion.build_reasons(BASELINE_PASS, SYNTHETIC_LOW, PHOTO_PASS, occ_cycles_fail_only)
    assert len(reasons) == 1
    assert reasons[0] != fusion._FAILURE_REASONS["occlusion"]
    assert "換臉" not in reasons[0]

    occ_identity_fail = dict(
        OCC_FAIL,
        checks=[
            {"label": "偵測到至少 2 次揮手遮擋循環", "passed": True},
            {"label": "身分特徵連續無突變", "passed": False},
            {"label": "遮擋區域層級關係正確", "passed": True},
        ],
    )
    reasons = fusion.build_reasons(BASELINE_PASS, SYNTHETIC_LOW, PHOTO_PASS, occ_identity_fail)
    assert reasons == [fusion._FAILURE_REASONS["occlusion"]]


def test_build_reasons_baseline_wording_lists_failed_action_names():
    baseline_wave_only = dict(
        BASELINE_FAIL,
        challenges=[
            {"action": "wave_hand", "name": "臉前揮手", "durationSec": 7, "passed": False},
            {"action": "turn_left", "name": "頭部向左轉", "durationSec": 5, "passed": True},
            {"action": "turn_right", "name": "頭部向右轉", "durationSec": 5, "passed": True},
            {"action": "blink", "name": "眨眼", "durationSec": 3, "passed": True},
        ],
    )
    reasons = fusion.build_reasons(baseline_wave_only, SYNTHETIC_LOW, PHOTO_PASS, OCC_PASS)
    assert reasons == ["以下動作挑戰未偵測到有效動作：臉前揮手"]


# --------------------------------------------------------------------------
# is_baseline_missed
# --------------------------------------------------------------------------


def test_is_baseline_missed_true_when_baseline_passed_but_overall_rejected():
    assert fusion.is_baseline_missed(BASELINE_PASS, "reject") is True


def test_is_baseline_missed_false_when_baseline_itself_failed():
    assert fusion.is_baseline_missed(BASELINE_FAIL, "reject") is False


def test_is_baseline_missed_false_when_overall_not_rejected():
    assert fusion.is_baseline_missed(BASELINE_PASS, "pass") is False


# --------------------------------------------------------------------------
# fuse_decision：端到端
# --------------------------------------------------------------------------


def test_fuse_decision_all_pass():
    decision = fusion.fuse_decision(BASELINE_PASS, SYNTHETIC_ZERO, PHOTO_PASS, OCC_PASS)
    assert decision == {
        "riskScore": 0,
        "verdict": "pass",
        "verdictLabel": "通過",
        "reasons": [],
    }


def test_fuse_decision_realtime_faceswap_scenario_is_rejected():
    """比照 PLAN.md「五種攻擊情境的攔截分佈」表的「即時臉部重繪」列
    （對照組✓／Track1✗／Track3✓／Track4✗，Track2 已停用不計入），
    結果應為拒絕。這是整套架構的論證核心（只有 Track 4 抓得到即時
    換臉），直接用融合邏輯驗證這個結論在目前（四層、Track4 權重提高
    到 0.50）的權重下依然成立。
    """
    decision = fusion.fuse_decision(
        BASELINE_PASS, SYNTHETIC_HIGH, PHOTO_PASS, OCC_FAIL
    )
    assert decision["verdict"] == "reject"
    assert fusion._FAILURE_REASONS["occlusion"] in decision["reasons"]


def test_fuse_decision_verdict_label_matches_verdict():
    decision = fusion.fuse_decision(
        BASELINE_FAIL, SYNTHETIC_LOW, PHOTO_PASS, OCC_PASS
    )
    assert decision["verdictLabel"] == fusion.VERDICT_LABELS[decision["verdict"]]


def test_fuse_decision_baseline_reject_never_passes_outright():
    """2026-09-01：applicant 1602（確認為虛擬攝影機）baseline reject 但
    其餘三層都乾淨，加權後 risk_score=27（落在 pass 區間）直接通過。
    baseline 權重刻意調低，稀釋了「沒通過」這個訊號，risk_score 本身
    不足以信任到可以直接放行——這裡驗證 floor 規則把它升級成 review，
    不是 pass，也不是強制 reject（見下面的 does_not_escalate 測試，
    真人動作挑戰失敗不該被自動升級成拒絕）。
    """
    decision = fusion.fuse_decision(
        BASELINE_FAIL, SYNTHETIC_LOW, PHOTO_PASS, OCC_PASS
    )
    assert decision["riskScore"] <= config.RISK_PASS_MAX
    assert decision["verdict"] == "review"
    assert fusion._FAILURE_REASONS["baseline"] in decision["reasons"]


def test_fuse_decision_baseline_reject_floor_does_not_escalate_existing_reject():
    """baseline reject 加上其他層也失敗、risk_score 本來就落在 reject
    區間時，floor 規則不該把它從 reject 降級成 review——這條規則只
    negative-side 補洞（防止直接通過），不該反過來放寬本來就該拒絕
    的案件。"""
    decision = fusion.fuse_decision(
        BASELINE_FAIL, SYNTHETIC_HIGH, PHOTO_FAIL, OCC_FAIL
    )
    assert decision["riskScore"] > config.RISK_REVIEW_MAX
    assert decision["verdict"] == "reject"


def test_fuse_decision_baseline_pass_is_unaffected_by_floor():
    """baseline 本身通過時，floor 規則不該介入，維持原本的風險分數
    區間判定。"""
    decision = fusion.fuse_decision(BASELINE_PASS, SYNTHETIC_ZERO, PHOTO_PASS, OCC_PASS)
    assert decision["verdict"] == "pass"
