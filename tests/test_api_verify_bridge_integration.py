"""R5-R5：真正 Track 1（guardframe_bridge）路由整合的測試，MODEL_FREE_ONLY。

這裡完全不碰真的 GuardFrameBridgeClient 網路傳輸、不起真的 socket、不 import
guardframe_synthetic_v3/torch/onnxruntime——所有跟 bridge 的互動都透過下面
_StubBridgeClient 取代 api.routes._guardframe_bridge_client。目的只有一個：
驗證 api/routes.py 這一層的抽樣/接線/融合傳遞/失敗語意，不驗證 bridge 協定
本身（那部分已經有 tests/test_guardframe_bridge_real_runner.py），也不驗證
真的模型輸出（Final Test 的職責）。

前四個測試（抽樣公式／短片重複索引／全解析度＋RGB／legacy 符號仍在）完全
不需要資料庫。牽涉 _run_verify_analysis() 端到端執行（會寫 DB）的測試沿用
tests/test_api_verify.py 同一套 requires_db skip 慣例：沒有可用 Postgres
連線時自動 skip，不讓這支檔案在沒有資料庫的環境下整批失敗。

任何呼叫 _run_verify_analysis() 的測試都必須使用下面的 hermetic_layers
fixture——讀過 api/routes.py::_run_verify_analysis() 的完整實作後確認，
fuse_decision() 之後可能觸及的外部/有副作用依賴只有三個：
summarize_verification()（VLM/Ollama）、send_verdict_email()、
send_wave_retry_email()（兩者都是真的 Resend 寄信）；三者連同
analyze_baseline/analyze_photometric/analyze_occlusion 一起被這個 fixture
固定成確定性的假結果，測試才不會意外打到本機 Ollama 或真的寄出信件。
"""

import sys
from datetime import date
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np
import pytest
from sqlalchemy import create_engine

import api.routes as routes
import config
from api.database import DATABASE_URL, SessionLocal
from api.models import Applicant, Base, VerificationRecordRow
from common.fusion import compute_risk_score
from guardframe_bridge import protocol as bridge_proto
from track1_synthetic.detector import detect_synthetic as legacy_detect_synthetic


def _db_available():
    try:
        engine = create_engine(DATABASE_URL)
        with engine.connect():
            pass
        engine.dispose()
        return True
    except Exception:
        return False


requires_db = pytest.mark.skipif(
    not _db_available(),
    reason="沒有可用的 PostgreSQL 連線（guardframe-pg 容器沒啟動？見 .env.example）",
)


@pytest.fixture(scope="module", autouse=True)
def _ensure_tables():
    if _db_available():
        engine = create_engine(DATABASE_URL)
        Base.metadata.create_all(engine)
        engine.dispose()


@pytest.fixture
def applicant_id():
    session = SessionLocal()
    try:
        applicant = Applicant(
            name="Bridge整合測試用戶", id_number_masked="C56****321", phone="0911222333",
            email="pytest-bridge-verify@example.com", address="測試地址",
            birth_date=date(1990, 1, 1),
        )
        session.add(applicant)
        session.commit()
        session.refresh(applicant)
        yield applicant.id
    finally:
        session.query(VerificationRecordRow).filter_by(applicant_id=applicant.id).delete()
        session.query(Applicant).filter_by(id=applicant.id).delete()
        session.commit()
        session.close()
        import shutil as _shutil
        _shutil.rmtree(config.VERIFICATION_VIDEO_DIR / str(applicant.id), ignore_errors=True)


class _StubBridgeClient:
    """model-free 替身，取代 api.routes._guardframe_bridge_client。"""

    def __init__(self, result=None, error=None):
        self._result = result
        self._error = error
        self.calls = []

    def assess(self, frames_rgb):
        self.calls.append(frames_rgb)
        if self._error is not None:
            raise self._error
        return self._result


