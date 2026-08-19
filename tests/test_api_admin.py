"""POST /api/admin/login、GET /api/admin/records、GET /api/admin/records/
{id} 的測試（§4.9、§5.5）。透過 FastAPI TestClient 接真的 Postgres，
沒有可用連線時自動 skip。
"""

import sys
from datetime import date, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest
from fastapi.testclient import TestClient
from passlib.hash import bcrypt
from sqlalchemy import create_engine

import config
from api.database import DATABASE_URL, SessionLocal
from api.main import app
from api.models import AdminCredential, Applicant, Base, VerificationRecordRow


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
def admin_id():
    session = SessionLocal()
    try:
        credential = AdminCredential(
            username="pytest-admin-api",
            password_hash=bcrypt.using(rounds=4).hash("correct-horse-battery-staple"),
        )
        session.add(credential)
        session.commit()
        session.refresh(credential)
        yield credential.id
    finally:
        session.query(AdminCredential).filter_by(id=credential.id).delete()
        session.commit()
        session.close()


@pytest.fixture
def admin_token(admin_id):
    token = "pytest-fixed-admin-token"
    session = SessionLocal()
    try:
        admin = session.get(AdminCredential, admin_id)
        admin.token = token
        admin.token_expires_at = datetime.now() + timedelta(hours=1)
        session.commit()
    finally:
        session.close()
    return token


@pytest.fixture
def applicant_id():
    session = SessionLocal()
    try:
        applicant = Applicant(
            name="Admin測試用戶", id_number_masked="E12****987", phone="0933444555",
            email="pytest-admin-records@example.com", address="測試地址",
            birth_date=date(1995, 3, 3),
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


def _add_verification_record(applicant_id, verdict="reject", risk_score=80):
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
            baseline_challenges=[{"action": "blink", "name": "眨眼", "durationSec": 3, "passed": True}],
            baseline_verdict="pass", baseline_confidence_score=0.1,
            synthetic_fake_probability=0.9, synthetic_threshold=0.5, synthetic_verdict="reject",
            synthetic_top_signals=[{"label": "臉部邊界混合痕跡", "weight": 0.4}],
            rppg_detected=False, rppg_heart_rate=None, rppg_snr=-1.0, rppg_roi_consistency=0.3,
            rppg_checks=[], rppg_waveform=[], rppg_spectrum=[], rppg_confidence_score=0.8,
            photo_detected=False, photo_correlation=0.1, photo_latency_ms=None,
            photo_geometry_score=0.2, photo_sequence=[], photo_checks=[],
            photo_light_curve=[], photo_reflect_curve=[], photo_confidence_score=0.85,
            occ_detected=False, occ_wave_cycles=1, occ_identity_stability=0.5,
            occ_max_identity_drop=0.6, occ_segments=[], occ_layer_score=0.3,
            occ_anomaly_frames=[1, 2], occ_checks=[], occ_stability_curve=[],
            occ_confidence_score=0.9,
            risk_score=risk_score, verdict=verdict, verdict_label="拒絕", reasons=["偵測到疑似 AI 生成的臉部特徵"],
            account_result="rejected" if verdict == "reject" else "pending",
        )
        session.add(row)
        session.commit()
        session.refresh(row)
        return row.id
    finally:
        session.close()


# --------------------------------------------------------------------------
# admin/login
# --------------------------------------------------------------------------


@requires_db
def test_admin_login_succeeds_with_correct_password(client, admin_id):
    response = client.post(
        "/api/admin/login",
        json={"username": "pytest-admin-api", "password": "correct-horse-battery-staple"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["token"]


@requires_db
def test_admin_login_fails_with_wrong_password_but_still_200(client, admin_id):
    """§5.5 契約只列出 200 這一種狀態碼——失敗與成功都是 200，用
    success 欄位分辨，不是 HTTP 狀態碼。"""
    response = client.post(
        "/api/admin/login", json={"username": "pytest-admin-api", "password": "wrong"}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is False
    assert body["token"] is None


# --------------------------------------------------------------------------
# admin/records
# --------------------------------------------------------------------------


@requires_db
def test_list_records_requires_authorization_header(client):
    response = client.get("/api/admin/records")
    assert response.status_code in (401, 403)


@requires_db
def test_list_records_rejects_invalid_token(client):
    response = client.get(
        "/api/admin/records", headers={"Authorization": "Bearer not-a-real-token"}
    )
    assert response.status_code == 401


@requires_db
def test_list_records_returns_full_records_with_confidence_score(
    client, admin_token, applicant_id
):
    _add_verification_record(applicant_id, verdict="reject")

    response = client.get(
        "/api/admin/records",
        params={"limit": 10, "verdict": "reject"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert response.status_code == 200
    records = response.json()["records"]
    assert len(records) >= 1
    record = next(r for r in records if r["applicantIdMasked"] == "E12****987")
    assert record["decision"]["verdict"] == "reject"
    # 這是 2026-08-19 補上的欄位（原本漏了持久化），確認真的能從 DB 讀回來
    assert record["rppg"]["confidenceScore"] == pytest.approx(0.8)
    assert record["occlusion"]["confidenceScore"] == pytest.approx(0.9)


@requires_db
def test_get_single_record_returns_404_for_nonexistent_id(client, admin_token):
    response = client.get(
        "/api/admin/records/999999999", headers={"Authorization": f"Bearer {admin_token}"}
    )
    assert response.status_code == 404


@requires_db
def test_get_single_record_round_trips_all_five_layers(client, admin_token, applicant_id):
    record_id = _add_verification_record(applicant_id, verdict="pass", risk_score=10)

    response = client.get(
        f"/api/admin/records/{record_id}", headers={"Authorization": f"Bearer {admin_token}"}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["baseline"]["confidenceScore"] == pytest.approx(0.1)
    assert body["synthetic"]["fakeProbability"] == pytest.approx(0.9)
    assert body["photometric"]["confidenceScore"] == pytest.approx(0.85)
    assert body["decision"]["riskScore"] == 10
    assert body["vlmSummary"] is None
