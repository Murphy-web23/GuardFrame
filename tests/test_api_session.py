"""§4.8 簡訊驗證與全域倒數 Session 的測試：POST /api/applicants/{id}/
sms/send、/sms/verify、/account-setup、/reset。透過 FastAPI TestClient
接真的 Postgres，沒有可用連線時自動 skip（跟 test_api_verify.py 同一套
判斷方式）。
"""

import secrets
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine

import config
from api.database import DATABASE_URL, SessionLocal
from api.main import app
from api.models import Applicant, Base, VerificationRecordRow


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
def client():
    return TestClient(app)


@pytest.fixture
def applicant_id():
    session = SessionLocal()
    try:
        applicant = Applicant(
            name="Session測試用戶", id_number_masked="D12****654", phone="0922333444",
            email="pytest-session@example.com", address="測試地址",
            birth_date=date(1992, 5, 5),
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


def _set_session(applicant_id, *, expired=False):
    """直接寫 DB 給 applicant 建立一個 session，回傳 header dict。"""
    token = secrets.token_urlsafe(config.SESSION_TOKEN_BYTES)
    session = SessionLocal()
    try:
        applicant = session.get(Applicant, applicant_id)
        applicant.session_id = token
        delta = timedelta(seconds=-1) if expired else timedelta(minutes=15)
        applicant.session_deadline_at = datetime.now() + delta
        session.commit()
    finally:
        session.close()
    return {"X-Session-Id": token}


def _add_verification_record(applicant_id, account_result):
    session = SessionLocal()
    try:
        row = VerificationRecordRow(
            applicant_id=applicant_id,
            timestamp=datetime.now(),
            source_type="虛擬攝影機",
            duration_sec=23.0,
            fps=30.0,
            total_frames=690,
            phases={"action": [0, 599], "lighting": [600, 689], "occlusion": [420, 599]},
            quality_passed=True, blur_score=999.0, brightness=120.0, contrast=50.0,
            overexposed_ratio=0.0, face_ratio=0.5, quality_message="",
            baseline_challenges=[], baseline_verdict="pass", baseline_confidence_score=0.1,
            synthetic_fake_probability=0.1, synthetic_threshold=0.5, synthetic_verdict="pass",
            synthetic_top_signals=[],
            rppg_detected=True, rppg_heart_rate=70.0, rppg_snr=5.0, rppg_roi_consistency=0.9,
            rppg_checks=[], rppg_waveform=[], rppg_spectrum=[], rppg_confidence_score=0.1,
            photo_detected=True, photo_correlation=0.9, photo_latency_ms=20.0,
            photo_geometry_score=0.9, photo_sequence=[], photo_checks=[],
            photo_light_curve=[], photo_reflect_curve=[], photo_confidence_score=0.1,
            occ_detected=True, occ_wave_cycles=3, occ_identity_stability=0.95,
            occ_max_identity_drop=0.05, occ_segments=[], occ_layer_score=0.9,
            occ_anomaly_frames=[], occ_checks=[], occ_stability_curve=[],
            occ_confidence_score=0.1,
            risk_score=10, verdict="pass", verdict_label="通過", reasons=[],
            account_result=account_result,
        )
        session.add(row)
        session.commit()
    finally:
        session.close()


# --------------------------------------------------------------------------
# sms/send
# --------------------------------------------------------------------------


@requires_db
def test_sms_send_returns_sent_true(client, applicant_id):
    response = client.post(
        f"/api/applicants/{applicant_id}/sms/send", json={"phone": "0911222333"}
    )
    assert response.status_code == 200
    assert response.json() == {"sent": True}


@requires_db
def test_sms_send_returns_404_for_nonexistent_applicant(client):
    response = client.post("/api/applicants/999999999/sms/send", json={"phone": "0911222333"})
    assert response.status_code == 404


# --------------------------------------------------------------------------
# sms/verify
# --------------------------------------------------------------------------


@requires_db
def test_sms_verify_succeeds_with_demo_code_and_returns_session(client, applicant_id):
    client.post(f"/api/applicants/{applicant_id}/sms/send", json={"phone": "0911222333"})
    response = client.post(
        f"/api/applicants/{applicant_id}/sms/verify", json={"code": config.SMS_DEMO_CODE}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["sessionId"]
    deadline = datetime.fromisoformat(body["deadlineAt"])
    verified = datetime.fromisoformat(body["smsVerifiedAt"])
    assert (deadline - verified) == timedelta(minutes=config.SESSION_DEADLINE_MINUTES)


@requires_db
def test_sms_verify_wrong_code_returns_400(client, applicant_id):
    client.post(f"/api/applicants/{applicant_id}/sms/send", json={"phone": "0911222333"})
    response = client.post(f"/api/applicants/{applicant_id}/sms/verify", json={"code": "000000"})
    assert response.status_code == 400


@requires_db
def test_sms_verify_locks_out_after_three_wrong_attempts(client, applicant_id):
    client.post(f"/api/applicants/{applicant_id}/sms/send", json={"phone": "0911222333"})
    for _ in range(config.SMS_MAX_ATTEMPTS - 1):
        resp = client.post(
            f"/api/applicants/{applicant_id}/sms/verify", json={"code": "000000"}
        )
        assert resp.status_code == 400

    resp = client.post(f"/api/applicants/{applicant_id}/sms/verify", json={"code": "000000"})
    assert resp.status_code == 403

    # 鎖住之後即使打對驗證碼也不能再過（要重新 sms/send 才能恢復）
    resp = client.post(
        f"/api/applicants/{applicant_id}/sms/verify", json={"code": config.SMS_DEMO_CODE}
    )
    assert resp.status_code == 403


# --------------------------------------------------------------------------
# account-setup
# --------------------------------------------------------------------------


@requires_db
def test_account_setup_succeeds_when_pending_setup(client, applicant_id):
    headers = _set_session(applicant_id)
    _add_verification_record(applicant_id, "pending_setup")

    response = client.post(
        f"/api/applicants/{applicant_id}/account-setup",
        json={
            "accountType": "type1",
            "transactionPassword": "123456",
            "notificationPreference": {"sms": True, "email": False},
            "termsAccepted": True,
        },
        headers=headers,
    )
    assert response.status_code == 200
    assert response.json() == {"success": True, "accountResult": "opened"}

    session = SessionLocal()
    try:
        row = (
            session.query(VerificationRecordRow)
            .filter_by(applicant_id=applicant_id)
            .order_by(VerificationRecordRow.id.desc())
            .first()
        )
        assert row.account_result == "opened"
    finally:
        session.close()


@requires_db
def test_account_setup_returns_401_without_valid_session(client, applicant_id):
    _add_verification_record(applicant_id, "pending_setup")
    response = client.post(
        f"/api/applicants/{applicant_id}/account-setup",
        json={
            "accountType": "type1",
            "transactionPassword": "123456",
            "notificationPreference": {"sms": True, "email": False},
            "termsAccepted": True,
        },
        headers={"X-Session-Id": "nonexistent-token"},
    )
    assert response.status_code == 401


@requires_db
def test_account_setup_returns_409_when_not_pending_setup(client, applicant_id):
    """還沒驗證過（沒有任何 verification_record）就呼叫 account-setup，
    不該讓它成功——見 §5.8 accountResult 狀態機。"""
    headers = _set_session(applicant_id)
    response = client.post(
        f"/api/applicants/{applicant_id}/account-setup",
        json={
            "accountType": "type1",
            "transactionPassword": "123456",
            "notificationPreference": {"sms": True, "email": False},
            "termsAccepted": True,
        },
        headers=headers,
    )
    assert response.status_code == 409


@requires_db
def test_account_setup_returns_400_when_terms_not_accepted(client, applicant_id):
    headers = _set_session(applicant_id)
    _add_verification_record(applicant_id, "pending_setup")
    response = client.post(
        f"/api/applicants/{applicant_id}/account-setup",
        json={
            "accountType": "type1",
            "transactionPassword": "123456",
            "notificationPreference": {"sms": True, "email": False},
            "termsAccepted": False,
        },
        headers=headers,
    )
    assert response.status_code == 400


@requires_db
def test_account_setup_returns_400_for_malformed_password(client, applicant_id):
    headers = _set_session(applicant_id)
    _add_verification_record(applicant_id, "pending_setup")
    response = client.post(
        f"/api/applicants/{applicant_id}/account-setup",
        json={
            "accountType": "type1",
            "transactionPassword": "12ab56",
            "notificationPreference": {"sms": True, "email": False},
            "termsAccepted": True,
        },
        headers=headers,
    )
    assert response.status_code == 400


@requires_db
def test_account_setup_does_not_check_deadline(client, applicant_id):
    """§5.6 流程圖：15 分鐘倒數只涵蓋③④，account-setup（步驟⑤）即使
    session 已經過了 deadline 也該成功，只要 session_id 本身還對得上。"""
    headers = _set_session(applicant_id, expired=True)
    _add_verification_record(applicant_id, "pending_setup")
    response = client.post(
        f"/api/applicants/{applicant_id}/account-setup",
        json={
            "accountType": "type1",
            "transactionPassword": "123456",
            "notificationPreference": {"sms": True, "email": False},
            "termsAccepted": True,
        },
        headers=headers,
    )
    assert response.status_code == 200


# --------------------------------------------------------------------------
# reset
# --------------------------------------------------------------------------


@requires_db
def test_reset_clears_session(client, applicant_id):
    headers = _set_session(applicant_id)
    response = client.post(f"/api/applicants/{applicant_id}/reset", headers=headers)
    assert response.status_code == 200
    assert response.json() == {"reset": True}

    session = SessionLocal()
    try:
        applicant = session.get(Applicant, applicant_id)
        assert applicant.session_id is None
        assert applicant.session_deadline_at is None
    finally:
        session.close()

    # 重置後同一個 token 不能再用
    response = client.post(f"/api/applicants/{applicant_id}/reset", headers=headers)
    assert response.status_code == 401


@requires_db
def test_reset_returns_401_without_valid_session(client, applicant_id):
    response = client.post(
        f"/api/applicants/{applicant_id}/reset", headers={"X-Session-Id": "nonexistent-token"}
    )
    assert response.status_code == 401