def _build_frames(count=30, height=48, width=64):
    """建構跟 224x224 明顯不同解析度的假 RGB 影格，供 _run_verify_analysis()
    端到端測試使用（analyze_baseline/photometric/occlusion 都會被
    hermetic_layers fixture 換掉，實際畫面內容不重要，只要形狀合法、
    每格不同即可）。"""
    return [np.full((height, width, 3), i, dtype=np.uint8) for i in range(count)]


def _build_phases():
    return SimpleNamespace(action=(0, 19), lighting=(20, 24), occlusion=(5, 14))


def _fixed_quality():
    return {
        "passed": True, "blurScore": 999.0, "brightness": 120.0,
        "contrast": 50.0, "overexposedRatio": 0.0, "faceRatio": 0.5, "message": "",
    }


def _fixed_top_signals():
    return [
        {"label": "sig_a", "weight": 0.9},
        {"label": "sig_b", "weight": 0.6},
        {"label": "sig_c", "weight": 0.3},
    ]


def _fixed_passing_layer_results():
    """baseline/photometric/occlusion 固定成「完全通過、零風險貢獻」，
    這樣 fuse_decision() 算出來的風險分數/決策只受 Track1 fakeProbability
    影響，才能對照 mandate 第 9 項「其餘各層輸入必須固定」的要求。"""
    baseline_result = {
        "challenges": [
            {"name": "blink", "passed": True},
            {"name": "turn_left", "passed": True},
            {"name": "turn_right", "passed": True},
            {"name": "wave_hand", "passed": True},
        ],
        "verdict": "pass",
        "confidenceScore": 0.0,
    }
    photometric_result = {
        "detected": True, "correlation": 0.9, "latencyMs": 50.0, "geometryScore": 1.0,
        "sequence": [], "checks": [{"label": "correlation", "passed": True}],
        "lightCurve": [], "reflectCurve": [], "confidenceScore": 0.0,
    }
    occlusion_result = {
        "detected": True, "waveCyclesDetected": 3, "identityStability": 0.99,
        "maxIdentityDrop": 0.01, "occlusionSegments": [], "layerScore": 0.99,
        "anomalyFrames": [],
        "checks": [
            {"label": "waveCycles", "passed": True},
            {"label": "identity", "passed": True},
            {"label": "layerColor", "passed": True},
        ],
        "stabilityCurve": [], "confidenceScore": 0.0,
    }
    return baseline_result, photometric_result, occlusion_result


@pytest.fixture
def hermetic_layers(monkeypatch):
    """Patches every side-effectful dependency _run_verify_analysis() can
    reach, so these route-level tests never touch a real analyzer, a real
    VLM backend (Ollama), or a real email provider (Resend) — only the
    Track1 bridge call itself is under test, via _guardframe_bridge_client.

    Reachable-after-fusion side effects identified by reading
    api/routes.py::_run_verify_analysis() directly:
        - summarize_verification()  (VLM, only if verdict in review/reject)
        - send_verdict_email()      (always, on any successful completion)
        - send_wave_retry_email()   (only if wave-retry eligible)
    send_review_action_email() is NOT reachable from _run_verify_analysis()
    (only called from the separate admin review-action endpoint), so it is
    intentionally not patched here.

    analyze_baseline/analyze_photometric/analyze_occlusion are also patched
    to fixed, zero-risk results so the Track1 fusion contribution can be
    isolated per mandate item 9 (all other layer inputs held constant
    across the 0.2/0.5/0.8 cases).
    """
    baseline_result, photometric_result, occlusion_result = _fixed_passing_layer_results()
    monkeypatch.setattr(routes, "analyze_baseline", lambda *a, **kw: baseline_result)
    monkeypatch.setattr(routes, "analyze_photometric", lambda *a, **kw: photometric_result)
    monkeypatch.setattr(routes, "analyze_occlusion", lambda *a, **kw: occlusion_result)
    monkeypatch.setattr(
        routes,
        "summarize_verification",
        lambda record, anomaly_frames: {
            "available": False, "frameObservations": [], "summary": "",
            "model": "", "latencyMs": 0.0,
        },
    )
    monkeypatch.setattr(routes, "send_verdict_email", lambda *a, **kw: None)
    monkeypatch.setattr(routes, "send_wave_retry_email", lambda *a, **kw: None)
    return SimpleNamespace(
        baseline=baseline_result, photometric=photometric_result, occlusion=occlusion_result,
    )


# ---------------------------------------------------------------------------
# 1/2/4/5：_sample_fullres_rgb_for_bridge() 本身的抽樣/解析度/色彩契約，
# 純函式測試，不需要資料庫。
# ---------------------------------------------------------------------------


def test_sample_fullres_rgb_for_bridge_matches_frozen_index_formula():
    """len(frames)=20 時 linspace 的中間位置都是有小數的（step=19/9），
    astype(int)（無條件捨去）跟 round()/np.rint()（四捨五入）在好幾個
    中間索引上會給出不同答案——用這個長度才能真的釘死
    EXACT_SAMPLING_SEMANTICS 是「truncate」而不是「round」，不是只在
    剛好整除、兩種寫法算出來的結果沒差異的情況下矇混過關。"""
    frames = _build_frames(count=20)
    expected_indices = [0, 2, 4, 6, 8, 10, 12, 14, 16, 19]
    assert expected_indices == np.linspace(
        0, len(frames) - 1, config.FRAME_COUNT
    ).astype(int).tolist()

    result = routes._sample_fullres_rgb_for_bridge(frames, config.FRAME_COUNT)

    assert len(result) == config.FRAME_COUNT
    for out_frame, idx in zip(result, expected_indices):
        assert out_frame is frames[idx]


def test_sample_fullres_rgb_for_bridge_retains_duplicate_indices_for_short_lists():
    """0 < len(frames) < FRAME_COUNT 時，凍結語意要求保留
    np.linspace(...).astype(int) 本來就會產生的重複索引，不能去重、
    不能補幀、不能報錯。"""
    frames = _build_frames(count=3)
    assert 0 < len(frames) < config.FRAME_COUNT

    expected_indices = np.linspace(0, len(frames) - 1, config.FRAME_COUNT).astype(int).tolist()
    assert expected_indices == [0, 0, 0, 0, 0, 1, 1, 1, 1, 2]
    assert len(set(expected_indices)) < config.FRAME_COUNT  # 確實有重複

    result = routes._sample_fullres_rgb_for_bridge(frames, config.FRAME_COUNT)

    assert len(result) == config.FRAME_COUNT
    for out_frame, idx in zip(result, expected_indices):
        assert out_frame is frames[idx]


def test_sample_fullres_rgb_for_bridge_preserves_full_resolution_and_rgb_order():
    """刻意用跟 224x224 明顯不同的解析度＋一個獨特的 RGB sentinel 像素，
    證明這個 helper 不縮放、不做任何色彩轉換（RGB→BGR 是
    guardframe_bridge/client.py 唯一該做的地方，見該檔案開頭說明）。"""
    height, width = 50, 64
    frame = np.zeros((height, width, 3), dtype=np.uint8)
    frame[0, 0] = [11, 22, 33]
    frames = [frame.copy() for _ in range(config.FRAME_COUNT)]

    result = routes._sample_fullres_rgb_for_bridge(frames, config.FRAME_COUNT)

    assert len(result) == config.FRAME_COUNT
    for out_frame in result:
        assert out_frame.shape == (height, width, 3)
        assert list(out_frame[0, 0]) == [11, 22, 33]


# ---------------------------------------------------------------------------
# 11：legacy 佔位路徑（_sample_for_synthetic / detect_synthetic）維持存在、
# 行為不變，即使真正的路由已經不再呼叫它們。不需要資料庫。
# ---------------------------------------------------------------------------


def test_legacy_placeholder_symbols_remain_present_and_functional():
    """R5-R5 明文禁止刪除/修改這條 legacy 呼叫鏈——即使真正路由已經改呼叫
    bridge，這兩個符號本身仍要存在、行為跟原本一致，清理留給之後另外
    裁決的批次。這裡直接呼叫（不透過路由），證明它們沒有被動過。"""
    frames = _build_frames(count=19)

    sampled = routes._sample_for_synthetic(frames, config.FRAME_COUNT)
    assert len(sampled) == config.FRAME_COUNT
    assert all(frame.shape == (config.FACE_SIZE, config.FACE_SIZE, 3) for frame in sampled)

    result = legacy_detect_synthetic(sampled)
    # 2026-09-13：佔位版本已於 track1_synthetic/detector.py 改成固定回傳
    # 0.5（真人測試期間排除雜訊用，見該檔案內註解），這裡的期望值跟著
    # 更新，不是這個 legacy 呼叫鏈本身的行為驗證邏輯改變。
    assert result["fakeProbability"] == pytest.approx(0.5)
    assert len(result["topSignals"]) == 3


# ---------------------------------------------------------------------------
# 3/6/7：真正的 Track1 呼叫鏈接線正確——走 bridge、不走 legacy 佔位路徑，
# 且真的送出 10 張全解析度 RGB 影格。需要資料庫（_run_verify_analysis()
# 端到端執行、真的寫 VerificationRecordRow），side effects 全部 hermetic。
# ---------------------------------------------------------------------------


@requires_db
def test_real_track1_path_calls_bridge_not_legacy_placeholder(
    monkeypatch, applicant_id, tmp_path, hermetic_layers
):
    def _raise_if_called(*args, **kwargs):
        raise AssertionError("legacy Track1 佔位路徑不該被真正的 bridge 路由呼叫")

    monkeypatch.setattr(routes, "_sample_for_synthetic", _raise_if_called)
    monkeypatch.setattr(routes, "detect_synthetic", _raise_if_called)

    stub = _StubBridgeClient(result={"fakeProbability": 0.2, "topSignals": _fixed_top_signals()})
    monkeypatch.setattr(routes, "_guardframe_bridge_client", stub)

    frames = _build_frames()
    phases = _build_phases()
    video_path = tmp_path / "video.mp4"
    video_path.write_bytes(b"stub-video-bytes")

    routes._run_verify_analysis(
        applicant_id, str(video_path), ".mp4", "測試", frames, 5.0, phases, [], {}, _fixed_quality(),
    )

    assert len(stub.calls) == 1
    received_frames = stub.calls[0]
    assert len(received_frames) == config.FRAME_COUNT

    expected_indices = np.linspace(0, len(frames) - 1, config.FRAME_COUNT).astype(int).tolist()
    for received_frame, idx in zip(received_frames, expected_indices):
        assert received_frame is frames[idx]  # 全解析度、RGB，同一個物件，沒有中途複製/轉換


# ---------------------------------------------------------------------------
# 8/9：bridge fakeProbability 0.2/0.5/0.8 傳遞到既有融合邏輯的行為不變，
# 且 Track1 加權風險貢獻精確等於 1.0/2.5/4.0（其餘各層固定為零風險）。
# 2026-09-13：WEIGHT_SYNTHETIC 從 0.20 降到 0.05（見 config.py 同日
# 註解），這裡的期望值跟著更新，不是測試邏輯本身改變。
# ---------------------------------------------------------------------------


@requires_db
@pytest.mark.parametrize("fake_probability", [0.2, 0.5, 0.8])
def test_bridge_fake_probability_passthrough_and_fusion_contribution(
    monkeypatch, applicant_id, tmp_path, fake_probability, hermetic_layers
):
    assert config.WEIGHT_SYNTHETIC == pytest.approx(0.05)

    top_signals = _fixed_top_signals()
    stub = _StubBridgeClient(result={"fakeProbability": fake_probability, "topSignals": top_signals})
    monkeypatch.setattr(routes, "_guardframe_bridge_client", stub)

    frames = _build_frames()
    phases = _build_phases()
    video_path = tmp_path / "video.mp4"
    video_path.write_bytes(b"stub-video-bytes")

    routes._run_verify_analysis(
        applicant_id, str(video_path), ".mp4", "測試", frames, 5.0, phases, [], {}, _fixed_quality(),
    )

    expected_synthetic_result = {
        "fakeProbability": fake_probability,
        "threshold": config.SYNTHETIC_THRESHOLD,
        "verdict": "reject" if fake_probability >= config.SYNTHETIC_THRESHOLD else "pass",
        "topSignals": top_signals,
    }
    expected_risk_score = compute_risk_score(
        hermetic_layers.baseline, expected_synthetic_result,
        hermetic_layers.photometric, hermetic_layers.occlusion,
    )
    expected_track1_contribution = fake_probability * 100 * config.WEIGHT_SYNTHETIC
    assert expected_track1_contribution == pytest.approx(
        {0.2: 1.0, 0.5: 2.5, 0.8: 4.0}[fake_probability]
    )

    session = SessionLocal()
    try:
        rows = session.query(VerificationRecordRow).filter_by(applicant_id=applicant_id).all()
        assert len(rows) == 1
        row = rows[0]
        # DB 讀回來是 Decimal（Numeric 欄位），跟 float 比較前要先轉型——
        # risk_score 也一樣，不能直接用 == 比 Decimal/float。
        assert float(row.synthetic_fake_probability) == pytest.approx(fake_probability)
        assert row.synthetic_verdict == expected_synthetic_result["verdict"]
        assert float(row.risk_score) == pytest.approx(float(expected_risk_score))
    finally:
        session.close()

    assert len(stub.calls) == 1
    assert len(stub.calls[0]) == config.FRAME_COUNT


# ---------------------------------------------------------------------------
# 10：bridge 基礎設施/協定失敗，不得被偷偷轉成 fakeProbability=0.5，
# 必須以例外形式離開 _run_verify_analysis()，且不產生任何
# VerificationRecordRow。
# ---------------------------------------------------------------------------


@requires_db
@pytest.mark.parametrize(
    "error_code",
    [
        bridge_proto.ProtocolErrorCode.CONNECTION_REFUSED,
        bridge_proto.ProtocolErrorCode.TIMEOUT,
        bridge_proto.ProtocolErrorCode.PROTOCOL_VERSION_MISMATCH,
        bridge_proto.ProtocolErrorCode.RUNNER_INTERNAL_ERROR,
    ],
)
def test_bridge_infrastructure_failure_is_not_converted_to_model_uncertainty(
    monkeypatch, applicant_id, tmp_path, error_code, hermetic_layers
):
    stub = _StubBridgeClient(
        error=bridge_proto.GuardFrameProtocolError(error_code, f"stub failure: {error_code.value}")
    )
    monkeypatch.setattr(routes, "_guardframe_bridge_client", stub)

    frames = _build_frames()
    phases = _build_phases()
    video_path = tmp_path / "video.mp4"
    video_path.write_bytes(b"stub-video-bytes")

    with pytest.raises(bridge_proto.GuardFrameProtocolError) as excinfo:
        routes._run_verify_analysis(
            applicant_id, str(video_path), ".mp4", "測試", frames, 5.0, phases, [], {}, _fixed_quality(),
        )
    assert excinfo.value.code == error_code

    # 沒有任何 VerificationRecordRow 被寫入——尤其不能有一筆
    # fakeProbability == 0.5 的紀錄冒充「模型判定不確定」。
    session = SessionLocal()
    try:
        rows = session.query(VerificationRecordRow).filter_by(applicant_id=applicant_id).all()
        assert rows == []
    finally:
        session.close()

    # 例外發生在 shutil.move(tmp_path, ...) 之前，暫存影片檔案應該原封
    # 不動——連帶佐證失敗真的發生在寫 DB／搬檔案之前，不是搬完才報錯。
    assert video_path.exists()
